# Plan: Real Streaming for Reasoning Content + Tool Description Display + Suppress Broken Sentence Bubbles

## Problem Statement 1: Reasoning Streaming

The SDK fires `assistant.reasoning_delta` events with `{reasoningId, deltaContent}` chunks in rapid succession for reasoning/chain-of-thought output. Currently these hit the `default` case in `sdkSessionManager.ts` and are logged as "Unhandled event type". Only the final `assistant.reasoning` event (complete content) is handled.

**Goal**: Stream reasoning chunks in real-time using the same pattern as `messageDelta` streaming, but **only when `showReasoning` is enabled** in the webview.

## Problem Statement 2: Tool Description Display

Each bash/shell tool call includes a human-readable `description` field in its arguments (e.g. `"Confirm what CLI version created the working session"`). Currently `formatArgumentsPreview` ignores it entirely for bash tools, showing only `$ <command>`. The `report_intent` tool provides turn-level context but only stamps the *first* tool card. Per-tool descriptions are already in the data and should be shown.

**Goal**: Show `args.description` as the intent label on tool cards when `toolState.intent` is absent.

## Problem Statement 3: Broken Sentence Bubble from Mixed content+toolRequests

The SDK fires `assistant.message` events that can carry BOTH a `content` field AND `toolRequests` in the same event. When the AI starts writing a sentence then decides to call a tool mid-thought, the content is a truncated fragment (e.g. `"All files confirmed. Let me read a reference spike to match the pattern:"`). Current code fires `onDidReceiveOutput` with this partial text, creating a standalone broken-sentence bubble in the UI followed by tool cards.

**Fix**: Suppress `assistant.message` content when `toolRequests` are present:
- With streaming ON: content was already rendered via `message_delta` events
- With streaming OFF: the tool's `args.description` already conveys the same information
- Tool description fallback (Part 2) makes this content redundant

---

## Approach: Reasoning Streaming

Mirror the existing `messageDelta` / `message:delta` pipeline, but for reasoning:
1. Handle `assistant.reasoning_delta` in SDK manager → fire new emitter
2. Forward delta through extension → RPC → webview
3. In webview: if `showReasoning=false`, ignore deltas; if `showReasoning=true`, stream into a dedicated reasoning element keyed by `reasoningId`
4. When final `assistant.reasoning` arrives, finalize the element (or do nothing if already rendered via deltas)

The webview gates rendering (not the extension) — simple, doesn't require new RPC for `showReasoning` sync.

Key difference from assistant message streaming: reasoning is **plain text only** (no markdown), so we use `textContent` not `innerHTML`/`marked`. Assistant messages get replaced by the final canonical `assistant.message` content; reasoning uses the delta stream as the source of truth because `assistant.reasoning` fires the same content — we finalize the streaming bubble rather than replacing it.

## Approach: Tool Description

One-liner change in `ToolExecution.js`: fall back to `toolState.arguments?.description` when `toolState.intent` is falsy. Escape both `intent` and `args.description` for consistency.

---

## Files to Change

### Part 0: ADR
| File | Change |
|------|--------|
| `documentation/ADRS/ADR-006-STREAMING-RESPONSES-FOR-MESSAGES-AND-REASONING.md` | New ADR documenting streaming decisions |

### Part 1: Tool Description
| File | Change |
|------|--------|
| `src/webview/app/components/ToolExecution/ToolExecution.js` | Fall back to `toolState.arguments?.description` when `toolState.intent` is absent; escape both |

### Part 2: Suppress Broken Sentence Bubble
| File | Change |
|------|--------|
| `src/sdkSessionManager.ts` | Don't fire `onDidReceiveOutput` when `toolRequests` are present |

### Part 3: Reasoning Streaming
| File | Change |
|------|--------|
| `src/sdkSessionManager.ts` | Add `_onDidReceiveReasoningDelta` emitter; handle `assistant.reasoning_delta` case; change `_onDidReceiveReasoning` to fire `{reasoningId, content}`; add comment about `reasoningText` in `assistant.message` being intentionally ignored |
| `src/shared/messages.ts` | Add `'reasoningDelta'` to union; add `ReasoningDeltaPayload`; add to `validTypes`; add optional `reasoningId` to `ReasoningMessagePayload` |
| `src/extension/rpc/ExtensionRpcRouter.ts` | Add `sendReasoningDelta(reasoningId, deltaContent)`; update `addReasoningMessage` to accept/pass `reasoningId` |
| `src/chatViewProvider.ts` | Add `sendReasoningDelta(reasoningId, deltaContent)`; update `addReasoningMessage` to accept/pass `reasoningId` |
| `src/extension.ts` | Update `onDidReceiveReasoning` handler to pass `reasoningId`; add `onDidReceiveReasoningDelta` listener |
| `src/webview/app/rpc/WebviewRpcClient.js` | Add `onReasoningDelta(handler)` |
| `src/webview/main.js` | Register `rpc.onReasoningDelta` gated on `showReasoning`; update `handleReasoningMessageMessage` to pass `reasoningId` in `message:add` |
| `src/webview/app/components/MessageDisplay/MessageDisplay.js` | Subscribe to `reasoning:delta`; add `reasoningStreamingBubbles` Map; finalize on `message:add` with `role:'reasoning'` |

---

## Tasks

### Phase 0: Write ADR

- [ ] Create `documentation/ADRS/ADR-006-STREAMING-RESPONSES-FOR-MESSAGES-AND-REASONING.md` with the following content:

```markdown
# ADR-006: Streaming Responses — Messages vs. Reasoning, and Suppressing Broken Sentence Bubbles

**Status**: Accepted
**Date**: 2026-03-14
**Driver**: 3.6.0 reasoning streaming work; cut-off assistant message investigation

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

## Consequences

**Positive:**
- Reasoning streams in real time instead of appearing all at once after ~10 seconds of thinking
- Tool cards show per-tool descriptions from `args.description` when no turn-level `report_intent` is present
- No more broken-sentence message bubbles before tool execution groups

**Negative:**
- With streaming OFF and tool requests present, any genuinely useful partial text in `content` is suppressed. In practice this text is always transitional narration, but the decision is irreversible once the model writes substantive content before calling tools — monitor if this ever causes missing information reports.
- Reasoning deltas dropped before `showReasoning` is enabled are gone — no replay.

## Notes

- `showReasoning` toggle is currently a hardcoded `false` default in `main.js`. If we ever persist toggle state or change the default to `true`, the drop-on-gate behavior should be re-evaluated.
- The `reasoningText` field in `assistant.message` was observed in production logs (3-5-0-assistant-message-cut-off.log, line 138) and is confirmed to be the full reasoning text already delivered via `assistant.reasoning`. The suppression is intentional.
```

### Part 1: Tool Description (small, do first)

- [ ] **RED: Write failing test**
  - Verify that when a tool has `arguments.description` but no `intent`, the description text appears in the rendered tool card HTML
  - Run test, verify it fails

- [ ] **GREEN: Fix `ToolExecution.js`**
  - In `createToolElement()` (line ~217):
    ```js
    ${(toolState.intent || toolState.arguments?.description)
      ? `<span class="tool-intent tool-execution__intent">${this.escapeHtml(toolState.intent || toolState.arguments.description)}</span>`
      : ''}
    ```

- [ ] **Verify**: run test passes; no regression

### Part 2: Suppress Broken Sentence Bubble

- [ ] **RED: Write failing test**
  - In `tests/unit/extension/`: test that `assistant.message` with both `content` and `toolRequests` does NOT fire `onDidReceiveOutput`
  - Test that `assistant.message` with `content` and no `toolRequests` DOES fire `onDidReceiveOutput`
  - Run tests, verify they fail

- [ ] **GREEN: Fix `sdkSessionManager.ts`**
  ```typescript
  const hasToolRequests = event.data.toolRequests && event.data.toolRequests.length > 0;
  const hasContent = event.data.content && event.data.content.trim().length > 0;
  if (hasContent && !hasToolRequests) {
      // Normal: display content directly
      this._onDidReceiveOutput.fire({ content: event.data.content, messageId: event.data.messageId ?? '' });
  } else if (hasToolRequests && event.data.messageId) {
      // Has tool requests: suppress content but send empty signal to finalize any streaming bubble
      this._onDidReceiveOutput.fire({ content: '', messageId: event.data.messageId });
  }
  ```
  Also add guard in `MessageDisplay.addMessage` — if role is 'assistant', no streaming bubble exists, and content is empty/blank → return early (don't create an empty bubble).

- [ ] **Verify**: tests pass; no regression

### Part 3: Reasoning Streaming

- [ ] **RED: Write failing tests**
  - `tests/integration/webview/reasoning-delta-streaming.test.js` (source-scan style)
    - WebviewRpcClient has `onReasoningDelta()` method
    - main.js wires `rpc.onReasoningDelta` → `eventBus.emit('reasoning:delta', ...)`
    - main.js gates on `showReasoning` before emitting
    - MessageDisplay subscribes to `reasoning:delta`
  - `tests/unit/components/MessageDisplay-reasoning-streaming.test.js` (JSDOM + real imports)
    - `showReasoning=true` + `reasoning:delta` → element created with text appended
    - `showReasoning=false` + `reasoning:delta` → no element created
    - Final `message:add {role:'reasoning', reasoningId}` after streaming → finalizes, no duplicate element

- [ ] **Backend: `src/sdkSessionManager.ts`**
  - Change `_onDidReceiveReasoning` to fire `{reasoningId: string, content: string}` instead of bare `string`
  - Add `_onDidReceiveReasoningDelta` emitter firing `{reasoningId: string, deltaContent: string}`
  - Add `case 'assistant.reasoning_delta':` firing the new emitter
  - Add comment in `assistant.message` case: reasoningOpaque/reasoningText intentionally ignored to prevent double-render

- [ ] **Types: `src/shared/messages.ts`**
  - Add `'reasoningDelta'` to `ExtensionMessageType` union and `validTypes`
  - Add `ReasoningDeltaPayload` interface
  - Add optional `reasoningId?: string` to `ReasoningMessagePayload`

- [ ] **RPC Router: `src/extension/rpc/ExtensionRpcRouter.ts`**
  - Add `sendReasoningDelta(reasoningId, deltaContent)` method
  - Update `addReasoningMessage` to accept/pass `reasoningId`

- [ ] **ChatViewProvider: `src/chatViewProvider.ts`**
  - Add `sendReasoningDelta(reasoningId, deltaContent)` method
  - Update `addReasoningMessage` to accept/pass `reasoningId`

- [ ] **Extension wiring: `src/extension.ts`**
  - Update `onDidReceiveReasoning` handler to destructure `{reasoningId, content}`
  - Add `onDidReceiveReasoningDelta` listener → `chatProvider.sendReasoningDelta(...)`
  - ⚠️ Must update atomically with all other consumers of `_onDidReceiveReasoning`

- [ ] **WebviewRpcClient.js**
  - Add `onReasoningDelta(handler)` method

- [ ] **main.js**
  - Register `rpc.onReasoningDelta` gated on `showReasoning`; emit `reasoning:delta` on EventBus
  - Update `handleReasoningMessageMessage` to pass `reasoningId` in `message:add`

- [ ] **MessageDisplay.js**
  - Add `this.reasoningStreamingBubbles = new Map()` in constructor
  - Subscribe to `reasoning:delta` in `attachListeners()`; append `textContent` (not innerHTML)
  - In `addMessage` for `role:'reasoning'`: if `reasoningId` matches a streaming bubble → finalize it (replace textContent with canonical content, remove from map); else render normally (backward compat for history)

- [ ] **GREEN: Run tests, fix until passing; run full suite**

- [ ] **Build and verify**: `npm run compile`

### Part 4: Inactivity Flush for Long Pauses

When the model pauses mid-stream (e.g. waiting for a long-running tool), `_flushSafeMarkdown` may hold unrendered text in the buffer indefinitely because it requires paragraph terminators (`\n\n`, headings, code fences). The user sees an empty bubble. Fix: flush unconditionally after ~1.5s of no new delta events.

- [ ] **RED: Write failing test**
  - JSDOM + real MessageDisplay
  - Emit a `message:delta` with content that has no `\n\n` (e.g. `"Let me update the plan:"`)
  - Wait 1.5s (use fake timers / sinon or just verify the timer is set up)
  - Assert the content appears in `contentEl` — test fails today because content never flushes

- [ ] **GREEN: Fix `MessageDisplay.js` — add inactivity timer in `_renderDeltaProgress`**
  ```js
  _renderDeltaProgress(state) {
      if (state.deltaCount < 2) return;
      if (state.deltaCount === 2) {
          state.el.classList.remove('streaming-hidden');
      }
      this._flushSafeMarkdown(state);
      // Reset inactivity timer — if no new delta in 1.5s, flush remaining buffer
      clearTimeout(state.flushTimer);
      state.flushTimer = setTimeout(() => {
          const remaining = state.buffer.slice(state.renderedUpTo);
          if (remaining) {
              state.contentEl.insertAdjacentHTML('beforeend',
                  typeof marked !== 'undefined' ? marked.parse(remaining) : remaining);
              state.renderedUpTo = state.buffer.length;
          }
      }, 1500);
      this.autoScroll();
  }
  ```
  Clear the timer when the bubble is finalized (in the streaming finalization path in `addMessage`): `clearTimeout(state.flushTimer)`.

- [ ] **Verify**: test passes; no regression; timer clears cleanly on finalization

### Code Review Notes on Part 4 (from Claude Opus review)

**Log analysis confirms the problem.** From `3-5-0-no-delta-render-for-long-pauses.log`:

```
01:22:49.833  delta: "Good"
01:22:49.834  delta: ", I have"
01:22:49.874  delta: " the format"
01:22:49.968  delta: ". Now let me update"
              ↓ 6.4 SECOND GAP — model thinking, buffer holds unrendered text ↓
01:22:56.335  delta: " the plan and"
01:22:56.387  delta: " write"
01:22:49.627  delta: " the ADR simultaneously"  (note: timestamp out of order in log)
01:22:49.677  delta: ":"
              ↓ 57 SECOND GAP — model calling update_work_plan tool ↓
01:23:56.456  assistant.message arrives (with toolRequests) — only NOW does finalization run
```

The buffer held `"Good, I have the format. Now let me update"` for 6.4s with nothing rendered because `_flushSafeMarkdown` needs `\n\n` and there is none. After all deltas arrived, the full buffer `"Good, I have the format. Now let me update the plan and write the ADR simultaneously:"` still had no `\n\n`, so nothing rendered for another 57s until `assistant.message` finalized the bubble. The user stared at an empty bubble for over a minute.

**The 1.5s timer fix is correct.** Three notes:

1. **Partial markdown risk is acceptable.** The timer flushes through `marked.parse()` which auto-closes incomplete constructs (e.g., `**bold` becomes `<strong>bold</strong>`). If more deltas arrive after a timer flush with content that was meant to close the construct (e.g., ` text**`), the next flush starts from `renderedUpTo` and produces orphaned closing markers. This is visually imperfect for ~1.5s but is far better than an empty bubble for 60+ seconds. Finalization will flush the remaining tail correctly. In practice, the log shows the content is plain prose — this edge case is rare.

2. **Timer must clear on finalization — already in the plan, good.** Line 248-264 of `MessageDisplay.js` (streaming finalization path) must add `clearTimeout(state.flushTimer)` before flushing the remaining buffer. Otherwise a race: timer fires after finalization and `insertAdjacentHTML` into an already-finalized bubble, doubling the last chunk.

3. **Interaction with Part 2 (suppress content + toolRequests).** In this specific log, `assistant.message` has BOTH content AND `toolRequests`. With the Part 2 fix, content is suppressed. But the streaming bubble still needs finalization. The Part 2 code should still send a finalization signal (empty content with the `messageId`), and `MessageDisplay.addMessage` should finalize the streaming bubble even when content is empty. Verify this path in integration testing.

---

## Technical Considerations

- **No markdown in reasoning**: Use `textContent` not `innerHTML`. Plain text, fast, safe, XSS-proof.
- **Buffered emitter**: `_onDidReceiveReasoningDelta` uses `BufferedEmitter` (same as all others).
- **showReasoning gate is in webview only**: Extension always forwards all deltas. User can toggle reasoning mid-stream and see remaining chunks.
- **showReasoning defaults to false**: Deltas arriving before user enables reasoning are dropped — not buffered. Acceptable; if default ever changes, revisit.
- **reasoningId threads through**: `assistant.reasoning` carries same `reasoningId` as deltas — used to finalize the streaming bubble without creating a duplicate.
- **Backward compat**: History messages (`role: 'reasoning'`) without `reasoningId` render as before.
- **Tool description priority**: `report_intent` (turn-level) takes priority over `args.description` (per-tool). Fall back order: `intent` → `args.description` → nothing.
- **Breaking emitter type change**: Changing `_onDidReceiveReasoning` from `string` to `{reasoningId, content}` must update ALL consumers atomically: `extension.ts`, `chatViewProvider.ts`, `ExtensionRpcRouter.ts`, `main.js`, `MessageDisplay.js`.
- **Streaming bubble + toolRequests interaction**: Part 2 suppresses content display but still sends an empty-content signal with the `messageId` so the streaming bubble (if any) gets finalized. `MessageDisplay.addMessage` guards against creating new empty bubbles.
- **Inactivity timer cleanup**: `state.flushTimer` must be cleared in the streaming finalization path to prevent a post-finalization flush from double-rendering content.

## Testing Strategy

### Suppress broken sentence bubble test
- Mock `_onDidReceiveOutput` fire, call the `assistant.message` handler with content + toolRequests → assert NOT fired
- Call with content only → assert fired once

### Tool description test
- Real ToolExecution import + JSDOM
- Tool state with `arguments: { description: 'Confirm what CLI version' }` and no `intent`
- Render card, assert `.tool-execution__intent` text content equals description

### Reasoning streaming tests
- Source-scan: wiring exists in main.js and WebviewRpcClient.js
- JSDOM component test: real MessageDisplay, real EventBus
- `showReasoning=true` path: delta → DOM element with text
- `showReasoning=false` path: delta → nothing in DOM
- Finalization: streaming bubble + final `message:add` → no duplicate

All tests MUST fail before implementation.
