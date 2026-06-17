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
