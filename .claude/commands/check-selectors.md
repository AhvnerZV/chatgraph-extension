# /check-selectors — Audit Claude.ai DOM selectors for fragility

Claude.ai can update its CSS class names at any time. This command checks all DOM selectors used in the scraper and flags fragile ones.

## Steps

1. Determine which file to check: use `src/scraper.js` if it exists, otherwise use `V0.0/content.js` or `content.js`.

2. Extract all `querySelector` and `querySelectorAll` calls from that file and list every selector string found.

3. For each selector, classify it:
   - 🔴 **HIGH RISK** — looks like a Tailwind utility class chain (multiple dot-separated classes like `.flex-1.flex.flex-col.px-4`) — these are implementation details that change without notice
   - 🟡 **MEDIUM RISK** — single utility class (e.g. `.font-claude-response`) — better than chains but still can change
   - 🟢 **LOW RISK** — uses `data-testid` attributes or semantic HTML (e.g. `[data-testid="user-message"]`) — these are more stable as they're intentionally exposed

4. Summarize: how many selectors total, how many of each risk level.

5. Recommend adding a `data-testid`-based fallback or a comment noting which selectors to watch, for any HIGH RISK ones.
