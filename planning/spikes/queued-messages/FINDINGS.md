# Queued Messages Spike — Findings

Date: 2026-02-24
SDK: 0.1.26, CLI: auto-updated (latest), Node: v24.13.1

## Event Timeline

```
[7ms]    pending_messages.modified (x2)  — first message enters queue
[508ms]  pending_messages.modified       — second message enters queue
[1295ms] user.message                    — first message starts processing
[1296ms] assistant.turn_start            — first turn begins
[3062ms] assistant.turn_end              — first turn ends
[3062ms] pending_messages.modified       — queue changes (second dequeued)
[3063ms] user.message                    — second message starts processing
[3214ms] assistant.turn_start            — second turn begins
[4938ms] assistant.turn_end              — second turn ends
[4938ms] session.idle                    — queue empty
```

## Key Findings

### 1. `pending_messages.modified` fires on queue changes

- Fires when a message is **added** to the queue (7ms, 508ms)
- Fires when a message is **removed** from the queue (3062ms — between first turn_end and second user.message)
- Data is always `{}` — empty. No info about queue depth or message IDs.

### 2. Queuing works automatically

- `sendAndWait` with default `mode: "enqueue"` queues the second message
- The CLI processes the queue FIFO — second message starts immediately after first turn ends
- No explicit "queued" text from the AI — it just processes them sequentially

### 3. No `sendAndWait` result text

Both `sendAndWait` promises resolved but `.text` was empty (undefined). The actual content came through `assistant.message` events. This is expected — `sendAndWait` returns when the turn completes, but the response text may only be available through streaming events.

### 4. Timeline for UI indicator

The window for showing a "queued" indicator is:
- **Show**: When we call `sendAndWait` for a second message while already streaming
- **Hide**: When `user.message` fires for that queued message (meaning it left the queue)

Since `pending_messages.modified` data is empty (no queue depth), we need to track queue state ourselves:
- Track if we're currently in a turn (between `assistant.turn_start` and `assistant.turn_end`)
- If user sends a message while in a turn → show "Queued" on that message
- When `user.message` fires for the queued prompt → remove the indicator

### 5. `session.idle` fires when queue is fully drained

This could be used to definitively clear any queued indicators.

## Implementation Decision

Since `pending_messages.modified` data is empty and fires multiple times, it's not directly useful for UI state. Instead:

1. Track `isInTurn` state (set on `assistant.turn_start`, cleared on `assistant.turn_end`)
2. When user sends a message while `isInTurn` → mark that message as "queued" in the UI
3. When `assistant.turn_start` fires for a new turn while we have queued messages → dequeue and remove indicator
4. `session.idle` → definitively clear all queued state
