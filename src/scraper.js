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
