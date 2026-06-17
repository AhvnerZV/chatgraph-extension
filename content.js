// =============================================================================
// ChatGraph — src/markdown.js
// Converts Claude's markdown output to safe HTML for node cards.
// Supports: fenced code blocks (with syntax highlighting), tables,
//           blockquotes/callouts, headings, HR, bold/italic/inline-code, UL, OL.
// =============================================================================

// Token-based syntax highlighter. Returns HTML-escaped string with <span class="hl-*"> tags.
// Priority order: comments > strings > keywords > builtins > numbers.
function highlightCode(rawCode, lang) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (!lang) return esc(rawCode);

  const L = lang.toLowerCase();
  const alias = { py: 'python', js: 'javascript', ts: 'typescript',
                  jsx: 'javascript', tsx: 'typescript', sh: 'bash', zsh: 'bash' };
  const resolved = alias[L] || L;

  let tokenDefs;
  if (resolved === 'python') {
    tokenDefs = [
      { cls: 'hl-comment', re: /#[^\n]*/g },
      { cls: 'hl-str',     re: /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g },
      { cls: 'hl-kw',      re: /\b(def|class|import|from|as|if|elif|else|for|while|in|not|and|or|is|None|True|False|pass|break|continue|with|try|except|finally|raise|lambda|yield|global|del|assert|async|await|return)\b/g },
      { cls: 'hl-builtin', re: /\b(print|len|range|enumerate|zip|map|filter|list|dict|set|tuple|str|int|float|bool|type|isinstance|hasattr|getattr|setattr|super|open|input|sorted|reversed|any|all|sum|min|max)\b/g },
      { cls: 'hl-num',     re: /\b0x[\da-fA-F]+|\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g },
    ];
  } else if (resolved === 'javascript' || resolved === 'typescript') {
    tokenDefs = [
      { cls: 'hl-comment', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//g },
      { cls: 'hl-str',     re: /`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g },
      { cls: 'hl-kw',      re: /\b(const|let|var|function|return|if|else|for|while|of|in|class|import|export|default|new|this|typeof|instanceof|null|undefined|true|false|async|await|try|catch|finally|throw|switch|case|break|continue|from|type|interface|extends|implements|readonly|enum|as|is|void|never|any|unknown)\b/g },
      { cls: 'hl-builtin', re: /\b(console|Math|JSON|Object|Array|String|Number|Boolean|Promise|setTimeout|clearTimeout|fetch|document|window|Error|Map|Set|Symbol|Proxy|Reflect|parseInt|parseFloat|isNaN|isFinite)\b/g },
      { cls: 'hl-num',     re: /\b0x[\da-fA-F]+|\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g },
    ];
  } else if (resolved === 'bash') {
    tokenDefs = [
      { cls: 'hl-comment', re: /#[^\n]*/g },
      { cls: 'hl-str',     re: /"(?:[^"\\]|\\.)*"|'[^']*'/g },
      { cls: 'hl-kw',      re: /\b(if|then|else|elif|fi|for|while|do|done|function|return|export|local|in|case|esac|until|select)\b/g },
      { cls: 'hl-builtin', re: /\b(echo|cd|ls|mkdir|rm|cp|mv|grep|sed|awk|cat|chmod|source|set|unset|read|exit|pwd|touch|find|curl|wget|git|npm|node|python|python3)\b/g },
      { cls: 'hl-num',     re: /\b\d+\b/g },
    ];
  } else if (resolved === 'css') {
    tokenDefs = [
      { cls: 'hl-comment', re: /\/\*[\s\S]*?\*\//g },
      { cls: 'hl-str',     re: /"[^"]*"|'[^']*'/g },
      { cls: 'hl-num',     re: /-?\d+\.?\d*(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b/g },
      { cls: 'hl-kw',      re: /\b(auto|none|block|flex|grid|inline|absolute|relative|fixed|sticky|center|left|right|top|bottom|solid|dashed|dotted|normal|bold|italic|inherit|initial|unset)\b/g },
    ];
  } else {
    return esc(rawCode);
  }

  // Collect spans in priority order — earlier defs win on overlap
  const spans = [];
  tokenDefs.forEach(({ cls, re }) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(rawCode)) !== null) {
      const start = m.index, end = m.index + m[0].length;
      if (!spans.some(s => s.start < end && s.end > start)) {
        spans.push({ start, end, cls });
      }
    }
  });
  spans.sort((a, b) => a.start - b.start);

  let out = '', pos = 0;
  for (const sp of spans) {
    if (sp.start > pos) out += esc(rawCode.slice(pos, sp.start));
    out += `<span class="${sp.cls}">${esc(rawCode.slice(sp.start, sp.end))}</span>`;
    pos = sp.end;
  }
  if (pos < rawCode.length) out += esc(rawCode.slice(pos));
  return out;
}

function parseMarkdown(text) {
  if (!text) return '';

  const escape = (s) =>
    s.replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;');

  // Fenced code blocks — syntax-highlighted + language label
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const cls      = lang ? ` class="lang-${escape(lang)}"` : '';
    const langAttr = lang ? ` data-lang="${escape(lang)}"` : '';
    const label    = lang ? `<span class="code-lang-label">${escape(lang)}</span>` : '';
    const body     = highlightCode(code.trim(), lang);
    return `<pre data-code-block="1"${langAttr}>${label}<code${cls}>${body}</code></pre>`;
  });

  const parts = text.split(/(<pre[\s\S]*?<\/pre>)/g);

  const processInline = (chunk) => {
    chunk = escape(chunk);
    chunk = chunk.replace(/`([^`]+)`/g, '<code>$1</code>');
    chunk = chunk.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    chunk = chunk.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    chunk = chunk.replace(/\*(.+?)\*/g, '<em>$1</em>');
    chunk = chunk.replace(/_([^_]+)_/g, '<em>$1</em>');
    return chunk;
  };

  const isTableRow  = (line) => line.trim().startsWith('|') && line.trim().endsWith('|');
  const isSepRow    = (line) => /^\|[\s\-|:]+\|$/.test(line.trim());

  const processBlock = (chunk) => {
    const lines  = chunk.split('\n');
    const output = [];
    let inUl = false, inOl = false, pLines = [];
    let inBq = false, bqLines = [];
    let inTable = false, tableRows = [];

    const flushP   = () => { if (pLines.length)  { output.push(`<p>${pLines.join('<br>')}</p>`); pLines = []; } };
    const closeUl  = () => { if (inUl)  { output.push('</ul>');  inUl  = false; } };
    const closeOl  = () => { if (inOl)  { output.push('</ol>');  inOl  = false; } };

    const closeBq = () => {
      if (!inBq) return;
      inBq = false;
      const raw = bqLines.join(' ').trim();
      bqLines = [];
      const CALLOUT_TYPES = ['note', 'warning', 'important', 'tip', 'key', 'info', 'caution'];
      const lc = raw.toLowerCase();
      const matched = CALLOUT_TYPES.find(t => lc.startsWith(`**${t}**`) || lc.startsWith(`**${t}:**`));
      if (matched) {
        const icons = { note: 'ℹ', warning: '⚠', important: '★', tip: '💡', key: '🔑', info: 'ℹ', caution: '⚠' };
        const body  = raw.replace(/^\*\*\w+\b[:\s*]*\*\*:?\s*/i, '');
        output.push(
          `<div class="chatgraph-callout callout-${matched}">` +
          `<span class="callout-icon">${icons[matched]}</span>` +
          `<div class="callout-body">${processInline(body)}</div></div>`
        );
      } else {
        output.push(`<blockquote>${processInline(raw)}</blockquote>`);
      }
    };

    const flushTable = () => {
      if (!inTable) return;
      inTable = false;
      const rows = tableRows.filter(r => !isSepRow(r));
      tableRows = [];
      if (rows.length === 0) return;
      const parseCells = (row) => row.trim().slice(1, -1).split('|').map(c => c.trim());
      const headers = parseCells(rows[0]);
      let html = '<table class="chatgraph-table"><thead><tr>';
      headers.forEach(h => { html += `<th>${processInline(h)}</th>`; });
      html += '</tr></thead>';
      if (rows.length > 1) {
        html += '<tbody>';
        rows.slice(1).forEach(row => {
          html += '<tr>';
          parseCells(row).forEach(c => { html += `<td>${processInline(c)}</td>`; });
          html += '</tr>';
        });
        html += '</tbody>';
      }
      html += '</table>';
      output.push(html);
    };

    lines.forEach(line => {
      // ── Table
      if (isTableRow(line)) {
        flushP(); closeUl(); closeOl(); closeBq();
        inTable = true; tableRows.push(line); return;
      } else if (inTable) { flushTable(); }

      // ── Heading
      const hMatch = line.match(/^(#{1,3})\s+(.*)/);
      if (hMatch) {
        flushP(); closeUl(); closeOl(); closeBq();
        output.push(`<h${hMatch[1].length}>${processInline(hMatch[2])}</h${hMatch[1].length}>`); return;
      }

      // ── HR
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        flushP(); closeUl(); closeOl(); closeBq();
        output.push('<hr>'); return;
      }

      // ── Blockquote / callout
      const bqMatch = line.match(/^>\s?(.*)/);
      if (bqMatch) {
        flushP(); closeUl(); closeOl();
        inBq = true; bqLines.push(bqMatch[1]); return;
      } else if (inBq) { closeBq(); }

      // ── Unordered list
      const ulMatch = line.match(/^[\s]*[-*+]\s+(.*)/);
      if (ulMatch) {
        flushP(); closeOl(); closeBq();
        if (!inUl) { output.push('<ul>'); inUl = true; }
        output.push(`<li>${processInline(ulMatch[1])}</li>`); return;
      }

      // ── Ordered list
      const olMatch = line.match(/^\s*\d+\.\s+(.*)/);
      if (olMatch) {
        flushP(); closeUl(); closeBq();
        if (!inOl) { output.push('<ol>'); inOl = true; }
        output.push(`<li>${processInline(olMatch[1])}</li>`); return;
      }

      // ── Blank line
      if (line.trim() === '') { flushP(); closeUl(); closeOl(); closeBq(); flushTable(); return; }

      // ── Paragraph text
      closeUl(); closeOl(); closeBq();
      pLines.push(processInline(line));
    });

    flushP(); closeUl(); closeOl(); closeBq(); flushTable();
    return output.join('\n');
  };

  return parts.map(part => part.startsWith('<pre') ? part : processBlock(part)).join('');
}
// =============================================================================
// ChatGraph — src/state.js
// Central state object, layout constants, and DOM element references.
// =============================================================================

const state = {
  nodes: [],
  edges: [],
  activeNodeId: null,
  nodeMap: new Map(),
  nextId: 1,
  panX: 0,
  panY: 0,
  scale: 1,
  isPanning: false,
  lastMouseX: 0,
  lastMouseY: 0,
  overlayVisible: false,
  observerActive: false,
  apiKey: null,
  lastScrapedCount: 0,
  sendMode: 'claudeai',
  pendingNodeId: null,  // ID of node currently waiting for a streaming response
  animateNodeId: null,  // set by scraper when a pending node gets its aiText; renderNode animates it
  highlights:    [],    // { parentNodeId, selectedText, color } — persisted per branch
  stickyNotes:   [],    // { id, x, y, text, rotation, connectedNodeId }
  nextStickyId:  1,
  theme:         'dark',      // 'dark' | 'light' — manual toggle
  accentColor:   '#5856D6',  // user-selected from ACCENT_COLORS
  searchQuery:    '',
  searchMatchIds: [],
  searchActiveIdx: 0,
};

const NODE_WIDTH = 480;
const H_GAP      = 60;
const V_GAP      = 80;
const MAX_CHAIN  = 4;

// Apple system palette — cycled per branch (no green; no semantic collision with system UI)
const BRANCH_COLORS  = ['#5856D6', '#AF52DE', '#5AC8FA', '#FF9500', '#FF2D55', '#007AFF'];
// Same pool for the user-selectable accent color (indigo first as default)
const ACCENT_COLORS  = ['#5856D6', '#AF52DE', '#5AC8FA', '#007AFF', '#FF9500', '#FF2D55'];

// Node tags — color is null for 'key' so it inherits the user's accent color at render time
const NODE_TAGS = {
  'explored':  { label: 'Explored',    color: '#30D158' },
  'dead-end':  { label: 'Dead end',    color: '#FF453A' },
  'follow-up': { label: 'Follow-up',   color: '#FF9500' },
  'key':       { label: 'Key insight', color: null },
};

// Undo / redo stacks — hold snapshots of graph state, max 50 entries each
const undoStack = [];
const redoStack = [];

// DOM element references — populated by buildOverlayHTML / buildToggleButton
let overlayEl      = null;
let canvasEl       = null;
let inputBarEl     = null;
let messageInputEl = null;
let sendButtonEl   = null;
let toggleButtonEl = null;
// =============================================================================
// ChatGraph — src/scraper.js
// Reads Claude.ai's DOM and syncs new message pairs into graph state.
// =============================================================================

// Clones Claude.ai's rendered response HTML, strips UI chrome, rebuilds code
// blocks with our own syntax highlighting, and returns clean innerHTML.
function sanitizeClaudeHTML(claudeEl) {
  if (!claudeEl) return '';
  const clone = claudeEl.cloneNode(true);

  // Remove buttons, icons, and other UI chrome Claude.ai injects
  clone.querySelectorAll('button, svg, [role="button"], [data-testid]').forEach(el => el.remove());
  // Remove script/style for safety
  clone.querySelectorAll('script, style, link, meta, iframe').forEach(el => el.remove());

  // Rebuild code blocks with our syntax highlighting BEFORE stripping attributes
  // (we need the class="language-*" to detect the language)
  clone.querySelectorAll('pre').forEach(pre => {
    const codeEl = pre.querySelector('code');
    const rawCode = codeEl ? codeEl.textContent : pre.textContent;

    let lang = '';
    if (codeEl) {
      for (const cls of Array.from(codeEl.classList)) {
        if (cls.startsWith('language-')) { lang = cls.slice(9); break; }
      }
    }
    if (!lang) lang = pre.getAttribute('data-lang') || pre.getAttribute('data-language') || '';

    // Rebuild with our structure
    while (pre.firstChild) pre.removeChild(pre.firstChild);
    const origAttrs = Array.from(pre.attributes).map(a => a.name);
    origAttrs.forEach(a => pre.removeAttribute(a));
    pre.setAttribute('data-code-block', '1');
    if (lang) pre.setAttribute('data-lang', lang);

    if (lang) {
      const label = document.createElement('span');
      label.className = 'code-lang-label';
      label.textContent = lang;
      pre.appendChild(label);
    }

    const newCode = document.createElement('code');
    if (lang) newCode.className = `lang-${lang}`;
    newCode.innerHTML = highlightCode(rawCode, lang);
    pre.appendChild(newCode);
  });

  // Strip all attributes from elements outside our rebuilt code blocks
  clone.querySelectorAll('*').forEach(el => {
    if (el.closest('pre')) return; // preserve our rebuilt code elements
    const attrs = Array.from(el.attributes).map(a => a.name);
    attrs.forEach(name => {
      if (name !== 'colspan' && name !== 'rowspan') el.removeAttribute(name);
    });
  });

  return clone.innerHTML;
}

function scrapeConversation() {
  const pairs = [];

  const container = document.querySelector('.flex-1.flex.flex-col.px-4.max-w-3xl');
  if (!container) {
    console.warn('[ChatGraph] Conversation container not found.');
    return pairs;
  }

  const children = Array.from(container.children);

  children.forEach((child, i) => {
    const userMsgEl = child.querySelector('[data-testid="user-message"]');
    if (!userMsgEl) return;

    const userText = userMsgEl.textContent.trim();
    if (!userText) return;

    let aiText = '';
    let aiHtml  = null;
    for (let j = i + 1; j < children.length; j++) {
      if (children[j].querySelector('[data-testid="user-message"]')) break;

      const claudeEl = children[j].querySelector('.font-claude-response');
      if (claudeEl) {
        aiText = claudeEl.textContent.trim();
        if (!aiText) {
          aiText = '[Not yet rendered — scroll near this message to load it]';
        } else {
          aiHtml = sanitizeClaudeHTML(claudeEl);
        }
        break;
      }
    }

    pairs.push({ userText, aiText, aiHtml });
  });

  return pairs;
}

function scrapeAndRender() {
  const pairs = scrapeConversation();

  pairs.forEach((pair) => {
    if (state.nodeMap.has(pair.userText)) {
      const existingId   = state.nodeMap.get(pair.userText);
      const existingNode = state.nodes.find(n => n.id === existingId);
      if (existingNode && pair.aiText && !pair.aiText.startsWith('[Not yet')) {
        existingNode.aiText = pair.aiText;
        if (pair.aiHtml) existingNode.aiHtml = pair.aiHtml;
        if (state.pendingNodeId === existingId) {
          state.pendingNodeId  = null;
          state.animateNodeId  = existingId; // signal renderNode to show response
        }
      }
      return;
    }

    // Auto-detect branch messages by prefix (fallback when pre-registration was lost,
    // e.g. after a navigation reset clears state mid-conversation)
    const isBranch = pair.userText.startsWith('Regarding:');

    let parentId = null;
    let x, y, branchDir = null;

    if (state.nodes.length === 0) {
      x = 80; y = 80;
    } else if (state.activeNodeId !== null) {
      parentId = state.activeNodeId;
      const pos = calcChildPosition(parentId, isBranch);
      x = pos.x; y = pos.y; branchDir = pos.branchDir;
    } else {
      const mainNodes = state.nodes.filter(n => !n.isBranch && !n.isNote);
      const lastMain  = mainNodes[mainNodes.length - 1];
      parentId = lastMain ? lastMain.id : null;
      if (isBranch && parentId) {
        const pos = calcChildPosition(parentId, true);
        x = pos.x; y = pos.y; branchDir = pos.branchDir;
      } else {
        x = lastMain ? lastMain.x : 80;
        y = lastMain ? avoidOverlap(x, lastMain.y + getNodeHeight(lastMain) + V_GAP) : 80;
      }
    }

    // Assign a branch color to branch nodes (same logic as addChildNode in api.js)
    const branchCount = (isBranch && parentId)
      ? state.nodes.filter(n => n.parentId === parentId && n.isBranch).length
      : 0;
    const branchColor = isBranch ? BRANCH_COLORS[branchCount % BRANCH_COLORS.length] : null;

    const newId   = state.nextId++;
    const newNode = {
      id: newId,
      userText:    pair.userText,
      aiText:      pair.aiText,
      aiHtml:      pair.aiHtml || null,
      x, y,
      parentId,
      isBranch,
      branchDir,
      branchColor,
      collapsed: false,
    };

    state.nodes.push(newNode);
    state.nodeMap.set(pair.userText, newId);
    if (parentId !== null) state.edges.push({ fromId: parentId, toId: newId });
    state.activeNodeId = newId;

    if (!pair.aiText) state.pendingNodeId = newId;
  });

  state.lastScrapedCount = pairs.length;
  renderGraph();
  resolveAllOverlaps(); // uses real DOM heights now that renderGraph() has run
  centerOnActiveNode();
}

function calcChildPosition(parentId, isBranch) {
  const parent = state.nodes.find(n => n.id === parentId);
  if (!parent) return { x: 80, y: 80, branchDir: null };

  const parentBottom = parent.y + getNodeHeight(parent);

  if (!isBranch) {
    const y = avoidOverlap(parent.x, parentBottom + V_GAP);
    return { x: parent.x, y, branchDir: null };
  } else {
    // Pick direction based on parent's position relative to the visible viewport center
    const canvasCenterX = (window.innerWidth / 2 - state.panX) / state.scale;
    const dir = parent.x > canvasCenterX ? 'left' : 'right';

    const rightSiblings = state.nodes.filter(n => n.parentId === parentId && n.isBranch && n.branchDir !== 'left').length;
    const leftSiblings  = state.nodes.filter(n => n.parentId === parentId && n.isBranch && n.branchDir === 'left').length;

    const x = dir === 'right'
      ? parent.x + (rightSiblings + 1) * (NODE_WIDTH + H_GAP)
      : parent.x - (leftSiblings  + 1) * (NODE_WIDTH + H_GAP);

    const y = avoidOverlap(x, parentBottom + V_GAP);
    return { x, y, branchDir: dir };
  }
}

function getNodeHeight(node) {
  if (node.renderedHeight) return node.renderedHeight;
  if (node.collapsed) return 52;
  if (node.isNote) return 130;
  const aiLines = Math.ceil((node.aiText || '').length / 80);
  return Math.max(120, 52 + aiLines * 20 + 32);
}

// Shifts y downward until the rect (x, y, NODE_WIDTH, ~200) doesn't overlap any
// existing node. Stops gaps from stacking or being too tight after re-layouts.
function avoidOverlap(x, y) {
  const PAD = 20;
  let shifted = true;
  while (shifted) {
    shifted = false;
    for (const n of state.nodes) {
      const nh = getNodeHeight(n);
      const xOverlap = x < n.x + NODE_WIDTH + PAD && x + NODE_WIDTH + PAD > n.x;
      const yOverlap = y < n.y + nh + PAD         && y + 120       + PAD > n.y;
      if (xOverlap && yOverlap) { y = n.y + nh + PAD; shifted = true; break; }
    }
  }
  return y;
}
// =============================================================================
// ChatGraph — src/renderer.js
// Redraws nodes, edges, active state, context menus, and settings panel.
// =============================================================================

// Shared drag state — read by mousemove/mouseup in events.js
let dragStart        = null;
let stickyDragStart  = null; // { note, clientX, clientY, origX, origY }
let minimapTransform = null; // { scale, offsetX, offsetY } — cached for click-to-pan
let connectDragState = null; // { fromNodeId, fromX, fromY, currentX, currentY } — drag-to-connect

// Smart suggestions state
let _suggestionAbortController = null;
let _suggestionNodeId          = null;

// Force layout state
let _forceLayoutActive = false;

// Focus mode — track which node is currently being focused so hideFocusMode
// can update its notes badge without knowing which node was open.
let _focusModeNodeId = null;

function applyTheme() {
  if (!overlayEl) return;

  overlayEl.classList.toggle('chatgraph-light', state.theme === 'light');

  const hex = state.accentColor || '#5856D6';
  overlayEl.style.setProperty('--accent', hex);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  overlayEl.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);

  // Toggle button lives outside the overlay so CSS vars don't flow to it — set directly
  if (toggleButtonEl) toggleButtonEl.style.setProperty('--btn-accent', hex);

  // Sync theme icon and swatch ring
  const themeBtn  = document.getElementById('chatgraph-theme-btn');
  if (themeBtn) {
    themeBtn.textContent = state.theme === 'dark' ? '☀' : '🌙';
    themeBtn.title       = state.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }
  const colorGroup = document.getElementById('chatgraph-color-group');
  if (colorGroup) {
    colorGroup.querySelectorAll('.chatgraph-color-swatch').forEach(s => {
      s.classList.toggle('selected', s.dataset.color === hex);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UNDO / REDO
// Snapshot-based: copy state before every destructive or positional action.
// ─────────────────────────────────────────────────────────────────────────────

function captureSnapshot() {
  return {
    nodes:        state.nodes.map(n => ({ ...n })),
    edges:        state.edges.map(e => ({ ...e })),
    nodeMap:      new Map(state.nodeMap),
    activeNodeId: state.activeNodeId,
    nextId:       state.nextId,
    highlights:   state.highlights.map(h => ({ ...h })),
    stickyNotes:  state.stickyNotes.map(s => ({ ...s })),
    nextStickyId: state.nextStickyId,
  };
}

function restoreSnapshot(snap) {
  state.nodes        = snap.nodes.map(n => ({ ...n }));
  state.edges        = snap.edges.map(e => ({ ...e }));
  state.nodeMap      = new Map(snap.nodeMap);
  state.activeNodeId = snap.activeNodeId;
  state.nextId       = snap.nextId;
  state.highlights   = snap.highlights.map(h => ({ ...h }));
  state.stickyNotes  = snap.stickyNotes.map(s => ({ ...s }));
  state.nextStickyId = snap.nextStickyId;
  canvasEl?.querySelectorAll('.chatgraph-sticky').forEach(el => el.remove());
}

function pushUndo() {
  undoStack.push(captureSnapshot());
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}

function performUndo() {
  if (undoStack.length === 0) return;
  redoStack.push(captureSnapshot());
  restoreSnapshot(undoStack.pop());
  renderGraph();
  updateUndoButtons();
}

function performRedo() {
  if (redoStack.length === 0) return;
  undoStack.push(captureSnapshot());
  restoreSnapshot(redoStack.pop());
  renderGraph();
  updateUndoButtons();
}

function updateUndoButtons() {
  const undoBtn = document.getElementById('chatgraph-undo-btn');
  const redoBtn = document.getElementById('chatgraph-redo-btn');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function renderGraph() {
  if (!canvasEl) return;
  canvasEl.querySelectorAll('.chatgraph-node').forEach(el => el.remove());
  renderEdges();
  state.nodes.forEach(node => renderNode(node));
  renderStickyNotes(); // add any sticky notes not yet in the DOM
  applyTransform();
  updateActiveLabel();
  applySearchHighlights();
}

// Post-render overlap resolution — runs after renderGraph() so renderedHeight
// values are real DOM measurements, not estimates. Pushes nodes downward until
// no two nodes with overlapping X ranges share the same vertical space.
function resolveAllOverlaps() {
  if (!canvasEl || state.nodes.length < 2) return;
  const PAD = 24;

  // Process top-to-bottom so pushes cascade correctly
  const sorted = [...state.nodes].sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);

  let changed = true;
  let iters   = 0;
  while (changed && iters < 60) {
    changed = false;
    iters++;
    for (let i = 0; i < sorted.length; i++) {
      const a  = sorted[i];
      const ah = getNodeHeight(a);
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        // Skip if horizontally non-overlapping (different columns)
        if (a.x + NODE_WIDTH + PAD <= b.x || b.x + NODE_WIDTH + PAD <= a.x) continue;
        const need = a.y + ah + PAD;
        if (b.y < need) {
          b.y = need;
          changed = true;
        }
      }
    }
  }

  // Apply corrected positions to DOM without a full re-render
  state.nodes.forEach(n => {
    const el = canvasEl.querySelector(`[data-node-id="${n.id}"]`);
    if (el) el.style.top = n.y + 'px';
  });
  renderEdges();
  updateMinimap();
}

// Walks up the parent chain to find the nearest branch color for a node.
// Lets branch descendants inherit their branch's accent color.
function getInheritedBranchColor(node) {
  if (node.branchColor) return node.branchColor;
  if (!node.parentId) return null;
  const parent = state.nodes.find(n => n.id === node.parentId);
  return parent ? getInheritedBranchColor(parent) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTE NODES
// Lightweight text-only annotation nodes tied to a parent Q&A node.
// Created via right-click → "Add note". Displayed with amber styling.
// ─────────────────────────────────────────────────────────────────────────────

function buildNoteCard(node, el) {
  el.classList.add('note-node');

  const header = document.createElement('div');
  header.className = 'note-node-header';

  const labelRow = document.createElement('div');
  labelRow.className = 'note-node-label-row';

  const label = document.createElement('span');
  label.className   = 'note-node-label';
  label.textContent = '📝 Note';
  labelRow.appendChild(label);

  if (node.parentId) {
    const parent = state.nodes.find(n => n.id === node.parentId);
    if (parent) {
      const ref = document.createElement('span');
      ref.className   = 'note-node-ref';
      ref.textContent = truncate(parent.userText, 34);
      labelRow.appendChild(ref);
    }
  }

  const collapseBtn = document.createElement('button');
  collapseBtn.className   = 'node-collapse-btn';
  collapseBtn.textContent = node.collapsed ? '+' : '−';
  collapseBtn.title       = node.collapsed ? 'Expand' : 'Collapse';
  collapseBtn.style.color = 'var(--text-note)';

  const body = document.createElement('div');
  body.className    = 'note-node-body';
  body.style.display = node.collapsed ? 'none' : 'block';

  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    node.collapsed = !node.collapsed;
    el.dataset.collapsed    = node.collapsed ? 'true' : 'false';
    collapseBtn.textContent = node.collapsed ? '+' : '−';
    collapseBtn.title       = node.collapsed ? 'Expand' : 'Collapse';
    body.style.display      = node.collapsed ? 'none' : 'block';
    node.renderedHeight = el.offsetHeight;
    renderEdges();
  });

  header.appendChild(labelRow);
  header.appendChild(collapseBtn);

  const textarea = document.createElement('textarea');
  textarea.className   = 'note-node-textarea';
  textarea.placeholder = 'Write a note…';
  textarea.value       = node.noteText || '';
  textarea.addEventListener('input', () => { node.noteText = textarea.value; });
  textarea.addEventListener('mousedown', (e) => e.stopPropagation());

  body.appendChild(textarea);

  el.appendChild(header);
  el.appendChild(body);

  // Drag from header only
  header.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.node-collapse-btn')) return;
    dragStart = { node, clientX: e.clientX, clientY: e.clientY, origX: node.x, origY: node.y, dragged: false };
  });

  el.addEventListener('click', (e) => {
    if (dragStart?.dragged || e._wasDrag) return;
    if (e.target.closest('.node-collapse-btn')) return;
    setActiveNode(node.id);
  });

  el.addEventListener('dblclick', (e) => e.stopPropagation());

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showNodeContextMenu(node.id, e.clientX, e.clientY);
  });
}

function createNoteNode(parentNodeId) {
  const parent = state.nodes.find(n => n.id === parentNodeId);
  if (!parent) return;
  pushUndo();

  const newId    = state.nextId++;
  const noteNode = {
    id:          newId,
    userText:    `Note — ${truncate(parent.userText, 40)}`,
    aiText:      '',
    noteText:    '',
    isNote:      true,
    parentId:    parentNodeId,
    x:           parent.x + NODE_WIDTH + H_GAP,
    y:           parent.y,
    branchColor: null,
    collapsed:   false,
    isBranch:    false,
    branchDir:   null,
  };

  state.nodes.push(noteNode);
  state.edges.push({ fromId: parentNodeId, toId: newId, isNote: true });
  state.activeNodeId = newId;

  renderGraph();
  resolveAllOverlaps();
  centerOnActiveNode();
}

function renderNode(node) {
  const el = document.createElement('div');
  el.className = 'chatgraph-node';
  el.dataset.nodeId    = node.id;
  el.dataset.collapsed = node.collapsed ? 'true' : 'false';
  el.style.left = node.x + 'px';
  el.style.top  = node.y + 'px';
  if (node.id === state.activeNodeId) el.classList.add('active');

  // Note nodes get a completely different card structure
  if (node.isNote) {
    buildNoteCard(node, el);
    canvasEl.appendChild(el);
    node.renderedHeight = el.offsetHeight;
    return;
  }

  // Apply branch color — direct or inherited from a branch ancestor
  const effectiveBranchColor = getInheritedBranchColor(node);
  if (effectiveBranchColor) {
    const { r, g, b } = hexToRgb(effectiveBranchColor);
    el.classList.add('branch-node');
    el.style.setProperty('--branch-rgb', `${r}, ${g}, ${b}`);
  }
  if (node.isSynthesis) el.classList.add('synthesis-node');

  // Header
  const header    = document.createElement('div');
  header.className = 'node-header';

  // YOU label row — includes tag pill when node is tagged
  const userLabelRow = document.createElement('div');
  userLabelRow.className = 'node-user-label-row';

  const userLabel = document.createElement('span');
  userLabel.className   = 'node-user-label';
  userLabel.textContent = node.isSynthesis ? '✦ SYNTHESIS' : 'YOU';
  userLabelRow.appendChild(userLabel);

  if (node.tag && NODE_TAGS[node.tag]) {
    const tagConf  = NODE_TAGS[node.tag];
    const tagColor = node.tag === 'key' ? (state.accentColor || '#5856D6') : tagConf.color;
    const tagPill  = document.createElement('span');
    tagPill.className = 'node-tag-pill';
    tagPill.style.setProperty('--tag-color', tagColor);
    tagPill.textContent = tagConf.label;
    userLabelRow.appendChild(tagPill);
  }

  const userText = document.createElement('span');
  userText.className   = 'node-user-text';
  userText.textContent = node.userText;

  const collapseBtn = document.createElement('button');
  collapseBtn.className   = 'node-collapse-btn';
  collapseBtn.textContent = node.collapsed ? '+' : '−';
  collapseBtn.title       = node.collapsed ? 'Expand node' : 'Collapse node';
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    node.collapsed = !node.collapsed;
    el.dataset.collapsed    = node.collapsed ? 'true' : 'false';
    collapseBtn.textContent = node.collapsed ? '+' : '−';
    collapseBtn.title       = node.collapsed ? 'Expand node' : 'Collapse node';
    body.style.display      = node.collapsed ? 'none' : 'block';
    // Clear stale height so getNodeHeight re-measures correctly after expand/collapse
    node.renderedHeight = el.offsetHeight;
    renderEdges();
  });

  const expandBtn = document.createElement('button');
  expandBtn.className   = 'node-expand-btn';
  expandBtn.textContent = '⤢';
  expandBtn.title       = 'Open in reading mode (focus view)';
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showFocusMode(node);
  });

  // Notes badge — shown inline in the YOU label row when this node has notes
  if (node.notes && node.notes.trim()) {
    userLabelRow.appendChild(buildNotesBadge(node, el));
  }

  header.appendChild(userLabelRow);
  header.appendChild(userText);
  header.appendChild(collapseBtn);
  header.appendChild(expandBtn);

  // Body
  const body = document.createElement('div');
  body.className    = 'node-body';
  body.style.display = node.collapsed ? 'none' : 'block';

  const aiLabel = document.createElement('div');
  aiLabel.className   = 'node-ai-label';
  aiLabel.textContent = 'CLAUDE';

  const aiTextEl = document.createElement('div');
  aiTextEl.className = 'node-ai-text';

  const applyNodeHtml = (el, n) => {
    const html = n.aiHtml || parseMarkdown(n.aiText);
    el.innerHTML = html;
    attachCodeCopyButtons(el);
    state.highlights
      .filter(h => h.parentNodeId === n.id)
      .forEach(h => applyHighlight(el, h.selectedText, h.color));
  };

  if (node.id === state.animateNodeId) {
    state.animateNodeId = null; // clear so re-renders don't re-animate
    if (node.aiHtml) {
      // Scraped rich HTML — reveal instantly (no typewriter needed; already rendered by Claude.ai)
      applyNodeHtml(aiTextEl, node);
    } else {
      // API mode plain markdown — animate with typewriter
      aiTextEl.innerHTML = '';
      setTimeout(() => typewriterNode(node.id, node.aiText), 50);
    }
  } else {
    applyNodeHtml(aiTextEl, node);
  }
  attachBranchSelector(aiTextEl, node);

  body.appendChild(aiLabel);
  body.appendChild(aiTextEl);

  el.appendChild(header);
  el.appendChild(body);

  // Connect port — drag from this to another node to draw a manual edge
  const portEl = document.createElement('div');
  portEl.className = 'node-connect-port';
  portEl.title     = 'Drag to connect to another node';
  portEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const r     = el.getBoundingClientRect();
    const fromX = (r.right  - state.panX) / state.scale;
    const fromY = (r.top + r.height / 2 - state.panY) / state.scale;
    connectDragState = { fromNodeId: node.id, fromX, fromY, currentX: fromX, currentY: fromY };
  });
  el.appendChild(portEl);

  // Drag only from the header so text in the body stays selectable
  header.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.node-collapse-btn')) return;
    if (e.target.closest('.node-expand-btn'))   return;
    dragStart = { node, clientX: e.clientX, clientY: e.clientY, origX: node.x, origY: node.y, dragged: false };
  });

  el.addEventListener('click', (e) => {
    if (dragStart?.dragged || e._wasDrag) return;
    if (e.target.closest('.node-collapse-btn')) return;
    if (e.target.closest('.chatgraph-branch-popup')) return;
    setActiveNode(node.id);
  });

  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    setActiveNode(node.id);
    const nodeH    = getNodeHeight(node);
    const newScale = Math.min(
      (window.innerWidth  - 80)  / NODE_WIDTH,
      (window.innerHeight - 140) / Math.max(nodeH, 80),
      1.6
    );
    state.scale = newScale;
    state.panX  = window.innerWidth  / 2 - (node.x + NODE_WIDTH / 2) * newScale;
    state.panY  = window.innerHeight / 2 - (node.y + nodeH / 2)      * newScale;
    if (canvasEl) {
      canvasEl.classList.add('zooming');
      applyTransform();
      setTimeout(() => canvasEl?.classList.remove('zooming'), 360);
    }
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showNodeContextMenu(node.id, e.clientX, e.clientY);
  });

  canvasEl.appendChild(el);
  node.renderedHeight = el.offsetHeight;
}

function showNodeContextMenu(nodeId, x, y) {
  document.getElementById('chatgraph-ctx-menu')?.remove();

  const menu = document.createElement('div');
  menu.id         = 'chatgraph-ctx-menu';
  menu.style.left = Math.min(x, window.innerWidth  - 160) + 'px';
  menu.style.top  = Math.min(y, window.innerHeight - 60)  + 'px';

  const deleteItem = document.createElement('button');
  deleteItem.className   = 'chatgraph-ctx-item chatgraph-ctx-delete';
  deleteItem.textContent = '🗑 Delete node';
  deleteItem.addEventListener('click', () => { pushUndo(); deleteNodeAndDescendants(nodeId); menu.remove(); });

  const sep = document.createElement('div');
  sep.className = 'chatgraph-ctx-sep';

  menu.appendChild(deleteItem);
  menu.appendChild(sep);

  // Tag options and note creation for non-note nodes only
  const node = state.nodes.find(n => n.id === nodeId);

  if (!node?.isNote) {
    const addNoteItem = document.createElement('button');
    addNoteItem.className   = 'chatgraph-ctx-item';
    addNoteItem.textContent = '📝 Add note';
    addNoteItem.title       = 'Create a linked note node';
    addNoteItem.addEventListener('click', () => { menu.remove(); createNoteNode(nodeId); });
    menu.appendChild(addNoteItem);

    const noteSep = document.createElement('div');
    noteSep.className = 'chatgraph-ctx-sep';
    menu.appendChild(noteSep);
  }
  if (!node?.isNote) {
    Object.entries(NODE_TAGS).forEach(([key, conf]) => {
      const tagColor = key === 'key' ? (state.accentColor || '#5856D6') : conf.color;
      const item = document.createElement('button');
      item.className   = 'chatgraph-ctx-item chatgraph-ctx-tag-item';
      const dot = document.createElement('span');
      dot.className  = 'ctx-tag-dot';
      dot.style.background = tagColor;
      dot.style.color      = tagColor;
      if (node?.tag === key) dot.classList.add('ctx-tag-dot-active');
      const label = document.createTextNode(conf.label);
      item.appendChild(dot);
      item.appendChild(label);
      item.addEventListener('click', () => {
        pushUndo();
        const n = state.nodes.find(nd => nd.id === nodeId);
        if (n) n.tag = (n.tag === key) ? null : key;
        menu.remove();
        renderGraph();
      });
      menu.appendChild(item);
    });
  }

  (overlayEl || document.body).appendChild(menu);

  const dismiss = (e) => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss); }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 50);
}

function deleteNodeAndDescendants(nodeId) {
  const toDelete = new Set();
  const collect  = (id) => { toDelete.add(id); state.nodes.filter(n => n.parentId === id).forEach(n => collect(n.id)); };
  collect(nodeId);

  state.nodes = state.nodes.filter(n => !toDelete.has(n.id));
  state.edges = state.edges.filter(e => !toDelete.has(e.fromId) && !toDelete.has(e.toId));
  toDelete.forEach(id => {
    for (const [key, val] of state.nodeMap.entries()) {
      if (val === id) { state.nodeMap.delete(key); break; }
    }
  });

  if (toDelete.has(state.activeNodeId)) {
    state.activeNodeId = state.nodes.length > 0 ? state.nodes[state.nodes.length - 1].id : null;
  }
  renderGraph();
}

function renderEdges() {
  let svg = canvasEl.querySelector('#chatgraph-svg');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'chatgraph-svg';
    canvasEl.insertBefore(svg, canvasEl.firstChild);
  }
  svg.innerHTML = '';

  state.edges.forEach(edge => {
    const fromNode = state.nodes.find(n => n.id === edge.fromId);
    const toNode   = state.nodes.find(n => n.id === edge.toId);
    if (!fromNode || !toNode) return;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const pts  = getEdgePoints(fromNode, toNode);
    path.setAttribute('d', `M${pts.x1},${pts.y1} C${pts.cp1x},${pts.cp1y} ${pts.cp2x},${pts.cp2y} ${pts.x2},${pts.y2}`);

    if (edge.isNote) {
      path.setAttribute('class', 'chatgraph-edge chatgraph-edge-note');
    } else if (toNode.isBranch) {
      path.setAttribute('class', 'chatgraph-edge chatgraph-edge-branch');
      if (toNode.branchColor) path.style.stroke = toNode.branchColor;
    } else {
      path.setAttribute('class', 'chatgraph-edge');
    }

    svg.appendChild(path);
  });

  // Sticky ↔ node connectors — same smart bezier routing as node edges
  state.stickyNotes.forEach(note => {
    if (!note.connectedNodeId) return;
    const target   = state.nodes.find(n => n.id === note.connectedNodeId);
    if (!target) return;
    const stickyEl = canvasEl?.querySelector(`[data-sticky-id="${note.id}"]`);
    const stickyH  = stickyEl ? stickyEl.offsetHeight : 130;
    const pts = getEdgePointsRect(
      { x: note.x, y: note.y, w: 210, h: stickyH },
      { x: target.x, y: target.y, w: NODE_WIDTH, h: getNodeHeight(target) }
    );
    const conn = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    conn.setAttribute('d', `M${pts.x1},${pts.y1} C${pts.cp1x},${pts.cp1y} ${pts.cp2x},${pts.cp2y} ${pts.x2},${pts.y2}`);
    conn.setAttribute('class', 'chatgraph-sticky-connector');
    svg.appendChild(conn);
  });

  // Edge labels — rendered on top of all edges so they're never obscured
  state.edges.forEach(edge => {
    if (!edge.label) return;
    const from = state.nodes.find(n => n.id === edge.fromId);
    const to   = state.nodes.find(n => n.id === edge.toId);
    if (!from || !to) return;
    const pts  = getEdgePoints(from, to);
    const midX = (pts.x1 + pts.x2) / 2;
    const midY = (pts.y1 + pts.y2) / 2;
    const lw   = Math.max(edge.label.length * 6.5 + 20, 44);
    const lh   = 20;
    const bg   = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', midX - lw / 2);
    bg.setAttribute('y', midY - lh / 2);
    bg.setAttribute('width', lw);
    bg.setAttribute('height', lh);
    bg.setAttribute('rx', '10');
    bg.setAttribute('class', 'edge-label-bg');
    svg.appendChild(bg);
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', midX);
    txt.setAttribute('y', midY);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('dominant-baseline', 'central');
    txt.setAttribute('class', 'edge-label-text');
    txt.textContent = edge.label;
    svg.appendChild(txt);
  });

  const allX = [...state.nodes.map(n => n.x + NODE_WIDTH), ...state.stickyNotes.map(n => n.x + 240), 1200];
  const allY = [...state.nodes.map(n => n.y + 400),        ...state.stickyNotes.map(n => n.y + 220), 1200];
  svg.setAttribute('width',  Math.max(...allX) + 300 + 'px');
  svg.setAttribute('height', Math.max(...allY) + 300 + 'px');
}

// Generic bezier routing — works for any two axis-aligned rectangles.
// Routes horizontally when |dx| >= |dy|, vertically otherwise.
// Used for both node↔node edges and sticky↔node connectors.
function getEdgePointsRect(fromR, toR) {
  const fromCX = fromR.x + fromR.w / 2;
  const fromCY = fromR.y + fromR.h / 2;
  const toCX   = toR.x   + toR.w   / 2;
  const toCY   = toR.y   + toR.h   / 2;
  const dx     = toCX - fromCX;
  const dy     = toCY - fromCY;

  let x1, y1, x2, y2, cp1x, cp1y, cp2x, cp2y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) { x1 = fromR.x + fromR.w; y1 = fromCY; x2 = toR.x;          y2 = toCY; }
    else         { x1 = fromR.x;            y1 = fromCY; x2 = toR.x + toR.w;  y2 = toCY; }
    const midX = (x1 + x2) / 2;
    cp1x = midX; cp1y = y1; cp2x = midX; cp2y = y2;
  } else {
    if (dy >= 0) { x1 = fromCX; y1 = fromR.y + fromR.h; x2 = toCX; y2 = toR.y;          }
    else         { x1 = fromCX; y1 = fromR.y;            x2 = toCX; y2 = toR.y + toR.h;  }
    const midY = (y1 + y2) / 2;
    cp1x = x1; cp1y = midY; cp2x = x2; cp2y = midY;
  }

  return { x1, y1, x2, y2, cp1x, cp1y, cp2x, cp2y };
}

const NOTE_NODE_WIDTH = 300;

function getEdgePoints(fromNode, toNode) {
  const lodMicro = overlayEl?.classList.contains('lod-micro');
  const h1 = lodMicro ? 36 : getNodeHeight(fromNode);
  const h2 = lodMicro ? 36 : getNodeHeight(toNode);
  const w1 = fromNode.isNote ? NOTE_NODE_WIDTH : NODE_WIDTH;
  const w2 = toNode.isNote   ? NOTE_NODE_WIDTH : NODE_WIDTH;
  return getEdgePointsRect(
    { x: fromNode.x, y: fromNode.y, w: w1, h: h1 },
    { x: toNode.x,   y: toNode.y,   w: w2, h: h2 }
  );
}

// Cubic bezier scalar at parameter t
function bezierPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}

// Returns { edge, pts } for the first edge whose bezier passes within `tol` canvas-units
// of (cx, cy). Samples 12 points along each curve — fast enough for any realistic graph.
function findEdgeNearPoint(cx, cy, tol) {
  for (const edge of state.edges) {
    const from = state.nodes.find(n => n.id === edge.fromId);
    const to   = state.nodes.find(n => n.id === edge.toId);
    if (!from || !to) continue;
    const pts = getEdgePoints(from, to);
    for (let i = 0; i <= 12; i++) {
      const t  = i / 12;
      const bx = bezierPoint(pts.x1, pts.cp1x, pts.cp2x, pts.x2, t);
      const by = bezierPoint(pts.y1, pts.cp1y, pts.cp2y, pts.y2, t);
      if (Math.sqrt((bx - cx) ** 2 + (by - cy) ** 2) < tol) return { edge, pts };
    }
  }
  return null;
}

function showEdgeLabelEditor(edge, pts, mouseEvent) {
  document.getElementById('chatgraph-edge-label-editor')?.remove();

  const midX    = (pts.x1 + pts.x2) / 2;
  const midY    = (pts.y1 + pts.y2) / 2;
  const screenX = midX * state.scale + state.panX;
  const screenY = midY * state.scale + state.panY;

  const wrap = document.createElement('div');
  wrap.id        = 'chatgraph-edge-label-editor';
  wrap.className = 'chatgraph-edge-label-editor';
  wrap.style.left = screenX + 'px';
  wrap.style.top  = (screenY - 16) + 'px';

  const input = document.createElement('input');
  input.type        = 'text';
  input.value       = edge.label || '';
  input.placeholder = 'Add label…';
  input.className   = 'chatgraph-edge-label-input';

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    pushUndo();
    edge.label = input.value.trim();
    wrap.remove();
    renderEdges();
  };
  const cancel = () => { done = true; wrap.remove(); };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { cancel(); }
  });
  input.addEventListener('blur', commit);

  wrap.appendChild(input);
  (overlayEl || document.body).appendChild(wrap);
  setTimeout(() => { input.focus(); input.select(); }, 20);
}

function setActiveNode(nodeId) {
  state.activeNodeId = nodeId;
  canvasEl.querySelectorAll('.chatgraph-node').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.nodeId) === nodeId);
  });
  updateActiveLabel();
  fetchSuggestions(nodeId);
}

function updateActiveLabel() {
  if (!inputBarEl) return;
  const label = document.getElementById('chatgraph-active-label');
  if (!label) return;

  if (state.activeNodeId !== null) {
    const node    = state.nodes.find(n => n.id === state.activeNodeId);
    const preview = node ? truncate(node.userText, 48) : '?';
    label.textContent = `Active: "${preview}"`;
  } else {
    label.textContent = 'Click a node to activate it';
  }
}

function truncate(text, maxLen) {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

// ─────────────────────────────────────────────────────────────────────────────
// SMART FOLLOW-UP SUGGESTIONS
// When a node is activated, fetch 3 suggested questions from Claude Haiku
// and show them as clickable chips above the message input.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchSuggestions(nodeId) {
  if (_suggestionAbortController) {
    _suggestionAbortController.abort();
    _suggestionAbortController = null;
  }

  if (!nodeId || !state.apiKey) { hideSuggestions(); return; }
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node || !node.aiText || node.aiText.length < 30 || node.isSynthesis) { hideSuggestions(); return; }

  _suggestionNodeId = nodeId;
  showSuggestionLoading();

  _suggestionAbortController = new AbortController();

  const messages = buildContextChain(nodeId, null);
  messages.push({
    role: 'user',
    content: 'Based on this conversation, what are 3 concise follow-up questions a curious person might ask next? Reply with ONLY 3 questions, one per line, no numbers, no bullets, no extra text. Keep each under 12 words.',
  });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': state.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, messages }),
      signal: _suggestionAbortController.signal,
    });

    if (_suggestionNodeId !== nodeId || !response.ok) { hideSuggestions(); return; }

    const data = await response.json();
    if (_suggestionNodeId !== nodeId) return;

    const text      = data.content?.[0]?.text || '';
    const questions = text.split('\n')
      .map(q => q.trim().replace(/^[-•*\d.]+\s*/, ''))
      .filter(q => q.length > 4 && q.length < 200)
      .slice(0, 3);

    if (questions.length > 0 && _suggestionNodeId === nodeId) {
      showSuggestions(questions);
    } else {
      hideSuggestions();
    }
  } catch (err) {
    if (err.name !== 'AbortError') hideSuggestions();
  }
}

function showSuggestions(questions) {
  const row = document.getElementById('chatgraph-suggestions');
  if (!row) return;
  row.innerHTML = '';
  row.style.display = 'flex';
  questions.forEach(q => {
    const chip = document.createElement('button');
    chip.className   = 'suggestion-chip';
    chip.textContent = q;
    chip.title       = q;
    chip.addEventListener('click', () => {
      if (!messageInputEl) return;
      messageInputEl.value = q;
      messageInputEl.focus();
      messageInputEl.style.height = 'auto';
      messageInputEl.style.height = Math.min(messageInputEl.scrollHeight, 160) + 'px';
    });
    row.appendChild(chip);
  });
}

function showSuggestionLoading() {
  const row = document.getElementById('chatgraph-suggestions');
  if (!row) return;
  row.innerHTML = '';
  row.style.display = 'flex';
  const span = document.createElement('span');
  span.className   = 'suggestion-loading';
  span.textContent = 'Thinking of follow-ups…';
  row.appendChild(span);
}

function hideSuggestions() {
  const row = document.getElementById('chatgraph-suggestions');
  if (row) { row.style.display = 'none'; row.innerHTML = ''; }
  _suggestionNodeId = null;
}

// Animates text into a node's ai-text div letter-by-letter after the response arrives.
function typewriterNode(nodeId, text) {
  if (!text || !canvasEl) return;
  const chunkSize = Math.max(4, Math.ceil(text.length / 90));
  let i = 0;
  const tick = () => {
    const el = canvasEl.querySelector(`[data-node-id="${nodeId}"] .node-ai-text`);
    if (!el) return;
    i = Math.min(i + chunkSize, text.length);
    const partial = text.slice(0, i);
    el.innerHTML = parseMarkdown(partial) + (i < text.length ? '<span class="streaming-cursor">▍</span>' : '');
    if (i < text.length) {
      setTimeout(tick, 16);
    } else {
      attachCodeCopyButtons(el); // attach copy buttons once animation is complete
    }
  };
  tick();
}

// ─────────────────────────────────────────────────────────────────────────────
// HIGHLIGHT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// Walks text nodes inside containerEl and wraps the first occurrence of `text`
// with a colored highlight mark. Skips if the match spans multiple DOM elements.
function applyHighlight(containerEl, text, color) {
  if (!text || !containerEl) return;
  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT, null, false);
  const nodes  = [];
  let totalText = '';
  let n;
  while ((n = walker.nextNode())) {
    nodes.push({ node: n, start: totalText.length });
    totalText += n.textContent;
  }

  const idx = totalText.indexOf(text);
  if (idx === -1) return;
  const end = idx + text.length;

  // Only handle single-text-node matches (cross-element spans are skipped gracefully)
  const hit = nodes.find(entry => entry.start <= idx && entry.start + entry.node.textContent.length >= end);
  if (!hit) return;

  const localStart = idx - hit.start;
  const localEnd   = end - hit.start;
  const content    = hit.node.textContent;
  const { r, g, b } = hexToRgb(color);

  const mark = document.createElement('mark');
  mark.className = 'chatgraph-highlight';
  mark.style.cssText = `background:rgba(${r},${g},${b},0.22);border-bottom:2px solid ${color};border-radius:2px;padding:0 1px;color:inherit;`;
  mark.textContent = content.slice(localStart, localEnd);

  const parent = hit.node.parentNode;
  const after  = document.createTextNode(content.slice(localEnd));
  parent.replaceChild(after, hit.node);
  parent.insertBefore(mark, after);
  if (localStart > 0) parent.insertBefore(document.createTextNode(content.slice(0, localStart)), mark);
}

// Finds all fenced code blocks and adds a floating Copy button to each.
function attachCodeCopyButtons(containerEl) {
  containerEl.querySelectorAll('pre[data-code-block]').forEach(pre => {
    if (pre.querySelector('.code-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className   = 'code-copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = pre.querySelector('code');
      if (!code) return;
      // execCommand fallback — no clipboard permission needed
      const ta = document.createElement('textarea');
      ta.value = code.textContent;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try {
        document.execCommand('copy');
        btn.textContent = 'Copied!';
      } catch (_) {
        btn.textContent = 'Failed';
      }
      document.body.removeChild(ta);
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
    pre.style.position = 'relative';
    pre.appendChild(btn);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STICKY NOTES
// ─────────────────────────────────────────────────────────────────────────────

// Only adds stickies that don't already have a DOM element (safe to call in renderGraph).
function renderStickyNotes() {
  state.stickyNotes.forEach(note => {
    if (!canvasEl.querySelector(`[data-sticky-id="${note.id}"]`)) renderStickyNote(note);
  });
}

function renderStickyNote(note) {
  const el = document.createElement('div');
  el.className      = 'chatgraph-sticky';
  el.dataset.stickyId = note.id;
  el.style.left     = note.x + 'px';
  el.style.top      = note.y + 'px';
  el.style.transform = `rotate(${note.rotation}deg)`;

  // ── Controls bar (also acts as drag handle)
  const controls = document.createElement('div');
  controls.className = 'sticky-controls';

  const connectBtn = document.createElement('button');
  connectBtn.className   = 'sticky-btn sticky-connect';
  connectBtn.textContent = '⊕ Connect';
  connectBtn.title       = 'Click then click a node to link';
  connectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.stickyConnectMode === note.id) {
      state.stickyConnectMode = null;
      connectBtn.classList.remove('active');
      return;
    }
    state.stickyConnectMode = note.id;
    connectBtn.classList.add('active');
    // Capture the next click on a node
    const pickNode = (ev) => {
      const nodeEl = ev.target.closest('.chatgraph-node');
      if (nodeEl) {
        ev.stopPropagation();
        note.connectedNodeId = Number(nodeEl.dataset.nodeId);
        renderEdges();
      }
      state.stickyConnectMode = null;
      connectBtn.classList.remove('active');
      document.removeEventListener('click', pickNode, true);
    };
    setTimeout(() => document.addEventListener('click', pickNode, true), 80);
  });

  const promoteBtn = document.createElement('button');
  promoteBtn.className   = 'sticky-btn sticky-promote';
  promoteBtn.textContent = '→ Ask';
  promoteBtn.title       = 'Send this note as a message from the connected node';
  promoteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const text = note.text.trim();
    if (!text) {
      // Nothing to ask — just discard the sticky
      state.stickyNotes = state.stickyNotes.filter(s => s.id !== note.id);
      el.remove();
      renderEdges();
      return;
    }

    // Require a connected node — context is essential for a meaningful response
    const linkedId   = note.connectedNodeId || state.activeNodeId;
    const linkedNode = state.nodes.find(n => n.id === linkedId);
    if (!linkedNode) {
      alert('Connect this note to a node first (⊕ button), then Ask.');
      return;
    }

    // Activate the linked node so the reply chains from it
    state.activeNodeId = linkedId;
    canvasEl?.querySelectorAll('.chatgraph-node').forEach(nodeEl => {
      nodeEl.classList.toggle('active', Number(nodeEl.dataset.nodeId) === linkedId);
    });
    updateActiveLabel();

    // Remove the sticky before sending
    state.stickyNotes = state.stickyNotes.filter(s => s.id !== note.id);
    el.remove();
    renderEdges();

    // Send note text as a new message continuing from the linked node
    const effectiveMode = state.sendMode || 'claudeai';
    if (effectiveMode === 'claudeai') {
      await handleSendViaClaudeAI(text);
    } else {
      await handleSendViaAPI(text);
    }
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className   = 'sticky-btn sticky-delete';
  deleteBtn.textContent = '×';
  deleteBtn.title       = 'Delete note';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pushUndo();
    state.stickyNotes = state.stickyNotes.filter(s => s.id !== note.id);
    el.remove();
    renderEdges();
  });

  controls.appendChild(connectBtn);
  controls.appendChild(promoteBtn);
  controls.appendChild(deleteBtn);

  // ── Textarea
  const textarea = document.createElement('textarea');
  textarea.className   = 'sticky-textarea';
  textarea.placeholder = 'Add a note…';
  textarea.value       = note.text;
  textarea.addEventListener('input', () => { note.text = textarea.value; });
  textarea.addEventListener('mousedown', (e) => e.stopPropagation()); // don't start drag

  el.appendChild(controls);
  el.appendChild(textarea);

  // ── Drag (from anywhere except textarea/buttons)
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('textarea') || e.target.closest('button')) return;
    e.stopPropagation();
    pushUndo();
    stickyDragStart = { note, clientX: e.clientX, clientY: e.clientY, origX: note.x, origY: note.y };
  });

  canvasEl.appendChild(el);
}


// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PANEL
// An in-overlay modal for mode toggle + API key. Reachable from the toolbar
// "⚙ Settings" button and triggered automatically when a missing key blocks
// a branch or send action.
// ─────────────────────────────────────────────────────────────────────────────

function buildSettingsPanel() {
  const backdrop = document.createElement('div');
  backdrop.id    = 'chatgraph-settings-backdrop';

  const panel = document.createElement('div');
  panel.id    = 'chatgraph-settings-panel';

  // ── Header
  const header = document.createElement('div');
  header.className = 'settings-header';

  const title = document.createElement('span');
  title.className   = 'settings-title';
  title.textContent = '⚙ Settings';

  const closeBtn = document.createElement('button');
  closeBtn.className   = 'settings-close-btn';
  closeBtn.textContent = '✕';
  closeBtn.title       = 'Close settings';
  closeBtn.addEventListener('click', hideSettingsPanel);

  header.appendChild(title);
  header.appendChild(closeBtn);

  // ── Mode toggle
  const modeLabel = document.createElement('div');
  modeLabel.className   = 'settings-section-label';
  modeLabel.textContent = 'Send mode';

  const modeGroup = document.createElement('div');
  modeGroup.className = 'settings-mode-group';

  const modes = [
    { value: 'claudeai', title: 'Use Claude.ai directly',  desc: 'No API key needed for main thread. Drives the Claude.ai tab you have open.' },
    { value: 'api',      title: 'Use my own API key',      desc: 'Calls Anthropic directly. Required for all messages and branches.' },
  ];

  modes.forEach(m => {
    const card = document.createElement('div');
    card.className       = 'settings-mode-card';
    card.dataset.mode    = m.value;

    const radio = document.createElement('input');
    radio.type  = 'radio';
    radio.name  = 'chatgraph-mode';
    radio.value = m.value;

    const text = document.createElement('div');
    text.className = 'settings-mode-text';
    text.innerHTML = `<strong>${m.title}</strong><span>${m.desc}</span>`;

    card.appendChild(radio);
    card.appendChild(text);
    modeGroup.appendChild(card);

    card.addEventListener('click', () => {
      modeGroup.querySelectorAll('.settings-mode-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      radio.checked = true;
      const newMode = m.value;
      state.sendMode = newMode;
      chrome.storage.local.set({ sendMode: newMode });
    });
  });

  // ── API key
  const keyLabel = document.createElement('div');
  keyLabel.className   = 'settings-section-label';
  keyLabel.textContent = 'Anthropic API key';

  const keyNote = document.createElement('p');
  keyNote.className   = 'settings-key-note';
  keyNote.textContent = 'Required for branches in either mode. Also required for all messages in "API key" mode.';

  const keyInput = document.createElement('input');
  keyInput.id          = 'chatgraph-settings-key-input';
  keyInput.type        = 'password';
  keyInput.placeholder = 'sk-ant-…';
  keyInput.className   = 'settings-key-input';
  keyInput.autocomplete = 'off';

  const saveRow = document.createElement('div');
  saveRow.className = 'settings-save-row';

  const saveBtn = document.createElement('button');
  saveBtn.className   = 'settings-save-btn';
  saveBtn.textContent = 'Save';

  const saveStatus = document.createElement('span');
  saveStatus.className = 'settings-save-status';

  saveBtn.addEventListener('click', () => {
    const key = keyInput.value.trim();
    if (!key) return;
    state.apiKey = key;
    chrome.storage.local.set({ apiKey: key }, () => {
      saveStatus.textContent = 'Saved ✓';
      setTimeout(() => {
        saveStatus.textContent = '';
        hideSettingsPanel();
      }, 1200);
    });
  });

  keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
  });

  saveRow.appendChild(saveBtn);
  saveRow.appendChild(saveStatus);

  panel.appendChild(header);
  panel.appendChild(modeLabel);
  panel.appendChild(modeGroup);
  panel.appendChild(keyLabel);
  panel.appendChild(keyNote);
  panel.appendChild(keyInput);
  panel.appendChild(saveRow);

  backdrop.appendChild(panel);

  // Close on backdrop click (outside the panel card)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hideSettingsPanel();
  });

  overlayEl.appendChild(backdrop);
}

function showSettingsPanel() {
  const backdrop = document.getElementById('chatgraph-settings-backdrop');
  if (!backdrop) return;

  // Pre-fill key input
  const keyInput = document.getElementById('chatgraph-settings-key-input');
  if (keyInput && state.apiKey) keyInput.value = state.apiKey;

  // Reflect current mode in the cards
  const modeCards = backdrop.querySelectorAll('.settings-mode-card');
  modeCards.forEach(card => {
    const isActive = card.dataset.mode === (state.sendMode || 'claudeai');
    card.classList.toggle('selected', isActive);
    card.querySelector('input').checked = isActive;
  });

  backdrop.style.display = 'flex';
  if (keyInput) setTimeout(() => keyInput.focus(), 50);
}

function hideSettingsPanel() {
  const backdrop = document.getElementById('chatgraph-settings-backdrop');
  if (backdrop) backdrop.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────────────────────

function openSearch() {
  const bar = document.getElementById('chatgraph-search-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  const input = document.getElementById('chatgraph-search-input');
  if (input) { input.focus(); input.select(); }
}

function closeSearch() {
  const bar = document.getElementById('chatgraph-search-bar');
  if (bar) bar.style.display = 'none';
  const input = document.getElementById('chatgraph-search-input');
  if (input) input.value = '';
  state.searchQuery     = '';
  state.searchMatchIds  = [];
  state.searchActiveIdx = 0;
  canvasEl?.querySelectorAll('.search-match, .search-active').forEach(el => {
    el.classList.remove('search-match', 'search-active');
  });
  updateSearchCount();
}

function performSearch(query) {
  state.searchQuery = query;
  const q = query.trim().toLowerCase();
  if (!q) {
    state.searchMatchIds  = [];
    state.searchActiveIdx = 0;
    applySearchHighlights();
    updateSearchCount();
    return;
  }
  state.searchMatchIds = state.nodes
    .filter(n =>
      n.userText.toLowerCase().includes(q) ||
      (n.aiText   || '').toLowerCase().includes(q) ||
      (n.noteText || '').toLowerCase().includes(q)
    )
    .map(n => n.id);
  state.searchActiveIdx = 0;
  applySearchHighlights();
  centerOnSearchMatch();
  updateSearchCount();
}

function cycleSearch(dir) {
  if (state.searchMatchIds.length === 0) return;
  state.searchActiveIdx = (state.searchActiveIdx + dir + state.searchMatchIds.length) % state.searchMatchIds.length;
  applySearchHighlights();
  centerOnSearchMatch();
  updateSearchCount();
}

function centerOnSearchMatch() {
  const nodeId = state.searchMatchIds[state.searchActiveIdx];
  if (nodeId === undefined) return;
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;
  state.panX = window.innerWidth  / 2 - (node.x + NODE_WIDTH / 2) * state.scale;
  state.panY = window.innerHeight / 2 - (node.y + getNodeHeight(node) / 2) * state.scale;
  applyTransform();
}

function applySearchHighlights() {
  if (!canvasEl) return;
  canvasEl.querySelectorAll('.chatgraph-node').forEach(el => {
    const id = Number(el.dataset.nodeId);
    el.classList.toggle('search-match',   state.searchMatchIds.includes(id) && id !== state.searchMatchIds[state.searchActiveIdx]);
    el.classList.toggle('search-active',  id === state.searchMatchIds[state.searchActiveIdx]);
  });
}

function updateSearchCount() {
  const countEl = document.getElementById('chatgraph-search-count');
  if (!countEl) return;
  if (state.searchMatchIds.length === 0) {
    countEl.textContent = state.searchQuery.trim() ? 'No matches' : '';
  } else {
    countEl.textContent = `${state.searchActiveIdx + 1} / ${state.searchMatchIds.length}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

function showExportPopover(anchorEl) {
  document.getElementById('chatgraph-export-popover')?.remove();

  const popover = document.createElement('div');
  popover.id        = 'chatgraph-export-popover';
  popover.className = 'chatgraph-export-popover';

  const rect = anchorEl.getBoundingClientRect();
  popover.style.top  = (rect.bottom + 8) + 'px';
  popover.style.left = rect.left + 'px';

  const items = [
    { label: '{ } JSON  —  save & reload', fn: exportJSON },
    { label: '#  Markdown  —  conversation tree', fn: exportMarkdown },
  ];

  items.forEach(({ label, fn }) => {
    const btn = document.createElement('button');
    btn.className   = 'chatgraph-export-item';
    btn.textContent = label;
    btn.addEventListener('click', () => { fn(); popover.remove(); });
    popover.appendChild(btn);
  });

  (overlayEl || document.body).appendChild(popover);

  const dismiss = (ev) => {
    if (!popover.contains(ev.target) && ev.target !== anchorEl) {
      popover.remove();
      document.removeEventListener('mousedown', dismiss, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 50);
}

function exportJSON() {
  const data = {
    version:     1,
    exportedAt:  new Date().toISOString(),
    nodes:       state.nodes,
    edges:       state.edges,
    highlights:  state.highlights,
    stickyNotes: state.stickyNotes,
    panX:        state.panX,
    panY:        state.panY,
    scale:       state.scale,
  };
  downloadFile(JSON.stringify(data, null, 2), 'chatgraph-export.json', 'application/json');
}

function exportMarkdown() {
  let md = '# ChatGraph Export\n\n';
  md += `*${new Date().toLocaleString()}*\n\n---\n\n`;

  const visited = new Set();

  function nodeToMd(node, depth) {
    if (visited.has(node.id) || node.isNote) return '';
    visited.add(node.id);
    const h  = '#'.repeat(Math.min(depth + 1, 6));
    let out  = `${h} ${node.userText}\n\n`;
    if (node.aiText && !node.aiText.startsWith('[Not yet')) {
      out += `${node.aiText}\n\n`;
    }
    state.nodes
      .filter(n => n.parentId === node.id && !n.isNote)
      .forEach(child => { out += nodeToMd(child, depth + 1); });
    return out;
  }

  state.nodes.filter(n => !n.parentId && !n.isNote).forEach(root => { md += nodeToMd(root, 0); });

  const noteNodes = state.nodes.filter(n => n.isNote && n.noteText && n.noteText.trim());
  if (noteNodes.length > 0) {
    md += '---\n\n## 📝 Note Nodes\n\n';
    noteNodes.forEach(n => {
      const parent = state.nodes.find(p => p.id === n.parentId);
      if (parent) md += `> *Re: "${truncate(parent.userText, 50)}"*\n\n`;
      md += `${n.noteText.trim()}\n\n`;
    });
  }

  const notes = state.stickyNotes.filter(s => s.text.trim());
  if (notes.length > 0) {
    md += '---\n\n## Sticky Notes\n\n';
    notes.forEach(s => { md += `- ${s.text.trim()}\n`; });
    md += '\n';
  }

  downloadFile(md, 'chatgraph-export.md', 'text/markdown');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAG-TO-CONNECT
// Draws a live dashed bezier while the user drags from a port to a target node.
// ─────────────────────────────────────────────────────────────────────────────

function renderConnectLine() {
  if (!connectDragState) return;
  const svg = canvasEl?.querySelector('#chatgraph-svg');
  if (!svg) return;
  let line = svg.querySelector('#chatgraph-connect-line');
  if (!line) {
    line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.id = 'chatgraph-connect-line';
    line.setAttribute('class', 'chatgraph-connect-line');
    svg.appendChild(line);
  }
  const { fromX, fromY, currentX, currentY } = connectDragState;
  const midX = (fromX + currentX) / 2;
  line.setAttribute('d', `M${fromX},${fromY} C${midX},${fromY} ${midX},${currentY} ${currentX},${currentY}`);
}

function removeConnectLine() {
  canvasEl?.querySelector('#chatgraph-connect-line')?.remove();
}

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH SYNTHESIS NODE
// ─────────────────────────────────────────────────────────────────────────────

function createSynthesisNode() {
  if (!state.apiKey) { showSettingsPanel(); return; }
  const realNodes = state.nodes.filter(n => !n.isSynthesis);
  if (realNodes.length === 0) {
    alert('Add some conversation nodes to the graph before synthesizing.');
    return;
  }

  pushUndo();

  const maxY   = Math.max(...realNodes.map(n => n.y + getNodeHeight(n)));
  const minX   = Math.min(...realNodes.map(n => n.x));
  const maxX   = Math.max(...realNodes.map(n => n.x + NODE_WIDTH));
  const centerX = Math.round((minX + maxX) / 2 - NODE_WIDTH / 2);
  const startY  = maxY + 100;
  const finalY  = avoidOverlap(centerX, startY);

  const synthId   = state.nextId++;
  const synthNode = {
    id: synthId,
    userText:    'Graph Synthesis',
    aiText:      '',
    x:            Math.max(80, centerX),
    y:            finalY,
    parentId:     null,
    isBranch:     false,
    branchColor:  null,
    collapsed:    false,
    isSynthesis:  true,
  };

  state.nodes.push(synthNode);
  state.activeNodeId = synthId;
  renderGraph();
  resolveAllOverlaps();
  centerOnActiveNode();

  runSynthesis(synthId); // defined in api.js
}

// ─────────────────────────────────────────────────────────────────────────────
// FORCE-DIRECTED AUTO-LAYOUT
// Physics simulation: Coulomb repulsion between all node pairs + Hooke spring
// attraction along edges. Runs in rAF batches for smooth animation.
// ─────────────────────────────────────────────────────────────────────────────

function applyForceLayout() {
  if (state.nodes.length < 2 || _forceLayoutActive) return;
  pushUndo();
  _forceLayoutActive = true;

  const btn = document.getElementById('chatgraph-layout-btn');
  if (btn) { btn.textContent = '⊹ Running…'; btn.disabled = true; }

  const REPEL  = 140000; // repulsion constant (px^3 equivalent)
  const SPRING = 0.04;   // spring constant
  const REST   = NODE_WIDTH + H_GAP + 80; // natural edge rest length
  const DAMP   = 0.80;   // velocity damping per step
  const ITERS  = 280;    // total iterations
  const BATCH  = 28;     // iterations per animation frame (~10 frames)

  const vel = new Map(state.nodes.map(n => [n.id, { vx: 0, vy: 0 }]));
  let iter = 0;

  function tick() {
    if (!_forceLayoutActive || !state.overlayVisible) {
      _forceLayoutActive = false;
      if (btn) { btn.textContent = '⊹ Layout'; btn.disabled = false; }
      return;
    }

    for (let b = 0; b < BATCH && iter < ITERS; b++, iter++) {
      const forces = new Map(state.nodes.map(n => [n.id, { fx: 0, fy: 0 }]));

      // Coulomb repulsion between all node pairs (center-to-center)
      for (let i = 0; i < state.nodes.length; i++) {
        for (let j = i + 1; j < state.nodes.length; j++) {
          const na = state.nodes[i], nb = state.nodes[j];
          const ax = na.x + NODE_WIDTH / 2, ay = na.y + getNodeHeight(na) / 2;
          const bx = nb.x + NODE_WIDTH / 2, by = nb.y + getNodeHeight(nb) / 2;
          const dx = bx - ax, dy = by - ay;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const f  = REPEL / (dist * dist);
          const fx = f * dx / dist, fy = f * dy / dist;
          forces.get(na.id).fx -= fx; forces.get(na.id).fy -= fy;
          forces.get(nb.id).fx += fx; forces.get(nb.id).fy += fy;
        }
      }

      // Hooke spring attraction along edges
      state.edges.forEach(edge => {
        const na = state.nodes.find(n => n.id === edge.fromId);
        const nb = state.nodes.find(n => n.id === edge.toId);
        if (!na || !nb) return;
        const ax = na.x + NODE_WIDTH / 2, ay = na.y + getNodeHeight(na) / 2;
        const bx = nb.x + NODE_WIDTH / 2, by = nb.y + getNodeHeight(nb) / 2;
        const dx = bx - ax, dy = by - ay;
        const dist    = Math.sqrt(dx * dx + dy * dy) || 1;
        const stretch = dist - REST;
        const fx = SPRING * stretch * dx / dist, fy = SPRING * stretch * dy / dist;
        forces.get(na.id).fx += fx; forces.get(na.id).fy += fy;
        forces.get(nb.id).fx -= fx; forces.get(nb.id).fy -= fy;
      });

      // Integrate velocity → position
      state.nodes.forEach(n => {
        const v = vel.get(n.id), f = forces.get(n.id);
        v.vx = (v.vx + f.fx) * DAMP;
        v.vy = (v.vy + f.fy) * DAMP;
        n.x = Math.max(20, n.x + v.vx);
        n.y = Math.max(20, n.y + v.vy);
      });
    }

    // Update DOM positions without a full re-render (fast)
    state.nodes.forEach(n => {
      const el = canvasEl?.querySelector(`[data-node-id="${n.id}"]`);
      if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
    });
    renderEdges();
    updateMinimap();

    if (iter < ITERS) {
      requestAnimationFrame(tick);
    } else {
      _forceLayoutActive = false;
      if (btn) { btn.textContent = '⊹ Layout'; btn.disabled = false; }
      fitAllNodes();
    }
  }

  requestAnimationFrame(tick);
}

// ─────────────────────────────────────────────────────────────────────────────
// FOCUS / READING MODE
// Full-screen takeover: scrollable Q+A content, pinned notes, pinned chat bar.
// ─────────────────────────────────────────────────────────────────────────────

// Creates the 📝 badge element. Clicking toggles an inline note preview
// inside the node card (inserted between header and body).
function buildNotesBadge(node, nodeEl) {
  const badge = document.createElement('button');
  badge.className   = 'node-notes-badge';
  badge.textContent = '📝';
  badge.title       = 'Toggle notes';
  badge.addEventListener('mousedown', (e) => e.stopPropagation());
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = nodeEl.querySelector('.node-notes-inline');
    if (existing) { existing.remove(); return; }
    const inline = document.createElement('div');
    inline.className   = 'node-notes-inline';
    inline.textContent = node.notes || '';
    inline.addEventListener('mousedown', (ev) => ev.stopPropagation());
    const body = nodeEl.querySelector('.node-body');
    nodeEl.insertBefore(inline, body);
  });
  return badge;
}

// Called after focus mode closes — adds or removes the badge on the node card
// without triggering a full renderGraph().
function updateNodeNotesBadge(nodeId) {
  const node = state.nodes.find(n => n.id === nodeId);
  if (!node) return;
  const nodeEl = canvasEl?.querySelector(`[data-node-id="${nodeId}"]`);
  if (!nodeEl) return;
  const labelRow = nodeEl.querySelector('.node-user-label-row');
  if (!labelRow) return;

  const existingBadge = labelRow.querySelector('.node-notes-badge');
  const hasNotes = !!(node.notes && node.notes.trim());

  if (hasNotes && !existingBadge) {
    labelRow.appendChild(buildNotesBadge(node, nodeEl));
  } else if (!hasNotes && existingBadge) {
    existingBadge.remove();
    nodeEl.querySelector('.node-notes-inline')?.remove();
  } else if (hasNotes && existingBadge) {
    // Notes changed — update existing inline preview if it's open
    const inline = nodeEl.querySelector('.node-notes-inline');
    if (inline) inline.textContent = node.notes;
  }
}

function showFocusMode(node) {
  document.getElementById('chatgraph-focus-backdrop')?.remove();
  _focusModeNodeId = node.id;

  const backdrop = document.createElement('div');
  backdrop.id = 'chatgraph-focus-backdrop';

  const panel = document.createElement('div');
  panel.id = 'chatgraph-focus-panel';

  // ── Top bar: back button + node preview label
  const topbar = document.createElement('div');
  topbar.className = 'focus-topbar';

  const backBtn = document.createElement('button');
  backBtn.className   = 'focus-back-btn';
  backBtn.textContent = '← Back';
  backBtn.title       = 'Close focus mode (Esc)';
  backBtn.addEventListener('click', hideFocusMode);

  const topLabel = document.createElement('span');
  topLabel.className   = 'focus-topbar-label';
  topLabel.textContent = truncate(node.userText, 52);

  topbar.appendChild(backBtn);
  topbar.appendChild(topLabel);

  // ── Scrollable content: YOU question + Claude answer
  const scrollable = document.createElement('div');
  scrollable.className = 'focus-scrollable';

  const youLabel = document.createElement('div');
  youLabel.className = 'focus-you-label';
  const youLabelText = document.createElement('span');
  youLabelText.textContent = 'YOU';
  youLabel.appendChild(youLabelText);

  if (node.tag && NODE_TAGS[node.tag]) {
    const tagConf  = NODE_TAGS[node.tag];
    const tagColor = node.tag === 'key' ? (state.accentColor || '#5856D6') : tagConf.color;
    const tagPill  = document.createElement('span');
    tagPill.className = 'node-tag-pill';
    tagPill.style.setProperty('--tag-color', tagColor);
    tagPill.textContent = tagConf.label;
    youLabel.appendChild(tagPill);
  }

  const youText = document.createElement('div');
  youText.className   = 'focus-you-text';
  youText.textContent = node.userText;

  const divider = document.createElement('div');
  divider.className = 'focus-divider';

  const claudeLabel = document.createElement('div');
  claudeLabel.className   = 'focus-claude-label';
  claudeLabel.textContent = 'CLAUDE';

  const claudeText = document.createElement('div');
  claudeText.className = 'focus-claude-text node-ai-text';
  const focusHtml = node.aiHtml || (node.aiText && !node.aiText.startsWith('[') ? parseMarkdown(node.aiText) : null);
  if (focusHtml) {
    claudeText.innerHTML = focusHtml;
    attachCodeCopyButtons(claudeText);
    state.highlights
      .filter(h => h.parentNodeId === node.id)
      .forEach(h => applyHighlight(claudeText, h.selectedText, h.color));
  } else {
    claudeText.innerHTML = '<span style="opacity:0.35">Response not yet available.</span>';
  }

  scrollable.appendChild(youLabel);
  scrollable.appendChild(youText);
  scrollable.appendChild(divider);
  scrollable.appendChild(claudeLabel);
  scrollable.appendChild(claudeText);

  // ── Notes section (pinned, not scrollable)
  const notesSec = document.createElement('div');
  notesSec.className = 'focus-notes-section';

  const notesLabel = document.createElement('div');
  notesLabel.className   = 'focus-notes-label';
  notesLabel.textContent = '📝 Notes';

  const notesInput = document.createElement('textarea');
  notesInput.className   = 'focus-notes-input';
  notesInput.placeholder = 'Add notes about this exchange…';
  notesInput.value       = node.notes || '';
  notesInput.addEventListener('input', () => { node.notes = notesInput.value; });

  notesSec.appendChild(notesLabel);
  notesSec.appendChild(notesInput);

  // ── Chat bar (pinned at bottom)
  const chatBar = document.createElement('div');
  chatBar.className = 'focus-chat-bar';

  const chatInput = document.createElement('textarea');
  chatInput.className   = 'focus-chat-input';
  chatInput.placeholder = 'Continue from this node…';
  chatInput.rows        = 1;
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });

  const chatSend = document.createElement('button');
  chatSend.className   = 'focus-chat-send';
  chatSend.textContent = '↑';
  chatSend.title       = 'Send (Enter)';

  const doSend = async () => {
    const text = chatInput.value.trim();
    if (!text) return;
    state.activeNodeId = node.id;
    hideFocusMode();
    const effectiveMode = state.sendMode || 'claudeai';
    if (effectiveMode === 'claudeai') {
      await handleSendViaClaudeAI(text);
    } else {
      await handleSendViaAPI(text);
    }
  };

  chatSend.addEventListener('click', doSend);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });

  chatBar.appendChild(chatInput);
  chatBar.appendChild(chatSend);

  // ── Assemble panel
  panel.appendChild(topbar);
  panel.appendChild(scrollable);
  panel.appendChild(notesSec);
  panel.appendChild(chatBar);

  backdrop.appendChild(panel);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) hideFocusMode(); });

  overlayEl.appendChild(backdrop);
}

function hideFocusMode() {
  if (_focusModeNodeId !== null) {
    updateNodeNotesBadge(_focusModeNodeId);
    _focusModeNodeId = null;
  }
  document.getElementById('chatgraph-focus-backdrop')?.remove();
}

// ─────────────────────────────────────────────────────────────────────────────
// MINIMAP
// ─────────────────────────────────────────────────────────────────────────────

function updateMinimap() {
  const miniCanvas = document.getElementById('chatgraph-minimap-canvas');
  if (!miniCanvas || !state.overlayVisible) return;

  const ctx  = miniCanvas.getContext('2d');
  const W    = miniCanvas.width;
  const H    = miniCanvas.height;
  const dark = state.theme !== 'light';

  ctx.clearRect(0, 0, W, H);

  if (state.nodes.length === 0 && state.stickyNotes.length === 0) {
    minimapTransform = null;
    return;
  }

  // Bounding box that always includes the current viewport
  const vpX = -state.panX / state.scale;
  const vpY = -state.panY / state.scale;
  const vpW = window.innerWidth  / state.scale;
  const vpH = window.innerHeight / state.scale;

  const allX = [vpX, vpX + vpW,
    ...state.nodes.map(n => n.x), ...state.nodes.map(n => n.x + NODE_WIDTH),
    ...state.stickyNotes.map(s => s.x), ...state.stickyNotes.map(s => s.x + 210)];
  const allY = [vpY, vpY + vpH,
    ...state.nodes.map(n => n.y), ...state.nodes.map(n => n.y + getNodeHeight(n)),
    ...state.stickyNotes.map(s => s.y), ...state.stickyNotes.map(s => s.y + 130)];

  const PAD  = 16;
  const minX = Math.min(...allX) - PAD;
  const minY = Math.min(...allY) - PAD;
  const maxX = Math.max(...allX) + PAD;
  const maxY = Math.max(...allY) + PAD;

  const gW      = maxX - minX;
  const gH      = maxY - minY;
  const mmScale = Math.min(W / gW, H / gH);
  const ofsX    = (W - gW * mmScale) / 2 - minX * mmScale;
  const ofsY    = (H - gH * mmScale) / 2 - minY * mmScale;

  minimapTransform = { scale: mmScale, offsetX: ofsX, offsetY: ofsY };

  const mx = (x) => x * mmScale + ofsX;
  const my = (y) => y * mmScale + ofsY;

  // Edges (straight lines — fast approximation)
  ctx.lineWidth   = 1;
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
  state.edges.forEach(edge => {
    const from = state.nodes.find(n => n.id === edge.fromId);
    const to   = state.nodes.find(n => n.id === edge.toId);
    if (!from || !to) return;
    ctx.beginPath();
    ctx.moveTo(mx(from.x + NODE_WIDTH / 2), my(from.y + getNodeHeight(from) / 2));
    ctx.lineTo(mx(to.x   + NODE_WIDTH / 2), my(to.y   + getNodeHeight(to)   / 2));
    ctx.stroke();
  });

  // Nodes
  state.nodes.forEach(node => {
    const nx = mx(node.x);
    const ny = my(node.y);
    const nw = Math.max((node.isNote ? NOTE_NODE_WIDTH : NODE_WIDTH) * mmScale, 4);
    const nh = Math.max(getNodeHeight(node) * mmScale, 3);

    ctx.fillStyle = node.isNote
      ? (dark ? 'rgba(50, 35, 0, 0.9)'   : 'rgba(255, 248, 200, 0.9)')
      : (dark ? 'rgba(44, 44, 46, 0.96)' : 'rgba(255, 255, 255, 0.96)');
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(nx, ny, nw, nh, 2); else ctx.rect(nx, ny, nw, nh);
    ctx.fill();

    const isActive = node.id === state.activeNodeId;
    ctx.strokeStyle = isActive
      ? (state.accentColor || '#5856D6')
      : node.isNote
        ? (dark ? 'rgba(200, 150, 30, 0.55)' : 'rgba(160, 100, 0, 0.4)')
        : node.branchColor
          ? node.branchColor + '90'
          : (dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)');
    ctx.lineWidth = isActive ? 1.5 : 0.75;
    ctx.stroke();
  });

  // Sticky notes
  state.stickyNotes.forEach(s => {
    ctx.fillStyle = dark ? 'rgba(50,48,18,0.85)' : 'rgba(255,252,230,0.85)';
    ctx.fillRect(mx(s.x), my(s.y), Math.max(210 * mmScale, 3), Math.max(130 * mmScale, 3));
  });

  // Viewport rectangle
  ctx.fillStyle   = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  ctx.fillRect(mx(vpX), my(vpY), vpW * mmScale, vpH * mmScale);
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.42)';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(mx(vpX), my(vpY), vpW * mmScale, vpH * mmScale);
}
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
// =============================================================================
// ChatGraph — src/events.js
// Canvas pan/zoom, keyboard shortcuts, and highlight-to-branch selector.
// =============================================================================

function attachCanvasEvents() {
  if (!overlayEl) return;

  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('.chatgraph-node')) return;
    if (e.target.closest('.chatgraph-sticky')) return;
    if (e.target.closest('#chatgraph-input-bar')) return;
    if (e.target.closest('#chatgraph-toolbar')) return;
    state.isPanning  = true;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
    overlayEl.style.cursor = 'grabbing';
  });

  // Double-click on empty canvas → label an edge if near one, else create a sticky note
  overlayEl.addEventListener('dblclick', (e) => {
    if (e.target.closest('.chatgraph-node')) return;
    if (e.target.closest('.chatgraph-sticky')) return;
    if (e.target.closest('#chatgraph-input-bar')) return;
    if (e.target.closest('#chatgraph-toolbar')) return;
    if (e.target.closest('#chatgraph-minimap')) return;

    const canvasX = (e.clientX - state.panX) / state.scale;
    const canvasY = (e.clientY - state.panY) / state.scale;

    // Check for edge hit first (tolerance scales with zoom so it feels consistent)
    const tol     = Math.max(10, 14 / state.scale);
    const hitEdge = findEdgeNearPoint(canvasX, canvasY, tol);
    if (hitEdge) {
      showEdgeLabelEditor(hitEdge.edge, hitEdge.pts, e);
      return;
    }

    // No edge nearby — create sticky note
    const rotation = parseFloat((Math.random() * 4 - 2).toFixed(1));
    const note     = { id: state.nextStickyId++, x: canvasX, y: canvasY, text: '', rotation, connectedNodeId: null };
    pushUndo();
    state.stickyNotes.push(note);
    renderStickyNote(note);
    renderEdges();
    setTimeout(() => {
      const ta = canvasEl?.querySelector(`[data-sticky-id="${note.id}"] .sticky-textarea`);
      if (ta) ta.focus();
    }, 50);
  });

  window.addEventListener('mousemove', (e) => {
    // Connect-drag: update line and highlight potential target
    if (connectDragState) {
      connectDragState.currentX = (e.clientX - state.panX) / state.scale;
      connectDragState.currentY = (e.clientY - state.panY) / state.scale;
      renderConnectLine();
      canvasEl?.querySelectorAll('.chatgraph-node').forEach(n => n.classList.remove('connect-target'));
      const under   = document.elementFromPoint(e.clientX, e.clientY);
      const hovered = under?.closest?.('.chatgraph-node');
      if (hovered && Number(hovered.dataset.nodeId) !== connectDragState.fromNodeId) {
        hovered.classList.add('connect-target');
      }
      return;
    }
    if (stickyDragStart) {
      const dx = (e.clientX - stickyDragStart.clientX) / state.scale;
      const dy = (e.clientY - stickyDragStart.clientY) / state.scale;
      stickyDragStart.note.x = stickyDragStart.origX + dx;
      stickyDragStart.note.y = stickyDragStart.origY + dy;
      const el = canvasEl?.querySelector(`[data-sticky-id="${stickyDragStart.note.id}"]`);
      if (el) { el.style.left = stickyDragStart.note.x + 'px'; el.style.top = stickyDragStart.note.y + 'px'; }
      renderEdges();
      return;
    }
    if (dragStart) {
      const dx = (e.clientX - dragStart.clientX) / state.scale;
      const dy = (e.clientY - dragStart.clientY) / state.scale;
      if (!dragStart.dragged && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        pushUndo(); // capture pre-drag position before first move
        dragStart.dragged = true;
      }
      if (dragStart.dragged) {
        dragStart.node.x = dragStart.origX + dx;
        dragStart.node.y = dragStart.origY + dy;
        const el = canvasEl?.querySelector(`[data-node-id="${dragStart.node.id}"]`);
        if (el) { el.style.left = dragStart.node.x + 'px'; el.style.top = dragStart.node.y + 'px'; }
        renderEdges();
      }
      return;
    }
    if (!state.isPanning) return;
    state.panX += e.clientX - state.lastMouseX;
    state.panY += e.clientY - state.lastMouseY;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
    applyTransform();
  });

  window.addEventListener('mouseup', (e) => {
    // Connect-drag: create edge if dropped on a different node
    if (connectDragState) {
      const under  = document.elementFromPoint(e.clientX, e.clientY);
      const target = under?.closest?.('.chatgraph-node');
      if (target) {
        const toId   = Number(target.dataset.nodeId);
        const fromId = connectDragState.fromNodeId;
        if (toId !== fromId) {
          const already = state.edges.some(ed =>
            (ed.fromId === fromId && ed.toId === toId) ||
            (ed.fromId === toId   && ed.toId === fromId)
          );
          if (!already) {
            pushUndo();
            state.edges.push({ fromId, toId, manual: true });
            renderEdges();
          }
        }
      }
      canvasEl?.querySelectorAll('.chatgraph-node').forEach(n => n.classList.remove('connect-target'));
      removeConnectLine();
      connectDragState = null;
      return;
    }
    dragStart       = null;
    stickyDragStart = null;
    state.isPanning = false;
    if (overlayEl) overlayEl.style.cursor = 'grab';
  });

  overlayEl.addEventListener('wheel', (e) => {
    // Focus mode: let the focus panel scroll naturally — don't zoom the canvas behind it
    if (e.target.closest('#chatgraph-focus-backdrop')) return;

    // Node body: when content overflows, scroll the node — don't zoom the canvas
    const scrollable = e.target.closest('.node-body, .note-node-body, .focus-scrollable');
    if (scrollable && scrollable.scrollHeight > scrollable.clientHeight + 2) return;

    e.preventDefault();
    const delta    = e.deltaY > 0 ? -0.08 : 0.08;
    const newScale = Math.min(Math.max(state.scale + delta, 0.15), 3);

    const rect   = overlayEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    state.panX  = mouseX - (mouseX - state.panX) * (newScale / state.scale);
    state.panY  = mouseY - (mouseY - state.panY) * (newScale / state.scale);
    state.scale = newScale;

    applyTransform();
  }, { passive: false });

  sendButtonEl.addEventListener('click', handleSendMessage);
  messageInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });
  messageInputEl.addEventListener('input', () => {
    messageInputEl.style.height = 'auto';
    messageInputEl.style.height = Math.min(messageInputEl.scrollHeight, 160) + 'px';
  });

  // ── Global keyboard shortcuts (only when graph is visible) ────────────────
  window.addEventListener('keydown', (e) => {
    if (!state.overlayVisible) return;

    const meta    = e.metaKey || e.ctrlKey;
    const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

    // Undo: Cmd/Ctrl+Z
    if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault(); performUndo(); return;
    }
    // Redo: Cmd/Ctrl+Shift+Z  or  Cmd/Ctrl+Y
    if ((meta && e.key.toLowerCase() === 'z' && e.shiftKey) || (meta && e.key.toLowerCase() === 'y')) {
      e.preventDefault(); performRedo(); return;
    }
    // Search: Cmd/Ctrl+F
    if (meta && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); return; }

    // Escape: close any open popup/menu/panel
    if (e.key === 'Escape') {
      document.getElementById('chatgraph-branch-btn-popup')?.remove();
      document.getElementById('chatgraph-ctx-menu')?.remove();
      document.getElementById('chatgraph-export-popover')?.remove();
      hideFocusMode();
      hideSettingsPanel();
      closeSearch();
      return;
    }

    if (inInput) return; // remaining shortcuts are single-key — skip when typing

    // F — fit all nodes
    if (e.key === 'f' || e.key === 'F') { fitAllNodes(); return; }

    // H — home (first node)
    if (e.key === 'h' || e.key === 'H') {
      const first = state.nodes[0];
      if (!first) return;
      state.scale = 1;
      state.panX  = window.innerWidth  / 2 - (first.x + NODE_WIDTH / 2);
      state.panY  = window.innerHeight / 2 - (first.y + getNodeHeight(first) / 2);
      applyTransform();
      return;
    }

    // L — latest node
    if (e.key === 'l' || e.key === 'L') {
      if (state.nodes.length === 0) return;
      const latest = state.nodes.reduce((a, b) => b.id > a.id ? b : a);
      state.scale = 1;
      state.panX  = window.innerWidth  / 2 - (latest.x + NODE_WIDTH / 2);
      state.panY  = window.innerHeight / 2 - (latest.y + getNodeHeight(latest) / 2);
      applyTransform();
      return;
    }

    // Delete / Backspace — delete the active node
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.activeNodeId !== null) {
      e.preventDefault();
      pushUndo();
      deleteNodeAndDescendants(state.activeNodeId);
      return;
    }
  });
}

function applyTransform() {
  if (!canvasEl) return;
  canvasEl.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
  if (overlayEl) {
    overlayEl.style.setProperty('--inv-scale', (1 / Math.max(state.scale, 0.1)).toFixed(4));
    const wasLodMicro = overlayEl.classList.contains('lod-micro');
    const nowLodMicro = state.scale < 0.45;
    overlayEl.classList.toggle('lod-micro', nowLodMicro);
    // Re-route edges only when crossing the threshold (not every scroll frame)
    if (wasLodMicro !== nowLodMicro) renderEdges();
  }
  updateMinimap();
}

function centerOnActiveNode() {
  if (state.activeNodeId === null) return;
  const node = state.nodes.find(n => n.id === state.activeNodeId);
  if (!node) return;

  state.panX = window.innerWidth  / 2 - (node.x + NODE_WIDTH / 2) * state.scale;
  state.panY = window.innerHeight / 2 - (node.y + getNodeHeight(node) / 2) * state.scale;
  applyTransform();
}

function attachBranchSelector(aiTextEl, node) {
  aiTextEl.addEventListener('mouseup', () => {
    document.getElementById('chatgraph-branch-btn-popup')?.remove();

    const selection    = window.getSelection();
    const selectedText = selection?.toString().trim();
    if (!selectedText || selectedText.length < 3) return;

    const range = selection.getRangeAt(0);
    if (!aiTextEl.contains(range.commonAncestorContainer)) return;

    const rect        = range.getBoundingClientRect();
    const branchPopup = document.createElement('div');
    branchPopup.id        = 'chatgraph-branch-btn-popup';
    branchPopup.className = 'chatgraph-branch-popup';
    branchPopup.style.left = Math.min(rect.left,         window.innerWidth  - 320) + 'px';
    branchPopup.style.top  = Math.min(rect.bottom + 8,   window.innerHeight - 60)  + 'px';

    const questionInput = document.createElement('input');
    questionInput.type        = 'text';
    questionInput.placeholder = 'Ask a question about this excerpt…';
    questionInput.className   = 'branch-question-input';

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Branch →';
    submitBtn.className   = 'branch-submit-btn';

    branchPopup.appendChild(questionInput);
    branchPopup.appendChild(submitBtn);
    (overlayEl || document.body).appendChild(branchPopup);
    questionInput.focus();

    const dismiss = (e) => {
      if (!branchPopup.contains(e.target)) { branchPopup.remove(); document.removeEventListener('mousedown', dismiss); }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 100);

    const handleSubmit = async () => {
      const question = questionInput.value.trim();
      if (!question) return;

      const effectiveMode = state.sendMode || 'claudeai';

      if (effectiveMode !== 'api') {
        // Assign the highlight color BEFORE addChildNode so the count is correct
        const branchCount    = state.nodes.filter(n => n.parentId === node.id && n.isBranch).length;
        const highlightColor = BRANCH_COLORS[branchCount % BRANCH_COLORS.length];
        state.highlights.push({ parentNodeId: node.id, selectedText, color: highlightColor });

        const message = `Regarding: "${truncate(selectedText, 80)}" — ${question}`;
        branchPopup.remove();
        document.removeEventListener('mousedown', dismiss);
        addChildNode(node.id, message, '', true);
        state.pendingNodeId = state.activeNodeId;
        injectIntoClaudeInput(message);
        return;
      }

      // api mode: call Anthropic directly
      if (!state.apiKey) {
        showInlineBranchKeyEntry(branchPopup, handleSubmit);
        return;
      }

      submitBtn.textContent = '…';
      submitBtn.disabled    = true;

      const contextMessages = buildContextChain(node.id, null);
      contextMessages.push({
        role:    'user',
        content: `Regarding this excerpt from your previous response:\n\n"${selectedText}"\n\n${question}`,
      });

      try {
        const aiText        = await callAnthropicAPI(contextMessages);
        const userText      = `[Branch on: "${truncate(selectedText, 50)}"] ${question}`;
        const branchCount   = state.nodes.filter(n => n.parentId === node.id && n.isBranch).length;
        const highlightColor = BRANCH_COLORS[branchCount % BRANCH_COLORS.length];
        state.highlights.push({ parentNodeId: node.id, selectedText, color: highlightColor });
        branchPopup.remove();
        document.removeEventListener('mousedown', dismiss);
        addChildNode(node.id, userText, aiText, true);
      } catch (err) {
        console.error('[ChatGraph] Branch error:', err);
        alert('Branch failed: ' + err.message);
        submitBtn.textContent = 'Branch →';
        submitBtn.disabled    = false;
      }
    };

    submitBtn.addEventListener('click', handleSubmit);
    questionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  handleSubmit();
      if (e.key === 'Escape') branchPopup.remove();
    });
  });
}

// Morphs an existing branch popup in-place to show an API key entry row.
// Once the user saves the key, onSaved() is called — which re-calls handleSubmit
// so the branch proceeds immediately without the user re-selecting text.
function showInlineBranchKeyEntry(popupEl, onSaved) {
  popupEl.innerHTML = '';
  popupEl.style.flexDirection = 'column';
  popupEl.style.alignItems    = 'flex-start';
  popupEl.style.gap           = '8px';

  const label = document.createElement('div');
  label.className   = 'branch-inline-key-label';
  label.textContent = '🔑 API key needed for branches';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;width:100%;';

  const keyInput = document.createElement('input');
  keyInput.type         = 'password';
  keyInput.placeholder  = 'sk-ant-…';
  keyInput.className    = 'branch-inline-key-input';
  keyInput.autocomplete = 'off';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save & Branch →';
  saveBtn.className   = 'branch-save-and-branch-btn';

  const doSave = () => {
    const key = keyInput.value.trim();
    if (!key) return;
    saveBtn.disabled    = true;
    saveBtn.textContent = '…';
    state.apiKey = key;
    chrome.storage.local.set({ apiKey: key }, () => {
      onSaved();
    });
  };

  saveBtn.addEventListener('click', doSave);
  keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  doSave();
    if (e.key === 'Escape') popupEl.remove();
  });

  row.appendChild(keyInput);
  row.appendChild(saveBtn);
  popupEl.appendChild(label);
  popupEl.appendChild(row);

  setTimeout(() => keyInput.focus(), 30);
}
// =============================================================================
// ChatGraph — src/observer.js
// MutationObserver for new messages + SPA navigation detection.
// =============================================================================

// Module-level reference so we can disconnect the old observer before creating a new one.
let _mutationObserver = null;

function startMutationObserver() {
  // Always disconnect the previous observer before starting fresh (avoids duplicate firings
  // after SPA navigations, which call this function a second time).
  if (_mutationObserver) { _mutationObserver.disconnect(); _mutationObserver = null; }
  state.observerActive = false;

  let quickTimer = null; // 150ms — creates placeholder node the moment user message hits DOM
  let finalTimer = null; // 1000ms after last change — final sync once streaming is done

  const handleMutations = (mutations) => {
    if (!state.overlayVisible) return;

    let hasNewUserMessage = false;
    let hasAnyChange      = false;

    for (const mutation of mutations) {
      if (mutation.type === 'characterData') { hasAnyChange = true; continue; }
      for (const added of mutation.addedNodes) {
        if (added.nodeType !== Node.ELEMENT_NODE) continue;
        if (added.matches?.('[data-testid="user-message"]') || added.querySelector?.('[data-testid="user-message"]')) {
          hasNewUserMessage = true;
        }
        if (
          added.classList?.contains('font-claude-response') ||
          added.querySelector?.('.font-claude-response')
        ) { hasAnyChange = true; }
      }
    }

    // Create the placeholder node immediately so user sees it while Claude streams
    if (hasNewUserMessage) {
      clearTimeout(quickTimer);
      quickTimer = setTimeout(() => scrapeAndRender(), 150);
      hasAnyChange = true;
    }

    // Reset final timer on every change (characterData resets it during streaming,
    // so it fires 1000ms after the last character — response is complete by then)
    if (hasAnyChange) {
      clearTimeout(finalTimer);
      finalTimer = setTimeout(() => {
        scrapeAndRender();
        // One retry for slow streams — response may still be building when first scrape fires
        if (state.pendingNodeId !== null) setTimeout(() => scrapeAndRender(), 3000);
      }, 1000);
    }
  };

  _mutationObserver = new MutationObserver(handleMutations);

  const attach = () => {
    const container = document.querySelector('.flex-1.flex.flex-col.px-4.max-w-3xl');
    if (container) {
      _mutationObserver.observe(container, { childList: true, subtree: true, characterData: true });
    } else {
      // No characterData on body — avoids our own overlay's typewriter triggering the observer
      _mutationObserver.observe(document.body, { childList: true, subtree: true });
      const retryInterval = setInterval(() => {
        const found = document.querySelector('.flex-1.flex.flex-col.px-4.max-w-3xl');
        if (found) {
          clearInterval(retryInterval);
          _mutationObserver.disconnect();
          _mutationObserver.observe(found, { childList: true, subtree: true, characterData: true });
        }
      }, 1500);
    }
  };

  attach();
  state.observerActive = true;
}

function startNavigationObserver() {
  let currentUrl = location.href;

  const onNavigate = () => {
    if (location.href === currentUrl) return;
    currentUrl = location.href;

    state.nodes            = [];
    state.edges            = [];
    state.nodeMap          = new Map();
    state.activeNodeId     = null;
    state.nextId           = 1;
    state.lastScrapedCount = 0;
    state.highlights       = [];
    state.stickyNotes      = [];
    state.nextStickyId     = 1;
    if (canvasEl) canvasEl.querySelectorAll('.chatgraph-sticky').forEach(el => el.remove());

    state.observerActive = false;
    startMutationObserver();

    if (state.overlayVisible) {
      renderGraph();
      setTimeout(scrapeAndRender, 800);
    }
  };

  const _pushState    = history.pushState.bind(history);
  const _replaceState = history.replaceState.bind(history);

  history.pushState = (...args) => { _pushState(...args); onNavigate(); };
  history.replaceState = (...args) => { _replaceState(...args); onNavigate(); };

  window.addEventListener('popstate', onNavigate);
}
// =============================================================================
// ChatGraph — src/init.js
// Extension boot: builds the overlay DOM and kicks off observers.
// =============================================================================

function init() {
  chrome.storage.local.get(['apiKey', 'sendMode', 'theme', 'accentColor'], (result) => {
    const hexRe       = /^#[0-9a-f]{6}$/i;
    state.apiKey      = (typeof result.apiKey === 'string' && result.apiKey.startsWith('sk-ant-')) ? result.apiKey : null;
    state.sendMode    = ['claudeai', 'api'].includes(result.sendMode) ? result.sendMode : 'claudeai';
    state.theme       = result.theme === 'light' ? 'light' : 'dark';
    state.accentColor = hexRe.test(result.accentColor) ? result.accentColor : '#5856D6';

    buildOverlayHTML();
    buildToggleButton();
    applyTheme();
    attachCanvasEvents();
    startMutationObserver();
    startNavigationObserver();

    chrome.storage.onChanged.addListener((changes) => {
      const hexRe = /^#[0-9a-f]{6}$/i;
      if (changes.apiKey)   state.apiKey   = (typeof changes.apiKey.newValue === 'string' && changes.apiKey.newValue.startsWith('sk-ant-')) ? changes.apiKey.newValue : null;
      if (changes.sendMode) state.sendMode = ['claudeai', 'api'].includes(changes.sendMode.newValue) ? changes.sendMode.newValue : 'claudeai';
      if (changes.theme)       { state.theme       = changes.theme.newValue === 'light' ? 'light' : 'dark';                   applyTheme(); }
      if (changes.accentColor) { state.accentColor = hexRe.test(changes.accentColor.newValue) ? changes.accentColor.newValue : '#5856D6'; applyTheme(); }
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function buildOverlayHTML() {
  overlayEl    = document.createElement('div');
  overlayEl.id = 'chatgraph-overlay';

  canvasEl    = document.createElement('div');
  canvasEl.id = 'chatgraph-canvas';
  overlayEl.appendChild(canvasEl);

  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.id    = 'chatgraph-svg';
  canvasEl.appendChild(svgEl);

  inputBarEl    = document.createElement('div');
  inputBarEl.id = 'chatgraph-input-bar';

  const activeLabel = document.createElement('div');
  activeLabel.id          = 'chatgraph-active-label';
  activeLabel.textContent = 'Click a node to activate it';

  const inputWrapper    = document.createElement('div');
  inputWrapper.id = 'chatgraph-input-wrapper';

  messageInputEl             = document.createElement('textarea');
  messageInputEl.id          = 'chatgraph-message-input';
  messageInputEl.rows        = 1;
  messageInputEl.placeholder = 'Continue from active node…';

  sendButtonEl             = document.createElement('button');
  sendButtonEl.id          = 'chatgraph-send-btn';
  sendButtonEl.textContent = '↑';
  sendButtonEl.title       = 'Send message (Enter)';

  inputWrapper.appendChild(messageInputEl);
  inputWrapper.appendChild(sendButtonEl);

  const suggestionsRow = document.createElement('div');
  suggestionsRow.id           = 'chatgraph-suggestions';
  suggestionsRow.style.display = 'none';

  inputBarEl.appendChild(activeLabel);
  inputBarEl.appendChild(suggestionsRow);
  inputBarEl.appendChild(inputWrapper);
  overlayEl.appendChild(inputBarEl);

  // ── Search bar (hidden until Cmd+F)
  const searchBar = document.createElement('div');
  searchBar.id           = 'chatgraph-search-bar';
  searchBar.style.display = 'none';

  const searchInput = document.createElement('input');
  searchInput.id          = 'chatgraph-search-input';
  searchInput.type        = 'text';
  searchInput.placeholder = 'Search nodes…';
  searchInput.className   = 'chatgraph-search-input';
  searchInput.addEventListener('input', () => performSearch(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape')                   { closeSearch(); e.stopPropagation(); return; }
    if (e.key === 'Enter' && !e.shiftKey)     { cycleSearch(1);  e.preventDefault(); return; }
    if (e.key === 'Enter' &&  e.shiftKey)     { cycleSearch(-1); e.preventDefault(); return; }
  });

  const searchCount = document.createElement('span');
  searchCount.id        = 'chatgraph-search-count';
  searchCount.className = 'chatgraph-search-count';

  const searchPrev = document.createElement('button');
  searchPrev.className   = 'chatgraph-search-btn';
  searchPrev.textContent = '↑';
  searchPrev.title       = 'Previous match (Shift+Enter)';
  searchPrev.addEventListener('click', () => cycleSearch(-1));

  const searchNext = document.createElement('button');
  searchNext.className   = 'chatgraph-search-btn';
  searchNext.textContent = '↓';
  searchNext.title       = 'Next match (Enter)';
  searchNext.addEventListener('click', () => cycleSearch(1));

  const searchClose = document.createElement('button');
  searchClose.className   = 'chatgraph-search-btn';
  searchClose.textContent = '✕';
  searchClose.title       = 'Close search (Esc)';
  searchClose.addEventListener('click', closeSearch);

  searchBar.appendChild(searchInput);
  searchBar.appendChild(searchCount);
  searchBar.appendChild(searchPrev);
  searchBar.appendChild(searchNext);
  searchBar.appendChild(searchClose);
  overlayEl.appendChild(searchBar);

  // ── Minimap
  const minimap = document.createElement('div');
  minimap.id    = 'chatgraph-minimap';

  const minimapCanvas = document.createElement('canvas');
  minimapCanvas.id = 'chatgraph-minimap-canvas';
  const dpr = window.devicePixelRatio || 1;
  minimapCanvas.width        = Math.round(180 * dpr);
  minimapCanvas.height       = Math.round(120 * dpr);
  minimapCanvas.style.width  = '180px';
  minimapCanvas.style.height = '120px';
  minimap.appendChild(minimapCanvas);
  overlayEl.appendChild(minimap);

  // Click / drag on minimap → pan main canvas
  let minimapDragging = false;
  const doMinimapNav  = (ev) => {
    if (!minimapTransform) return;
    const r   = minimapCanvas.getBoundingClientRect();
    const mmx = (ev.clientX - r.left)  * dpr;
    const mmy = (ev.clientY - r.top)   * dpr;
    const { scale: ms, offsetX: ox, offsetY: oy } = minimapTransform;
    state.panX = window.innerWidth  / 2 - ((mmx - ox) / ms) * state.scale;
    state.panY = window.innerHeight / 2 - ((mmy - oy) / ms) * state.scale;
    applyTransform();
  };
  minimapCanvas.addEventListener('mousedown', (ev) => {
    ev.stopPropagation(); minimapDragging = true; doMinimapNav(ev);
  });
  window.addEventListener('mousemove', (ev) => { if (minimapDragging) doMinimapNav(ev); });
  window.addEventListener('mouseup',   ()   => { minimapDragging = false; });

  overlayEl.style.display = 'none'; // hidden until toggle button is clicked
  document.body.appendChild(overlayEl);

  buildToolbar();
  buildSettingsPanel();
}

function buildToggleButton() {
  toggleButtonEl             = document.createElement('button');
  toggleButtonEl.id          = 'chatgraph-toggle-btn';
  toggleButtonEl.textContent = '⬡ Graph';
  toggleButtonEl.title       = 'Toggle ChatGraph overlay';

  toggleButtonEl.addEventListener('click', () => {
    state.overlayVisible = !state.overlayVisible;
    overlayEl.style.display = state.overlayVisible ? 'flex' : 'none';
    toggleButtonEl.classList.toggle('active', state.overlayVisible);
    if (state.overlayVisible) scrapeAndRender();
  });

  document.body.appendChild(toggleButtonEl);
}

function buildToolbar() {
  const toolbar = document.createElement('div');
  toolbar.id    = 'chatgraph-toolbar';

  const undoBtn = document.createElement('button');
  undoBtn.id        = 'chatgraph-undo-btn';
  undoBtn.className = 'chatgraph-toolbar-btn';
  undoBtn.textContent = '↺';
  undoBtn.title     = 'Undo (⌘Z)';
  undoBtn.disabled  = true;
  undoBtn.addEventListener('click', performUndo);

  const redoBtn = document.createElement('button');
  redoBtn.id        = 'chatgraph-redo-btn';
  redoBtn.className = 'chatgraph-toolbar-btn';
  redoBtn.textContent = '↻';
  redoBtn.title     = 'Redo (⌘⇧Z)';
  redoBtn.disabled  = true;
  redoBtn.addEventListener('click', performRedo);

  const undoSep = document.createElement('div');
  undoSep.className = 'toolbar-sep';

  const fitBtn = document.createElement('button');
  fitBtn.className   = 'chatgraph-toolbar-btn';
  fitBtn.textContent = '⊞ Fit';
  fitBtn.title       = 'Zoom to fit all nodes';
  fitBtn.addEventListener('click', fitAllNodes);

  const homeBtn = document.createElement('button');
  homeBtn.className   = 'chatgraph-toolbar-btn';
  homeBtn.textContent = '⌂ Home';
  homeBtn.title       = 'Return to first node';
  homeBtn.addEventListener('click', () => {
    const first = state.nodes[0];
    if (!first) return;
    state.scale = 1;
    state.panX  = window.innerWidth  / 2 - (first.x + NODE_WIDTH / 2);
    state.panY  = window.innerHeight / 2 - (first.y + getNodeHeight(first) / 2);
    applyTransform();
  });

  const latestBtn = document.createElement('button');
  latestBtn.className   = 'chatgraph-toolbar-btn';
  latestBtn.textContent = '↓ Latest';
  latestBtn.title       = 'Jump to most recent node';
  latestBtn.addEventListener('click', () => {
    if (state.nodes.length === 0) return;
    const latest = state.nodes.reduce((a, b) => b.id > a.id ? b : a);
    state.scale = 1;
    state.panX  = window.innerWidth  / 2 - (latest.x + NODE_WIDTH / 2);
    state.panY  = window.innerHeight / 2 - (latest.y + getNodeHeight(latest) / 2);
    applyTransform();
  });

  const synthBtn = document.createElement('button');
  synthBtn.className   = 'chatgraph-toolbar-btn chatgraph-toolbar-synthesize';
  synthBtn.textContent = '✦ Synthesize';
  synthBtn.title       = 'Send entire graph to Claude — get a synthesis of what was explored, discovered, and what\'s still open';
  synthBtn.addEventListener('click', (e) => { e.stopPropagation(); createSynthesisNode(); });

  const layoutBtn = document.createElement('button');
  layoutBtn.id        = 'chatgraph-layout-btn';
  layoutBtn.className = 'chatgraph-toolbar-btn';
  layoutBtn.textContent = '⊹ Layout';
  layoutBtn.title     = 'Apply force-directed auto-layout — physics simulation repositions nodes by connection proximity';
  layoutBtn.addEventListener('click', (e) => { e.stopPropagation(); applyForceLayout(); });

  const exportBtn = document.createElement('button');
  exportBtn.className   = 'chatgraph-toolbar-btn';
  exportBtn.textContent = '↓ Export';
  exportBtn.title       = 'Export graph as JSON or Markdown';
  exportBtn.addEventListener('click', (e) => { e.stopPropagation(); showExportPopover(exportBtn); });

  const settingsBtn = document.createElement('button');
  settingsBtn.className   = 'chatgraph-toolbar-btn';
  settingsBtn.textContent = '⚙ Settings';
  settingsBtn.title       = 'API key & send mode';
  settingsBtn.addEventListener('click', showSettingsPanel);

  // ── Separator
  const sep1 = document.createElement('div');
  sep1.className = 'toolbar-sep';

  // ── Accent color swatches
  const colorGroup = document.createElement('div');
  colorGroup.className = 'chatgraph-color-group';
  colorGroup.id        = 'chatgraph-color-group';

  ACCENT_COLORS.forEach(color => {
    const swatch = document.createElement('button');
    swatch.className        = 'chatgraph-color-swatch';
    swatch.style.background = color;
    swatch.dataset.color    = color;
    swatch.title            = 'Accent: ' + color;
    if (color === state.accentColor) swatch.classList.add('selected');
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      state.accentColor = color;
      chrome.storage.local.set({ accentColor: color });
      applyTheme();
    });
    colorGroup.appendChild(swatch);
  });

  // ── Separator
  const sep2 = document.createElement('div');
  sep2.className = 'toolbar-sep';

  // ── Theme toggle
  const themeBtn = document.createElement('button');
  themeBtn.id          = 'chatgraph-theme-btn';
  themeBtn.className   = 'chatgraph-toolbar-btn';
  themeBtn.textContent = state.theme === 'dark' ? '☀' : '🌙';
  themeBtn.title       = state.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    chrome.storage.local.set({ theme: state.theme });
    applyTheme();
  });

  // ── Separator
  const sep3 = document.createElement('div');
  sep3.className = 'toolbar-sep';

  const closeBtn = document.createElement('button');
  closeBtn.className   = 'chatgraph-toolbar-btn chatgraph-toolbar-close';
  closeBtn.textContent = '✕';
  closeBtn.title       = 'Close graph';
  closeBtn.addEventListener('click', () => toggleButtonEl.click());

  toolbar.appendChild(undoBtn);
  toolbar.appendChild(redoBtn);
  toolbar.appendChild(undoSep);
  toolbar.appendChild(fitBtn);
  toolbar.appendChild(homeBtn);
  toolbar.appendChild(latestBtn);
  toolbar.appendChild(synthBtn);
  toolbar.appendChild(layoutBtn);
  toolbar.appendChild(exportBtn);
  toolbar.appendChild(settingsBtn);
  toolbar.appendChild(sep1);
  toolbar.appendChild(colorGroup);
  toolbar.appendChild(sep2);
  toolbar.appendChild(themeBtn);
  toolbar.appendChild(sep3);
  toolbar.appendChild(closeBtn);
  overlayEl.appendChild(toolbar);
}

function fitAllNodes() {
  if (state.nodes.length === 0) return;

  const MARGIN = 60;
  const minX   = Math.min(...state.nodes.map(n => n.x));
  const minY   = Math.min(...state.nodes.map(n => n.y));
  const maxX   = Math.max(...state.nodes.map(n => n.x + NODE_WIDTH));
  const maxY   = Math.max(...state.nodes.map(n => n.y + getNodeHeight(n)));

  const graphW = maxX - minX;
  const graphH = maxY - minY;
  const viewW  = window.innerWidth  - MARGIN * 2;
  const viewH  = window.innerHeight - MARGIN * 2 - 64;

  state.scale = Math.min(viewW / graphW, viewH / graphH, 1);
  state.panX  = MARGIN - minX * state.scale + (viewW - graphW * state.scale) / 2;
  state.panY  = MARGIN - minY * state.scale + (viewH - graphH * state.scale) / 2;

  applyTransform();
}
