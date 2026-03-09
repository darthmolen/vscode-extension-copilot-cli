# Resume Event Doubling — Spike Findings

**Date:** 2026-03-09
**Script:** `spike-resume-doubling.mjs`
**Node:** v24.13.1 (requires 22.5+ for node:sqlite)

## Result: BUG CONFIRMED

Calling `client.resumeSession()` on an already-active session causes **7 of 8 event types** to fire twice for every subsequent `sendAndWait()` call.

### Phase 1: After `createSession()` — all events single

```
assistant.message: 1  [single]
assistant.turn_end: 1  [single]
assistant.turn_start: 1  [single]
assistant.usage: 1  [single]
pending_messages.modified: 2  [single — fires twice by design: queue + dequeue]
session.idle: 1  [single]
session.usage_info: 1  [single]
user.message: 1  [single]
Total: 9 events
```

### Phase 2: After `resumeSession()` on same session — doubled

```
assistant.message: 2  [DOUBLED]
assistant.turn_end: 2  [DOUBLED]
assistant.turn_start: 2  [DOUBLED]
assistant.usage: 2  [DOUBLED]
pending_messages.modified: 4  [DOUBLED — was 2, now 4]
session.idle: 1  [single — exception]
session.usage_info: 2  [DOUBLED]
user.message: 2  [DOUBLED]
Total: 17 events (1.9x ratio)
```

### Root Cause (Hypothesis)

`session.resume` RPC re-registers the session for `session.event` JSON-RPC notifications server-side without checking if a subscription already exists for that session+connection pair. The server then sends each notification twice over the same connection.

`session.idle` is likely emitted through a different code path (e.g., session state machine) rather than the general event subscription mechanism, which is why it stays single.

### Workaround

Don't use `resumeSession()` as a health check on sessions you already hold a live reference to. Use `session.abort()` (no-op on idle sessions, throws if dead) as a lightweight liveness check instead.
