# Fleet Command — Parallel Subagent Execution

## Problem/Opportunity

Copilot CLI v1.0 (GA Feb 2026) introduced `/fleet` — a parallel execution feature that breaks tasks into independent subtasks and runs them concurrently via subagents. Our extension already receives subagent SDK events (`subagent.started`, `subagent.completed`, `subagent.failed`, `subagent.selected`) at `sdkSessionManager.ts:801-808` but only logs them. Users who want parallel execution must drop to the CLI terminal — there's no way to trigger or monitor fleet from the sidebar.

## Fleet Command Features

### Core Behavior
- **Orchestrator pattern**: The main agent analyzes a prompt or plan, identifies subtask dependencies, and dispatches independent tasks to separate subagents concurrently
- **Subagent isolation**: Each subagent gets its own context window, tools, and permissions — separate from the main agent and from each other
- **Smart dependency analysis**: The orchestrator identifies which tasks depend on each other and only parallelizes truly independent work

### Usage Patterns
1. **Direct**: `/fleet add unit tests for every service in src/services/`
2. **With plan mode**: Create plan → accept → `/fleet implement the plan`
3. **Autopilot combo**: Plan → "Accept plan and build on autopilot + /fleet" for fully autonomous parallel execution

### Configuration
- **Model selection**: Subagents use a low-cost model by default; configurable per-task
- **Custom agents**: If `.copilot/agents/` defines custom agents, subagents can use them via `@AGENT-NAME` syntax
- **Task monitoring**: `/tasks` shows all background subagent tasks with kill (`k`) and remove (`r`) options

### SDK Events

**Phase 0 spikes complete (2026-03-12). All questions answered.**

| Event | Key Fields | When |
|-------|-----------|------|
| `subagent.started` | `toolCallId`, `agentName`, `agentDisplayName`, `agentDescription` | Subagent spawned |
| `subagent.completed` | `toolCallId`, `agentName`, `agentDisplayName` | Subagent finished successfully |
| `subagent.failed` | `toolCallId`, `agentName`, `agentDisplayName`, `error` | Subagent errored |
| `subagent.selected` | `agentName`, `agentDisplayName`, `tools` | Custom agent selected (not seen in fleet) |
| `tool.execution_start` | `toolCallId`, `toolName`, `arguments`, `parentToolCallId?` | Tool fired — **`parentToolCallId` links child tools to their subagent** |
| `system.notification` | `kind.agentId`, `kind.description`, `kind.prompt`, `kind.status` | Agent completed — includes full task description |

**Agent identity lookup chain** (two-hop, all from events):
```
subagent.started.toolCallId
  → tool.execution_complete.toolCallId (same value, fires +0ms)
    → toolTelemetry.properties.agent_id   ("agent-0", "agent-1", ...)

tool.execution_start.parentToolCallId   (child tools inside subagent)
  → matches subagent.started.toolCallId  (real-time attribution)
```

**SubagentTracker build order** (for implementation):
1. `tool.execution_start` (tool=`task`) → register `toolCallId` as a pending agent slot
2. `subagent.started` (same `toolCallId`) → agent is live; display `agentDisplayName` + `agentDescription`
3. `tool.execution_complete` (same `toolCallId`, +0ms) → extract `toolTelemetry.properties.agent_id`; now `toolCallId ↔ agent-N` map is complete
4. `tool.execution_start` (child: `parentToolCallId` = agent's `toolCallId`) → live tool feed for that agent card (`view`, `grep`, `bash` with arguments)
5. `system.notification` (`kind.agentId` = `agent-N`) → task description available if not already known
6. `subagent.completed` / `subagent.failed` → mark agent done; show result summary

**New event types in 0.1.32** to handle:
- `permission.requested` / `permission.completed` — file read permissions during fleet (auto-approved by `approveAll`)
- `session.background_tasks_changed` — fires on agent lifecycle changes (payload always `{}`, use as trigger to refresh count)
- `system.notification` — rich agent completion metadata

### Cost Implication
Each subagent interacts with the LLM independently. Fleet execution may consume significantly more premium requests than sequential execution of the same work. This is relevant for our cost-tier model display.

## Proposed Solution

Surface fleet as a first-class feature in the sidebar extension:

1. **`/fleet` slash command** — trigger fleet execution from the chat input
2. **`/tasks` slash command** — view/manage active subagent tasks
3. **SubagentTracker UI** — real-time visual tracking of subagent progress, rendered as a **sibling of MessageDisplay** in `main.js`. Lives in a new `<div id="fleet-tracker-mount">` mount point inserted **between `#messages-mount` and `#acceptance-mount`** in `chatViewProvider.ts`. This keeps the panel **outside** the scrollable `.messages` container so it stays visible even as the conversation scrolls. SubagentTracker is never a child of MessageDisplay.

   **Each agent card shows** (all from real event data, no polling):
   ```
   ● explore  "Summarize sdkSessionManager.ts"   running 8s
     ├ view    src/sdkSessionManager.ts            ✓ 12ms
     ├ bash    grep -n "export" ...                ✓ 15ms
     ├ grep    "SDKSessionManager" src/            ✓ 8ms
     └ bash    wc -l src/sdkSessionManager.ts      ⏳
   ```
   Powered by `parentToolCallId` on `tool.execution_start` events — each child tool call is attributed to its parent agent in real time.
4. **Plan mode integration** — "Accept + Fleet" button in `AcceptanceControls`. When clicked, it emits `acceptFleet` on the component's own event system (same pattern as `accept`/`reject`). In `main.js`, `acceptanceControls.on('acceptFleet', handler)` wires to `rpc.acceptAndFleet()`. On the extension side, `acceptAndFleet()` in `sdkSessionManager.ts` runs the same flow as `acceptPlan()` — calls `disablePlanMode()` (destroys plan session, re-activates work session), fires `plan_accepted` status — but instead of `buildKickoffMessage()`, calls `sendMessage('/fleet implement the plan', ...)` on the resumed work session.
5. **Event pipeline** — full event flow from SDK → sdkSessionManager → RPC → webview

## Value

- Users can trigger and monitor parallel execution without leaving the sidebar
- Subagent progress is visible in real-time (not hidden behind a CLI `/tasks` command)
- Plan mode + fleet combo enables the most powerful workflow directly from VS Code
- Cost implications are surfaced clearly (aligns with our "thoughtful & useful" principle)

## Rough Scope

### New UI

SubagentTracker UI component

### New Files
- `src/extension/services/slashCommands/FleetSlashHandlers.ts` — `/fleet` and `/tasks` handlers
- `src/webview/app/components/SubagentTracker/SubagentTracker.js` — sibling component (not nested under MessageDisplay)

### `SubagentState` interface (from spike-confirmed payloads)
```typescript
// src/shared/models.ts
interface SubagentToolCall {
    toolCallId: string;
    toolName: string;        // "view" | "grep" | "bash" | ...
    arguments?: Record<string, unknown>;
    startedAt: number;       // Date.now()
    completedAt?: number;
    success?: boolean;
}

interface SubagentState {
    toolCallId: string;      // from subagent.started — permanent ID
    agentId?: string;        // "agent-0", "agent-1" — from tool.execution_complete.toolTelemetry
    agentName: string;       // "explore" | "general-purpose"
    agentDisplayName: string;
    description?: string;    // from system.notification.kind.description
    status: 'starting' | 'running' | 'completed' | 'failed';
    startedAt: number;
    completedAt?: number;
    error?: string;
    toolCalls: SubagentToolCall[];   // live feed from parentToolCallId
}
```

### Modified Files
- `src/shared/models.ts` — add `SubagentState` interface
- `src/shared/messages.ts` — add subagent/fleet RPC message types
- `src/sdkSessionManager.ts` — emit subagent events (replace log-only handling at line 801-808)
- `src/extension.ts` — wire new events
- `src/extension/rpc/ExtensionRpcRouter.ts` — add subagent send/receive methods
- `src/chatViewProvider.ts` — wire fleet slash commands; add `<div id="fleet-tracker-mount"></div>` between `#messages-mount` and `#acceptance-mount` in the webview HTML
- `src/webview/app/rpc/WebviewRpcClient.js` — add subagent handlers
- `src/webview/app/components/AcceptanceControls.js` — add "Accept + Fleet"
- `src/webview/app/components/SlashCommandPanel/SlashCommandPanel.js` — register `/fleet`, `/tasks`; add `'fleet'` to `CATEGORY_ORDER` with label `'Parallel Execution'`
- `src/webview/app/services/CommandParser.js` — register `/fleet` (type: `'extension'`, category: `'fleet'`) and `/tasks` (type: `'extension'`, category: `'fleet'`)
- `esbuild.js` — copy SubagentTracker.js to dist

### Version
Minor bump (new feature/capability).

## Dependencies

- Copilot CLI v1.0+ (GA — already available)
- `@github/copilot-sdk` 0.1.32+ — subagent events present; `parentToolCallId` confirmed populated
- **Phase 0 spike: COMPLETE** — see `planning/spikes/fleet-command/phase-0-fleet-command.md`
- **Blocked on**: 0.1.32 mechanical integration (`subagent.deselected`, `session.task_complete`, `onEvent` race fix) — tracked in `planning/backlog/upgrade-to-0.1.32.md`

## Open Questions (Resolved by Phase 0 Spikes)

All Phase 0 questions answered. See `planning/spikes/fleet-command/phase-0-fleet-command.md` for full findings. Key answers:

1. **SDK event payloads** — fully documented above (spike-02, spike-05)
2. **Programmatic trigger** — use `session.rpc.fleet.start({ prompt })` fire-and-forget; do NOT use `sendAndWait`
3. **Tool events vs subagent events** — interleaved in the same stream; child tools have `parentToolCallId` linking them to their parent subagent
4. **Per-subagent tool attribution** — YES, fully supported via `parentToolCallId` on `tool.execution_start`
5. **Individual subagent output** — not streaming; results come via `assistant.message` at end, plus `system.notification` per agent
6. **Abort behavior** — `session.abort()` kills all subagents; no cleanup events fired; clear all running state on abort
7. **Accept + Fleet prompt** — fleet needs the plan text inline as `prompt`; disk `plan.md` alone is not enough context for the fresh work session

## Remaining Unknowns (need spike before implementation)

1. Does `rpc.fleet.start()` use `customAgents` if defined on the session? (needed for Plan/Implement/Review workflow)
2. Does `session.task_complete` fire after fleet when using `customAgents`?
3. Can `session.shutdown` `codeChanges` metric surface "X files modified" post-fleet?
4. Can we `rpc.agent.select()` during an active `sendAndWait()` or `rpc.fleet.start()`? (mid-task agent switching — needed to auto-advance Plan/Implement/Review phases on `session.task_complete`)
5. Does `ResumeSessionConfig` support `customAgents` — meaning a resumed session gets the agents from the selected workflow? (types say yes, needs validation)

----

Extra stuff pulled from the 0.1.32 upgrade document that needs to be organized.

### Opportunity B: Custom Agents for Fleet Subagents

When `rpc.fleet.start()` is called on a session that has `customAgents` defined, the fleet dispatcher can use YOUR custom agents instead of the built-in `explore`/`general-purpose` ones.

From spike-04 EXP3, fleet autonomously chose `explore` → then 3× `general-purpose`. With custom agents, fleet would instead choose from our `planner`/`implementer`/`reviewer` set. This gives us:
- Predictable agent behavior (our prompts, not SDK defaults)
- Tighter tool scope per subagent (security principle of least privilege)
- Branded agent names in the UI ("Implementer Agent started" vs "General-Purpose Agent started")

**Question to validate**: Does `rpc.fleet.start()` use `customAgents` if they're defined? Needs a spike. Most likely yes, since the docs say "the runtime evaluates whether to delegate to a sub-agent" and custom agents are part of that evaluation.

### Opportunity C: Compaction Before Fleet

Spike-04 showed fleet can run for 400+ seconds with 386 events. Long sessions will hit context limits. Add automatic compaction before fleet:

```typescript
async startFleet(prompt: string): Promise<void> {
    // Compact first to maximize context window
    const compact = await this.session.rpc.compaction.compact();
    if (compact) {
        this.logger.info(`[Fleet] Pre-fleet compaction freed ${compact.tokensRemoved} tokens`);
    }

    this.emitFleetActive(true);
    this.session.rpc.fleet.start({ prompt })
        .then(() => this.emitFleetActive(false))
        .catch((err) => this.emitFleetError(err));
}
```