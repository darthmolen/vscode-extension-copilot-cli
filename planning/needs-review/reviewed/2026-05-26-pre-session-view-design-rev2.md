# Pre-Session View — design (rev 2)

## Context

On first run (or after a CLI version bump), [CliBundleService.ensureBundled()](src/extension/services/cliBundleService.ts#L56) does a real `npm install` of `@github/copilot` into `globalStorageUri/cli/<peer-range>/`. On a slow network (corporate VPN, etc.) this can take ~2 minutes. Today this is **entirely silent** from the user's perspective:

- The sidebar shows a static `💬 Start a chat session to begin` empty state ([MessageDisplay.js:56-66](src/webview/app/components/MessageDisplay/MessageDisplay.js#L56)).
- The bundle install starts in the background during `activate()` ([extension.ts:77](src/extension.ts#L77)) but emits no UI events.
- The webview signals ready → extension auto-runs `resumeAndStartSession()` ([extension.ts:170-172](src/extension.ts#L170)), which `await`s `cliBundleReady` ([extension.ts:548-549](src/extension.ts#L548)). The user watches a static empty state for two minutes and reasonably wonders: *"did I break it?"*

This change replaces the static empty state with a **Pre-Session View** that streams the actual startup phases as they happen — from the moment the sidebar opens through the session being ready.

**Outcome:** the user always knows something is happening (or that nothing is happening because we're cached and ready). The "did I break it?" question never arises.

## Versioning

User suggested "patch", but per [CLAUDE.md Versioning](CLAUDE.md) section, *"new UI elements"* and *"new capabilities"* are minor bumps. This adds a new component, new RPC method, new EventBus topic, new backend emitter + state snapshot. **Bump to 3.9.0.**

## The actual startup lifecycle (background)

This drove the rev-2 revisions. The real sequence is:

1. `activate()` fires. [extension.ts:77](src/extension.ts#L77) kicks off `initCliBundle(context)` and stores the promise as `cliBundleReady`. **This runs in the background — does not block sidebar.**
2. User opens the sidebar. `ChatViewProvider.resolveWebviewView` creates the webview.
3. Webview boots, sends `ready` RPC. [chatViewProvider.ts:169](src/chatViewProvider.ts#L169) handler fires.
4. Handler calls `backendState.getFullState()` and `sendInit(...)` to restore prior session state, if any.
5. `ChatViewProvider.onDidBecomeReady` fires. [extension.ts:170-172](src/extension.ts#L170) auto-runs `resumeAndStartSession()`.
6. Inside that, `await cliBundleReady` ([extension.ts:548-549](src/extension.ts#L548)) — this is the blocking wait.
7. SDK session starts. Subsequent state changes propagate via existing RPC.
8. User types and submits. [InputArea.js:335](src/webview/app/components/InputArea/InputArea.js#L335) emits `input:sendMessage` on EventBus.

The Pre-Session View must work with this lifecycle — including the case where a prior session is restored via `sendInit` (which replays historical messages by emitting `message:add` per message — see [main.js:566-581](src/webview/main.js#L566)). Collapsing on `message:add` would be wrong: it'd collapse on every replayed historical message.

## Design summary

**One component, two states:**

1. **Live phase view** (before user submits a new message in this run): a stack of phase rows, each `<icon> <label> [<detail>]`. Phases stream in as they enter/transition.
2. **Collapsed summary** (after user's first `input:sendMessage` of this run): single line `▸ Session started in 12s` pinned at the top of the chat. Click toggles expand/collapse of the original phase list.

**Collapse trigger:** subscribe to `input:sendMessage` (real user submission), **not** `message:add` (which fires on init replay). This ensures restored sessions don't immediately collapse the view if the user opens the sidebar again during a slow operation.

**Init-replay window:** during `handleInitMessage()`, set a flag on PreSessionView (`isReplayingHistory = true`) so it ignores any incidental events during replay. Cleared after replay finishes.

**Phases shown** — each row is added on `:start`, mutated on `:done`/`:error`:

| Phase | In-progress label | Completed label |
|---|---|---|
| `cli.resolving` | `⚙️ Resolving Copilot CLI...` | `✓ Using bundled CLI v1.0.42 (cached)` *or* `✓ Install required` |
| `cli.installing` | `📦 Installing Copilot CLI v1.0.42... (this may take 1–2 min)` | `✓ Installed v1.0.42` |
| `cli.error` | — (no start) | `⚠️ CLI install failed: <detail>` (terminal) |
| `session.ready` | `⚙️ Starting session...` | `💬 Ready` |

**Canonical event sequences:**

| Path | Sequence |
|---|---|
| Cached | `cli.resolving:start` → `cli.resolving:done {detail: "Using bundled v1.0.42 (cached)"}` → `session.ready:start` → `session.ready:done` |
| Install | `cli.resolving:start` → `cli.resolving:done {detail: "Install required"}` → `cli.installing:start` → `cli.installing:done` → `session.ready:start` → `session.ready:done` |
| Error | any in-progress phase transitions to `:error` with detail. No subsequent phases fire. Row shows `⚠️` with detail. |

We do **not** parse `npm install` stdout for sub-progress — brittle and adds noise. One row + spinner + honest time estimate is enough.

## File-by-file plan

### Backend (extension host)

**1. New event types — [src/shared/messages.ts](src/shared/messages.ts)**

```ts
export type ExtensionMessageType = ... | 'systemStatus';

export type SystemStatusPhase = 'cli.resolving' | 'cli.installing' | 'cli.error' | 'session.ready';
export type SystemStatusKind = 'start' | 'done' | 'error';

export interface SystemStatusEvent {
  phase: SystemStatusPhase;
  status: SystemStatusKind;
  detail?: string;       // version, error message, etc.
  at: number;            // Date.now() — used for "started in Ns" summary
}

export interface SystemStatusMessage extends BaseMessage {
  type: 'systemStatus';
  event: SystemStatusEvent;
}

// Phase snapshot included in InitState (see backendState changes)
export interface SystemStatusSnapshot {
  events: SystemStatusEvent[]; // ordered, append-only for this run
  collapsedAt?: number;        // set when user has submitted first message; UI uses this
}
```

Also add `systemStatus?: SystemStatusSnapshot` to the existing `InitState` interface in [src/shared/models.ts](src/shared/models.ts).

**2. New persistent snapshot — [src/backendState.ts](src/backendState.ts)**

`BufferedEmitter` alone is insufficient: per [bufferedEmitter.ts:35-41](src/utilities/bufferedEmitter.ts#L35), the buffer is cleared after first listener attaches. If the webview is recreated (sidebar hide/show, reload) the buffer is gone, so the new webview wouldn't know what phases already completed.

Solution: store an append-only ordered list of `SystemStatusEvent` in `backendState`, and update the snapshot on every fire. The `init` payload sent to the webview includes this snapshot, so PreSessionView can hydrate from it. The `BufferedEmitter` remains for live deltas only (events that fire *after* a given webview attaches).

Add to backendState:
```ts
private systemStatusEvents: SystemStatusEvent[] = [];
private systemStatusCollapsedAt: number | undefined;

appendSystemStatusEvent(e: SystemStatusEvent): void { this.systemStatusEvents.push(e); }
markSystemStatusCollapsed(at: number): void { this.systemStatusCollapsedAt = at; }
getSystemStatusSnapshot(): SystemStatusSnapshot { ... }
clearSystemStatus(): void { /* called on new session start */ }
```

**3. New emitter — `src/extension/services/systemStatusEmitter.ts`** (new file)

Thin wrapper around `BufferedEmitter<SystemStatusEvent>` that:
- Mirrors every fired event into `backendState.appendSystemStatusEvent()`.
- Exposes `event` for webview-side subscription.

Singleton injected into CliBundleService, SDKSessionManager, and ChatViewProvider.

**4. [CliBundleService](src/extension/services/cliBundleService.ts) emits phase events**

Constructor adds an optional `onPhase?: (e: SystemStatusEvent) => void` parameter. Inside [ensureBundled()](src/extension/services/cliBundleService.ts#L56):

```ts
// Top of method
this.onPhase?.({phase: 'cli.resolving', status: 'start', at: Date.now()});

// Each cached return branch (local/managed/system)
this.onPhase?.({phase: 'cli.resolving', status: 'done', detail: `Using bundled v${found.cliVersion} (cached)`, at: Date.now()});

// Before installManaged()
this.onPhase?.({phase: 'cli.resolving', status: 'done', detail: 'Install required', at: Date.now()});
this.onPhase?.({phase: 'cli.installing', status: 'start', detail: spec, at: Date.now()});

// After install succeeds
this.onPhase?.({phase: 'cli.installing', status: 'done', detail: `v${installed.cliVersion}`, at: Date.now()});

// In any catch path
this.onPhase?.({phase: <current-phase>, status: 'error', detail: err.message, at: Date.now()});
```

**5. [SDKSessionManager](src/sdkSessionManager.ts) emits `session.ready`**

Inject same `onPhase` callback. Before [SDKSessionManager.start()](src/sdkSessionManager.ts#L483) (after `await cliBundleReady` completes), fire `session.ready:start`. After session creation succeeds, fire `session.ready:done`. On failure, fire `session.ready:error`.

**6. Wire emitter through [extension.ts](src/extension.ts) activation**

In `activate()`, create the `SystemStatusEmitter` singleton; pass it to `CliBundleService` constructor in `initCliBundle()` and to `SDKSessionManager` factory.

**7. [chatViewProvider.ts](src/chatViewProvider.ts) bridges emitter → webview, manages subscription lifecycle**

In the `ready` handler ([chatViewProvider.ts:169-189](src/chatViewProvider.ts#L169)):
- Pass `systemStatus: backendState.getSystemStatusSnapshot()` into the `sendInit(...)` payload (PreSessionView hydrates from this).
- Subscribe to the `SystemStatusEmitter.event` for live deltas, forwarding via `rpcRouter.sendSystemStatus(event)`.
- Store the disposable in a new `DisposableStore` keyed to this webview instance — already-existing pattern at [chatViewProvider.ts:28](src/chatViewProvider.ts#L28). Disposed in [chatViewProvider.ts:132 onDidDispose](src/chatViewProvider.ts#L132). Prevents duplicate forwards across reload cycles.

Add a webview→extension RPC `userSubmittedMessage` (or hook into existing `sendMessage` handler) so the extension can call `backendState.markSystemStatusCollapsed(Date.now())`. This persists the collapsed state across webview recreations (otherwise reopening the sidebar after a chat would re-expand the phase view).

**8. [ExtensionRpcRouter](src/extension/rpc/ExtensionRpcRouter.ts)**

Add `sendSystemStatus(event: SystemStatusEvent): void` to the send side.

### Frontend (webview)

**9. New component — `src/webview/app/components/PreSessionView/PreSessionView.js`** (new directory + file)

`PreSessionView` is a **child component of `MessageDisplay`**, mirroring the [ToolExecution pattern](src/webview/app/components/MessageDisplay/MessageDisplay.js#L50). Constructor takes `(messagesContainer, eventBus)`. Mounted as part of MessageDisplay's lifecycle — so `MessageDisplay.render()` rebuilding the container works correctly (PreSessionView re-mounts itself).

Responsibilities:
- On construct: render an empty placeholder row container into `messagesContainer`.
- `hydrate(snapshot: SystemStatusSnapshot)` — called by MessageDisplay during `clear()` / init: replay snapshot events to build current row state; if `snapshot.collapsedAt` is set, render in collapsed mode immediately.
- Subscribe to `system:status` EventBus topic for live deltas (events received after init).
- Subscribe to `input:sendMessage` EventBus topic (real user submission, not `message:add`); on first fire of this run, transition to collapsed mode and emit `system:markCollapsed` so extension persists it.
- Set an `isReplayingHistory` flag during `handleInitMessage` (via a new EventBus topic `init:replay:start` / `init:replay:end` — see main.js changes); ignore `input:sendMessage` while flag is set.
- Maintain `Map<phase, {status, detail, el, startedAt, completedAt}>`. On `:start` append row with spinner; on `:done` swap icon + label; on `:error` swap to `⚠️` and stop spinner.
- Collapsed mode: single `<div class="pre-session-view__summary">` with chevron + `Session started in Ns`. Click toggles expanded/collapsed.

**10. [MessageDisplay.js](src/webview/app/components/MessageDisplay/MessageDisplay.js) integrates PreSessionView**

- Remove the inline `<div class="empty-state">...</div>` from `render()` ([MessageDisplay.js:56](src/webview/app/components/MessageDisplay/MessageDisplay.js#L56)).
- In constructor, after `render()`, instantiate `this.preSessionView = new PreSessionView(this.messagesContainer, eventBus)` alongside `ToolExecution`.
- Expose `MessageDisplay.hydratePreSession(snapshot)` that forwards to `this.preSessionView.hydrate(snapshot)`.
- `MessageDisplay.clear()` needs to preserve the PreSessionView between session switches — call `this.preSessionView.reset()` (clears phase state and re-renders empty placeholder) rather than relying on innerHTML wipe.

**11. [main.js](src/webview/main.js)**

- Register `receiveSystemStatus` RPC handler → emit `system:status` on EventBus.
- In `handleInitMessage` ([main.js:566](src/webview/main.js#L566)):
  - Emit `init:replay:start` before the message loop.
  - Call `messageDisplay.hydratePreSession(payload.systemStatus)` if present, before replaying messages.
  - Emit `init:replay:end` after the message loop.
- When InputArea emits `input:sendMessage`, also send an `userSubmittedMessage` RPC to the extension (so it can mark collapsed state in backendState). Existing `input:sendMessage` handler at [main.js around line 335](src/webview/main.js) already sends the message — just add the marker call.

**12. [WebviewRpcClient.js](src/webview/app/rpc/WebviewRpcClient.js)**

Add `receiveSystemStatus` to the receive registry. Add `userSubmittedMessage` to the send registry.

**13. [esbuild.js](esbuild.js) — CRITICAL**

Per [CLAUDE.md "Critical: Webview Build System"](CLAUDE.md), the new `src/webview/app/components/PreSessionView/` directory needs:
1. `presessionDistDir` variable.
2. `fs.mkdirSync(presessionDistDir, { recursive: true })`.
3. `fs.copyFileSync` for `PreSessionView.js`.

Without this the component silently fails to load — blank sidebar, no `ready` message, no errors.

### Styles

**14. [src/webview/styles.css](src/webview/styles.css)**

Add:
- `.pre-session-view` — container, padded to match existing `.empty-state` spacing.
- `.pre-session-view__row` — flex row, gap 8px, line-height ~28px.
- `.pre-session-view__row--in-progress .pre-session-view__icon` — CSS spinner animation (model after existing `.thinking-icon` animation if present; otherwise a simple `@keyframes spin` rotate).
- `.pre-session-view__summary` — collapsed single line. `cursor: pointer`. `▸` rotates 90° when expanded.

Use VS Code theme vars (`--vscode-foreground`, `--vscode-descriptionForeground`, `--vscode-focusBorder` for chevron). No hardcoded colors.

## Critical files

- [src/extension/services/cliBundleService.ts](src/extension/services/cliBundleService.ts) — emit phase events
- **NEW** `src/extension/services/systemStatusEmitter.ts` — singleton emitter that mirrors fires into backendState
- [src/extension.ts](src/extension.ts) — wire emitter into initCliBundle + SDK session manager
- [src/backendState.ts](src/backendState.ts) — persistent phase snapshot
- [src/sdkSessionManager.ts](src/sdkSessionManager.ts) — emit `session.ready`
- [src/chatViewProvider.ts](src/chatViewProvider.ts) — include snapshot in init, subscribe to emitter on `ready` (DisposableStore-scoped), handle `userSubmittedMessage`
- [src/extension/rpc/ExtensionRpcRouter.ts](src/extension/rpc/ExtensionRpcRouter.ts) — `sendSystemStatus`
- [src/shared/messages.ts](src/shared/messages.ts) — `SystemStatusEvent`, `SystemStatusSnapshot`, `SystemStatusMessage`
- [src/shared/models.ts](src/shared/models.ts) — add `systemStatus?: SystemStatusSnapshot` to `InitState`
- [src/webview/main.js](src/webview/main.js) — replay-window events, `userSubmittedMessage` send, RPC handler
- [src/webview/app/rpc/WebviewRpcClient.js](src/webview/app/rpc/WebviewRpcClient.js) — `receiveSystemStatus`, `userSubmittedMessage`
- [src/webview/app/components/MessageDisplay/MessageDisplay.js](src/webview/app/components/MessageDisplay/MessageDisplay.js) — own PreSessionView as child; remove inline empty state; hydrate path
- **NEW** `src/webview/app/components/PreSessionView/PreSessionView.js`
- [src/webview/styles.css](src/webview/styles.css) — pre-session styles
- [esbuild.js](esbuild.js) — register new component directory (mandatory)
- [package.json](package.json) — bump `version` to `3.9.0`

## Reusing existing patterns

- **BufferedEmitter** ([src/utilities/bufferedEmitter.ts](src/utilities/bufferedEmitter.ts)) — used for live deltas only (no longer load-bearing for replay across recreations).
- **DisposableStore** ([src/utilities/disposable.ts](src/utilities/disposable.ts)) — already used by ChatViewProvider ([chatViewProvider.ts:28](src/chatViewProvider.ts#L28)); scope the per-webview subscription here.
- **ToolExecution as child of MessageDisplay** ([MessageDisplay.js:50](src/webview/app/components/MessageDisplay/MessageDisplay.js#L50)) — direct template for PreSessionView ownership.
- **`addTaskComplete` styling** ([MessageDisplay.js:377](src/webview/app/components/MessageDisplay/MessageDisplay.js#L377)) — visual precedent for status-styled, non-chat callouts.
- **InputArea `input:sendMessage`** ([InputArea.js:335](src/webview/app/components/InputArea/InputArea.js#L335)) — the correct collapse trigger (real user submission, not init replay).

## Testing

Per [CLAUDE.md TDD section](CLAUDE.md), tests first. Match actual repo paths.

**Unit (server)** — [tests/unit/extension/](tests/unit/extension/):
- Extend existing [cli-bundle-service.test.js](tests/unit/extension/cli-bundle-service.test.js): inject a recording `onPhase`; assert exact sequences for cached / install / error paths against the canonical sequences table above. Use the existing `runNpmInstall` injection point to drive the install branch deterministically.
- Add `system-status-emitter.test.js`: assert that every fire (a) flows to subscribers and (b) is appended to backendState snapshot.
- Extend `sdk-session-manager.test.js` (or add if missing — check for the file first): assert `session.ready:start` fires before SDK init and `session.ready:done` fires after.

**Unit (webview)** — [tests/unit/components/](tests/unit/components/):
- `PreSessionView.test.js` using existing helpers from [tests/helpers/jsdom-component-setup.js](tests/helpers/jsdom-component-setup.js):
  - Renders empty container when no snapshot and no events.
  - `hydrate(snapshot)` rebuilds rows from event list.
  - `system:status` `:start` event appends in-progress row.
  - `:done` event mutates existing row (icon swap, label change).
  - `:error` event marks row terminal.
  - `input:sendMessage` while `isReplayingHistory=true` does NOT collapse.
  - `input:sendMessage` while flag is false collapses to summary line.
  - Click on collapsed summary expands; click again collapses.
  - Snapshot with `collapsedAt` set hydrates directly into collapsed mode.
- Extend [MessageDisplay.test.js](tests/unit/components/MessageDisplay.test.js): assert PreSessionView is constructed as a child; `clear()` calls `preSessionView.reset()` rather than wiping.

**Integration** — [tests/integration/](tests/integration/):
- Assert ChatViewProvider includes `systemStatus` snapshot in init payload.
- Assert ChatViewProvider forwards live `SystemStatusEvent`s via `sendSystemStatus` after `ready`.
- Assert the forwarding subscription is disposed on `webviewView.onDidDispose`; reopening the sidebar produces no duplicate forwards.

**Manual verification (the real test):**
1. Identify the managed cache: `code --status` to find the extension's globalStorage path, then `rm -rf <globalStorage>/cli/`. (Or: from the Output Channel "Copilot CLI", note the `CliBundleService` log line that prints the install destination on first install.)
2. `./test-extension.sh` to install a fresh VSIX.
3. Open the sidebar. Observe (auto-start, no user action needed):
   - `⚙️ Resolving Copilot CLI...`
   - `✓ Install required` (resolving row updates)
   - `📦 Installing Copilot CLI v1.0.42... (this may take 1–2 min)` with spinner
   - `✓ Installed v1.0.42`
   - `⚙️ Starting session...`
   - `💬 Ready`
4. Type a message and submit. Observe the phase list collapses to `▸ Session started in Ns`.
5. Click the summary. Observe expand/collapse toggle works.
6. Reload the window (`Ctrl+Shift+P` → "Developer: Reload Window"). Cache is now hot. Observe:
   - `⚙️ Resolving Copilot CLI...` → `✓ Using bundled v1.0.42 (cached)` → `⚙️ Starting session...` → `💬 Ready` (all near-instant)
   - The collapsed summary persists from the prior chat (collapsedAt was persisted in backendState).
7. Hide and re-show the sidebar (forces webview recreation). Observe state hydrates correctly from snapshot — no duplicate rows, no re-flashing of completed phases.
8. Force an error: temporarily point `@github/copilot` to an invalid version. Observe `⚠️ CLI install failed: <error>` row stays visible.

## What this is NOT

- Not a real-time `npm install` progress bar (parsing npm output is brittle, low-value).
- Not a separate panel or header — lives inside MessageDisplay (owned as a child component).
- Not a notification toast — toasts get dismissed and don't address the "is it doing anything?" question.
- Not changing the auto-start flow — startup is still automatic via `onDidBecomeReady`; we just surface what's happening.

## Out of scope (future)

- Surface MCP server connection phases, model warm-up, etc. — the `SystemStatusPhase` enum is designed to extend.
- A "Cancel install" button — rare scenario; not worth the complexity for v1.
- Per-user toggle to disable the pre-session view — defer until someone complains about it.

---

## Plan Review

**Reviewed:** 2026-05-26 13:27
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

- **"The actual startup lifecycle"** is a strong rev2 addition: it now matches the real auto-start flow in `extension.ts`/`main.js` and explicitly avoids the rev1 `message:add` collapse bug.
- **Sections 2–7** correctly replace the rev1 "BufferedEmitter-only" design with a **BackendState snapshot + live deltas** model.
- **Sections 9–10** now respect the **MessageDisplay-owned child component** pattern from `MessageDisplay`/`ToolExecution`.
- **Testing** is much better aligned with repo reality: actual test locations, TDD emphasis, and disposal/reopen coverage.
- **esbuild.js** requirements are called out clearly.

### Rev1 Issues Addressed

| Rev1 Issue | Status |
|---|---|
| Critical 1 — Component ownership conflict | **Addressed** — Sections 9–10 make `PreSessionView` a child of `MessageDisplay` |
| Critical 2 — Wrong startup model / collapse on `message:add` | **Addressed** — collapse on `input:sendMessage`, replay notes in Sections 11/Design |
| Important 1 — BufferedEmitter alone insufficient | **Addressed** — Section 2 adds persistent snapshot in `BackendState` |
| Important 2 — Slow-path event contract underspecified | **Addressed** — canonical sequences table in Design summary |
| Important 3 — Test paths mismatched repo | **Addressed** — Testing now references real directories/files |
| Important 4 — Manual verification inaccurate | **Partially addressed** — auto-start/cache-path fixes better, but reload persistence claim still wrong |
| Important 5 — Subscription lifecycle unspecified | **Addressed** — Section 7 calls for `DisposableStore`-scoped disposal |

### Issues

#### Critical (Must Address Before Implementation)

1. **Sections "The actual startup lifecycle", 7, 11 — missing the second `init`**
   - `extension.ts` lines 174–186 send a follow-up `init` after `resumeAndStartSession()`. Rev2 updates the `ready`-handler init path but not this second one.
   - Why it matters: implementers can build the feature correctly per plan and still have the main startup path wipe/reset the pre-session state.
   - **Fix:** explicitly update **both** init send sites, or restructure so there is one authoritative init flow.

#### Important (Should Address)

1. **Manual verification step 6 / BackendState design — reload persistence is wrong**
   - `BackendState` is in-memory only; it does **not** survive `Developer: Reload Window`.
   - Why it matters: the plan promises behavior the proposed storage model cannot deliver.
   - **Fix:** scope persistence to **webview recreation only** (hide/show sidebar) or add real durable persistence.

2. **Sections 7, 11, 12 — `userSubmittedMessage` RPC is inconsistent and likely unnecessary**
   - The plan says "or hook into existing `sendMessage` handler," but later tasks commit to a new RPC.
   - Why it matters: duplicates existing intent, adds extra shared/RPC plumbing, risks divergence from actual sends.
   - **Fix:** prefer marking collapse in existing `ChatViewProvider.onSendMessage()` and drop the extra RPC.

3. **Section 2 (`clearSystemStatus`) — reset timing is underdefined**
   - "Called on new session start" is too vague for a bootstrap/status feature.
   - Why it matters: clearing on every new session can erase useful state while no new CLI-resolution phases will re-fire.
   - **Fix:** define a precise reset boundary (new activation / new startup run / explicit new run id).

4. **Section 4 / Design summary — cached label is inaccurate for the `system` CLI path**
   - Plan uses "Using bundled…" for local/managed/**system** branches.
   - `CliBundleService` explicitly distinguishes `local | managed | system`; UI should not lie.
   - **Fix:** make labels source-aware.

#### Minor (Consider)

1. **Replay guard complexity** in Sections 9/11 may be more than needed since collapse is already tied to `input:sendMessage`, not `message:add`. Simplify unless a real replay-triggered event exists.

### Recommendations

- Fix the **second-init** lifecycle gap before implementation.
- Decide whether persistence is **webview-only** or **reload-durable**; don't imply both.
- Reuse existing `sendMessage` plumbing instead of inventing `userSubmittedMessage`.
- Make status labels reflect actual CLI source (`local` / `managed` / `system`).

### Assessment

**Implementable as written?** With fixes

**Reasoning:** Rev2 fixes the main architectural flaws from rev1, but it still misses one real startup path (the second `init` from `extension.ts`) and overclaims persistence beyond what `BackendState` can provide.
