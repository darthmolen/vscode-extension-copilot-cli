# Streaming Spike Findings — SDK 0.1.32

**Date**: 2026-03-13  
**Spike**: `spike-01-streaming.mjs`  
**Output**: `results/spike-01-output.txt`

## Questions Answered

### 1. Does `streaming: true` produce `assistant.message_delta` events?
**YES.** `streaming: true` in `SessionConfig` produces `assistant.message_delta` events with word/token-level granularity for GPT models.

### 2. Does `streaming: false` suppress deltas?
**YES.** With `streaming: false`, zero delta events fire. Only the final `assistant.message` arrives.

### 3. Do both delta and full message events fire together?
**YES.** Both fire in every streaming scenario:
- Deltas arrive incrementally during the response
- A final `assistant.message` arrives with the complete `content` field
- This means we can use deltas for progressive UI rendering without changing how we store/process the final message

### 4. What does an `assistant.message_delta` look like?

```json
{
  "type": "assistant.message_delta",
  "data": {
    "messageId": "ec7d03c1-cc63-48d9-8aec-fb984476692d",
    "deltaContent": "Hello"
  },
  "id": "b8cd0a22-869f-4097-a98d-03494567a279",
  "timestamp": "2026-03-13T14:13:41.444Z",
  "parentId": "6f0bd5d0-7489-4a3d-a70d-cbea8135eda0",
  "ephemeral": true
}
```

Key fields:
- `data.messageId` — ties the delta to its parent `assistant.message`
- `data.deltaContent` — the incremental text chunk
- `ephemeral: true` — SDK marks deltas as non-persistent (not stored in history)

### 5. What about tool-using responses (S3)?

Tool-call turns (`assistant.message` with `toolRequests`, empty `content`) fire **no deltas** — there is no text to stream.

The subsequent text turn (after tool execution) **does** fire deltas normally.

### 6. Claude / reasoning models (S4)?

Claude fires:
- `assistant.reasoning_delta` — incremental reasoning tokens (separate from answer)
- `assistant.message_delta` — only 1 delta containing the full response (Claude batches differently than GPT)

The `assistant.message` on Claude includes `reasoningText` (plain text) and `reasoningOpaque` (encrypted blob for chain-of-thought).

### 7. Does `sendAndWait()` return text with streaming?

**NO.** `result.text` is `null` when `streaming: true`. The full response text is in `assistant.message` event's `data.content`. This is already how we process messages (via events, not `sendAndWait` return value), so no change needed there.

## Event Types Observed

| Event | streaming:true | streaming:false |
|-------|---------------|-----------------|
| `assistant.message_delta` | ✅ | ❌ |
| `assistant.message` | ✅ | ✅ |
| `assistant.streaming_delta` | ✅ | ❌ |
| `assistant.reasoning_delta` | ✅ (Claude only) | n/a |
| `assistant.reasoning` | ✅ (Claude only) | n/a |

Note: `assistant.streaming_delta` also fires — this appears to be a lower-level event; `assistant.message_delta` is the one to use (has structured `data.deltaContent`).

## Implementation Plan for Phase 6b

1. **`sdkSessionManager.ts`**: Add `streaming: true` to `SessionConfig` in `createSessionWithModelFallback`
2. **`sdkSessionManager.ts`**: Add `assistant.message_delta` case in `_handleSDKEvent` → fire `_onDidMessageDelta` emitter (using `BufferedEmitter` pattern)
3. **`shared/messages.ts`**: Add `messageDelta` to `ExtensionMessageType`, add `MessageDeltaPayload` interface
4. **`ExtensionRpcRouter.ts`**: Add `sendMessageDelta()` method
5. **`extension.ts`**: Wire `onDidMessageDelta` → `sendMessageDelta()`
6. **`WebviewRpcClient.js`**: Add `onMessageDelta()` receive handler
7. **`main.js`**: Wire `rpc.onMessageDelta` → EventBus `message:delta`
8. **`MessageDisplay.js`**: Handle `message:delta` — append `deltaContent` to the current in-progress assistant bubble

### Risk: message ordering

Deltas arrive before the final `assistant.message`. The webview must track "in-progress" bubble by `messageId` and replace/finalize it when the full `assistant.message` arrives.

### Risk: Claude batches differently

Claude sends 1 delta = full response. GPT sends many small deltas. The implementation must handle both.

### Risk: `result.text` null

Already a non-issue — we process via events, not `sendAndWait` return value.
