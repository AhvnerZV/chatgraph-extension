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
