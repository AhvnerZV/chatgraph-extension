# /package — Create a distributable .zip of the ChatGraph extension

Package the extension files into a .zip ready for manual distribution or Chrome Web Store upload.

## Steps

1. Read the version number from `manifest.json` (the `"version"` field).

2. Create the zip, excluding dev-only files:
   ```bash
   cd /Users/ahvner/Documents/Projects/ChatGraph
   VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
   zip -r "ChatGraph-v${VERSION}.zip" . \
     --exclude "*.DS_Store" \
     --exclude ".git/*" \
     --exclude ".claude/*" \
     --exclude "src/*" \
     --exclude "*.md" \
     --exclude "build.sh" \
     --exclude "V0.0/*" \
     --exclude "ChatGraph-v*.zip"
   ```

3. Report:
   - The output filename (e.g. `ChatGraph-v1.0.0.zip`)
   - The file size
   - A list of files included in the zip (`unzip -l ChatGraph-v${VERSION}.zip`)

4. Remind the user: to upload to the Chrome Web Store, go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole), create a new item, and upload this zip.

**Note:** If `src/` exists, run `/build` first to make sure `content.js` is up to date before packaging.
