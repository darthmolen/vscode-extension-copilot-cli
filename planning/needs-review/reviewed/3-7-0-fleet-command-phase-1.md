# Fleet Command — 3.7.0 Implementation Plan

## Problem Statement

The extension receives `subagent.*` SDK events but only logs them. Users cannot trigger or monitor fleet execution from the sidebar. 3.7.0 surfaces fleet as a functional feature: `/fleet` + `/tasks` slash commands, "Accept + Fleet" button, and real-time progress as **text messages in the chat stream**. No new UI components. SubagentTracker drawer + BackendState replay are scoped to 3.8.0.

**Dependency note**: Requires `@github/copilot-sdk` >= 0.1.32 (installed per spike 2026-03-12).

---

## Approach

### Progress Display: Fleet Role in Message Stream

Fleet progress appears as distinct chat messages with `role: 'fleet'`. Pipeline:

```
subagent.started → sdkSessionManager emits → chatViewProvider → rpcRouter.sendFleetStatusMessage()
  → WebviewRpcClient → eventBus.emit('message:add', { role: 'fleet', content: '🚀 ...' })
  → MessageDisplay renders styled status line
```

Message format examples:
- `🚀 **Explore Agent** dispatched — analyzing codebase structure`
- `🤖 **Implementer Agent** dispatched — writing authentication module`
- `✅ **Explore Agent** complete (12s)`
- `❌ **Implementer Agent** failed — context limit exceeded`
- `🎯 Fleet complete — 3 agents finished`

MessageDisplay adds a `role === 'fleet'` case: renders a `div.message--fleet` styled line. ~5 lines.

### Mount/Layout Changes: None
No `#fleet-tracker-mount`. No `esbuild.js` changes. No AcceptanceControls layout changes (the Accept + Fleet button is the only addition there).

### DOM Order (unchanged from today):
```
#messages-mount       (MessageDisplay — fleet status lines appear here)
#acceptance-mount     (AcceptanceControls — adds Accept + Fleet button)
#input-mount          (InputArea)
```

---

## TDD Rules (Non-Negotiable)

- Tests import actual production code — no mocks standing in for real modules
- Every RED test must fail before implementation — immediate pass means it tests nothing
- Tests verify behavior: DOM state, EventBus emissions, method calls, return values
- BANNED: `fs.readFileSync` + `.includes()` on source; registry checks without calling `execute()`
- CommandParser tests must call `execute()` and verify EventBus event fires
- Backend slash handler tests load from `out/` (compiled), inject mock dependencies

---

## Phases

### Phase 0 — Spike: Custom Agents + Kill Confirmation

**File**: `planning/spikes/fleet-command/spike-06-fleet-custom-agents.mjs`
**Results**: `planning/spikes/fleet-command/results/spike-06-output.json`

| # | Question | Impact |
|---|----------|--------|
| 1 | Does `rpc.fleet.start()` dispatch custom agents defined on `customAgents` session config? | Yes → expose in 3.8.0 UI; No → built-in agents only for now |
| 2 | Does `session.task_complete` fire after fleet with `customAgents`? | Yes → add handler; No → keep subagent count tracking |
| 3 | Does `ResumeSessionConfig` accept `customAgents`? | Affects `acceptAndFleet()` session creation strategy |
| 4 | Can `rpc.agent.select()` be called mid-fleet to steer subagent type? | Deferred feature; answer informs 3.8.0 design |
| 5 | Confirm: no per-subagent kill API exists (`rpc.session.killSubagent` etc.)? | Removes `killSubagent` from types permanently |

**Decision gate** — fill findings before Phase 1:

| Finding | Plan change |
|---------|------------|
| Fleet uses custom agents | Note in Phase 9a; expose `agentDisplayName` in fleet messages (already in payload) |
| `task_complete` fires | Add handler in Phase 9a |
| `resumeSession` rejects `customAgents` | `acceptAndFleet()` creates fresh session instead of resuming |
| No per-subagent kill API | Remove `killSubagent` from types (Phase 1) confirmed |

- [ ] Write `spike-06-fleet-custom-agents.mjs` (4 experiments)
- [ ] Run spike; log to `results/spike-06-output.json`
- [ ] Fill findings in `phase-0-fleet-command.md`
- [ ] Update Phase 1 and 9a tasks based on findings

---

### Phase 1 — Shared Types

*TypeScript compilation is the verification.*

**`src/shared/models.ts`** — add:
- [ ] `SubagentState` interface: `{ toolCallId, agentName, agentDisplayName, agentDescription, agentId?, startedAt, status: 'running'|'completed'|'failed', error? }`
- [ ] `SubagentToolCall` interface: `{ toolCallId, parentToolCallId, toolName, arguments, status: 'running'|'complete' }`

**`src/shared/messages.ts`** — add:
- [ ] Webview→Extension: `startFleet` (`{ prompt: string }`)
- [ ] Webview→Extension: `acceptAndFleet` (no payload)
- [ ] Extension→Webview: `fleetStatusMessage` (`{ text: string, kind: 'started'|'completed'|'failed'|'done' }`)
- [ ] Update `WebviewMessageType` union, `ExtensionMessageType` union, and both type guard arrays
- [ ] Do NOT add `killSubagent` — confirmed no SDK API (see Phase 0 spike)

---

### Phase 2 — RED: CommandParser fleet tests

**File**: `tests/unit/components/command-parser-fleet.test.js`

Run first, confirm ALL fail. Import actual `CommandParser.js` and `EventBus.js`.

- [ ] `getCommandType('fleet')` returns `'extension'`; `getEvent('fleet')` returns `'startFleet'`
- [ ] **execute() behavior**: parse `/fleet list files in src`, call `execute(cmd, eventBus)`, assert EventBus fires `startFleet` with args `['list', 'files', 'in', 'src']`
- [ ] `/fleet` with no args: `execute()` fires `startFleet` with empty args array
- [ ] `getCommandType('tasks')` returns `'extension'`; `getEvent('tasks')` returns `'showTasks'`
- [ ] **execute() behavior**: parse `/tasks`, call `execute(cmd, eventBus)`, assert EventBus fires `showTasks`
- [ ] Both appear in `getVisibleCommands()` with `category: 'fleet'`

---

### Phase 2.5 — RED: FleetSlashHandlers backend tests

**File**: `tests/unit/extension/services/slashCommands/fleet-slash-handlers.test.js`

Load from `out/extension/services/slashCommands/FleetSlashHandlers.js`. Pattern matches `compact-slash-handlers.test.js`.

- [ ] `handleFleetCommand(['list', 'files', 'in', 'src'], mockManager)` — verify `mockManager.startFleet('list files in src')` is called with joined string
- [ ] `handleFleetCommand([], mockManager)` — verify `startFleet` is NOT called; `vscode.window.showInformationMessage` called with usage hint
- [ ] `handleFleetCommand` with error thrown by `startFleet` — returns `{ success: false, error: ... }`
- [ ] `handleTasksCommand(mockRpcRouter)` — calls `mockRpcRouter.sendFleetStatusMessage()` or equivalent; no active agents = shows status message

---

### Phase 3 — RED: AcceptanceControls fleet button tests

**File**: `tests/unit/components/acceptance-controls-fleet.test.js`

Run first, confirm ALL fail. No `.accept-fleet-btn` exists yet.

- [ ] Component renders element with class `.accept-fleet-btn`
- [ ] Clicking `.accept-fleet-btn` emits `acceptFleet` event — verified by registering `controls.on('acceptFleet', ...)` and clicking real DOM button
- [ ] `.accept-fleet-btn` is included in `setButtonsDisabled(true)` and `setButtonsDisabled(false)` behavior

---

### Phase 4 — RED: SlashCommandPanel fleet category tests

**File**: `tests/unit/components/slash-command-panel-fleet.test.js`

Run first, confirm ALL fail. `'fleet'` not in `CATEGORY_ORDER` yet.

*Note: Confirmed `show()` signature is `show(commands)` where `commands: [{name, description, category}]`.*

- [ ] `panel.show([{ name: 'fleet', description: '...', category: 'fleet' }])` renders a visible group
- [ ] That group's label textContent equals `'Parallel Execution'`
- [ ] Fleet commands render under that label, not under session/plan/code/config/cli

---

### Phase 5 — GREEN: CommandParser + SlashCommandPanel

Run Phase 2 + 4 tests before touching files to confirm RED. Implement until green.

- [ ] Add to `CommandParser.js`: `'fleet'` entry (`type: 'extension'`, `event: 'startFleet'`, `category: 'fleet'`, `description: 'Run tasks in parallel with subagents'`)
- [ ] Add to `CommandParser.js`: `'tasks'` entry (`type: 'extension'`, `event: 'showTasks'`, `category: 'fleet'`, `description: 'View active subagent tasks'`)
- [ ] Add `'fleet': 'Parallel Execution'` to `CATEGORY_LABELS` in `SlashCommandPanel.js`
- [ ] Add `'fleet'` to `CATEGORY_ORDER` in `SlashCommandPanel.js`
- [ ] Run Phases 2+4 — confirm GREEN. Run `npm test` — no regressions.

---

### Phase 6 — GREEN: AcceptanceControls

Run Phase 3 tests before touching file to confirm RED.

- [ ] Add `.accept-fleet-btn` button to rendered HTML in `AcceptanceControls.js`
- [ ] Add click listener: `this.acceptFleetBtn.addEventListener('click', () => this.emit('acceptFleet'))`
- [ ] Include `.accept-fleet-btn` in `setButtonsDisabled()` method
- [ ] Cache `.accept-fleet-btn` in element references
- [ ] Update JSDoc: add `acceptFleet` to Events list
- [ ] Run Phase 3 — confirm GREEN. Run `npm test` — no regressions.

---

### Phase 7 — GREEN: FleetSlashHandlers

Run Phase 2.5 tests before writing this file to confirm RED (file doesn't exist = import error).

- [ ] Create `src/extension/services/slashCommands/FleetSlashHandlers.ts`
- [ ] `handleFleetCommand(args: string[], sessionManager: any)` — join args as prompt; if empty show info message; call `sessionManager.startFleet(prompt)`; return `{ success, content?, error? }`
- [ ] `handleTasksCommand(rpcRouter: any)` — send fleet status message; show status notification if no active agents
- [ ] Run Phase 2.5 — confirm GREEN. Run `npm test` — no regressions.

---

### Phase 9a — SDKSessionManager

*Compile-verifiable. No VSIX needed yet.*

- [ ] Add private emitters: `_onDidFleetStatusMessage` (fires for each subagent lifecycle event as formatted text)
- [ ] Add public readonly: `onDidFleetStatusMessage`
- [ ] Replace log-only handling at lines 854–880:
  - `subagent.started` → emit `fleetStatusMessage` with `kind: 'started'`, text: `🚀 **{agentDisplayName}** dispatched — {agentDescription}`; store in `Map<toolCallId, SubagentState>`
  - `subagent.completed` → emit `kind: 'completed'`, text: `✅ **{agentDisplayName}** complete ({elapsed}s)`; update map
  - `subagent.failed` → emit `kind: 'failed'`, text: `❌ **{agentDisplayName}** failed — {error}`; update map
  - `tool.execution_complete` (task tool) → extract `toolTelemetry.properties.agent_id`; update map entry
  - `system.notification` (`kind.agentId`) → patch description if not already set
  - `session.background_tasks_changed` → check if all agents done; if so emit `kind: 'done'`, text: `🎯 Fleet complete — {N} agents finished`
- [ ] Add no-op case for `assistant.streaming_delta` — currently falls through to `default` case (line 886) causing log spam per streaming byte. Single `debug` log only.
- [ ] Add `public async startFleet(prompt: string)`:
  - Set up event listeners BEFORE calling `fleet.start()` (fire-and-forget, don't await)
  - `session.rpc.fleet.start({ prompt }).catch(err => { this._onDidFleetStatusMessage.fire({ text: '❌ Fleet failed to start — ' + err.message, kind: 'failed' }); logger.error(...); })`
  - Never `await` fleet.start() — it blocks for 30–400s
- [ ] Add `public async acceptAndFleet()`:
  - Guard: must be in plan mode
  - Read `plan.md` content (full content, not path — fresh work session has no history)
  - Call `disablePlanMode()`
  - Emit `plan_accepted`
  - Call `startFleet(planContent)`
- [ ] `npm run compile` — zero TypeScript errors

---

### Phase 9b — ExtensionRpcRouter + chatViewProvider routing

*Compile-verifiable.*

**`src/extension/rpc/ExtensionRpcRouter.ts`**:
- [ ] Add send method: `sendFleetStatusMessage(payload: FleetStatusMessagePayload)`
- [ ] Add receive handlers: `onStartFleet(handler)`, `onAcceptAndFleet(handler)`

**`src/chatViewProvider.ts`**:
- [ ] Register fleet slash command handlers: wire `onStartFleet` to `sdkSessionManager.startFleet(args.join(' '))`; wire `onAcceptAndFleet` to `sdkSessionManager.acceptAndFleet()`
- [ ] Subscribe to `sdkSessionManager.onDidFleetStatusMessage` → call `rpcRouter.sendFleetStatusMessage()`
- [ ] Register `FleetSlashHandlers` for `/fleet` and `/tasks` in slash command routing
- [ ] `npm run compile` — zero TypeScript errors

---

### Phase 9c — WebviewRpcClient + main.js + MessageDisplay

*VSIX-verifiable.*

**`src/webview/app/rpc/WebviewRpcClient.js`**:
- [ ] Add send methods: `startFleet(prompt)`, `acceptAndFleet()`
- [ ] Add receive registration: `onFleetStatusMessage(handler)`

**`src/webview/main.js`**:
- [ ] Wire `acceptanceControls.on('acceptFleet', () => rpc.acceptAndFleet())`
- [ ] Wire EventBus `startFleet` to `rpc.startFleet(args.join(' '))`
- [ ] Wire EventBus `showTasks` to send status message or focus fleet info (simple info notification for 3.7.0)
- [ ] Register `rpc.onFleetStatusMessage(payload => eventBus.emit('message:fleet', payload))`

**`src/webview/app/components/MessageDisplay/MessageDisplay.js`**:
- [ ] Subscribe to `'message:fleet'` EventBus event
- [ ] Add `role === 'fleet'` case in `addMessage()`: renders `div.message--fleet` with text content; scrolls to bottom
- [ ] CSS in `chatViewProvider.ts` webview styles: `.message--fleet { font-style: italic; opacity: 0.85; padding: 4px 12px; }` (or equivalent — keeps it visually distinct but not loud)

---

### Phase 10 — Integration Verification

- [ ] `npm run compile` — zero TypeScript errors
- [ ] `npm test` — full suite green (except known baseline failures)
- [ ] `./test-extension.sh` — builds and installs VSIX
- [ ] Manual: reload window, open sidebar, send `/fleet list all TypeScript files in src/` — fleet status messages appear in chat stream as agents start and complete
- [ ] Manual: enter plan mode, create a plan, click "Accept + Fleet" — fleet dispatches with full plan content as prompt; progress messages appear in stream
- [ ] Manual: send `/fleet` with no args — info message shown, no fleet started

---

### Phase 11 — Version Bump + Docs

- [ ] Bump `package.json` to `3.7.0`
- [ ] Update `CHANGELOG.md`
- [ ] Update `CLAUDE.md`: add `acceptFleet` to AcceptanceControls events; add `FleetSlashHandlers` to services list; update "10 granular events" count in SDKSessionManager description
- [ ] Move reviewed plan file from `planning/needs-review/reviewed/` to `planning/needs-review/completed/`

---

## Technical Considerations

### fleet.start() is fire-and-forget (critical)
```javascript
// ✅ Correct
session.rpc.fleet.start({ prompt }).catch(handleError); // never await
// ❌ Wrong — blocks extension for 30–400+ seconds
await session.rpc.fleet.start({ prompt });
```
Always set up event listeners BEFORE calling `fleet.start()`.

### acceptAndFleet prompt: full plan.md content
Fresh work session after `disablePlanMode()` has no conversation history. Pass full `plan.md` content inline — file path alone gives fleet no decomposition context.

### Two-hop agent identity
`subagent.started` has `toolCallId` only. `agent-N` ID arrives 0ms later in `tool.execution_complete.toolTelemetry.properties.agent_id`. Maintain `Map<toolCallId, SubagentState>` in SDKSessionManager.

### streaming_delta spam
`assistant.streaming_delta` currently hits `default:` case (line 886) and logs a warning for every streaming byte. No-op case in Phase 9a silences this.

### killSubagent: confirmed dead code
Spike 03 confirmed: no per-subagent cancel API. Only `session.abort()` (kills all). `killSubagent` removed from types in Phase 1.

### Remaining unknowns (Phase 0 spike answers these)
1. Does `rpc.fleet.start()` dispatch `customAgents` if defined on session?
2. Does `session.task_complete` fire after fleet?
3. Does `ResumeSessionConfig` accept `customAgents`?
4. Confirm no per-subagent kill API

---

## 3.8.0 Scope

Deferred to `planning/3-8-0-fleet-command-phase-2.md`.

---

## Plan Review

**Reviewed:** 2026-03-16 18:50
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

1. **Well-structured TDD phasing.** RED/GREEN separation (Phases 2–4 for RED, 5–7 for GREEN) enforces the project's strict TDD requirement. Each test phase specifies exact file, expected failures, and assertions.
2. **SDK-first approach honored.** Phase 0 spike answers specific SDK questions before production code. References `rpc.fleet.start()` with correct signature matching actual SDK at `research/copilot-sdk/nodejs/src/generated/rpc.ts`. Fire-and-forget pattern called out prominently.
3. **No unnecessary UI components.** Surfacing fleet as `role: 'fleet'` messages in existing MessageDisplay stream reuses the message pipeline and defers SubagentTracker complexity to 3.8.0. Aligns with "Thoughtful & Useful" design principle.
4. **Correct `streaming_delta` spam identification.** Accurately identifies the `default:` case fallthrough at line 886 — confirmed in actual code.
5. **Accurate code references.** Correctly identifies `CATEGORY_LABELS`/`CATEGORY_ORDER` in SlashCommandPanel.js, `setButtonsDisabled` in AcceptanceControls.js, `execute()` in CommandParser.js, and subagent handling at lines 854–862 in sdkSessionManager.ts.

### Issues

#### Critical (Must Address Before Implementation)

**1. Phase 2.5 references nonexistent test pattern file.**
- Plan says "Pattern matches `compact-slash-handlers.test.js`" — no such file exists. Existing slash handler tests are `code-review-slash-handlers.test.js`, `info-slash-handlers.test.js`, and `not-supported-slash-handlers.test.js`.
- **Why it matters:** Implementer wastes time searching for a nonexistent file or guesses at test structure.
- **Fix:** Replace with `code-review-slash-handlers.test.js` as the pattern reference.

**2. Phase 9a `acceptAndFleet()` duplicates `acceptPlan()` logic without specifying the relationship.**
- `sdkSessionManager.ts` already has `acceptPlan()` (~line 1963) which handles: read plan.md, `disablePlanMode()`, emit `plan_accepted`, session rename, UI messaging. The plan's `acceptAndFleet()` reimplements steps 1–3 independently.
- **Why it matters:** Divergent accept logic will drift. If `acceptPlan()` gains new steps (telemetry, state cleanup), `acceptAndFleet()` silently misses them.
- **Fix:** Specify that `acceptAndFleet()` calls `acceptPlan()` first, then reads plan.md content (persists on disk after accept), then calls `startFleet(planContent)`. Or extract shared logic into a private method.

#### Important (Should Address)

**3. No `BufferedEmitter` specified for `_onDidFleetStatusMessage`.**
- All existing emitters in sdkSessionManager.ts use `BufferedEmitter` (lines 269–305). If this uses plain `EventEmitter`, fleet messages firing before webview connects are permanently lost.
- **Why it matters:** Fleet is especially vulnerable — `fleet.start()` is fire-and-forget, subagent events may arrive before webview finishes re-rendering after plan mode exit.
- **Fix:** Explicitly state `BufferedEmitter` usage, consistent with all other emitters.

**4. `session.background_tasks_changed` as fleet-done signal is unverified.**
- Plan proposes this event for "all agents done" detection, but Phase 0 spike questions don't include validating this. Event is currently only logged (lines 868–870); actual payload and fleet-completion semantics unknown.
- **Why it matters:** If event doesn't reliably fire at fleet completion, the "Fleet complete" summary never appears.
- **Fix:** Add to Phase 0 spike, or implement count-based completion detection (`completed + failed === started` from the Map).

**5. Phase numbering gap — no Phase 8.**
- Jumps from Phase 7 to Phase 9a. Unclear if content is missing.
- **Fix:** Renumber sequentially, or add note explaining gap (e.g., "Phase 8 removed — fleet tracker deferred to 3.8.0").

**6. Phase 9c fleet message rendering: markdown vs XSS risk.**
- Fleet messages use markdown (`**{agentDisplayName}**`). Plan says render as `div.message--fleet` with "text content." If `textContent`, bold markers appear literally. If `innerHTML`, XSS risk without sanitization.
- **Fix:** Specify same markdown rendering pipeline as assistant messages, or strip markdown from message templates (use plain text).

**7. No error handling for `acceptAndFleet()` when plan.md missing/empty.**
- Existing `acceptPlan()` checks `fs.existsSync(planPath)`. Plan's `acceptAndFleet()` doesn't mention this guard.
- **Fix:** Add guard — if plan.md missing or empty, show error and don't call `startFleet()`.

**8. `handleFleetCommand` dependency injection pattern unclear.**
- Phase 2.5 uses `mockManager` (SDKSessionManager) for `/fleet` but `mockRpcRouter` for `/tasks`. Inconsistent with how other slash handlers receive dependencies.
- **Fix:** Specify exact dependency interface — single context object or separate arguments? Match existing handler patterns.

#### Minor (Consider)

**9. Emoji in status messages.** Stylistic choice that should be conscious decision. Works fine in VS Code but some users may find distracting in professional tool.

**10. Phase 11 plan file move path is wrong.** Says move from `planning/needs-review/reviewed/` to `planning/needs-review/completed/`, but file will be wherever it lives at completion time.

**11. `SubagentToolCall` interface defined in Phase 1 but never referenced.** No subsequent phase uses it. If for 3.8.0, defer to avoid dead code.

### Recommendations

1. **Resolve `acceptAndFleet()` vs `acceptPlan()` relationship before implementation.** Most architecturally significant decision — getting this wrong means duplicated lifecycle logic or mid-implementation refactor.
2. **Add fleet completion detection to Phase 0 spike.** The `session.background_tasks_changed` assumption is the riskiest technical bet. Consider fallback: count-based detection from the Map.
3. **Specify `BufferedEmitter` explicitly.** One-line plan fix, prevents subtle message-drop bug during webview lifecycle transitions.
4. **Clarify markdown rendering approach for fleet messages.** Prevents XSS risk and literal markdown display.

### Assessment
**Implementable as written?** With fixes
**Reasoning:** Well-structured plan with strong codebase knowledge, SDK awareness, and TDD discipline. Three issues need resolution before implementation: (1) `acceptAndFleet()`/`acceptPlan()` relationship must be clarified to avoid duplicated session lifecycle logic, (2) `compact-slash-handlers.test.js` reference must be corrected to an existing file, (3) `session.background_tasks_changed` assumption should be validated in Phase 0 spike or replaced with count-based completion detection. None require fundamental redesign — targeted plan updates before Phase 1 begins.
