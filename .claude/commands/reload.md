# /reload — Reload the ChatGraph extension in Chrome

Print the exact steps to reload the unpacked extension after making changes, then open the extensions page.

## Steps

Tell the user:

**To reload ChatGraph after any code change:**

1. Open `chrome://extensions` in Chrome (or click the link below)
2. Make sure **Developer mode** is ON (toggle in the top-right)
3. Find the **ChatGraph** card
4. Click the **refresh icon** (↻) on the ChatGraph card
5. Go to your **Claude.ai tab** and do a **hard refresh**: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
6. The graph toggle button should reappear — if it doesn't, check the Extensions console for errors

Then run:
```bash
open "chrome://extensions"
```

**Important:** Every time you change `content.js`, `styles.css`, or `manifest.json`, you must reload the extension. Changes to `popup.html` take effect immediately when you reopen the popup.
