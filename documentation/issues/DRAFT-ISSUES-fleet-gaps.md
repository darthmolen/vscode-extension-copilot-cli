# Draft Issues: Fleet Mode Gaps

Multiple issues discovered across fleet spikes (spike-01 through spike-07, 2026-03-17).

---

## Issue 1: `fleet.start()` ignores `customAgents` — always dispatches built-in agent types

**Severity:** High — makes fleet unusable for custom agent workflows

### Description

When a session is created with `customAgents` defined and `rpc.fleet.start()` is called, the fleet dispatcher **ignores the registered custom agents entirely**. Sub-agents are dispatched as built-in types (`explore`, `general-purpose`, etc.), not the custom agents registered in the session config.

### Reproduction

```javascript
const session = await client.createSession({
    onPermissionRequest: approveAll,
    customAgents: [{
        name: 'spike06-researcher',
        displayName: 'Spike 06 Researcher',
        description: 'A custom research agent',
        prompt: 'You are a custom research agent...',
        tools: ['view', 'grep', 'web_fetch'],
        infer: false,
    }],
});

// Confirm custom agent is registered:
const agentList = await session.rpc.agent.list();
// → { agents: [{ name: 'spike06-researcher', ... }] }  ✓ agent IS registered

await session.rpc.fleet.start({ prompt: 'Research X and Y in parallel' });
// → subagent.started events show agentName: "explore", not "spike06-researcher"
```

### Observed Behaviour (spike-06 output)

```json
"customAgentNamesInSubagentStarted": ["explore", "explore"],
"answer": "PARTIAL — subagents dispatched but with built-in names, not custom names"
```

```json
{
    "agentName": "explore",
    "agentDisplayName": "Explore Agent",
    "agentDescription": "Fast codebase exploration..."
}
```

Despite `spike06-researcher` being confirmed in `rpc.agent.list()`, fleet dispatched `explore` agents.

### Expected Behaviour

`fleet.start()` should use the session's registered custom agents when available, or at minimum provide a mechanism to specify which agent types fleet should dispatch.

### Impact

- Custom agents registered for a session are effectively invisible to fleet
- `customAgents[n].tools` restrictions cannot be applied to fleet workers
- Fleet workers inherit unrestricted built-in agent capabilities regardless of session config

---

## Issue 2: `session.task_complete` does not fire on fleet completion

**Severity:** Medium — no clean fleet-done signal; callers must infer from `session.idle`

### Description

`session.task_complete` never fires during or after fleet execution, even after all sub-agents complete and the session reaches idle. There is no fleet-specific completion event.

### Observed Behaviour

Across spike-06 (explicit check):
```json
"q2_taskCompleteWithCustomAgents": {
    "question": "Does session.task_complete fire when fleet completes with customAgents?",
    "taskCompleteCount": 0,
    "answer": "NO — task_complete did not fire"
}
```

In spike-07, fleet ran 4 sub-agents and produced results. Event log showed:
```
subagent.started ×4
subagent.completed ×2  (2 failed to complete before session.idle)
session.idle ×1
```

No `session.task_complete` event appeared.

### Expected Behaviour

Either `session.task_complete` should fire when fleet finishes, or a dedicated `fleet.complete` event should be introduced.

### Workaround

Poll/wait on `session.idle`. Caveat: `session.idle` fires when the session has nothing queued — this can fire before all sub-agents complete if they're slow.

---

## Issue 3: Fleet completion is non-deterministic — sub-agents can be abandoned at `session.idle`

**Severity:** Medium — callers cannot reliably know when fleet work is done

### Description

`session.idle` fires when the orchestrating session has no pending work, but sub-agents may still be running. In spike-07, 4 sub-agents were started but only 2 `subagent.completed` events arrived before `session.idle`. The other 2 sub-agents had no corresponding `subagent.completed` or `subagent.failed` events in the log.

### Observed Behaviour (spike-07)

```json
"subagentsStarted": [4 entries],
"subagentsCompleted": [2 entries],
"subagentsFailed": [],
"sessionIdleAt": 175813
```

Two sub-agents started but never completed (from the session event stream perspective). The session went idle while they were presumably still running.

### Expected Behaviour

One of:
1. `session.idle` should not fire until all fleet sub-agents complete
2. A `fleet.complete` event fires when all sub-agents are done, separate from `session.idle`
3. Documentation clarifying that `session.idle` ≠ fleet completion, with the correct pattern for waiting

### Impact

Callers relying on `session.idle` to know fleet is done will get false positives. Results from in-flight sub-agents may be silently dropped.

---

## Issue 4: No `fleet.*` events — fleet lifecycle is inferred from `subagent.*` events

**Severity:** Low — workable but inconsistent

### Description

There are no `fleet.start`, `fleet.complete`, or `fleet.failed` events. Fleet's entire lifecycle must be reconstructed by correlating `subagent.*` events. This is fragile — there is no explicit signal that "fleet was invoked" vs. "a tool happened to dispatch a sub-agent."

### Observed Behaviour

```
fleet.start → (no fleet.started event)
subagent.started ×N → (only way to know fleet is running)
subagent.completed / subagent.failed → (track N completions)
session.idle → (approximation for fleet done, see Issue 3)
```

### Suggested Addition

```
fleet.started  { prompt, expectedAgentCount? }
fleet.complete { agentCount, failedCount, durationMs }
fleet.failed   { error }
```

---

## Issue 5: Sub-agent output is not streamed per-agent — only aggregated at end

**Severity:** Low (UX) — no progressive results during fleet execution

### Description

Subagent tool activity (`tool.execution_start` / `tool.execution_complete` with `parentToolCallId`) is streamed in real time, but actual assistant output from each sub-agent is not. The only output available is the final aggregated `assistant.message` that arrives after all sub-agents complete.

There is no way to show "sub-agent A finished and found X" while sub-agent B is still running.

### Observed Behaviour

- `tool.execution_start` events carry `parentToolCallId` linking to a sub-agent (real-time ✓)
- No per-sub-agent `assistant.message` events during fleet
- Single aggregated `assistant.message` arrives at fleet completion

### Impact

- No progressive UI updates during fleet (all-or-nothing result)
- If fleet has 10 agents, the UI shows nothing for minutes then dumps everything at once
- Cannot surface partial results if some agents fail

---

## Issue 6: `resumeSession` with `customAgents` errors with timeout

**Severity:** Low — niche use case

### Description

Calling `client.resumeSession(sessionId, { customAgents: [...] })` to update custom agents on a running session produced a timeout error in spike-06.

### Observed Behaviour

```json
"q3_resumeSessionAcceptsCustomAgents": {
    "question": "Does ResumeSessionConfig accept customAgents at runtime?",
    "resumeSucceeded": false,
    "resumeError": "Timeout after [object Object]ms waiting for session.idle",
    "answer": "NO/ERROR"
}
```

Note: the error message `"[object Object]ms"` suggests an SDK-level bug where a timeout value is being stringified incorrectly before display.

### Expected Behaviour

Either `resumeSession` with `customAgents` works and updates the registered agent list, or documentation clarifies that `customAgents` can only be set at session creation time.

---

## Summary Table

| # | Issue | Severity | Workaround |
|---|-------|----------|-----------|
| 1 | `fleet.start()` ignores `customAgents` — always uses built-in agents | High | None |
| 2 | `session.task_complete` never fires on fleet completion | Medium | Wait on `session.idle` (imprecise) |
| 3 | Sub-agents can be abandoned at `session.idle` — completion non-deterministic | Medium | None reliable |
| 4 | No `fleet.*` lifecycle events — fleet inferred from `subagent.*` | Low | Correlate `subagent.*` by `toolCallId` |
| 5 | Sub-agent output not streamed per-agent — aggregated only at end | Low | None |
| 6 | `resumeSession` with `customAgents` errors with malformed timeout message | Low | Set `customAgents` at `createSession` only |

## Environment

- `@github/copilot-sdk` Node.js: installed in this repo
- CLI: `copilot` at `/home/smolen/.nvm/versions/node/v24.13.1/bin/copilot`
- Spike data: `planning/spikes/fleet-command/results/spike-06-output.json`, `results/07/spike-07-first-run.json`
