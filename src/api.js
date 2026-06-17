// =============================================================================
// ChatGraph — src/api.js
// Anthropic API calls (streaming + fallback), Claude.ai input injection,
// context chain builder, and child node management.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// CLAUDE.AI INPUT INJECTION
// Drives Claude.ai's own chat input so the message appears in the real
// conversation. No API key required. The MutationObserver picks up the
// response and adds it to the graph automatically.
//
// Claude.ai uses a ProseMirror contenteditable editor. To set text in a way
// React recognises, we focus the element, select all existing content, then
// use execCommand('insertText') which fires the native input events React
// listens to. We try several fallback selectors in case Claude.ai updates
// its DOM structure.
// ─────────────────────────────────────────────────────────────────────────────

const CLAUDE_INPUT_SELECTORS = [
  'div[contenteditable="true"][data-placeholder]',
  'div[contenteditable="true"].ProseMirror',
  'div[contenteditable="true"]',
];

const CLAUDE_SEND_SELECTORS = [
  'button[aria-label="Send message"]',
  'button[aria-label="Send Message"]',
  'button[data-testid="send-button"]',
  'button[aria-label*="Send"]',
];

function findClaudeInput() {
  for (const sel of CLAUDE_INPUT_SELECTORS) {
    const el = document.querySelector(sel);
    // Make sure it's not one of our own injected elements
    if (el && !el.closest('#chatgraph-overlay')) return el;
  }
  return null;
}

function findClaudeSendButton() {
  for (const sel of CLAUDE_SEND_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && !el.closest('#chatgraph-overlay')) return el;
  }
  return null;
}

// Returns true if the injection succeeded, false if the input wasn't found.
function injectIntoClaudeInput(text) {
  const inputEl = findClaudeInput();
  if (!inputEl) {
    console.warn('[ChatGraph] Could not find Claude.ai input element. Falling back to API mode.');
    return false;
  }

  // Focus the editor and replace any existing draft text
  inputEl.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, text);

  // Small delay so React can process the input event before we click send
  setTimeout(() => {
    const sendBtn = findClaudeSendButton();
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
    } else {
      // Fallback: simulate Enter key (ProseMirror sends on Enter by default)
      inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true,
      }));
    }
  }, 80);

  return true;
}

async function handleSendMessage() {
  const userText = messageInputEl.value.trim();
  if (!userText) return;

  if (state.activeNodeId === null) {
    alert('Click a node to make it active, then send your message.');
    return;
  }

  const activeNode = state.nodes.find(n => n.id === state.activeNodeId);
  if (activeNode?.isNote) {
    alert('Note nodes are for annotations only. Click a conversation node to continue chatting.');
    return;
  }

  const effectiveMode = state.sendMode || 'claudeai';

  if (effectiveMode === 'claudeai') {
    await handleSendViaClaudeAI(userText);
  } else {
    await handleSendViaAPI(userText);
  }
}

// ── Mode A: drive Claude.ai's own UI ──────────────────────────────────────────
// Injects text into Claude.ai's input and sends it. Claude.ai handles the
// API call; the MutationObserver scrapes and adds the response node as usual.
// Falls back to API mode if the injection fails (e.g. input selector changed).
async function handleSendViaClaudeAI(userText) {
  messageInputEl.disabled       = true;
  sendButtonEl.textContent      = '…';
  messageInputEl.value          = '';
  messageInputEl.style.height   = 'auto';

  const injected = injectIntoClaudeInput(userText);

  if (!injected) {
    // Injection failed — fall back to API mode silently
    console.warn('[ChatGraph] Claude.ai injection failed, falling back to API mode.');
    messageInputEl.disabled  = false;
    sendButtonEl.textContent = '↑';
    await handleSendViaAPI(userText);
    return;
  }

  // The MutationObserver will pick up the response and call scrapeAndRender,
  // which chains the new node off the current activeNodeId automatically.
  // We just need to re-enable the input after a short delay.
  setTimeout(() => {
    messageInputEl.disabled  = false;
    sendButtonEl.textContent = '↑';
  }, 400);
}

// ── Mode B: direct Anthropic API ──────────────────────────────────────────────
async function handleSendViaAPI(userText) {
  if (!state.apiKey) {
    showSettingsPanel();
    return;
  }

  messageInputEl.disabled       = true;
  sendButtonEl.textContent      = '…';
  messageInputEl.value          = '';
  messageInputEl.style.height   = 'auto';

  const parentNodeId = state.activeNodeId;
  const messages     = buildContextChain(parentNodeId, userText);

  // Create node immediately — streaming fills in the text
  addChildNode(parentNodeId, userText, '', false);
  const streamingNodeId = state.activeNodeId;

  const getLiveAiEl = () =>
    canvasEl.querySelector(`[data-node-id="${streamingNodeId}"] .node-ai-text`);

  let accumulated = '';

  try {
    await streamAnthropicAPI(messages, (chunk) => {
      accumulated += chunk;
      const el = getLiveAiEl();
      if (el) el.innerHTML = parseMarkdown(accumulated) || '<em class="streaming-cursor">▍</em>';
    });

    const node = state.nodes.find(n => n.id === streamingNodeId);
    if (node) node.aiText = accumulated;
    const el = getLiveAiEl();
    if (el) el.innerHTML = parseMarkdown(accumulated);

  } catch (err) {
    console.error('[ChatGraph] API error:', err);
    const node = state.nodes.find(n => n.id === streamingNodeId);
    if (node) node.aiText = '[Error: ' + err.message + ']';
    const el = getLiveAiEl();
    if (el) el.textContent = '[Error: ' + err.message + ']';
  } finally {
    messageInputEl.disabled  = false;
    sendButtonEl.textContent = '↑';
  }
}

function buildContextChain(fromNodeId, newUserText) {
  const chain = [];
  let currentId = fromNodeId;

  while (currentId !== null) {
    const node = state.nodes.find(n => n.id === currentId);
    if (!node || node.isNote) break;
    chain.unshift(node);
    currentId = node.parentId;
  }

  const messages = [];

  if (chain.length > MAX_CHAIN) {
    const summarized = chain.slice(0, chain.length - MAX_CHAIN);
    const recent     = chain.slice(chain.length - MAX_CHAIN);

    const rootTopic = summarized[0].userText.slice(0, 200);
    const keyPoints = summarized.slice(-2).map(n => n.aiText.slice(0, 300)).join('\n\n---\n\n');

    messages.push({
      role: 'user',
      content: `[Context: This is a branch of a longer conversation. It started with: "${rootTopic}". Recent key points:\n${keyPoints}]\n\nPlease continue from here, keeping this context in mind.`,
    });
    messages.push({ role: 'assistant', content: 'Understood. I have the context and am ready to continue.' });
    recent.forEach(node => {
      messages.push({ role: 'user',      content: node.userText });
      messages.push({ role: 'assistant', content: node.aiText   });
    });
  } else {
    chain.forEach(node => {
      messages.push({ role: 'user',      content: node.userText });
      messages.push({ role: 'assistant', content: node.aiText   });
    });
  }

  if (newUserText) messages.push({ role: 'user', content: newUserText });
  return messages;
}

// Streaming API — calls onChunk for each token
async function streamAnthropicAPI(messages, onChunk) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         state.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 2048, stream: true, messages }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`API returned ${response.status}: ${errBody}`);
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;

      let event;
      try { event = JSON.parse(payload); } catch { continue; }

      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta?.text) {
        onChunk(event.delta.text);
      }
    }
  }
}

// Non-streaming fallback — used by branch selector (needs full response before placing node)
async function callAnthropicAPI(messages) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         state.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 2048, messages }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`API returned ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '[No response]';
}

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH SYNTHESIS
// ─────────────────────────────────────────────────────────────────────────────

function buildSynthesisMessages(synthId) {
  const explored = state.nodes.filter(n => n.id !== synthId && !n.isSynthesis && !n.isNote);

  function nodeToText(node, depth) {
    const indent = '  '.repeat(depth);
    const role   = depth === 0 ? 'THREAD' : 'BRANCH';
    const ai     = (node.aiText && !node.aiText.startsWith('['))
      ? node.aiText.slice(0, 800) + (node.aiText.length > 800 ? '…' : '')
      : '[no response yet]';
    let out = `${indent}${role}: "${node.userText}"\n${indent}RESPONSE: ${ai}\n\n`;
    explored.filter(n => n.parentId === node.id).forEach(c => { out += nodeToText(c, depth + 1); });
    return out;
  }

  let graphText = '';
  explored
    .filter(n => !n.parentId || !explored.find(p => p.id === n.parentId))
    .forEach(root => { graphText += nodeToText(root, 0); });

  const noteLines = state.stickyNotes.filter(s => s.text.trim()).map(s => `NOTE: ${s.text.trim()}`).join('\n');

  const prompt =
    `Here is a conversation graph with ${explored.length} node${explored.length !== 1 ? 's' : ''} that I've been exploring:\n\n` +
    graphText +
    (noteLines ? `\nAnnotation notes:\n${noteLines}\n\n` : '') +
    `Synthesize what's been explored. Use these exact markdown headers:\n\n` +
    `## What Was Explored\nThe main questions and topics covered across all threads.\n\n` +
    `## Key Discoveries\nThe most important insights and conclusions. Be specific.\n\n` +
    `## Tensions & Contradictions\nConflicting findings across threads, if any. If none, say so in one sentence.\n\n` +
    `## What's Still Open\nThe most valuable unanswered questions or directions worth pursuing next.`;

  return [{ role: 'user', content: prompt }];
}

async function runSynthesis(synthId) {
  const messages     = buildSynthesisMessages(synthId);
  const getLiveEl    = () => canvasEl?.querySelector(`[data-node-id="${synthId}"] .node-ai-text`);
  let   accumulated  = '';

  // Show a spinner-style placeholder while we wait for the first token
  const placeholder = getLiveEl();
  if (placeholder) placeholder.innerHTML = '<span class="streaming-cursor">▍</span>';

  try {
    await streamAnthropicAPI(messages, (chunk) => {
      accumulated += chunk;
      const el = getLiveEl();
      if (el) el.innerHTML = parseMarkdown(accumulated) + '<span class="streaming-cursor">▍</span>';
    });
    const node = state.nodes.find(n => n.id === synthId);
    if (node) node.aiText = accumulated;
    const el = getLiveEl();
    if (el) { el.innerHTML = parseMarkdown(accumulated); attachCodeCopyButtons(el); }
  } catch (err) {
    console.error('[ChatGraph] Synthesis error:', err);
    const node = state.nodes.find(n => n.id === synthId);
    const msg  = '[Synthesis error: ' + err.message + ']';
    if (node) node.aiText = msg;
    const el = getLiveEl();
    if (el) el.textContent = msg;
  }
}

function addChildNode(parentId, userText, aiText, isBranch) {
  const parent = state.nodes.find(n => n.id === parentId);
  if (!parent) return;
  if (state.nodeMap.has(userText)) return;
  pushUndo();

  const newId       = state.nextId++;
  const pos         = calcChildPosition(parentId, isBranch);
  const branchCount = isBranch ? state.nodes.filter(n => n.parentId === parentId && n.isBranch).length : 0;
  const branchColor = isBranch ? BRANCH_COLORS[branchCount % BRANCH_COLORS.length] : null;
  const newNode = { id: newId, userText, aiText, x: pos.x, y: pos.y, parentId, isBranch, branchDir: pos.branchDir, branchColor, collapsed: false };

  state.nodes.push(newNode);
  state.edges.push({ fromId: parentId, toId: newId });
  state.nodeMap.set(userText, newId);
  state.activeNodeId = newId;

  renderGraph();
  resolveAllOverlaps();
  centerOnActiveNode();
}
