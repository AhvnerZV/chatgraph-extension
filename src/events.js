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
