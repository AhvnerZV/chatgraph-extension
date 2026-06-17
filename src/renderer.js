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
