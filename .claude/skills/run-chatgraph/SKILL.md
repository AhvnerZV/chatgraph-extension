---
name: run-chatgraph
description: build, run, reload, or smoke-test the ChatGraph Chrome extension; verify after changes; open chrome://extensions
---

ChatGraph is a Chrome Manifest V3 extension. There is no server or CLI to start — the "run" path is: build → validate → load unpacked in Chrome at `chrome://extensions`. The smoke script handles build + validation; loading requires the user's Chrome session.

## Prerequisites

- macOS with Google Chrome installed at `/Applications/Google Chrome.app`
- `bash` and `python3` (both present on macOS by default)
- No npm, no Node.js required — build is a shell `cat` concatenation

## Build

```bash
cd /Users/ahvner/Documents/Projects/ChatGraph
bash build.sh
```

Output: `content.js` (~1826 lines, ~67KB). The build concatenates `src/` files in this exact order:

```
src/markdown.js → src/state.js → src/scraper.js → src/renderer.js
→ src/api.js → src/events.js → src/observer.js → src/init.js
```

If you add a new `src/` file, update `build.sh` to include it.

## Run (agent path) — smoke validate + open Chrome

```bash
bash .claude/skills/run-chatgraph/smoke.sh --open-chrome
```

This:
1. Runs `build.sh` — concatenates all sources into `content.js`
2. Checks `content.js` size (fails if < 10KB — catches empty-output bugs)
3. Validates `manifest.json` is MV3 with `content.js` registered
4. Checks `styles.css` has no external URLs (XSS/network security gate)
5. Opens `chrome://extensions` in Chrome for the user to reload

Without `--open-chrome`, same checks but skips opening Chrome:

```bash
bash .claude/skills/run-chatgraph/smoke.sh
```

All four checks passed on 2026-06-13:
```
✓ content.js: 1826 lines, 66981 bytes
✓ manifest.json valid (MV3, content.js registered)
✓ styles.css: 1027 lines, no external URLs
```

## Run (human path) — loading in Chrome

After building:

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** → select `/Users/ahvner/Documents/Projects/ChatGraph`
4. If already loaded: click the **↻** refresh icon on the ChatGraph card
5. Hard-refresh any open claude.ai tab: `Cmd+Shift+R`
6. The `⬡ Graph` toggle button should appear bottom-right of Claude.ai

## After every code change

```bash
bash build.sh
# then reload the extension in Chrome (step 4-5 above)
```

CSS-only changes (`styles.css`) still require an extension reload + hard-refresh to take effect.

## Security gates (run before any PR)

The smoke script checks:
- No external URLs in `styles.css` (no `url(http...)` / `@import`)
- Manifest permissions unchanged (currently: `storage`, `activeTab`, `https://claude.ai/*`, `https://api.anthropic.com/*`)

If `manifest.json` permissions change, verify the change is intentional before shipping.

## Gotchas

- **`chrome://extensions` can't be opened via `open -a Google\ Chrome "chrome://extensions"`** on some macOS versions due to Chrome's security restrictions on `chrome://` URLs — if the page doesn't open, have the user type it directly.
- **`content.js` loads at `document_idle`** — if Claude.ai hasn't finished rendering when the script runs, the MutationObserver falls back to `document.body`. This is expected behavior, not a bug.
- **CSS changes are not hot-reloaded** — Chrome caches the extension's CSS. Always hard-refresh (`Cmd+Shift+R`) the Claude.ai tab after reloading the extension, not just a normal refresh.
- **The extension only activates on `https://claude.ai/*`** — testing locally or on staging URLs requires updating `host_permissions` in `manifest.json`.
- **Build order matters** — `state.js` must come before files that reference `state`, `BRANCH_COLORS`, `NODE_WIDTH` etc. `init.js` must be last. Don't reorder `build.sh` without checking cross-file dependencies.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `⬡ Graph` button missing after reload | Hard-refresh the Claude.ai tab (`Cmd+Shift+R`), not just a normal refresh |
| Extension shows red error badge in `chrome://extensions` | Click the error badge to see the console error; usually a JS syntax error — re-run `build.sh` and check the output |
| `build.sh` produces an empty or tiny `content.js` | Check that all `src/*.js` files listed in `build.sh` exist (`ls src/`) |
| Smoke script fails "External URLs found" | Search `styles.css` for `url(http` and remove or replace with inline/base64 |
| Nodes don't update while overlay is open | Observer timing issue — see `src/observer.js` for the dual-timer (150ms quickTimer + 1000ms finalTimer) logic |
