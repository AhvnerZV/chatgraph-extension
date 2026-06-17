# ChatGraph — Concept & Build Plan

## What Is ChatGraph?

ChatGraph is a Chrome extension that replaces the linear scroll view of Claude.ai with a 2D spatial graph canvas. Instead of reading a conversation top to bottom, every AI response becomes a visual node on a pannable, zoomable canvas. You can navigate the conversation spatially, branch off any part of any response, and build a living mind map of your thinking — all without ever scrolling.

The core problem it solves: **linear chat is a terrible format for non-linear thinking.** When you're working through a complex problem, your thoughts branch. The UI should reflect that. ChatGraph makes it do so.

---

## The Problem With Linear Chat

When a conversation gets long, you lose the thread. You scroll up to remember what was said, scroll back down to where you are, lose your place, repeat. The structure of the conversation — what led where, what branched from what — is invisible. Everything is flattened into a single column ordered only by time.

ChatGraph makes that structure visible. You can see at a glance where a conversation started, where it went, what questions came from what answers, and how deep any branch of thinking goes.

---

## How It Works

### The Canvas

When ChatGraph is active, it overlays a full-screen 2D canvas on top of Claude.ai. The canvas is pannable (click and drag to move around) and zoomable (scroll to zoom in and out). The original Claude.ai interface is hidden — the graph canvas is the interface.

### Nodes

Every AI response in the conversation becomes a **node** on the canvas. A node is a visual card that contains the text of the response. Nodes are connected to each other by lines that show the relationship between them — which response came from which question, and which branch came from which anchor point.

### The Bottom Input Bar

At the bottom of the screen, there is always a text input bar — identical in feel to the normal Claude.ai chat input. When you type and send a message from this bar, it continues the conversation from whichever node is currently **active**. The response to that message becomes a new node connected to the active node.

### The Active Node

At any point, exactly one node on the canvas is the **active node**. This is the node that the bottom input bar is currently continuing from. The active node is indicated by a color change — it visually stands out from all other nodes on the canvas. You can change the active node by clicking on any other node.

### Branching

This is the core feature of ChatGraph.

When you read a response and a specific part of it sparks a question, you can:

1. **Highlight** that specific text within the node
2. A **"Branch"** button appears
3. Click it and type your question
4. A new child node spawns on the canvas, connected by a line to the exact anchor point (the highlighted text) in the parent node

That child node is now its own conversation thread. You can continue it from the bottom input bar, or branch off it again. Branches can branch infinitely deep.

### Context Per Branch

Each branch carries context intelligently — not the full original thread (which would be too long and noisy), but a summarized chain of its parent history. Enough for the AI to know:

- Where the conversation started
- What the key points of the parent thread were
- What specific text the branch originated from
- Where the branch is going

This means every node, no matter how deep in the graph, has meaningful context. The AI is never answering blind — but it is also not being given the entire conversation history every time, which would be wasteful and slow.

---

## What ChatGraph Is Not

- **It does not intercept Claude's internal API calls.** Those are server-side and inaccessible to a browser extension. ChatGraph reads the rendered DOM — the text that appears on screen after Claude responds.
- **It is not a new AI model.** It uses Claude via your own Anthropic API key. You bring the intelligence; ChatGraph brings the interface.
- **It does not support multiple platforms at launch.** v1 is Claude.ai only. Expanding to ChatGPT, Gemini, and others is a future milestone.

---

## Technical Architecture

### Chrome Extension

ChatGraph is built as a Chrome extension. It injects a content script into Claude.ai that:

1. Scrapes rendered conversation content from the Claude.ai DOM
2. Overlays the graph canvas on top of the existing interface
3. Manages node state, branch state, and active node tracking
4. Handles all user interactions (pan, zoom, highlight, branch, input)

### Your Own API Key

All AI responses within the graph are powered by your own Anthropic API key. When you send a message or create a branch, ChatGraph constructs the appropriate context (summarized parent chain + highlighted anchor text + your question) and sends it directly to the Anthropic API. The response comes back and renders as a new node.

This is intentional. It keeps the product simple, gives you full control over context, and means the graph is not dependent on or limited by what Claude.ai itself does internally.

### Why DOM Scraping

A Chrome extension cannot access server-side API calls made by Claude.ai or any other platform. The only data available to the extension is what is rendered on the page. DOM scraping reads that rendered text and uses it as the source material for the graph. This is the correct and only viable approach for a v1 extension.

---

## v1 Scope

The first version of ChatGraph includes exactly the following. Nothing more.

| Feature | Description |
|---|---|
| Claude.ai only | Single platform target for v1 |
| Graph canvas | Full-screen 2D canvas with pan and zoom |
| Nodes | Every scraped AI response rendered as a node |
| Connections | Lines between nodes showing conversation flow |
| Active node | Color-based indicator showing which node is active |
| Bottom input bar | Sends messages that continue from the active node |
| Highlight → Branch | Select text in a node, branch off it as a new thread |
| Infinite branching | Any node can be branched from, no depth limit |
| Context summarization | Each branch carries a summarized parent context chain |
| Own API key | User provides their Anthropic API key to power responses |

---

## Future Milestones

These are explicitly out of scope for v1 but are the natural next steps:

- **Multi-platform support** — ChatGPT, Gemini, and other chat UIs
- **Context manager AI** — A lightweight AI layer that intelligently summarizes and structures the context passed to each branch, rather than a static summarization approach
- **Export** — Export the graph as an image, PDF, or structured JSON
- **Node search** — Search across all nodes in a graph by keyword
- **Saved graphs** — Persist graphs across sessions so you can return to a conversation map later
- **Collaboration** — Share a graph with someone else and explore it together

---

## Why This Works as a First Published Project

- Scope is well-defined and achievable
- The Chrome extension format means no backend infrastructure to manage
- DOM scraping and API calls are well-documented, learnable problems
- The core value (spatial conversation graph) is demonstrable in a simple demo
- Claude.ai as the single target means one DOM structure to learn, one thing to get right

The goal for v1 is simple: **build it, publish it, make it work.** Everything else comes after.
