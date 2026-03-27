# FLEET: `session.task_complete` does not fire after fleet execution

**Repo:** `github/copilot-sdk` (Node.js SDK)
**Severity:** Medium
**Affects:** `@github/copilot-sdk` Node.js ≥ 0.1.x

---

## Summary

`session.task_complete` — which fires reliably after a normal `sendAndWait()` turn — **never fires** after fleet execution completes. There is no clean fleet-done signal. Callers must approximate completion by watching `session.idle`, which has its own reliability problems (see FLEET-3).

---

## Steps to Reproduce

```javascript
import { CopilotClient } from '@github/copilot-sdk';

const client = new CopilotClient();
await client.connect();
const session = await client.createSession({
    onPermissionRequest: async () => ({ approved: true }),
});

let taskCompleteCount = 0;
session.on('session.task_complete', (data) => {
    taskCompleteCount++;
    console.log('task_complete fired:', data);
});

session.on('session.idle', () => {
    console.log(`session.idle. task_complete fired ${taskCompleteCount} times.`);
    // → "session.idle. task_complete fired 0 times."
});

await session.rpc.fleet.start({
    prompt: 'Research X and Y in parallel using two agents'
});

// Wait for session.idle to confirm fleet is done...
// task_complete never fires. Ever.
```

---

## Observed Behaviour

`session.task_complete` fired **0 times** across all fleet runs. From spike-06:

```json
{
  "q2_taskCompleteWithCustomAgents": {
    "question": "Does session.task_complete fire when fleet completes with customAgents?",
    "taskCompleteCount": 0,
    "taskCompleteData": [],
    "answer": "NO — task_complete did not fire"
  }
}
```

Spike-07 event type counts across a full fleet run (4 sub-agents, 757 total events):

```json
{
  "session.background_tasks_changed": 172,
  "subagent.started": 4,
  "subagent.completed": 2,
  "session.idle": 1
}
```

No `session.task_complete` in the counts. Normal `sendAndWait()` turns do fire `session.task_complete`.

---

## Expected Behaviour

`session.task_complete` should fire when fleet finishes all sub-agents, consistent with how it behaves for regular `sendAndWait()` turns.

Alternatively, a dedicated `fleet.complete` event should be introduced:

```typescript
session.on('fleet.complete', (data: {
    agentCount: number;
    failedCount: number;
    durationMs: number;
}) => { ... });
```

---

## Workaround

Wait on `session.idle`. Caveats:

```javascript
// Approximate fleet completion via session.idle
// ⚠ WARNING: session.idle fires when the orchestrating session queue empties.
// Sub-agents may still be running. See FLEET-3.
await new Promise(resolve => session.on('session.idle', resolve));
```

---

## Environment

- `@github/copilot-sdk` Node.js
- Spike date: 2026-03-17
