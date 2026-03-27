# FLEET: Sub-agent output is not streamed per-agent — results are aggregated and delivered only at end

**Repo:** `github/copilot-sdk` (Node.js SDK)
**Severity:** Low (UX)
**Affects:** `@github/copilot-sdk` Node.js ≥ 0.1.x

---

## Summary

Sub-agent tool activity is streamed in real time, but the actual **assistant output** (what each sub-agent found or produced) is not. A single aggregated `assistant.message` arrives after all sub-agents complete. There is no way to surface per-agent results progressively.

---

## Observed Behaviour

From spike-07 event counts across a 4-sub-agent fleet run (~176 seconds):

```json
{
  "tool.execution_start": 110,
  "tool.execution_complete": 110,
  "assistant.message": 57,
  "subagent.started": 4,
  "subagent.completed": 2,
  "session.idle": 1
}
```

The 110 `tool.execution_start`/`complete` pairs stream in real time — you can see sub-agents working. But there is no per-sub-agent `assistant.message` event correlated to a specific sub-agent completing. The final aggregated result comes as `assistant.message` events at the end, after `assistant.turn_end`.

---

## Problem for UI Builders

Consider a 4-agent fleet that each take 60 seconds. The UI experience is:

```
t=0s   [fleet dispatched, 4 agents running]
t=0-60s  [tool execution events stream — you see grep/view calls happening]
t=60s  agent 1 completes (subagent.completed fires)
         → but NO assistant.message yet. What did agent 1 find?
t=75s  agent 2 completes
t=90s  agent 3 completes
t=105s agent 4 completes
t=110s [aggregated assistant.message arrives — all 4 results at once]
```

There is no way to show "Agent 1 finished and found X" while agents 2-4 are still running.

---

## Workaround Attempt

Sub-agent tool calls carry `parentToolCallId` matching the sub-agent's `toolCallId` from `subagent.started`. You can *attribute* tool activity to agents, but not their output:

```javascript
const agentToolCalls = new Map(); // toolCallId → array of tool events

session.on('subagent.started', (d) => {
    agentToolCalls.set(d.toolCallId, []);
});

session.on('tool.execution_complete', (d) => {
    if (d.parentToolCallId && agentToolCalls.has(d.parentToolCallId)) {
        agentToolCalls.get(d.parentToolCallId).push(d);
    }
});

// This tells you WHAT each agent did (tool calls) but not WHAT it concluded (output text).
// assistant.message events do NOT carry parentToolCallId.
```

There is no way to correlate `assistant.message` content to a specific sub-agent.

---

## Expected Behaviour

One of:

1. Sub-agent `assistant.message` events carry a `subagentToolCallId` field correlating them to the originating sub-agent
2. A `subagent.message` event fires when a sub-agent produces output, before fleet completes:

```typescript
session.on('subagent.message', (data: {
    toolCallId: string;      // matches subagent.started
    agentName: string;
    content: string;
    isComplete: boolean;     // false = streaming, true = agent done
}) => { ... });
```

---

## Environment

- `@github/copilot-sdk` Node.js
- Spike date: 2026-03-17
