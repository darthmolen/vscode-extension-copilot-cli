# Pre-Session View — design

## Context

On first run (or after a CLI version bump), [CliBundleService.ensureBundled()](src/extension/services/cliBundleService.ts#L56) does a real `npm install` of `@github/copilot` into the extension's managed storage. On a slow network (corporate VPN, etc.) this can take ~2 minutes. Today this is **entirely silent** from the user's perspective:

- The sidebar shows a static `💬 Start a chat session to begin` empty state ([MessageDisplay.js:56-66](src/webview/app/components/MessageDisplay/MessageDisplay.js#L56)).
- The install runs in the background during `activate()` but emits no UI events — only a single `logger.info` line.
- The user only hits the wait at [SDKSessionManager.start()](src/sdkSessionManager.ts#L483), which `await`s `cliBundleReady`. They sit looking at the empty state and reasonably wonder: *"did I break it?"*

This change replaces the static empty state with a **Pre-Session View** that streams the actual startup phases as they happen — from the moment the sidebar opens through the session being ready.

**Outcome:** the user always knows something is happening (or that nothing is happening because we're cached and ready). The "did I break it?" question never arises.

## Versioning

User suggested "patch", but per [CLAUDE.md Versioning](CLAUDE.md) section, *"new UI elements"* and *"new capabilities"* are minor bumps. This adds a new component, new RPC method, new EventBus topic, and new backend emitter. **Bump to 3.9.0.**

## Design summary

**One component, two states:**

1. **Live phase view** (before first user message): a stack of phase rows, each `<icon> <label> [<detail>]`. Phases stream in as they complete or transition.
2. **Collapsed summary** (after first user message): single line `▸ Session started in 12s` pinned at the top of the chat. Click to expand the original phase list inline.

**Phases shown** (each row is added when phase enters, mutates when phase completes):

| Phase | In-progress label | Completed label |
|---|---|---|
| `cli.resolving` | `⚙️ Resolving Copilot CLI...` | `✓ Using bundled CLI v1.0.42` |
| `cli.installing` | `📦 Installing Copilot CLI v1.0.42... (this may take 1-2 min)` | `✓ Installed v1.0.42` |
| `cli.error` | — | `⚠️ CLI install failed: <detail>` (terminal, with retry hint) |
| `session.ready` | `💬 Ready to start a session` | (collapses into summary on first user message) |

Notes:
- Cached path: `cli.resolving` appears and immediately transitions to "Using bundled CLI vX.Y.Z" — the user sees a single confirming line. No flicker.
- Slow path: `cli.installing` appears with an honest time estimate. Spinner on the icon. Stays until install completes.
- We don't parse `npm install` stdout for sub-progress — it's brittle and adds noise. A single phase row + spinner + estimate is enough.

## File-by-file plan

### Backend (extension host)

**1. New event type — [src/shared/messages.ts](src/shared/messages.ts)**

Add to the existing union and add a new interface:
```ts
export type ExtensionMessageType = ... | 'systemStatus';

export interface SystemStatusEvent {
  phase: 'cli.resolving' | 'cli.installing' | 'cli.error' | 'session.ready';
  status: 'start' | 'done' | 'error';
  detail?: string;       // version string, error message, etc.
  startedAt?: number;    // for the summary "started in 12s"
}

export interface SystemStatusMessage extends BaseMessage {
  type: 'systemStatus';
  event: SystemStatusEvent;
}
```

**2. [CliBundleService](src/extension/services/cliBundleService.ts) emits phase events**

Add a constructor-injected emitter (matches existing pattern — see `BufferedEmitter` in [src/utilities/bufferedEmitter.ts](src/utilities/bufferedEmitter.ts)):
```ts
constructor(
  private ext: ExtensionLike,
  private logger: LoggerLike,
  opts: CliBundleServiceOptions = {},
  private onPhase?: (e: SystemStatusEvent) => void,
) { ... }
```
- Fire `{phase: 'cli.resolving', status: 'start'}` at top of `ensureBundled()`.
- Fire `{phase: 'cli.resolving', status: 'done', detail: 'v<version> (cached)'}` when returning from any cached branch (local/managed/system).
- Fire `{phase: 'cli.installing', status: 'start', detail: '<version>'}` right before [installManaged()](src/extension/services/cliBundleService.ts#L123).
- Fire `{phase: 'cli.installing', status: 'done', detail: 'v<version>'}` after install succeeds.
- Fire `{phase: 'cli.error', status: 'error', detail: err.message}` in the catch path.

**3. Wire emitter through [extension.ts](src/extension.ts) activation**

`initCliBundle()` creates the service. Inject a `BufferedEmitter<SystemStatusEvent>` stored on `backendState` so [chatViewProvider.ts](src/chatViewProvider.ts) can pick it up regardless of webview lifecycle:
- BufferedEmitter holds events until webview attaches → no lost events even though install starts before sidebar opens.

**4. [SDKSessionManager](src/sdkSessionManager.ts) emits `session.ready`**

After `start()` finishes session creation, emit `{phase: 'session.ready', status: 'done'}` on the same emitter. (Pre-existing emitter pattern — see the 10 other granular events the manager already emits.)

**5. [chatViewProvider.ts:169-189](src/chatViewProvider.ts#L169) bridges emitter → webview**

In the `ready` RPC handler (already sends init state), also subscribe to the backendState's system-status emitter and forward each event via a new RPC method.

**6. [ExtensionRpcRouter](src/extension/rpc/ExtensionRpcRouter.ts)**

Add `sendSystemStatus(event: SystemStatusEvent)` to the send side.

### Frontend (webview)

**7. New component — `src/webview/app/components/PreSessionView/PreSessionView.js`**

Owns the area currently occupied by `MessageDisplay`'s empty state. Responsibilities:
- Subscribe to `system:status` EventBus topic.
- Maintain a `Map<phase, {status, detail, el}>` keyed by phase name.
- On `start`, append a row with the in-progress label + spinner.
- On `done`, mutate the existing row's icon (`⚙️` → `✓`, `📦` → `✓`) and swap to the completed label.
- On `error`, mark the row with `⚠️` and stop the spinner.
- On `message:add` (first user message): collapse all rows into a single summary line with a chevron toggle. Click expands/collapses the original list inline.
- Track `startedAt` from the first event to compute the "started in Ns" summary.

**8. [MessageDisplay.js:56](src/webview/app/components/MessageDisplay/MessageDisplay.js#L56)**

Remove the inline `<div class="empty-state">...</div>` from `render()`. The PreSessionView component is instantiated by `main.js` and mounted into a slot in the messages container header. PreSessionView itself decides whether to render anything based on its received events — so even on a brand new webview with no events yet, the area is empty (not a misleading static message).

**9. [main.js](src/webview/main.js)**

- Instantiate `PreSessionView` alongside existing components.
- Register a `receiveSystemStatus` RPC handler that emits `system:status` on EventBus.

**10. [WebviewRpcClient.js](src/webview/app/rpc/WebviewRpcClient.js)**

Add `receiveSystemStatus` to the receive-method registry.

**11. [esbuild.js](esbuild.js) — CRITICAL**

Per [CLAUDE.md](CLAUDE.md) "Critical: Webview Build System": new component directory means:
1. Add `presessionDistDir` variable.
2. Add `fs.mkdirSync(presessionDistDir, { recursive: true })`.
3. Add `fs.copyFileSync` for `PreSessionView.js`.

Without this the component silently fails to load.

### Styles

**12. [src/webview/styles.css](src/webview/styles.css)** (or equivalent)

- `.pre-session-view` — container, padded, matches existing empty-state spacing.
- `.pre-session-view__row` — flex row, `<icon> <label>`, ~28px line-height.
- `.pre-session-view__row--in-progress .icon` — CSS spinner animation (steal pattern from existing `.thinking-icon` if one exists).
- `.pre-session-view__summary` — collapsed single-line state. Chevron + duration. `cursor: pointer`.

Use existing VS Code theme vars (`--vscode-foreground`, `--vscode-descriptionForeground`) — no hardcoded colors.

## Critical files

- [src/extension/services/cliBundleService.ts](src/extension/services/cliBundleService.ts) — emit phase events
- [src/extension.ts](src/extension.ts) — wire emitter into `initCliBundle`
- [src/backendState.ts](src/backendState.ts) — hold the emitter across webview recreations
- [src/sdkSessionManager.ts](src/sdkSessionManager.ts) — emit `session.ready`
- [src/chatViewProvider.ts](src/chatViewProvider.ts) — bridge emitter to webview on `ready`
- [src/extension/rpc/ExtensionRpcRouter.ts](src/extension/rpc/ExtensionRpcRouter.ts) — `sendSystemStatus`
- [src/shared/messages.ts](src/shared/messages.ts) — `SystemStatusEvent` types
- [src/webview/main.js](src/webview/main.js) — instantiate component, register handler
- [src/webview/app/rpc/WebviewRpcClient.js](src/webview/app/rpc/WebviewRpcClient.js) — `receiveSystemStatus`
- [src/webview/app/components/MessageDisplay/MessageDisplay.js](src/webview/app/components/MessageDisplay/MessageDisplay.js) — remove inline empty state
- **NEW** `src/webview/app/components/PreSessionView/PreSessionView.js`
- [esbuild.js](esbuild.js) — register new component directory (mandatory)
- [package.json](package.json) — bump `version` to `3.9.0`

## Reusing existing patterns

- **BufferedEmitter** ([src/utilities/bufferedEmitter.ts](src/utilities/bufferedEmitter.ts)) — exactly the pattern needed: events fire during `activate()` before webview exists; emitter buffers and replays on subscribe.
- **`addTaskComplete()` styling** ([MessageDisplay.js:377](src/webview/app/components/MessageDisplay/MessageDisplay.js#L377)) — provides the visual precedent for status-styled, non-chat callouts (`role="status"`).
- **EventBus** topic pattern — `system:status` parallels existing `task:complete`, `tool:start`, etc.

## Testing

Per [CLAUDE.md TDD section](CLAUDE.md), write the test first.

**Unit (server):**
- [tests/unit/extension/cliBundleService.test.ts](tests/unit/extension/) — assert phase events emitted at right times (mock `runNpmInstall` to control timing). Tests must verify ORDER: `resolving:start` → `installing:start` → `installing:done` → `resolving:done` is wrong; only one of them is "done". Write tests that pin the contract.
- [tests/unit/extension/sdkSessionManager.test.ts](tests/unit/extension/) — assert `session.ready` emitted after `start()` resolves.

**Unit (webview):**
- `tests/unit/webview/components/PreSessionView.test.js` (new) — using JSDOM helpers from [tests/helpers/jsdom-component-setup.js](tests/helpers/jsdom-component-setup.js):
  - Renders nothing when no events received.
  - Adds a row when `system:status` `start` event received.
  - Mutates the row on `done` event (icon swap, label change).
  - Collapses to summary on `message:add` event.
  - Click on summary toggles expand/collapse.

**Integration:**
- [tests/integration/](tests/integration/) — assert `chatViewProvider` forwards system-status events to the mock webview after `ready` is received.

**Manual verification (the real test):**
1. Delete managed CLI cache: `rm -rf "$(node -e 'console.log(require("os").homedir())')/.vscode/extensions/darthmolen.copilot-cli-extension-*/cli"` (or use `globalStorage` path).
2. `./test-extension.sh` to install fresh VSIX.
3. Open sidebar → observe `Resolving... → Installing v1.0.42 (this may take 1-2 min) → Installed → Ready`.
4. Click "Start a chat session" → observe transition.
5. Send first message → observe collapse to `▸ Session started in Ns`.
6. Click summary → expands back to original phase list.
7. Reload window (cache now hot) → observe `Resolving... → Using bundled CLI v1.0.42 → Ready` instantly (no flicker).

## What this is NOT

- Not a real-time `npm install` progress bar (parsing npm output is brittle and low-value).
- Not a separate panel/header — lives in the existing chat message area.
- Not a notification toast — those get dismissed and don't address the "is it doing anything?" question.
- Not auto-starting the session — that's a separate UX question.

## Out of scope (future considerations)

- Could later expand to surface MCP server connection phases, model warm-up, etc. The `phase` enum is designed to extend.
- Could add a "Cancel install" button — but this is rare enough that it's not worth the complexity for v1.

---

## Plan Review

**Reviewed:** 2026-05-26 12:43
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

- **Context / Design summary** clearly states the user problem and keeps scope tight: visibility into CLI bootstrap without inventing a noisy progress bar.
- **Versioning** is correct per `CLAUDE.md`: this is a **minor** bump, not patch.
- **File-by-file plan** is concrete and references real files that exist (`cliBundleService.ts`, `ExtensionRpcRouter.ts`, `messages.ts`, `esbuild.js`, `main.js`).
- **Build-system awareness** in section 11 is strong; it correctly calls out the manual `esbuild.js` copy requirements.
- **Pattern reuse** is thoughtful: `BufferedEmitter` is the right *kind* of primitive for early startup events.
- **Testing section** has good intent: cold path + hot path + integration coverage.

### Issues

#### Critical (Must Address Before Implementation)

1. **Sections 7–9 / 8: component ownership conflicts with current hierarchy**
   - The plan says `main.js` should instantiate `PreSessionView` and mount it into a slot inside `MessageDisplay`.
   - In this codebase, `MessageDisplay` owns the `.messages` container, and `MessageDisplay.clear()` wipes/recreates that DOM.
   - Why it matters: a sibling component mounted "into" `MessageDisplay` internals will be fragile and likely destroyed on `init` / clear cycles.
   - **Suggested fix:** make `PreSessionView` owned by `MessageDisplay` (like `ToolExecution`), or fold pre-session rendering directly into `MessageDisplay`.

2. **Sections 7 / Testing / "What this is NOT": plan assumes the wrong startup model**
   - Current code auto-resumes/starts a session in `extension.ts` via `onDidBecomeReady → resumeAndStartSession()`. It is **not** a manual "click start session" flow.
   - The plan also says collapse on first `message:add`, but `handleInitMessage()` replays historical messages on startup, including prior user messages.
   - Why it matters: as written, the view could collapse immediately from restored history before startup phases are shown.
   - **Suggested fix:** define transitions around the **current startup cycle**, not generic `message:add`. Use a startup-run marker or collapse only after the first **new outbound user send** for this run.

#### Important (Should Address)

1. **Sections 3–5: `BufferedEmitter` alone does not satisfy "regardless of webview lifecycle"**
   - `BufferedEmitter` replays buffered events to the **first** listener, then buffer is gone.
   - Why it matters: if the webview is recreated or re-initialized, prior phase state is not reconstructable.
   - **Suggested fix:** persist a phase snapshot/history in `BackendState` and include it in `init`; use the emitter only for live deltas.

2. **Section 2 / Testing: slow-path event contract is under-specified**
   - The plan emits `cli.resolving:start`, `cli.installing:start`, `cli.installing:done`, but does not define what completes `cli.resolving` on the install path.
   - Why it matters: the UI model says rows mutate from in-progress to done; one row would otherwise remain unresolved.
   - **Suggested fix:** explicitly define the canonical sequence for cached vs install paths.

3. **Testing section does not match repository conventions**
   - Proposed paths like `tests/unit/webview/components/PreSessionView.test.js` and `cliBundleService.test.ts` do not match the repo.
   - Existing patterns are `tests/unit/components/*.test.js` and `tests/unit/extension/*.test.js`.
   - **Suggested fix:** rewrite test tasks to match actual layout and file conventions.

4. **Manual verification steps are partly inaccurate**
   - Step 1 deletes the wrong cache location; `CliBundleService` uses `context.globalStorageUri.fsPath`, not the extension install dir.
   - Step 4 says click "Start a chat session," but current startup is automatic.
   - **Suggested fix:** reference the real managed cache path and describe the actual open-sidebar auto-start flow.

5. **Section 5: subscription lifecycle not fully specified**
   - Forwarding from a backend emitter in the `ready` handler needs explicit disposal / dedup semantics.
   - Why it matters: repeated ready/reload cycles can produce duplicate forwards.
   - **Suggested fix:** store/dispose the forwarding subscription in `ChatViewProvider`.

#### Minor (Consider)

1. **Section 2: `session.ready` label is slightly off** — current UX is "ready to chat," not "ready to start a session." Rename to match real behavior.

2. **Section 12: "styles.css (or equivalent)" is vague** — this repo has a single real target: `src/webview/styles.css`. Name it directly.

### Recommendations

- Reframe the plan around the **actual startup lifecycle**: `ready` → initial `init` → auto-resume/start → second `init` / status updates.
- Move `PreSessionView` under `MessageDisplay` ownership.
- Add a small persisted backend model for startup phases instead of relying only on buffered events.
- Rewrite testing and manual verification steps to match current repo structure and cache behavior.

### Assessment

**Implementable as written?** No

**Reasoning:** The core idea is good, but the plan currently conflicts with the app's real startup/init lifecycle and component ownership model. Without fixing those, implementation will be brittle and likely behave incorrectly on resume, init replay, and clear/re-render paths.
