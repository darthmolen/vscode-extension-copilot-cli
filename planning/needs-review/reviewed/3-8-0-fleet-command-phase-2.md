# Fleet Command Phase 2 — 3.8.0 Implementation Plan

## Problem Statement

3.7.0 surfaces fleet as functional (text messages in chat stream). 3.8.0 adds proper UI: a collapsible **SubagentTracker** drawer with agent cards, elapsed timers, and BackendState replay so the tracker survives sidebar hide/show during a long fleet run.

**Prerequisite**: 3.7.0 shipped — `SubagentState` model, `onDidFleetStatusMessage` emitter, and `Map<toolCallId, SubagentState>` tracking all exist in SDKSessionManager.

---

## Approach

### SubagentTracker Drawer

Collapsible panel placed between `#messages-mount` and `#acceptance-mount`. Contains agent cards keyed by `toolCallId`. Opens when fleet starts, auto-collapses after all agents complete (configurable delay for testability).

```
#messages-mount       (MessageDisplay — flex: 1, min-height: 0)
#fleet-tracker-mount  (SubagentTracker — collapsible drawer, height: 0 when closed)
#acceptance-mount     (AcceptanceControls)
#input-mount          (InputArea)
```

### BackendState Subagent Replay

On sidebar hide/show (webview destroyed and recreated), the tracker must restore state. BackendState caches `Map<toolCallId, SubagentState>`. On webview reconnect the `init` payload (or a new `fleetState` message) replays active subagent state.

---

## TDD Rules (Non-Negotiable)

- Tests import actual production code — no mocks standing in for real modules
- Every RED test must fail before implementation — immediate pass means it tests nothing
- Tests verify behavior: DOM state, EventBus emissions, method calls, return values
- BANNED: `fs.readFileSync` + `.includes()` on source; registry checks without calling `execute()`
- JSDOM + fake timers required for all SubagentTracker tests

---

## Phases

### Phase 1 — Shared Types

**`src/shared/models.ts`** — no new types needed (SubagentState already added in 3.7.0).

**`src/shared/messages.ts`** — add:
- [ ] Extension→Webview: `fleetActive` (`{ active: boolean }`) — opens/closes drawer
- [ ] Extension→Webview: `fleetState` (`{ agents: SubagentState[] }`) — replay on reconnect
- [ ] Extension→Webview: `clearSubagents` (no payload) — reset on new session or abort
- [ ] Update `ExtensionMessageType` union and type guard array

---

### Phase 2 — RED: SubagentTracker component tests

**File**: `tests/unit/components/subagent-tracker.test.js`

Run first, confirm ALL fail. No `SubagentTracker` exists yet.

- [ ] Component renders `div.subagent-tracker` (collapsed by default: `height === '0'` or hidden)
- [ ] `handleFleetActive(true)` opens drawer (visible / non-zero height)
- [ ] `handleFleetActive(false)` collapses drawer immediately
- [ ] `addAgent({ toolCallId: 'a1', agentDisplayName: 'Implementer', status: 'running' })` renders a card with class `.agent-card[data-tool-call-id="a1"]`
- [ ] Card shows agentDisplayName as text content
- [ ] `updateAgent({ toolCallId: 'a1', status: 'completed' })` adds `.agent-card--completed` class
- [ ] `updateAgent({ toolCallId: 'a1', status: 'failed', error: 'context limit' })` adds `.agent-card--failed`; renders error text
- [ ] `clearAgents()` removes all `.agent-card` elements
- [ ] Auto-collapse: after all agents reach `completed`/`failed`, tracker auto-collapses after `collapseDelay` ms (inject via constructor for testability; use fake timers)
- [ ] `collapseDelay` defaults to `3000`; can be overridden to `0` for tests
- [ ] Elapsed timer: card shows running time in seconds, updating each second (fake timer test)

---

### Phase 3 — RED: BackendState subagent replay tests

**File**: `tests/unit/extension/backend-state-subagents.test.js`

Load from `out/` (compiled). Pattern matches existing BackendState tests.

- [ ] `setSubagentState(state)` stores `SubagentState` keyed by `toolCallId`
- [ ] `getSubagentStates()` returns array of all stored states
- [ ] `clearSubagentStates()` empties the map
- [ ] Updating existing `toolCallId` with `setSubagentState` merges/replaces the entry
- [ ] States survive across `getSubagentStates()` calls (not consumed/cleared on read)

---

### Phase 4 — RED: AcceptanceControls timer test (deferred from 3.7.0 review)

**File**: `tests/unit/components/acceptance-controls-fleet-timer.test.js`

- [ ] Inject `collapseDelay` into SubagentTracker constructor
- [ ] `handleFleetActive(false)` collapses immediately (no timer)
- [ ] Auto-collapse after all agents complete uses fake timer (does not collapse before delay)

---

### Phase 5 — GREEN: SubagentTracker component

Run Phase 2 tests before creating file to confirm RED (import error = all fail).

- [ ] Create `src/webview/app/components/SubagentTracker/SubagentTracker.js`
- [ ] Constructor: `(container, eventBus, { collapseDelay = 3000 } = {})`
- [ ] Internal state: `Map<toolCallId, { element, intervalId, startedAt, status }>`
- [ ] `handleFleetActive(active)`: toggle visible/collapsed CSS
- [ ] `addAgent(state)`: create `.agent-card`, start elapsed timer interval
- [ ] `updateAgent(state)`: add status class, stop timer if terminal, trigger auto-collapse check
- [ ] `clearAgents()`: clear all cards, stop all timers
- [ ] Auto-collapse logic: after all agents terminal, `setTimeout(collapse, collapseDelay)`
- [ ] Update `esbuild.js`: add `SubagentTracker` dir, `mkdirSync`, `copyFileSync`
- [ ] Run Phase 2 tests — confirm GREEN. Run `npm test` — no regressions.

---

### Phase 6 — GREEN: BackendState subagent caching

Run Phase 3 tests before touching file to confirm RED.

- [ ] Add `_subagentStates: Map<string, SubagentState>` to `backendState.ts`
- [ ] Add `setSubagentState(state: SubagentState)`, `getSubagentStates()`, `clearSubagentStates()` methods
- [ ] Run Phase 3 — confirm GREEN. Run `npm run compile` — zero TypeScript errors.

---

### Phase 7 — GREEN: SDKSessionManager BackendState integration

- [ ] On `subagent.started`: call `BackendState.setSubagentState(...)` in addition to emitting event
- [ ] On `subagent.completed` / `subagent.failed`: update state in BackendState
- [ ] On `session.abort()` and new session start: call `BackendState.clearSubagentStates()`
- [ ] Add `public getActiveSubagentStates()`: returns `BackendState.getSubagentStates()`
- [ ] `npm run compile` — zero TypeScript errors

---

### Phase 8 — ExtensionRpcRouter + chatViewProvider

- [ ] **`ExtensionRpcRouter.ts`**: add send methods `sendFleetActive(payload)`, `sendFleetState(payload)`, `sendClearSubagents()`
- [ ] **`chatViewProvider.ts`**:
  - On `onDidFleetStatusMessage` with `kind: 'started'`: also call `rpcRouter.sendFleetActive({ active: true })`; call `rpcRouter.sendFleetState({ agents: [...] })`
  - On `kind: 'done'` or `kind: 'failed'` (all agents terminal): call `rpcRouter.sendFleetActive({ active: false })`
  - On webview reconnect (`init` handler): include `subagentStates: sdkSessionManager.getActiveSubagentStates()` in init payload (or send separate `fleetState` message)
  - On `session.abort()` / new session: call `rpcRouter.sendClearSubagents()`
- [ ] `npm run compile` — zero TypeScript errors

---

### Phase 9 — WebviewRpcClient + main.js + layout

**`src/webview/app/rpc/WebviewRpcClient.js`**:
- [ ] Add receive registrations: `onFleetActive(handler)`, `onFleetState(handler)`, `onClearSubagents(handler)`

**`src/webview/main.js`**:
- [ ] Instantiate `SubagentTracker` mounted on `#fleet-tracker-mount`
- [ ] Wire `rpc.onFleetActive(({ active }) => subagentTracker.handleFleetActive(active))`
- [ ] Wire `rpc.onFleetState(({ agents }) => agents.forEach(a => subagentTracker.addAgent(a)))`
- [ ] Wire `rpc.onClearSubagents(() => subagentTracker.clearAgents())`
- [ ] Wire EventBus `message:fleet` → also call `subagentTracker.addAgent()` / `subagentTracker.updateAgent()` based on `kind`

**`src/chatViewProvider.ts`** HTML:
- [ ] Add `<div id="fleet-tracker-mount"></div>` between `#messages-mount` and `#acceptance-mount`
- [ ] `#messages-mount`: add `min-height: 0; flex: 1` so tracker doesn't push input off screen
- [ ] `#fleet-tracker-mount` placement: outside the blue-bordered plan mode input panel

**CSS** (in chatViewProvider.ts webview styles):
- [ ] `.subagent-tracker { overflow: hidden; transition: height 0.2s ease; }`
- [ ] `.agent-card { display: flex; gap: 8px; padding: 4px 12px; font-size: 0.9em; }`
- [ ] `.agent-card--completed { opacity: 0.6; }`
- [ ] `.agent-card--failed { color: var(--vscode-errorForeground); }`

---

### Phase 10 — Integration Verification

- [ ] `npm run compile` — zero TypeScript errors
- [ ] `npm test` — full suite green (except known baseline failures)
- [ ] `./test-extension.sh` — builds and installs VSIX
- [ ] Manual: reload window, run `/fleet list all TypeScript files in src/` — SubagentTracker drawer opens, agent cards appear with running timers, cards update to completed/failed, drawer auto-collapses after 3s
- [ ] Manual: hide and reshow sidebar during active fleet — tracker restores state from BackendState replay
- [ ] Manual: start new session during fleet — `clearSubagents` fires, tracker resets cleanly
- [ ] Manual: `session.abort()` — tracker clears

---

### Phase 11 — Version Bump + Docs

- [ ] Bump `package.json` to `3.8.0`
- [ ] Update `CHANGELOG.md`
- [ ] Update `CLAUDE.md`: add `SubagentTracker` to component hierarchy; update component list; update esbuild.js note; add `fleetActive`/`fleetState`/`clearSubagents` to RPC message list

---

## Technical Considerations

### Elapsed Timer Testability

Pass `collapseDelay` into SubagentTracker constructor. Tests use `0` delay and fake timers (`sinon.useFakeTimers()` or equivalent). Never use `setTimeout` with hardcoded values in tests.

### Flex Layout: Tracker Must Not Push Input Off Screen

`#messages-mount` must have `flex: 1; min-height: 0` so it shrinks when tracker opens. Without `min-height: 0`, flexbox won't shrink below content height and input area gets pushed off screen.

### BackendState Replay vs BufferedEmitter

SubagentTracker state is replayed via BackendState (`fleetState` message on reconnect), not via BufferedEmitter. BufferedEmitter is for streaming messages during startup race condition — BackendState is for sidebar hide/show replay. They solve different problems.

### clearSubagents on abort()

`session.abort()` fires no cleanup events. `clearSubagents` must be proactively emitted by the extension on abort and on new session start. Don't rely on SDK events to signal tracker reset.

---

## Plan Review

**Reviewed:** 2026-03-16 18:45
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

1. **Clear prerequisite declaration.** The plan explicitly states what must exist from 3.7.0 before this work begins — good practice for multi-version feature rollouts.
2. **Strong TDD discipline (Phases 2–4, 5–6).** RED-then-GREEN phase structure matches the project's strict TDD conventions. Test files specify concrete assertions on DOM state, class names, and timer behavior.
3. **esbuild.js awareness (Phase 5).** Explicitly calls out updating `esbuild.js` with `mkdirSync` and `copyFileSync` for the new `SubagentTracker` directory — addresses the critical webview build system caveat in CLAUDE.md.
4. **BackendState vs BufferedEmitter distinction (Technical Considerations).** Correctly identifies that sidebar hide/show replay belongs in BackendState, not BufferedEmitter, and explains why.
5. **Testability design (collapseDelay injection).** Injecting `collapseDelay` via constructor for fake timer testing is clean and pragmatic.
6. **clearSubagents on abort.** Notes that `session.abort()` fires no cleanup events and `clearSubagents` must be proactively emitted — critical operational detail.
7. **Layout concern (flex/min-height).** Identifying `min-height: 0` requirement prevents a real CSS flexbox pitfall.

### Issues

#### Critical (Must Address Before Implementation)

**1. Prerequisite does not exist — `SubagentState`, `onDidFleetStatusMessage`, and `Map<toolCallId, SubagentState>` are not in the codebase.**
- The plan states 3.7.0 shipped these, but grepping the codebase finds them only in planning documents. The 3.7.0 plan is also in `in-progress` status — not implemented.
- **Why it matters:** Every phase depends on types and infrastructure that do not exist. Phase 1 says "no new types needed" but `fleetState` payload requires `SubagentState[]`.
- **Fix:** Either (a) mark as blocked on 3.7.0 completion with explicit gate check, or (b) absorb missing prerequisites into Phase 1 to make self-contained.

**2. Phase 1 claims "no new types needed" but `fleetState` payload requires `SubagentState[]`.**
- Since `SubagentState` does not exist in `models.ts`, this will not compile. Plan contradicts itself.
- **Fix:** Phase 1 must either add `SubagentState` to `models.ts` or acknowledge the 3.7.0 dependency.

#### Important (Should Address)

**3. Component hierarchy placement ambiguous.**
- Phase 9 instantiates `SubagentTracker` from `main.js` as top-level, but Phase 11 says "add to component hierarchy" without specifying where. Should explicitly state: `main.js → SessionToolbar, MessageDisplay, SubagentTracker, AcceptanceControls, InputArea`.

**4. Phase 4 title/content mismatch.**
- Labeled "AcceptanceControls timer test" but content tests `SubagentTracker.handleFleetActive()` and auto-collapse. Test file named `acceptance-controls-fleet-timer.test.js` but tests SubagentTracker.
- **Fix:** Rename phase and test file to reflect SubagentTracker, or merge into Phase 2.

**5. `fleetState` replay starts timers for completed agents.**
- Phase 9 wires `onFleetState` → `addAgent()` for each agent. But `addAgent()` starts an elapsed timer interval. Replayed agents with `status: 'completed'` will show a running timer.
- **Fix:** Specify that `addAgent()` checks status and skips timer for terminal agents, or add a `restoreAgent()` method.

**6. No tests for Phases 7–8 (server-side integration).**
- TDD drops off for SDKSessionManager-to-BackendState wiring and chatViewProvider routing. Inconsistent with "strict TDD" in CLAUDE.md.
- **Fix:** Add RED test phases before Phases 7 and 8 covering `getActiveSubagentStates()`, `clearSubagentStates()` on abort, and init payload inclusion.

**7. `getFullState()` and `reset()` not updated in BackendState.**
- Phase 6 adds `_subagentStates` map but doesn't update `getFullState()` to include them or `reset()` to clear them.
- **Fix:** Phase 6 should update both methods.

**8. `clearSession()` should also clear subagent states.**
- `clearSession()` clears session-specific data but doesn't clear subagent states, which are session-scoped.
- **Fix:** Add `this.clearSubagentStates()` to `clearSession()`.

#### Minor (Consider)

**9. CSS transition on `height` requires explicit height management.**
- `transition: height 0.2s ease` won't animate from/to `auto`. Consider `max-height` with large value, or `transform: scaleY()`, or JS-calculated pixel height.

**10. Version sequencing.**
- Plan bumps to 3.8.0 but 3.7.0 is not shipped. If implemented sequentially without releasing 3.7.0 first, version confusion may arise.

**11. `updateAgent()` for unknown `toolCallId` not specified.**
- Race condition possible if `updateAgent()` called before `addAgent()`. Specify fallback behavior (call `addAgent()`, or log warning and no-op).

### Recommendations

1. **Gate on 3.7.0 completion.** Most important action — plan cannot be implemented against the codebase today.
2. **Add server-side integration tests.** Close the TDD gap in Phases 7–8.
3. **Specify replay behavior for terminal agents.** Define `addAgent()` contract for terminal states to prevent timer bugs.
4. **Clarify Phase 4 identity.** Merge into Phase 2 or rename to avoid component confusion.

### Assessment
**Implementable as written?** No
**Reasoning:** The plan depends on infrastructure (`SubagentState`, `onDidFleetStatusMessage`, subagent tracking map) that 3.7.0 has not yet delivered. Beyond the blocking prerequisite, functional gaps (replay timer bug, missing `getFullState()`/`reset()`/`clearSession()` updates) and a TDD compliance gap in Phases 7–8 need addressing before implementation.
