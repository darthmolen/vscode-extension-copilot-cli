# ADR-006: Streaming Responses — Messages vs. Reasoning, and Suppressing Broken Sentence Bubbles

**Status**: Accepted
**Date**: 2026-03-14
**Driver**: 3.5.0 reasoning streaming work; cut-off assistant message investigation

## Context

The SDK delivers assistant output via two parallel event streams:

**Assistant messages** (text responses):
- `assistant.message_delta` — ephemeral chunk events, fires many times per turn with `{messageId, deltaContent}`
- `assistant.message` — final canonical event, fires once per turn with complete `{messageId, content, toolRequests}`

**Reasoning** (chain-of-thought, model-dependent):
- `assistant.reasoning_delta` — ephemeral chunk events, fires many times per turn with `{reasoningId, deltaContent}`
- `assistant.reasoning` — final canonical event, fires once with complete `{reasoningId, content}`

Both streams exist because some clients want progressive display (delta path) and others want fire-and-forget (final event path).

## Decision 1: Assistant Message Streaming — Replace on Final Event

For assistant messages, we **use delta events for progressive rendering but replace/finalize with the final `assistant.message` content**.

### How it works
- Each `message_delta` event appends to a streaming bubble in `MessageDisplay.streamingBubbles` keyed by `messageId`
- Markdown is parsed incrementally in safe units (paragraphs, code fences, tables) to avoid O(n²) re-serialization
- When `assistant.message` fires, the streaming bubble is finalized: remaining buffer is flushed, markdown is fully rendered, SVG/mermaid blocks are post-processed, and the bubble becomes visible (fade-in)

### Why finalize from the delta buffer, not from `assistant.message.content`?
The finalization path (MessageDisplay line ~248) flushes the remaining **delta buffer**, not the `content` field from the final event. Both should contain identical text. We use the buffer because:
1. It's already partially rendered — we just flush the tail
2. It avoids a full re-render of content that is already in the DOM

### Why does assistant message streaming need the final event at all?
- Claude's model path never shows the streaming bubble until `deltaCount >= 2` (to avoid flash-of-content); without the final event, single-delta messages would stay hidden
- Markdown post-processing (SVG, mermaid) only runs at finalization
- The bubble needs a deterministic "done" signal to remove the `streaming-hidden` class and apply fade-in

## Decision 2: Reasoning Streaming — Finalize in Place, No Replacement

For reasoning, we **use delta events for progressive rendering and finalize in place when `assistant.reasoning` arrives**.

### How it works
- Each `reasoning_delta` event appends to a reasoning bubble in `MessageDisplay.reasoningStreamingBubbles` keyed by `reasoningId`
- Content is set as `textContent` (not `innerHTML`) — reasoning is plain text, never markdown
- When `assistant.reasoning` fires, the streaming bubble is finalized using the canonical `content` field (replaces textContent to ensure exact match) and removed from the map
- If no streaming bubble exists (e.g. history replay), `assistant.reasoning` creates a static element as before

### Why plain text for reasoning but markdown for messages?
Reasoning is the model's raw chain-of-thought — unformatted prose, not structured output. It never contains markdown. Using `textContent` is safe (no XSS), fast (no parser), and correct.

### Why is reasoning gated on `showReasoning` in the webview?
Reasoning defaults to hidden (`showReasoning = false`). The extension always forwards reasoning deltas downstream regardless of the toggle — the webview decides whether to render. This means:
- The user can enable reasoning mid-stream and see remaining chunks
- No state synchronization is needed between extension and webview
- Deltas arriving before the user enables reasoning are dropped (not buffered) — this is acceptable since reasoning is opt-in

### Why doesn't `assistant.message` double-render reasoning?
The `assistant.message` SDK event also carries `reasoningOpaque` and `reasoningText` fields containing the same reasoning content. The `assistant.message` handler in `sdkSessionManager.ts` intentionally ignores these fields. Reasoning is handled exclusively via `assistant.reasoning` and `assistant.reasoning_delta`. Processing `reasoningText` in the message handler would cause the same reasoning to appear twice.

## Decision 3: Suppress `assistant.message` Content When `toolRequests` Are Present

### The problem
When the model writes text and then calls a tool in the same turn, the SDK fires a single `assistant.message` event with both `content` (partial text) and `toolRequests`. Example:

```json
{
  "content": "All files confirmed. Let me read a reference spike to match the pattern:",
  "toolRequests": [{"name": "view", "arguments": {"path": "..."}}]
}
```

The content is an **incomplete sentence** — the model was about to enumerate something but interrupted itself to call a tool. Displaying this creates a broken-sentence bubble in the UI followed by tool execution cards, which looks wrong and confusing.

### The fix
`sdkSessionManager.ts` suppresses `onDidReceiveOutput` when `toolRequests` are present:

```typescript
const hasToolRequests = event.data.toolRequests && event.data.toolRequests.length > 0;
if (event.data.content && event.data.content.trim().length > 0 && !hasToolRequests) {
    this._onDidReceiveOutput.fire({ content: event.data.content, messageId: event.data.messageId ?? '' });
}
```

### Why this is safe
- **With streaming ON**: The content was already progressively rendered via `message_delta` events. The `assistant.message` final event is only needed to finalize the streaming bubble — the bubble finalization path is triggered separately by the `message:add` event. Dropping the output event when there are tool requests does not affect the streaming bubble.
- **With streaming OFF** (no delta events): The partial text is almost always narration ("Let me check...", "All files confirmed, let me...") that adds no information the tool's `args.description` doesn't already convey. Hiding it produces a cleaner UI.
- The `report_intent` tool call (if present in `toolRequests`) still stamps intent onto the first tool card header regardless of whether the content fires.

## Decision 4: Inactivity Flush for Long Streaming Pauses

### The problem
`_flushSafeMarkdown` requires paragraph terminators (`\n\n`, headings, code fences) before rendering buffer content. When the model pauses mid-sentence (e.g. waiting for a long-running tool), content already in the buffer remains unrendered. The user sees an empty streaming bubble.

**Confirmed from logs** (`3-5-0-no-delta-render-for-long-pauses.log`): the full message `"Good, I have the format. Now let me update the plan and write the ADR simultaneously:"` had no `\n\n`, so `_flushSafeMarkdown` never flushed during the 57-second wait for a tool to complete.

### The fix
A 1.5s inactivity timer in `_renderDeltaProgress` unconditionally flushes the remaining buffer when no new delta arrives:

```js
clearTimeout(state.flushTimer);
state.flushTimer = setTimeout(() => {
    const remaining = state.buffer.slice(state.renderedUpTo);
    if (remaining) {
        state.contentEl.insertAdjacentHTML('beforeend',
            typeof marked !== 'undefined' ? marked.parse(remaining) : remaining);
        state.renderedUpTo = state.buffer.length;
    }
}, 1500);
```

The timer is cleared in the finalization path to prevent a post-finalization double-render.

## Consequences

**Positive:**
- Reasoning streams in real time instead of appearing all at once after ~10 seconds of thinking
- Tool cards show per-tool descriptions from `args.description` when no turn-level `report_intent` is present
- No more broken-sentence message bubbles before tool execution groups
- Streaming bubbles show content during long tool pauses instead of remaining empty

**Negative:**
- With streaming OFF and tool requests present, any genuinely useful partial text in `content` is suppressed. In practice this text is always transitional narration, but the decision is irreversible once the model writes substantive content before calling tools — monitor if this ever causes missing information reports.
- Reasoning deltas dropped before `showReasoning` is enabled are gone — no replay.
- Inactivity timer may produce slightly imperfect markdown rendering for ~1.5s if mid-construct content is flushed. `marked.parse()` auto-closes incomplete constructs; remaining deltas resume correctly from `renderedUpTo`.

## Notes

- `showReasoning` toggle is currently a hardcoded `false` default in `main.js`. If we ever persist toggle state or change the default to `true`, the drop-on-gate behavior should be re-evaluated.
- The `reasoningText` field in `assistant.message` was observed in production logs (3-5-0-assistant-message-cut-off.log) and is confirmed to be the full reasoning text already delivered via `assistant.reasoning`. The suppression is intentional.
- **Tool description priority**: `report_intent` (turn-level) takes priority over `args.description` (per-tool). Fall back order: `toolState.intent` → `toolState.arguments.description` → nothing shown.
