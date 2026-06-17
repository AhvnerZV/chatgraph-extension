# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build

ChatGraph has no npm, no bundler, and no transpilation. The build is a plain concatenation:

```bash
bash build.sh
```

This concatenates `src/` modules into `content.js` in a specific order that matters — each module depends on globals defined by earlier modules:

```
markdown.js → state.js → scraper.js → renderer.js → api.js → events.js → observer.js → init.js
```

After any change to `src/*.js` or `styles.css`, run `bash build.sh` then reload the extension at `chrome://extensions`.

**Custom commands:** `/build`, `/reload`, `/package`, `/check-selectors`, `/test-flow` are defined in `.claude/commands/`.

## Architecture

The extension is a Chrome MV3 content script injected on `https://claude.ai/*`. There is no background service worker and no bundling — the entire runtime is two files: `content.js` (concatenated source) and `styles.css`.

### Module responsibilities

| File | Role |
|---|---|
| `src/state.js` | Single `state` object, layout constants (`NODE_WIDTH`, `H_GAP`, `V_GAP`, `MAX_CHAIN`), color palettes (`BRANCH_COLORS`, `ACCENT_COLORS`), DOM element refs (`overlayEl`, `canvasEl`, etc.), undo/redo stacks |
| `src/markdown.js` | `highlightCode(rawCode, lang)` — priority token-based syntax highlighter; `parseMarkdown(text)` — full markdown→HTML (fenced code, tables, blockquotes/callouts, headings, lists) |
| `src/scraper.js` | `sanitizeClaudeHTML(claudeEl)` — clones Claude.ai's rendered DOM, strips UI chrome, rebuilds code blocks with our highlighter, returns safe innerHTML; `scrapeConversation()` — reads Claude.ai DOM into `{userText, aiText, aiHtml}` pairs; `scrapeAndRender()` — syncs pairs into graph state and calls `renderGraph()` |
| `src/renderer.js` | `renderGraph()`, `renderNode()`, `renderEdges()`, `renderStickyNote()`; also force-directed layout (`applyForceLayout()`), focus mode (`showFocusMode()`), smart suggestions (`fetchSuggestions()`), minimap (`updateMinimap()`), search, undo/redo, node context menu, export |
| `src/api.js` | `injectIntoClaudeInput(text)` — drives Claude.ai's ProseMirror editor via `execCommand`; `handleSendViaClaudeAI()` / `handleSendViaAPI()`; `streamAnthropicAPI()` / `callAnthropicAPI()`; `buildContextChain()`; `addChildNode()`; synthesis |
| `src/events.js` | Canvas pan/zoom, drag, sticky drag, connect-drag, keyboard shortcuts, branch-selector popup (`attachBranchSelector()`), `applyTransform()` |
| `src/observer.js` | `startMutationObserver()` — observes conversation container for new messages, drives `scrapeAndRender()`; `startNavigationObserver()` — patches `history.pushState/replaceState` to reset state on SPA navigation |
| `src/init.js` | `init()` — reads `chrome.storage.local`, calls `buildOverlayHTML()`, `buildToolbar()`, `buildToggleButton()`, `attachCanvasEvents()`, starts observers; all DOM construction is here |

### Two rendering paths

1. **claudeai mode (default):** Extension injects text into Claude.ai's ProseMirror input, Claude.ai makes the API call, the MutationObserver scrapes the response. `node.aiHtml` holds sanitized innerHTML scraped from Claude.ai's already-rendered DOM — used directly in the node card. Fallback is `parseMarkdown(node.aiText)`.

2. **api mode:** Extension calls Anthropic API directly with streaming. Response is raw markdown text stored as `node.aiText`, rendered via `parseMarkdown()`. `node.aiHtml` is null in this path.

### Key DOM selectors (fragile — Claude.ai can change these)

- Conversation container: `.flex-1.flex.flex-col.px-4.max-w-3xl` — HIGH RISK (Tailwind chain)
- User messages: `[data-testid="user-message"]` — LOW RISK
- Claude responses: `.font-claude-response` — MEDIUM RISK

Run `/check-selectors` to audit fragility whenever Claude.ai has updated.

### Branch colors

`BRANCH_COLORS` cycles per branch node at the parent. `getInheritedBranchColor(node)` in `renderer.js` walks the parent chain so all descendants of a branch share its color. Branch color is assigned in two places: `addChildNode()` (api.js, for interactively created branches) and `scrapeAndRender()` (scraper.js, for scraped conversations).

### LOD (zoom level of detail)

When `state.scale < 0.45`, `overlayEl` gets class `lod-micro` and CSS hides both `.node-header` and `.node-body`, leaving blank colored rectangles. The `--inv-scale` CSS variable (`1 / state.scale`) allows elements to counter-scale and stay screen-size-constant.

### Security constraints (must not be violated)

- No XSS: all user/AI content that goes into `innerHTML` must pass through either `sanitizeClaudeHTML()` (which clones and strips) or `parseMarkdown()` (which HTML-escapes raw text before building tags). `highlightCode()` escapes via its own `esc()` before wrapping in spans.
- No external network calls from visual/rendering code. Only `src/api.js` may call `fetch`.
- All fonts must be system fonts — no external `@font-face` or CDN URLs in CSS.
