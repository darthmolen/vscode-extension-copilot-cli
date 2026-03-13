# Phase 0: Fleet Command Spike

**Date**: 2026-03-12
**Goal**: Discover how the SDK exposes fleet/subagent functionality before implementing anything in the extension.
**Prerequisite**: GitHub token with Copilot access, `@github/copilot-sdk` installed locally.
**SDK versions**: `research/copilot-sdk` refreshed to HEAD (git pull 2026-03-12); `node_modules` updated to **0.1.32** (was 0.1.26).

## Questions to Answer

| # | Question | Spike |
|---|----------|-------|
| 1 | What events does the SDK emit when `/fleet` is used? What are the exact payloads? | `spike-01-fleet-events.mjs` |
| 2 | Can we trigger `/fleet` programmatically, or must it go through `sendAndWait`? | `spike-02-fleet-trigger.mjs` |
| 3 | How do subagent events interleave with tool events? | `spike-01-fleet-events.mjs` |
| 4 | Can we access individual subagent status/output via SDK RPC? | `spike-03-subagent-access.mjs` |
| 5 | What happens on abort while subagents are running? | `spike-03-subagent-access.mjs` |
| 6 | Does `/tasks` have an SDK equivalent, or is it CLI-only? | `spike-02-fleet-trigger.mjs` |
| 7 | Is `rpc.fleet.start()` blocking or fire-and-forget? Does it return before/after subagent events? | `spike-04-rpc-fleet.mjs` |
| 8 | Does `rpc.fleet.start()` always spawn subagents? What if no prompt / no context? | `spike-04-rpc-fleet.mjs` |
| 9 | What agent types does fleet use for real implementation work? | `spike-04-rpc-fleet.mjs` |
| 10 | Does accept+fleet dual-session work end-to-end via `rpc.fleet.start()`? | `spike-04-rpc-fleet.mjs` |

## How to Run

```bash
# From project root, with GitHub token available
node planning/spikes/fleet-command/spike-01-fleet-events.mjs
node planning/spikes/fleet-command/spike-02-fleet-trigger.mjs
node planning/spikes/fleet-command/spike-03-subagent-access.mjs
node planning/spikes/fleet-command/spike-04-rpc-fleet.mjs
```

Each spike logs all events to stdout AND writes a structured JSON log to `planning/spikes/fleet-command/results/spike-0X-output.json`. Run each spike, review the output, then fill in the FINDINGS section at the bottom of this file.

## Spike Scripts

See the four `.mjs` files in this directory. Each one is standalone and answers specific questions.

---

## FINDINGS (Fill in after running spikes)

### Spike 01: Fleet Event Discovery

**Raw event types observed** (48 total events in a non-fleet run):
`pending_messages.modified`, `user.message`, `assistant.turn_start`, `session.usage_info`, `assistant.usage`, `assistant.message`, `assistant.reasoning`, `tool.execution_start`, `tool.execution_complete`, `assistant.turn_end`, `session.idle`

**Key insight**: When `/fleet` is sent as plain text in a fresh session without enough context, the LLM processes it as a normal multi-tool turn (no subagent events). Subagent events only fire when the session has established context that causes the LLM to invoke the fleet tool. Confirmed in spike-02 EXP5 (dual-session, where plan context caused real fleet dispatch).

**subagent.started payload** (from spike-02 EXP5 + spike-05 0.1.32 recheck):
```json
{
  "toolCallId": "tooluse_KRWQJiN0TSL84wZmm4Px0Z",
  "agentName": "explore",
  "agentDisplayName": "Explore Agent",
  "agentDescription": "Fast codebase exploration and answering questions. Uses code intelligence, grep, glob, view, bash/powershell tools in a separate context window to search files and understand code structure. Safe to call in parallel.\n"
}
```

**subagent.completed payload**:
```json
{
  "toolCallId": "tooluse_KRWQJiN0TSL84wZmm4Px0Z",
  "agentName": "explore",
  "agentDisplayName": "Explore Agent"
}
```

**Agent identity lookup** — `subagent.started` only has `toolCallId`. The `agent-N` short ID (used by `system.notification` and `read_agent`) is revealed in the `tool.execution_complete` for the _same_ `toolCallId` (fires at +11ms, immediately after dispatch):
```json
{
  "toolCallId": "tooluse_KRWQJiN0TSL84wZmm4Px0Z",
  "success": true,
  "result": { "content": "Agent started in background with agent_id: agent-1. ..." },
  "toolTelemetry": {
    "properties": { "agent_type": "explore", "execution_mode": "background", "agent_id": "agent-1" }
  }
}
```
So the full mapping is: `subagent.started.toolCallId` → `tool.execution_complete.toolTelemetry.properties.agent_id`.

**Child tool attribution** (`parentToolCallId`) — Every `tool.execution_start` fired by a subagent carries `parentToolCallId` matching the parent `subagent.started.toolCallId`. This is the real-time feed of what each agent is doing:
```json
{
  "toolCallId": "tooluse_GziZUm5ywaOGHmRbVKZHT3",
  "toolName": "bash",
  "arguments": { "command": "..." },
  "parentToolCallId": "tooluse_KRWQJiN0TSL84wZmm4Px0Z"
}
```
18 of 27 tool events in spike-05 had `parentToolCallId` populated. The 9 without are the top-level orchestrator tool calls (the `task` dispatches and `read_agent` collections).

**Full agent lifecycle event chain** (SubagentTracker build order):
1. `tool.execution_start` (tool=`task`) — orchestrator dispatches agent; `toolCallId` is the agent's permanent ID
2. `subagent.started` (same `toolCallId`) — agent is live; `agentName` + `agentDescription` available
3. `tool.execution_complete` (same `toolCallId`, +0ms) — `toolTelemetry.properties.agent_id` gives `agent-N` short ID
4. `tool.execution_start` (child tools, `parentToolCallId` = agent's `toolCallId`) — real-time tool feed
5. `system.notification` (`kind.agentId` = `agent-N`, `kind.description` = task description) — fires on completion
6. `subagent.completed` / `subagent.failed` (same `toolCallId`) — agent done; update UI

**New event types in 0.1.32** (not seen in 0.1.26):
| Event | Payload | Notes |
|-------|---------|-------|
| `session.tools_updated` | `{ model: "claude-sonnet-4.6" }` | Fires at session start |
| `session.background_tasks_changed` | `{}` | Fires ~paired with agent start/complete (always empty payload) |
| `permission.requested` | `{ requestId, permissionRequest: { kind, toolCallId, intention, path } }` | Per file-read during fleet |
| `permission.completed` | `{ requestId, result: { kind: "approved" } }` | `approveAll` handles automatically |
| `system.notification` | `{ content, kind: { type, agentId, agentType, status, description, prompt } }` | Rich completion metadata — includes the exact prompt sent to each subagent |

**`session.task_complete` does NOT fire** in plain fleet runs (even with 0.1.32). Likely requires `customAgents` workflow. Still tracked via `session.idle`.

**`subagent.deselected` does NOT fire** in fleet runs — only relevant for `rpc.agent.select/deselect` flows.
```json
{
  "toolCallId": "tooluse_...",
  "agentName": "explore",
  "agentDisplayName": "Explore Agent",
  "error": "<error message string>"
}
```

**subagent.selected payload** (from SDK type definition — not observed live):
```json
{
  "agentName": "explore",
  "agentDisplayName": "Explore Agent",
  "tools": ["grep", "glob", "view"]
}
```

**Event ordering**: Subagent events interleave with tool events. In EXP5: 4× `subagent.started` fired near-simultaneously (within 20ms), then `subagent.completed` events arrived out of order as each agent finished (8s, 9s, 12s after start). **No fleet-level wrapper events** (`fleet.*`) exist — fleet is tracked entirely via `subagent.*` events.

**Tool event names**: The event is `tool.execution_start` / `tool.execution_complete` — NOT `tool.start` / `tool.end` (spike-03 searched for `tool.start` and found 0; spike-01 correctly observed `tool.execution_start`).

**Other unexpected events**: `assistant.reasoning` carries encrypted/opaque reasoning tokens. `session.usage_info` fires on each turn with running token totals.

---

### Spike 02: Fleet Trigger Mechanism

**Can `/fleet` be sent via `sendAndWait({ prompt: '/fleet ...' })`?**
Yes — but `sendAndWait` has a default 60s timeout and fleet tasks exceed that. Use `sendAndWait({ prompt: '/fleet ...', timeout: 300_000 })` (5 min). Confirmed: EXP5 produced real fleet subagent events but timed out at 60s because the 4th subagent didn't finish in time.

**Is there a dedicated SDK RPC method for fleet?**
**YES** — `session.rpc.fleet.start({ prompt?: string })` → `{ started: boolean }`.
This is a first-class SDK method. It triggers fleet mode and returns immediately; subagent progress comes via events. `session.rpc` keys: `["model", "mode", "plan", "workspace", "fleet"]`.

**Does `/tasks` have an SDK RPC equivalent?**
No. `/tasks` sent via `sendAndWait` timed out (60s). No `session.rpc.tasks` namespace exists. `/tasks` appears to be CLI-only.

**How does the SDK indicate fleet mode is active?**
Via `subagent.started` events — there is no "fleet.started" wrapper. The `session.rpc.fleet.start()` return value `{ started: boolean }` is the only synchronous signal that fleet was activated.

---

### Spike 03: Subagent Access & Lifecycle

**Can we query individual subagent status?**
No dedicated RPC for individual subagent status. The only mechanism is tracking `subagent.started` / `subagent.completed` / `subagent.failed` events by `toolCallId`.

**Can we read subagent output separately?**
No. Subagent output is not streamed separately per subagent. The final aggregated result comes as `assistant.message` text after all subagents complete.

**What happens on abort?**
`session.abort()` is available and callable. After calling it, no `subagent.failed` events were observed (EXP3 had 0 abort events). Abort appears to cut the stream without emitting cleanup events for in-progress subagents.

**Can we kill individual subagents?**
No. No `rpc.session.killSubagent`, `stopSubagent`, or similar method exists. The only kill mechanism is session-level `session.abort()`, which kills all subagents at once.

---

### Spike 04: rpc.fleet.start() Direct API

**Is `rpc.fleet.start()` blocking or fire-and-forget?**
**BLOCKING.** It does not return until the entire fleet execution completes (including final LLM synthesis turn). In EXP1 it returned after 32s (matched `session.idle`). In EXP3 it held for 399s. In EXP5 it returned at +27046ms while the first `subagent.started` fired at +6600ms — events fire during the await via Node.js event loop, but the call itself doesn't resolve until done.

**Does `rpc.fleet.start()` always return `{ started: true }`?**
In all 5 experiments: always `{ started: true }`. However, `started: true` does NOT mean subagents were spawned. EXP2 and EXP4 both returned `{ started: true }` with 0 subagent events — the LLM answered inline when no implementation-oriented prompt was given.

**Does `rpc.fleet.start()` without a prompt spawn subagents?**
No. EXP2 (primed session, no prompt): 0 subagents, returned in 7s.
EXP4 (fresh session, no prompt): 0 subagents, returned in 7s.
**Conclusion: a specific task-oriented `prompt` is required to trigger real fleet subagent dispatch.**

**What agent types does fleet spawn?**
- `explore` — fast, read-only (grep/glob/view). Used for analysis/research tasks. ~8-20s per agent.
- `general-purpose` — slow, full tool access (can write code). Used for implementation tasks. ~60-215s per agent.

**EXP3 timeline (accept+fleet with real plan, 4 subagents, 399s total):**
```
+10s   subagent.started   explore        (fleet.start() still awaiting)
+61s   subagent.completed explore
+180s  subagent.started   general-purpose  × 3 (spawned in parallel after explore finished)
+216s  subagent.completed general-purpose  (1 of 3)
+399s  rpc.fleet.start() returned         (2 of 3 general-purpose still running)
```

**New event type discovered: `tool.execution_partial_result`**
Appears during `general-purpose` agent execution (streaming output). Not seen in explore runs.

**EXP5 timing confirmation:**
`rpc.fleet.start()` returned at +27046ms. First `subagent.started` fired at +6600ms. **fleet.start() returns AFTER events start, AFTER session.idle.** Correct usage pattern:

```javascript
// ✅ Correct: set up listener BEFORE calling fleet.start(), fire-and-forget
session.on((event) => { /* handle subagent events */ });
workSession.rpc.fleet.start({ prompt }).catch(handleError); // don't await

// ❌ Wrong: await fleet.start() — blocks extension for 30-400+ seconds
await workSession.rpc.fleet.start({ prompt });
```

---

### SDK Refresh (2026-03-12) — New APIs in 0.1.27–0.1.32

#### What was added since we started (0.1.26 → 0.1.32)

**1. Custom Agents (`customAgents` in `SessionConfig`)** ← biggest addition
Define your own named agents with scoped tools, system prompts, and optional MCP servers. The runtime auto-selects them based on user intent (or you can manually select).

```typescript
const session = await client.createSession({
    customAgents: [
        {
            name: "researcher",
            displayName: "Research Agent",
            description: "Explores codebases and answers questions using read-only tools",
            tools: ["grep", "glob", "view"],
            prompt: "You are a research assistant. Analyze code, do not modify files.",
            infer: true,  // runtime can auto-select this agent
        },
        {
            name: "implementer",
            displayName: "Implementer Agent",
            description: "Implements code changes based on analysis",
            tools: ["view", "edit", "bash"],
            prompt: "You make minimal, targeted code changes.",
        },
    ],
    agent: "researcher",  // pre-select on creation (new in 0.1.32)
});
```

**2. `agent` parameter in `SessionConfig` / `ResumeSessionConfig`** (commit #722, 2026-03-08)
Pre-select which custom agent is active at session start. Equivalent to calling `rpc.agent.select()` after creation but avoids the extra call.

**3. `session.rpc.agent.*` — programmatic agent switching**
```typescript
await session.rpc.agent.list()           // → { agents: [{name, displayName, description}] }
await session.rpc.agent.getCurrent()     // → { agent: {name, displayName, description} | null }
await session.rpc.agent.select({ name }) // → { agent: {name, displayName, description} }
await session.rpc.agent.deselect()       // → {} (returns to default agent)
```

**4. `session.rpc.compaction.compact()`** — trigger session compaction
```typescript
const result = await session.rpc.compaction.compact();
// → { success: boolean, tokensRemoved: number, messagesRemoved: number }
```
Useful for long fleet runs that approach the context window limit.

**5. New session events**

| Event | Data | Notes |
|-------|------|-------|
| `session.task_complete` | `{ summary?: string }` | Agent completed its task; summary is optional text |
| `assistant.streaming_delta` | `{ totalResponseSizeBytes: number }` | Ephemeral; cumulative streaming progress |
| `subagent.deselected` | `{}` | Runtime switched away from sub-agent back to parent |

**6. `session.shutdown` event** (new docs — may have existed earlier)
Fires when session ends. Contains `codeChanges` metrics and `modelMetrics` usage breakdown.

---

#### Impact on Fleet Implementation

| Finding | Impact |
|---------|--------|
| `customAgents` available | We can define our own `researcher` + `implementer` agents instead of relying on built-in `explore`/`general-purpose` — gives us control over tools and prompts |
| `agent` in SessionConfig | Can pre-select the "right" agent for fleet work at session creation |
| `rpc.agent.select/deselect` | Could manually steer which agent handles each phase |
| `session.task_complete` | **New completion signal!** May fire after fleet finishes; check if it's emitted in fleet context (spike needed) |
| `compaction.compact()` | Essential for long fleet runs — can proactively compact before starting fleet to maximize context window |
| `subagent.deselected` | New event to handle in extension — round-trip cleanup for sub-agent UI |

---

## Postmortem

### What worked as expected

- `subagent.started` / `subagent.completed` events fire with `toolCallId` as the correlation key
- `session.rpc.fleet.start` exists as a proper SDK API (not just a slash command)
- `session.abort()` is available for cancellation
- Subagent events do interleave and complete out of order (as expected for parallel execution)

### What surprised us

- **`/fleet` as plain text in a fresh session doesn't reliably trigger fleet.** The LLM may decide to answer inline instead. Fleet actually fires when the session has plan context that causes the LLM to invoke the fleet tool (discovered via EXP5 dual-session test).
- **`sendAndWait` times out at 60s** — fleet routinely exceeds this. Need to pass a higher `timeout` option or switch to event-driven flow with `session.rpc.fleet.start`.
- **No `fleet.*` wrapper events.** There is no "fleet started" / "fleet completed" event. You track fleet state entirely by accumulating `subagent.*` events.
- **Tool events DO carry per-subagent attribution via `parentToolCallId`.** Every `tool.execution_start` fired inside a subagent has `parentToolCallId` matching `subagent.started.toolCallId`. Initially missed because our spike logged a nonexistent `subagentId` field. 18/27 tool events in spike-05 had it populated — all the real work (view/grep/bash) was attributable.
- **No per-subagent output streaming.** All subagent results are aggregated into a single `assistant.message` at the end.
- **Tool events don't carry a subagent ID — CORRECTED in spike-05.** `tool.execution_start` carries `parentToolCallId` matching `subagent.started.toolCallId`. Our spike code was checking for a `subagentId` field that doesn't exist. The attribution is there, via the right field name.
- **`/tasks` is CLI-only.** No SDK equivalent.
- **`rpc.fleet.start()` is blocking, not fire-and-forget.** It awaits full fleet completion (up to 400+ seconds) before returning. Must not await it synchronously — fire-and-forget with event listeners for progress.
- **`{ started: true }` doesn't mean subagents spawned.** Always returns `true` even when fleet decides not to use parallel agents (no prompt / no context). Can't use return value as confirmation.
- **Real implementation fleet uses `general-purpose` agents** — not just `explore`. These are slow (60-215s each) and can write code. Fleet may chain: `explore` first, then multiple `general-purpose` in parallel.
- **New event type: `tool.execution_partial_result`** — fires during `general-purpose` agent execution. Need to handle in extension.
- **Fleet chose explore-first pattern on its own**: EXP3 spawned 1 `explore` to research first, then dispatched 3 `general-purpose` agents in parallel. The LLM orchestrates this automatically.

### Plan modifications needed

- **Use `session.rpc.fleet.start({ prompt })` instead of `sendAndWait('/fleet ...')`** — more reliable, returns immediately (do NOT await), fire-and-forget with event listeners.
- **Fleet UI must be event-driven**: track `subagent.started` count → show N running agents; decrement on `subagent.completed` / `subagent.failed`; show final result from `assistant.message`.
- **A specific task-oriented prompt is required** — `rpc.fleet.start({})` with no prompt will not spawn subagents. The "Accept + Fleet" flow must pass the plan text as `prompt`.
- **No subagent-level progress display** — ~~impossible~~ **fully supported**. `tool.execution_start.parentToolCallId` links every child tool call to its parent subagent in real time. SubagentTracker can show a live tool feed per agent card.
- **Cancel = `session.abort()`** — kills all subagents. No partial cancel.
- **Handle `tool.execution_partial_result`** events in extension — new event type only seen during fleet.
- **Plan for 5-10 minute fleet runs** — real implementation fleet (general-purpose agents) can take 400+ seconds. UI must tolerate this gracefully without appearing stuck.
- **Call `rpc.compaction.compact()` before fleet** — proactively free context tokens before a long fleet run.
- **Define `customAgents` for fleet sessions** — rather than relying on built-in `explore`/`general-purpose`, define our own `researcher`+`implementer` pair for better control.
- **Handle `subagent.deselected`** — new event that needs to be tracked in the fleet UI state machine.
- **Watch for `session.task_complete`** — new signal that may indicate fleet completion; check alongside `session.idle`.
- **Extension pattern for fleet.start():**
  ```typescript
  // In sdkSessionManager.ts (future):
  async startFleet(prompt: string): Promise<void> {
      this.emitFleetActive(true);
      // DO NOT await — blocks for minutes
      this.currentSession.rpc.fleet.start({ prompt })
          .then(() => this.emitFleetActive(false))
          .catch((err) => this.emitFleetError(err));
  }
  ```

### Risks identified

- **Fleet may not fire if context is wrong**: `rpc.fleet.start()` returns `{ started: true }` even when no subagents spawn. Must validate by watching for first `subagent.started` within ~15s of calling fleet.start; if none arrive, fleet is running inline.
- **No fleet completion event**: Must infer completion from `session.idle` event or by tracking `subagent.started` vs `subagent.completed` counts. Note: `session.idle` fires BEFORE `fleet.start()` resolves — use event listener, not return value.
- **Abort has no cleanup events**: If we abort, we can't know which subagents were running. The UI must handle this gracefully (clear running state on abort).
- **general-purpose agents can run for 60-400+ seconds per agent** — UI must not time out or show "stuck" state.
- **Fleet chose explore-first autonomously**: The orchestrator (LLM) decides which agent types to use and in what order. Our UI must gracefully handle sequential subagent batches, not just a single parallel burst.
- **4 started / 2 completed in EXP3** — some subagents may still be running when `session.idle` fires. This could mean the session goes idle while agents are still technically in progress, or that the collection timed out (300s) before agents finished.
