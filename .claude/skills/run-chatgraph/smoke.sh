#!/bin/bash
# ChatGraph smoke validator
# Builds the extension and validates all output files.
# This is the only automated verification possible for a Chrome extension
# (actual runtime requires a logged-in Claude.ai session in Chrome).
#
# Usage: bash .claude/skills/run-chatgraph/smoke.sh [--open-chrome]

set -e
PROJ=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$PROJ"

echo "=== ChatGraph smoke ==="

# 1. Build
echo "[1/4] Building..."
bash build.sh

# 2. Check output file exists and is non-empty
LINES=$(wc -l < content.js | tr -d ' ')
BYTES=$(wc -c < content.js | tr -d ' ')
if [ "$BYTES" -lt 10000 ]; then
  echo "✗ content.js suspiciously small: ${BYTES} bytes" && exit 1
fi
echo "      ✓ content.js: ${LINES} lines, ${BYTES} bytes"

# 3. Validate manifest JSON
python3 -c "
import json, sys
d = json.load(open('manifest.json'))
assert d.get('manifest_version') == 3, 'not MV3'
assert d.get('content_scripts'), 'no content_scripts'
assert any('content.js' in s.get('js', []) for s in d['content_scripts']), 'content.js not in content_scripts'
print('      ✓ manifest.json valid (MV3, content.js registered)')
"

# 4. Check CSS has no external URLs (security gate)
python3 -c "
import re, sys
css = open('styles.css').read()
ext = [u for u in re.findall(r'url\(([^)]+)\)', css) if 'http' in u]
if ext:
    print('✗ External URLs found in styles.css:', ext); sys.exit(1)
lines = len(css.splitlines())
print(f'      ✓ styles.css: {lines} lines, no external URLs')
"

echo ""
echo "=== All checks passed ==="
echo ""
echo "Next: reload the extension in Chrome"
echo "  1. Open chrome://extensions  (Developer mode ON)"
echo "  2. Find ChatGraph → click ↻"
echo "  3. Hard-refresh any open claude.ai tab: Cmd+Shift+R"

# Optionally open Chrome
if [ "${1}" = "--open-chrome" ]; then
  echo ""
  echo "[opening chrome://extensions...]"
  open -a "Google Chrome" "chrome://extensions"
fi
