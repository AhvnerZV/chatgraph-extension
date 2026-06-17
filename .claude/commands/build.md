# /build — Concatenate src/ files into content.js

Concatenate the ChatGraph source files into the final `content.js` that the Chrome extension loads.

## Steps

1. Check if `src/` directory exists in the project root.

2. **If `src/` exists:** Run this exact concatenation in order:
   ```bash
   cat src/markdown.js src/state.js src/scraper.js src/renderer.js src/api.js src/events.js src/observer.js src/init.js > content.js
   ```
   Then report the output file size with `wc -l content.js` and `wc -c content.js`.

3. **If `src/` does NOT exist yet:** Tell the user that the src/ split hasn't been done yet and the current `content.js` is still the monolithic file. Do not proceed — the split must be done before /build is useful.

4. After a successful build, remind the user to reload the extension in Chrome (use `/reload` for the steps).
