# /test-flow — Manual testing checklist for ChatGraph

Walk through the key user flows to verify the extension is working correctly after changes.

## Steps

Tell the user to load the extension and work through this checklist in order. Each item should pass before moving to the next.

---

**Before you start:** Make sure the extension is loaded and reloaded in `chrome://extensions`. Open a Claude.ai conversation that has at least 3 back-and-forth exchanges.

---

### Core Graph

- [ ] **Toggle button visible** — The "⬡ Graph" button appears in the bottom-right corner of Claude.ai
- [ ] **Graph opens** — Clicking "⬡ Graph" opens the dark canvas overlay
- [ ] **Nodes appear** — One node per conversation exchange is visible on the canvas
- [ ] **Edges connect nodes** — Bezier lines connect parent → child nodes
- [ ] **Pan works** — Click and drag the background to move around the canvas
- [ ] **Zoom works** — Scroll wheel zooms toward cursor position
- [ ] **Active node highlights** — Clicking a node gives it a blue border; the bottom bar updates to show its text

### SPA Navigation

- [ ] **Graph resets on new conversation** — Open a different Claude.ai conversation; open the graph — it should show that conversation's nodes, NOT the previous one's

### Markdown Rendering

- [ ] **Formatted output** — Ask Claude for a numbered list or something with `**bold**`; the node should render it formatted, not as raw asterisks

### Sending Messages

- [ ] **Send from input bar** — Type a message in the bottom bar, press Enter; a new child node appears connected to the active node
- [ ] **Streaming** — The response appears word-by-word (not all at once after a delay)

### Branching

- [ ] **Branch popup appears** — Select 5+ characters of text in a node's Claude response; a popup appears near the selection
- [ ] **Popup doesn't clip** — Select text near the bottom-right corner of the screen; the popup should stay fully visible
- [ ] **Branch creates node** — Type a question in the popup, click "Branch →"; a new branch node appears connected to the parent
- [ ] **Branch is offset** — The branch node spawns to the right of the main thread, not directly below

### Toolbar

- [ ] **Fit-all works** — Pan far away from the nodes; click "⊞ Fit" — view snaps to show all nodes with margin
- [ ] **Home works** — Click "⌂ Home" — view resets to the first node, centered, at scale 1

### Deletion

- [ ] **Right-click delete** — Right-click a branch node → "Delete node" appears; clicking it removes that node and its children from the canvas

---

Report which items passed and which failed. For any failure, note the exact step where it broke.
