#!/bin/bash
# ChatGraph build script — concatenates src/ modules into content.js

set -e

OUTPUT="content.js"

cat \
  src/markdown.js \
  src/state.js \
  src/scraper.js \
  src/renderer.js \
  src/api.js \
  src/events.js \
  src/observer.js \
  src/init.js \
  > "$OUTPUT"

LINES=$(wc -l < "$OUTPUT")
BYTES=$(wc -c < "$OUTPUT")
echo "✓ Built $OUTPUT — ${LINES} lines, ${BYTES} bytes"
