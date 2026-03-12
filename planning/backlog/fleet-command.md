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
| Event | Data | When |
|-------|------|------|
| `subagent.started` | `toolCallId`, `name`, `displayName` | Subagent spawned |
| `subagent.completed` | `toolCallId`, `name`, `displayName` | Subagent finished successfully |
| `subagent.failed` | `toolCallId`, `name`, `displayName`, `error` | Subagent errored |
| `subagent.selected` | `toolCallId`, `name`, `displayName` | Custom agent selected for task |

### AgentNode Interface (SDK)
```
toolCallId: string    — unique identifier
name: string          — agent name
displayName: string   — human-readable name
status: string        — running/complete/failed
error?: string        — error details if failed
startedAt?: string    — ISO timestamp
completedAt?: string  — ISO timestamp
```

### Cost Implication
Each subagent interacts with the LLM independently. Fleet execution may consume significantly more premium requests than sequential execution of the same work. This is relevant for our cost-tier model display.

## Proposed Solution

Surface fleet as a first-class feature in the sidebar extension:

1. **`/fleet` slash command** — trigger fleet execution from the chat input
2. **`/tasks` slash command** — view/manage active subagent tasks
3. **SubagentTracker UI** — real-time visual tracking of subagent progress within the message display area (child of MessageDisplay, like ToolExecution)
4. **Plan mode integration** — "Accept + Fleet" option in AcceptanceControls
5. **Event pipeline** — full event flow from SDK → sdkSessionManager → RPC → webview

## Value

- Users can trigger and monitor parallel execution without leaving the sidebar
- Subagent progress is visible in real-time (not hidden behind a CLI `/tasks` command)
- Plan mode + fleet combo enables the most powerful workflow directly from VS Code
- Cost implications are surfaced clearly (aligns with our "thoughtful & useful" principle)

## Rough Scope

### New Files
- `src/extension/services/slashCommands/FleetSlashHandlers.ts` — `/fleet` and `/tasks` handlers
- `src/webview/app/components/SubagentTracker.js` — subagent tracking UI component

### Modified Files
- `src/shared/models.ts` — add `SubagentState` interface
- `src/shared/messages.ts` — add subagent/fleet RPC message types
- `src/sdkSessionManager.ts` — emit subagent events (replace log-only handling at line 801-808)
- `src/extension.ts` — wire new events
- `src/extension/rpc/ExtensionRpcRouter.ts` — add subagent send/receive methods
- `src/chatViewProvider.ts` — wire fleet slash commands
- `src/webview/app/rpc/WebviewRpcClient.js` — add subagent handlers
- `src/webview/app/components/AcceptanceControls.js` — add "Accept + Fleet"
- `src/webview/app/components/SlashCommandPanel.js` — register `/fleet`, `/tasks`
- `esbuild.js` — copy SubagentTracker.js to dist

### Version
Minor bump (new feature/capability).

## Dependencies

- Copilot CLI v1.0+ (GA — already available)
- `@github/copilot-sdk` must expose subagent events (it does — already handled at sdkSessionManager.ts:801-808)
- **Phase 0 spike required**: We need to verify SDK event payloads, subagent lifecycle, and fleet trigger mechanism before implementation. See `planning/spikes/fleet-command/phase-0-fleet-command.md`.

## Open Questions (Spike Will Answer)

1. What exactly does the SDK emit for each subagent event? (payload shape, timing)
2. Can we trigger `/fleet` programmatically via the SDK, or must it go through `sendAndWait({ prompt: '/fleet ...' })`?
3. How do subagent events relate to the existing tool event stream? (interleaved? separate?)
4. Does each subagent produce its own tool events, or are they aggregated?
5. Can we access individual subagent output/status via SDK RPC methods?
6. What happens if we abort the main session while subagents are running?
