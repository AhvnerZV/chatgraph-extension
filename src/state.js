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
