# Fleet Command Implementation Plan

## Problem Statement

The extension already receives `subagent.*` SDK events but only logs them. Users cannot trigger or monitor fleet execution from the sidebar. This plan surfaces fleet as a first-class feature: `/fleet` slash command, real-time SubagentTracker UI, "Accept + Fleet" button, and a full event pipeline from SDK to webview.

**Dependency note**: Requires `@github/copilot-sdk` >= 0.1.32 (installed per spike 2026-03-12).

---

## Approach

SubagentTracker build order (from spec):
1. `tool.execution_start` (tool=`task`) — register pending agent slot
2. `subagent.started` (same `toolCallId`) — agent live; display name + description
3. `tool.execution_complete` (same `toolCallId`, +0ms) — extract `toolTelemetry.properties.agent_id`
4. `tool.execution_start` (child `parentToolCallId`) — live tool feed per agent card
5. `system.notification` (`kind.agentId`) — task description if not already known
6. `subagent.completed` / `subagent.failed` — mark done

**Mount point**: `#fleet-tracker-mount` before `#acceptance-mount`. Collapsible drawer that sits outside the blue-bordered input panel, in the gap between messages and input. `#messages-mount` flex-shrinks when open.

```
#messages-mount          (flex-shrinks when drawer open)
#fleet-tracker-mount     (drawer — the yellow gap above input)
[blue border]
  #acceptance-mount
  #input-mount
[/blue border]
```

---

## TDD Rules (Non-Negotiable)

- Tests import actual production code — no mocks standing in for real modules
- Every RED test must fail before implementation exists — immediate pass means it tests nothing
- Tests verify behavior: DOM state, EventBus emissions, method outcomes
- BANNED: `fs.readFileSync` + `.includes()` on source; registry checks without calling `execute()`
- CommandParser tests must call `execute()` and verify EventBus event actually fires

---

## Phases

### Phase 0 — Spike: Does fleet use customAgents?

**Spike file**: `planning/spikes/fleet-command/spike-06-fleet-custom-agents.mjs`
**Results**: `planning/spikes/fleet-command/results/spike-06-output.json`

We just shipped the custom agents infrastructure (v3.6.0). Before wiring fleet into SDKSessionManager, we need to know if `rpc.fleet.start()` actually dispatches our custom agents or only the built-in `explore`/`general-purpose` types.

**Questions to answer:**

| # | Question | Impact if YES | Impact if NO |
|---|----------|--------------|--------------|
| 1 | Does `rpc.fleet.start()` dispatch custom agents defined on the session's `customAgents` config? | Fleet leverages our agents — major integration opportunity | Fleet ignores them — custom agents are a separate path |
| 2 | Does `session.task_complete` fire after fleet when `customAgents` are defined? | New completion signal for fleet | Keep tracking via `subagent.completed` count |
| 3 | Does `ResumeSessionConfig` accept `customAgents`? | Can attach custom agents to resumed sessions | Must create a new session for custom-agent fleet |
| 4 | Can `rpc.agent.select()` be called mid-fleet to steer subagent type? | Dynamic agent steering during fleet execution | Agent type is fixed at fleet.start() time |

**Spike design** (spike-06):
- EXP1: `createSession({ customAgents: [researcher, implementer] })` → call `rpc.fleet.start({ prompt: 'analyze src/ and list all exported functions' })` → log all `subagent.started.agentName` values — are they `researcher`/`implementer` or `explore`/`general-purpose`?
- EXP2: Same session, check if `session.task_complete` fires (listen for it alongside `session.idle`)
- EXP3: `resumeSession` with `customAgents` in config — does it accept without error?
- EXP4: Call `rpc.agent.select({ name: 'researcher' })` before `rpc.fleet.start()` — do subagents inherit that selection?

**Decision gate** — run spike, fill in findings, then choose implementation path:

| Finding | Phase 9 SDKSessionManager change |
|---------|----------------------------------|
| Fleet uses custom agents | Pass `customAgents` from the session config when calling `startFleet()`; SubagentTracker should show custom agent `displayName` (already in `subagent.started.agentDisplayName`) |
| Fleet ignores custom agents | No change — built-in `explore`/`general-purpose` only; document limitation |
| `task_complete` fires | Add handler alongside existing `session.idle` tracking |
| `task_complete` doesn't fire | Keep current approach: count running agents, mark fleet done when all `subagent.completed` |
| `resumeSession` accepts `customAgents` | Use in `acceptAndFleet()` flow when resuming work session |
| `resumeSession` rejects `customAgents` | Create fresh session for custom-agent fleet; note in acceptAndFleet() |

- [ ] Write `spike-06-fleet-custom-agents.mjs` with 4 experiments
- [ ] Run spike; log results to `results/spike-06-output.json`
- [ ] Fill in findings table in `phase-0-fleet-command.md`
- [ ] Update Phase 9 tasks based on findings before implementing

---

### Phase 1 — Shared Types

*No unit tests — TypeScript compilation is verification.*

- [ ] Add `SubagentToolCall` interface to `src/shared/models.ts`
- [ ] Add `SubagentState` interface to `src/shared/models.ts`
- [ ] Add Webview to Extension messages in `src/shared/messages.ts`: `startFleet`, `acceptAndFleet`, `killSubagent`
- [ ] Add Extension to Webview messages: `subagentStarted`, `subagentUpdated`, `subagentCompleted`, `subagentFailed`, `fleetActive`, `clearSubagents`
- [ ] Update `WebviewMessageType` union, `ExtensionMessageType` union, and type guards

---

### Phase 2 — RED: CommandParser fleet tests

**File**: `tests/unit/components/command-parser-fleet.test.js`

Run first, confirm ALL fail. Tests import actual `CommandParser.js` and `EventBus.js`.

- [ ] `/fleet` parses correctly; args captured from `/fleet list files in src`
- [ ] `getCommandType('fleet')` returns `'extension'`; `getEvent('fleet')` returns `'startFleet'`
- [ ] **execute() behavior**: parse `/fleet list files`, call `execute(cmd, eventBus)`, assert EventBus fires `startFleet` with args `['list', 'files']`
- [ ] `getCommandType('tasks')` returns `'extension'`; `getEvent('tasks')` returns `'showTasks'`
- [ ] **execute() behavior**: parse `/tasks`, call `execute(cmd, eventBus)`, assert EventBus fires `showTasks`
- [ ] Both appear in `getVisibleCommands()` with `category: 'fleet'`
- [ ] Both valid regardless of plan mode context

---

### Phase 3 — RED: AcceptanceControls fleet button tests

**File**: `tests/unit/components/acceptance-controls-fleet.test.js`

Run first, confirm ALL fail. No `.accept-fleet-btn` exists yet.

- [ ] Component renders element with class `.accept-fleet-btn`
- [ ] Clicking `.accept-fleet-btn` emits `acceptFleet` event — verified by registering `controls.on('acceptFleet', ...)` and clicking the real DOM button
- [ ] `.accept-fleet-btn` is included in `setButtonsDisabled(true/false)` behavior

---

### Phase 4 — RED: SlashCommandPanel fleet category tests

**File**: `tests/unit/components/slash-command-panel-fleet.test.js`

Run first, confirm ALL fail. `'fleet'` not in CATEGORY_ORDER.

- [ ] `panel.show([{ name: 'fleet', description: '...', category: 'fleet' }])` renders a visible group
- [ ] That group's label element textContent equals `'Parallel Execution'`
- [ ] Fleet commands appear under that group label, not under others

---

### Phase 5 — RED: SubagentTracker tests

**File**: `tests/unit/components/SubagentTracker.test.js`

ALL tests fail immediately — `SubagentTracker.js` does not exist. Import error is the expected RED.

JSDOM setup: same pattern as `AcceptanceControls.test.js`. Import actual `SubagentTracker.js`.

- [ ] Component mounts without error; container has expected root element
- [ ] Initially collapsed — root element is hidden or has zero-height class
- [ ] `handleSubagentStarted(subagent)` — verify DOM: card exists with `data-tool-call-id` matching `toolCallId`; card contains `agentDisplayName` text; card contains `agentDescription` text
- [ ] `handleChildToolUpdate(toolCallId, toolCall)` — verify DOM: tool row appended to correct card (matched by `toolCallId`); row contains `toolName`
- [ ] `handleChildToolUpdate` for unknown `toolCallId` — does not throw, no card created
- [ ] `handleSubagentCompleted(toolCallId)` — verify DOM: card has completed state class; does NOT have running/failed class
- [ ] `handleSubagentFailed(toolCallId, error)` — verify DOM: card has failed state class; error text is present in card
- [ ] `handleClearSubagents()` — verify DOM: all agent cards removed; container reverts to collapsed/empty state
- [ ] `handleFleetActive(true)` — drawer becomes visible (not hidden/collapsed)
- [ ] `handleFleetActive(false)` — drawer returns to collapsed/hidden state

---

### Phase 6 — GREEN: CommandParser + SlashCommandPanel

Run Phase 2 + 4 tests before touching these files to confirm RED. Implement until green.

- [ ] Add to `CommandParser.js`: `'fleet'` entry (type: `extension`, event: `startFleet`, category: `fleet`, description: `Run tasks in parallel with subagents`)
- [ ] Add to `CommandParser.js`: `'tasks'` entry (type: `extension`, event: `showTasks`, category: `fleet`, description: `View active subagent tasks`)
- [ ] Add `'fleet': 'Parallel Execution'` to `CATEGORY_LABELS` in `SlashCommandPanel.js`
- [ ] Add `'fleet'` to `CATEGORY_ORDER` in `SlashCommandPanel.js`
- [ ] Run phases 2+4 tests — confirm GREEN. Run full `npm test` — no regressions.

---

### Phase 7 — GREEN: AcceptanceControls

Run Phase 3 tests before touching this file to confirm RED.

- [ ] Add `.accept-fleet-btn` button to rendered HTML in `AcceptanceControls.js`
- [ ] Add click listener: `this.acceptFleetBtn.addEventListener('click', () => this.emit('acceptFleet'))`
- [ ] Include `.accept-fleet-btn` in `setButtonsDisabled()` method
- [ ] Cache `.accept-fleet-btn` in element references
- [ ] Update JSDoc: add `acceptFleet` to Events list
- [ ] Run Phase 3 tests — confirm GREEN. Run full `npm test` — no regressions.

---

### Phase 8 — GREEN: SubagentTracker component

Run Phase 5 tests before writing this file to confirm RED (import error = RED).

- [ ] Create `src/webview/app/components/SubagentTracker/SubagentTracker.js`
- [ ] Constructor `(container, eventBus)` — renders collapsed drawer root; registers EventBus listeners
- [ ] Internal state: `Map` keyed by `toolCallId` holding agent card state
- [ ] `handleSubagentStarted(subagent)` — create card with `data-tool-call-id`; show `agentDisplayName` + `agentDescription`; start elapsed timer
- [ ] `handleChildToolUpdate(toolCallId, toolCall)` — look up card by `toolCallId`; append tool row showing `toolName` and arguments summary; mark row pending/complete
- [ ] `handleSubagentCompleted(toolCallId)` — set card to completed state; stop timer; show elapsed duration
- [ ] `handleSubagentFailed(toolCallId, error)` — set card to failed state; render error text
- [ ] `handleClearSubagents()` — remove all cards; collapse drawer
- [ ] `handleFleetActive(active)` — add/remove open class; CSS transition handles height
- [ ] Drawer CSS: `height: 0; overflow: hidden` collapsed; `height: auto` open; auto-collapse ~3s after all agents complete
- [ ] EventBus wiring: `subagent:started`, `subagent:toolUpdate`, `subagent:completed`, `subagent:failed`, `subagent:clear`, `fleet:active`
- [ ] Run Phase 5 tests — confirm GREEN. Run full `npm test` — no regressions.

---

### Phase 9 — Backend Pipeline

No unit tests possible without live SDK; integration verified via VSIX install.

**ExtensionRpcRouter** (`src/extension/rpc/ExtensionRpcRouter.ts`):
- [ ] Add send methods: `sendSubagentStarted`, `sendSubagentChildToolUpdate`, `sendSubagentCompleted`, `sendSubagentFailed`, `sendFleetActive`, `sendClearSubagents`
- [ ] Add receive handlers: `onStartFleet`, `onAcceptAndFleet`, `onKillSubagent`

**SDKSessionManager** (`src/sdkSessionManager.ts`):
- [ ] Add private emitters: `_onDidSubagentStarted`, `_onDidSubagentCompleted`, `_onDidSubagentFailed`, `_onDidFleetActive`
- [ ] Add public readonly event accessors for each
- [ ] Replace log-only handling at lines 854-880: `subagent.started` builds and emits `SubagentState`; `subagent.completed` / `subagent.failed` emit with toolCallId; `session.background_tasks_changed` emits `fleetActive`; `system.notification` patches agent description; `tool.execution_start` with `parentToolCallId` emits child tool update; `tool.execution_complete` (task tool) extracts `toolTelemetry.properties.agent_id`
- [ ] Add case for `assistant.streaming_delta` — no-op (single debug log, silences spam)
- [ ] Add `public async startFleet(prompt: string)` — optional pre-compaction, fire-and-forget `session.rpc.fleet.start({ prompt })`, emit fleetActive true/false
- [ ] Add `public async acceptAndFleet()` — guard plan mode, read plan.md, fire visual message, call `disablePlanMode()`, emit `plan_accepted`, call `startFleet(planContent)`

**FleetSlashHandlers** (`src/extension/services/slashCommands/FleetSlashHandlers.ts`):
- [ ] Create new file
- [ ] `handleFleetCommand(args, sdkSessionManager)` — join args as prompt; if no args show info message; call `sdkSessionManager.startFleet(prompt)`
- [ ] `handleTasksCommand(rpcRouter)` — emit `sendFleetActive(true)` to surface tracker; show status message if no active agents

**chatViewProvider.ts**:
- [ ] Register fleet slash command handlers in routing
- [ ] Wire `onStartFleet` to `sdkSessionManager.startFleet()`
- [ ] Wire `onAcceptAndFleet` to `sdkSessionManager.acceptAndFleet()`
- [ ] Wire subagent emitter events to `rpcRouter.send*()` methods
- [ ] Emit `sendClearSubagents()` on new session and abort
- [ ] Add `<div id="fleet-tracker-mount"></div>` before `#acceptance-mount` in HTML template

**WebviewRpcClient.js**:
- [ ] Add send methods: `startFleet(prompt)`, `acceptAndFleet()`, `killSubagent(toolCallId)`
- [ ] Add receive registrations: `onSubagentStarted`, `onSubagentChildToolUpdate`, `onSubagentCompleted`, `onSubagentFailed`, `onFleetActive`, `onClearSubagents`

**main.js**:
- [ ] Import `SubagentTracker`
- [ ] Initialize on `#fleet-tracker-mount` with eventBus
- [ ] Wire `acceptanceControls.on('acceptFleet', () => rpc.acceptAndFleet())`
- [ ] Wire EventBus `startFleet` to `rpc.startFleet(args.join(' '))`
- [ ] Wire EventBus `showTasks` to open/focus fleet tracker
- [ ] Wire all `rpc.on*` subagent handlers to corresponding `eventBus.emit()` calls

**esbuild.js**:
- [ ] Add `SubagentTracker` dir variable, `mkdirSync`, `copyFileSync`

---

### Phase 10 — Integration Verification

- [ ] `npm run compile` — zero TypeScript errors
- [ ] `npm test` — full suite green (except known baseline failures)
- [ ] `./test-extension.sh` — builds and installs VSIX
- [ ] Manual: reload window, open sidebar, send `/fleet list files in src/` — SubagentTracker drawer appears, agent cards populate in real time
- [ ] Manual: enter plan mode, create a plan, click "Accept + Fleet" — drawer opens, agents spin up

---

### Phase 11 — Version Bump + Changelog

- [ ] Bump `package.json` to `3.7.0`
- [ ] Update `CHANGELOG.md`

---

## Technical Considerations

### Two-hop agent identity
`subagent.started` has `toolCallId` only. The `agent-N` short ID arrives 0ms later in `tool.execution_complete.toolTelemetry.properties.agent_id`. Maintain a `Map<toolCallId, SubagentState>` in sdkSessionManager; child tools arrive via `parentToolCallId` and look up their parent slot.

### fleet.start is fire-and-forget
From spike-02: `session.rpc.fleet.start({ prompt })` must NOT use `sendAndWait` — `session.idle` never fires during fleet. Emit `fleetActive(false)` in the `.then()` callback.

### acceptAndFleet prompt
From spike-04 EXP5: the fresh work session has no history after `disablePlanMode()`. Pass full `plan.md` content inline as the prompt — a file path alone gives fleet no context for task decomposition.

### Abort / session reset
`session.abort()` fires no cleanup events. Always emit `clearSubagents` proactively on abort and new session.

### Remaining unknowns (deferred to 03-agent-workflows.md)
1. ~~Does `rpc.fleet.start()` use `customAgents` if defined?~~ → **Phase 0 spike** (spike-06)
2. ~~Does `session.task_complete` fire after fleet with `customAgents`?~~ → **Phase 0 spike** (spike-06)
3. ~~Can `rpc.agent.select()` be called mid-fleet?~~ → **Phase 0 spike** (spike-06)
4. ~~Does `ResumeSessionConfig` support `customAgents`?~~ → **Phase 0 spike** (spike-06)
5. Can `session.shutdown` surface "X files modified" post-fleet?

---

## Plan Review

**Reviewed:** 2026-03-16 00:00
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

- **Thorough spike-driven approach (Phase 0).** Follows SDK-First Development mandate exactly. Four specific questions with a decision gate table that maps findings to implementation changes. Prevents building on assumptions.
- **Strict TDD phasing (Phases 2-5, 6-8).** RED-then-GREEN structure with explicit "run first, confirm ALL fail" instructions. Import errors count as RED. Matches project's non-negotiable TDD convention.
- **Correct event sequence documentation (Approach section).** Six-step SubagentTracker build order from SDK events is well-documented with specific event types and field names. "Two-hop agent identity" note correctly identifies the `toolCallId`-to-`agent_id` mapping challenge.
- **Build system awareness (Phase 9).** Explicitly includes `esbuild.js` update for new `SubagentTracker` directory, respecting the critical webview build system requirement from CLAUDE.md.
- **Component hierarchy compliance.** SubagentTracker placed as a direct `main.js` child on `#fleet-tracker-mount`, consistent with documented hierarchy.
- **Versioning is correct.** New feature with new UI → 3.7.0 minor bump per semver rules.

### Issues

#### Critical (Must Address Before Implementation)

**1. Phase 9 is a monolithic mega-phase that violates "small enough to implement in one session."**
- **Section:** Phase 9 — Backend Pipeline
- **Problem:** Touches six files across extension host (TypeScript) and webview (JavaScript): `ExtensionRpcRouter.ts`, `sdkSessionManager.ts`, `FleetSlashHandlers.ts`, `chatViewProvider.ts`, `WebviewRpcClient.js`, `main.js`, `esbuild.js`. Only verification is "VSIX install" — first feedback comes after everything is done.
- **Why it matters:** An implementer cannot verify progress incrementally. Debugging failures requires checking six files simultaneously.
- **Suggested fix:** Split into sub-phases:
  - Phase 9a: SDKSessionManager emitters and fleet methods (compile-verifiable)
  - Phase 9b: ExtensionRpcRouter send/receive + FleetSlashHandlers (compile-verifiable)
  - Phase 9c: chatViewProvider wiring + WebviewRpcClient + main.js + esbuild.js (VSIX-verifiable)

**2. No tests for backend code in Phase 9, contradicting project's TDD approach.**
- **Section:** Phase 9 — Backend Pipeline
- **Problem:** Plan states "No unit tests possible without live SDK" but this is too broad. `FleetSlashHandlers.ts` logic (argument joining, empty-args guard) is testable. `ExtensionRpcRouter` method registration is testable. Existing slash handlers likely have tests.
- **Why it matters:** The project's TDD convention is "Non-Negotiable" — stated in the plan itself. Skipping tests for an entire phase contradicts that principle.
- **Suggested fix:** Add RED/GREEN test phase for `FleetSlashHandlers`: (a) `handleFleetCommand` with args calls `startFleet` with joined prompt; (b) no args shows info message; (c) `handleTasksCommand` behavior. For SDKSessionManager, test event-to-emitter mapping with mock event data.

#### Important (Should Address)

**3. `killSubagent` RPC message defined but never implemented.**
- **Section:** Phase 1 (types) + Phase 9 (router)
- **Problem:** Phase 1 adds `killSubagent` message type, Phase 9 adds `onKillSubagent` to router, but no phase implements actual kill logic. No SDK API reference for per-agent cancellation.
- **Why it matters:** Creates dead code in message types and router. If SDK has no per-agent cancellation, the type shouldn't exist.
- **Suggested fix:** Add a spike question in Phase 0 to check if per-subagent cancellation exists, or remove `killSubagent` and defer.

**4. SubagentTracker not added to CLAUDE.md component hierarchy.**
- **Section:** Phase 11 / Component Hierarchy
- **Problem:** CLAUDE.md documents four top-level `main.js` children. Adding a fifth without updating the hierarchy documentation will mislead future developers.
- **Suggested fix:** Add task in Phase 11 (or new Phase 12) to update CLAUDE.md component hierarchy.

**5. No error handling for `session.rpc.fleet.start()` rejection.**
- **Section:** Phase 9 — SDKSessionManager `startFleet()`
- **Problem:** If RPC rejects (network error, session expired, unsupported CLI version), `.then()` callback for `fleetActive(false)` never fires. SubagentTracker drawer gets stuck active.
- **Suggested fix:** Add `.catch()` handler that emits `fleetActive(false)` and shows error notification.

**6. Auto-collapse "~3s after all agents complete" has no test.**
- **Section:** Phase 5 / Phase 8
- **Problem:** Timer-based behavior is untested. Could regress or collapse while user reads output.
- **Suggested fix:** Add Phase 5 test using fake timers to verify auto-collapse fires after all subagents complete.

**7. `assistant.streaming_delta` handling needs verification.**
- **Section:** Phase 9, line 215
- **Problem:** Adding a no-op case could mask events handled elsewhere. Current code likely hits `default` case (line 886) but should be verified.
- **Suggested fix:** Note explicitly that this event currently falls through to default.

#### Minor (Consider)

**8. Phase 4 test API should match actual `SlashCommandPanel.show()` signature.**
- Verify exact method signature before writing tests.

**9. No consideration of BufferedEmitter for subagent events.**
- If webview recreates during fleet (sidebar hide/show), subagent state is lost. Consider whether events should flow through BufferedEmitter or if `clearSubagents` on reconnect is sufficient.

**10. CSS file location for SubagentTracker not specified.**
- Drawer needs CSS (`height: 0`, `overflow: hidden`, transitions). Plan describes behavior but not where styles live.

### Recommendations

1. **Split Phase 9** before implementation. Single highest-risk change — monolithic backend phase with VSIX-only verification will be painful to debug.
2. **Resolve `killSubagent` scope** before writing types. Dead types in shared contract create confusion.
3. **Add documentation update phase.** CLAUDE.md component hierarchy, "9 components" count, and "10 granular events" count all need updating.
4. **Consider state replay on webview reconnect.** When sidebar hides/shows, webview is destroyed. `BackendState` may need to cache subagent state for replay, similar to how other state survives sidebar toggles.

### Assessment
**Implementable as written?** With fixes
**Reasoning:** Architecture is sound and follows established patterns. SDK API (`session.rpc.fleet.start()`) is confirmed. Event pipeline matches data flow conventions. However, Phase 9 is too large for one session, `killSubagent` is specified but unimplemented, and backend phase lacks tests despite strict TDD policy. Addressing the two critical issues (splitting Phase 9, adding backend tests) makes this reliably implementable.
