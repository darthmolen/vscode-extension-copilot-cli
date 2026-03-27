# FLEET: `session.idle` fires before all sub-agents complete — completion is non-deterministic

**Repo:** `github/copilot-sdk` (Node.js SDK)
**Severity:** Medium
**Affects:** `@github/copilot-sdk` Node.js ≥ 0.1.x

---

## Summary

`session.idle` fires when the orchestrating session has no pending work queued, but **sub-agents may still be running**. In testing with 4 sub-agents, only 2 `subagent.completed` events arrived before `session.idle`. The other 2 sub-agents had no corresponding completion events in the stream. There is no reliable way to know when all fleet work is done.

---

## Steps to Reproduce

```javascript
import { CopilotClient } from '@github/copilot-sdk';

const client = new CopilotClient();
await client.connect();
const session = await client.createSession({
    onPermissionRequest: async () => ({ approved: true }),
});

const started = [];
const completed = [];

session.on('subagent.started', (data) => {
    started.push(data.toolCallId);
    console.log(`started: ${data.agentName} (${data.toolCallId})`);
});

session.on('subagent.completed', (data) => {
    completed.push(data.toolCallId);
    console.log(`completed: ${data.agentName} (${data.toolCallId})`);
});

session.on('session.idle', () => {
    console.log(`idle. started=${started.length}, completed=${completed.length}`);
    // → "idle. started=4, completed=2"   ← 2 agents never reported done
});

await session.rpc.fleet.start({
    prompt: 'Do 4 parallel research tasks on these topics: A, B, C, D'
});
```

---

## Observed Behaviour

From spike-07 (session `ba5281cc-5df6-48d8-861d-806f9a51e0e7`):

```json
{
  "subagentsStarted": [
    { "toolCallId": "tooluse_4Vim3gCZxGXWqGqX832PIO", "agentName": "general-purpose", "elapsedMs": 47837 },
    { "toolCallId": "tooluse_QF8x4XKh69tWubnLV1Q9PK", "agentName": "general-purpose", "elapsedMs": 47837 },
    { "toolCallId": "tooluse_Cg1Vhzlg2tLvFgr6yAzLDg", "agentName": "general-purpose", "elapsedMs": 47838 },
    { "toolCallId": "tooluse_rTPWcjyPoZKMHpjiglj9Bi", "agentName": "general-purpose", "elapsedMs": 47838 }
  ],
  "subagentsCompleted": [
    { "toolCallId": "tooluse_QF8x4XKh69tWubnLV1Q9PK", "agentName": "general-purpose", "elapsedMs": 138770 },
    { "toolCallId": "tooluse_4Vim3gCZxGXWqGqX832PIO", "agentName": "general-purpose", "elapsedMs": 170059 }
  ],
  "subagentsFailed": [],
  "sessionIdleAt": 175813
}
```

4 started, 2 completed — `session.idle` fired at 175s. The tool calls for the other 2 (`Cg1Vhzlg2tLvFgr6yAzLDg`, `rTPWcjyPoZKMHpjiglj9Bi`) appear in `tool.execution_start`/`complete` events but no `subagent.completed` arrived.

**Implication:** Results from in-flight sub-agents may be silently dropped when `session.idle` is used as a completion signal.

---

## Expected Behaviour

One of:

1. `session.idle` must not fire until all fleet sub-agents have fired `subagent.completed` or `subagent.failed`
2. A `fleet.complete` event fires when all sub-agents finish, independent of `session.idle`
3. At minimum, documentation clarifies `session.idle ≠ fleet completion` and provides the correct pattern

---

## Suggested Completion Pattern (if fixed)

```javascript
// Reliable fleet completion tracking (requires fix for this issue)
const fleetComplete = new Promise((resolve, reject) => {
    const started = new Set();
    const done = new Set();

    session.on('subagent.started', (d) => started.add(d.toolCallId));
    session.on('subagent.completed', (d) => {
        done.add(d.toolCallId);
        if (done.size === started.size) resolve();
    });
    session.on('subagent.failed', (d) => {
        done.add(d.toolCallId);
        if (done.size === started.size) resolve();
    });
});

await session.rpc.fleet.start({ prompt: '...' });
await fleetComplete; // ⚠ Currently unreliable — not all subagents emit completed/failed
```

---

## Environment

- `@github/copilot-sdk` Node.js
- Spike date: 2026-03-17
