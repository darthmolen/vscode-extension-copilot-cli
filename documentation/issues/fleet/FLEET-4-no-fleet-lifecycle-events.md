# FLEET: No `fleet.*` lifecycle events — fleet state must be inferred from `subagent.*` events

**Repo:** `github/copilot-sdk` (Node.js SDK)
**Severity:** Low
**Affects:** `@github/copilot-sdk` Node.js ≥ 0.1.x

---

## Summary

There are no `fleet.started`, `fleet.complete`, or `fleet.failed` events. Fleet's entire lifecycle must be reconstructed by correlating individual `subagent.*` events. This is fragile — there is no explicit signal that "fleet was invoked" as opposed to "a tool happened to dispatch a sub-agent some other way." Combined with FLEET-3 (incomplete `subagent.completed` delivery), there is no reliable end-to-end fleet lifecycle signal.

---

## Observed Event Flow

From spike-07, a complete fleet run produced this event sequence:

```
session.tools_updated
user.message
assistant.turn_start
  tool.execution_start    ← fleet invocation
  tool.execution_complete
  subagent.started        ← agent 1 begins
  subagent.started        ← agent 2 begins
  subagent.started        ← agent 3 begins
  subagent.started        ← agent 4 begins
  [172x session.background_tasks_changed]
  [tool.execution_start/complete for each subagent's tools]
  subagent.completed      ← agent 2 done
  subagent.completed      ← agent 1 done
  assistant.message       ← aggregated result
assistant.turn_end
session.idle
```

No `fleet.started`, no `fleet.complete`, no `fleet.failed`. Fleet is invisible at the lifecycle level.

---

## Problem: Distinguishing Fleet from Regular Sub-Agents

The SDK does not indicate *why* sub-agents were dispatched. A session might spawn sub-agents via fleet OR via a tool call to the `task` built-in. The caller cannot distinguish these cases from event data alone.

```javascript
// Both of these dispatch sub-agents with identical event signatures:

// Case 1: Explicit fleet
await session.rpc.fleet.start({ prompt: 'Research A and B' });

// Case 2: Task tool (model decides to use task tool)
await session.sendAndWait({ prompt: 'Research A and B' }); // model may call task()

// Event stream for both:
// subagent.started { agentName: "general-purpose", toolCallId: "..." }
// subagent.started { agentName: "general-purpose", toolCallId: "..." }
```

---

## Problem: `session.background_tasks_changed` fires 172 times with empty payload

Spike-06 and spike-07 both show `session.background_tasks_changed` firing repeatedly (~14× per sub-agent pair) with `{}` as the payload every single time:

```json
{
  "q4_backgroundTasksChangedPayload": {
    "count": 14,
    "events": [
      { "data": {}, "elapsedMs": 8674 },
      { "data": {}, "elapsedMs": 8674 },
      { "data": {}, "elapsedMs": 17359 },
      ...
    ],
    "answer": "FIRED 14x — see events for payload"
  }
}
```

Spike-07 with 4 sub-agents: **172 `session.background_tasks_changed` events**, all `{}`. This event fires frequently but carries no actionable information.

---

## Expected Behaviour

Fleet should emit explicit lifecycle events:

```typescript
// Proposed additions to session event types:

session.on('fleet.started', (data: {
    prompt: string;
    agentCount: number;   // number of sub-agents dispatched
    toolCallId: string;   // correlates with tool.execution_start for the fleet call
}) => { ... });

session.on('fleet.complete', (data: {
    toolCallId: string;
    agentCount: number;
    failedCount: number;
    durationMs: number;
}) => { ... });

session.on('fleet.failed', (data: {
    toolCallId: string;
    error: string;
}) => { ... });
```

Additionally, `session.background_tasks_changed` should carry meaningful payload (task counts, agent names, progress) instead of always emitting `{}`.

---

## Environment

- `@github/copilot-sdk` Node.js
- Spike date: 2026-03-17
