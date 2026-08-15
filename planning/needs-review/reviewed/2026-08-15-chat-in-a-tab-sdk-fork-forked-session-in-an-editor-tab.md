# Chat-in-a-Tab: SDK Fork → Forked Session in an Editor Tab

## Context

Today the extension has exactly one chat surface (the sidebar `WebviewView`) driven by one
module-level `sessionManager`, one `BackendState` singleton, and one `ExtensionRpcRouter`.
Fork (shipped v3.7.0) works around that by *replacing* the current session: it `cpSync`-copies
`~/.copilot/session-state/<id>/`, patches line 0 of `events.jsonl`, and switches the sidebar onto
the copy. You lose sight of the parent.

That's backwards. The valuable pattern — the one being used right now, a long task running in the
panel while a second conversation happens in a tab — needs **a session to be viewable in a tab or
in the sidebar, interchangeably**. Once a chat surface can live in an editor tab, Fork becomes
"pop the fork into a tab and leave the parent running", per-message fork becomes possible, and the
side-chat "btw" aside (ask a throwaway question without polluting the main session) is unblocked.

Two other things are wrong with fork today and get fixed on the way:

- The SDK has had `client.rpc.sessions.fork({ sessionId, toEventId?, name? })` since before the
  bundled CLI — we reimplemented it with a filesystem copy. Verified present in the installed
  typings (`node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:14531`) and in
  [rpc.ts](research/copilot-sdk/nodejs/src/generated/rpc.ts) at the `sessions.fork` definition.
- Because `SessionService.ensureSessionName()` is no-clobber and `session-name.txt` is copied along
  with everything else, **a fork silently inherits the parent's name verbatim** — the CHANGELOG's
  claim of a distinct label does not hold.

Roadmap alignment: this fills the two undocumented `:construction:` rows in
[ROADMAP.md:17-18](planning/roadmap/ROADMAP.md#L17-L18) — "Multi-session support (ACE-FCA
workflows)" and "Multiple agents — separate virtual windows (tmux-like)".

**This is not a re-introduction of anything.** The existing sub-agent pop-out
([SubagentPanelService.ts](src/extension/services/SubagentPanelService.ts)) is a read-only text feed
with hand-rolled inline HTML and its own ad-hoc `{type:'item'|'status'}` protocol. It is a *pattern
reference* for panel lifecycle, not a base to extend.

### Decisions taken

| Question | Decision |
| --- | --- |
| Shipping | Three independently shippable slices |
| Fork behavior | Sidebar **stays on the parent**; the fork opens in a tab and takes focus |
| Concurrency | Both live, **one shared `CopilotClient`** (one CLI process) |
| "btw" | Side-chat aside in a tab — design the seam now, build it later |

---

## Slice 1 — SDK-native fork (v3.12.0)

Replace the filesystem copy with the SDK RPC. No UI change; fork still switches the sidebar (Slice 2
flips that).

**`src/sdkSessionManager.ts`** — add `forkSession(sessionId, opts?: { toEventId?: string; name?: string })`:
- Call `this.client.rpc.sessions.fork({...})`. The API is `@experimental`, so probe defensively in
  the style already used for MCP config at [sdkSessionManager.ts:1572](src/sdkSessionManager.ts#L1572)
  (`(this.client as any)?.rpc?.mcp?.config`).
- Fall back to the existing `SessionService.forkSession()` when the RPC is absent. Add a
  `supportsSessionForkRpc` flag to `CliCapabilityService` alongside `supportsMcpListRpc`.
- Pass `name: \`${parentName} (fork)\`` so the runtime assigns a distinct label — this is the fix for
  the inherited-name bug. Read the parent's name via the existing `SessionService` name helpers.

**`src/extension.ts`** — `handleForkSession()` ([extension.ts:446-465](src/extension.ts#L446-L465))
calls the manager instead of `SessionService.forkSession` directly. Keep the `No active session to
fork.` guard and the try/catch toast.

**Tests** — extend `tests/unit/extension/session-fork.test.js`: RPC path preferred, cpSync path still
covered as fallback, name is passed through. The three other fork test files
(`fork-session-button`, `fork-session-rpc` ×2) are unaffected.

**Spike first** (per CLAUDE.md SDK-first rule) — `planning/spikes/session-fork-rpc/`:
prove `sessions.fork` against the *bundled* CLI, that `name` lands, that `toEventId` is exclusive,
and that a fork can be resumed while the parent is still live on the same client. The SDK's own e2e
covers the shape ([rpc_session_state.e2e.test.ts](research/copilot-sdk/nodejs/test/e2e/rpc_session_state.e2e.test.ts),
the "fork session to event id excluding boundary event" case) — the spike confirms it against our CLI version.

---

## Slice 2 — Chat surface decoupling + tab (v4.0.0, phase 0)

The whole slice exists to make "a chat surface" a thing you can have more than one of.

### 2a. Shared `CopilotClient`

`SDKSessionManager` constructs its own client at [sdkSessionManager.ts:594](src/sdkSessionManager.ts#L594)
and again at :1736 — one CLI process per manager. Extract `src/extension/services/CopilotClientProvider.ts`
owning start/stop/restart, `modelCapabilitiesService.initialize()`, and the CLI process/connection
lifecycle listeners (currently :1683-1720). `SDKSessionManager` takes the provider by constructor.

Precedent that multiple sessions on one client work: **plan mode already runs a second session on
the same client** (dual-session plan mode). The spike below confirms it for two *interactive* sessions.

**Spike** — `planning/spikes/multi-session-client/`: two concurrent live sessions on one
`CopilotClient`, both streaming, no cross-talk in event routing.

### 2b. Per-session state — `ChatSessionHost` + registry

`BackendState` is already a class; only `getBackendState()` at
[backendState.ts:203-208](src/backendState.ts#L203-L208) makes it a singleton. Stop using it.

New `src/extension/session/ChatSessionHost.ts` owning, per session:
`sessionId` · `SDKSessionManager` · its own `BackendState` · the event wiring currently in
`extension.ts`'s `wireManagerEvents()` · a bound `ChatSurface`.

New `src/extension/session/ChatSessionRegistry.ts` — `Map<sessionId, ChatSessionHost>`, mirroring the
dedupe/dispose shape of `SubagentPanelService` (`panels` map, reveal-if-exists, `onDidDispose`
unregister, `dispose()` disposing all).

Migrating the `getBackendState()` call sites is the bulk of the risk here; they are concentrated in
`extension.ts` (e.g. `setSessionId` at :661 and :786, `getFullState()` in `handleSwitchSession` at
:431) and in `chatViewProvider.ts`'s `ready` handler at :323-343.

### 2c. Surface abstraction — two implementations, one HTML, one handler set

- **Extract HTML** — `_getHtmlForWebview` ([chatViewProvider.ts:965](src/chatViewProvider.ts#L965),
  CSP at :980, nonce via `getNonce()` at :1004, asset URIs at :968-973, mount points at :987-995)
  moves to `src/extension/webview/chatHtml.ts` as `buildChatHtml(webview, extensionUri, opts)`.
  Both surfaces call it. This is what gives the tab the real chat UI rather than another hand-rolled
  string.
- **Extract handlers** — `_setupRpcHandlers` ([chatViewProvider.ts:320-637](src/chatViewProvider.ts#L320-L637),
  ~80 registrations) moves to `src/extension/rpc/registerChatHandlers.ts` as
  `registerChatHandlers(router, host, deps)`.
  `ExtensionRpcRouter.registerHandler` is **last-one-wins per type**, so every surface must get its
  own router — which it does: the router is already per-webview by construction
  (`constructor(private webview: vscode.Webview)` at [ExtensionRpcRouter.ts:115](src/extension/rpc/ExtensionRpcRouter.ts#L115)).
  Also capture the Disposable that `listen()` returns — [chatViewProvider.ts:636](src/chatViewProvider.ts#L636)
  currently discards it, which is fine for one immortal sidebar and a leak for N tabs.
- **`ChatSurface` interface** — `{ router, postMessage, reveal, dispose }`, implemented by:
  - `SidebarChatSurface` — the existing `ChatViewProvider`, thinned to a surface.
  - `PanelChatSurface` — new `src/extension/services/ChatPanelService.ts`.

### 2d. `ChatPanelService`

`createWebviewPanel('copilotChatPanel', title, ViewColumn.Active, {...})`, keyed by `sessionId`,
reveal-if-exists. Two things `SubagentPanelService` gets away with and this cannot:

- **`localResourceRoots` is required.** `SubagentPanelService` passes none
  ([SubagentPanelService.ts:97-102](src/extension/services/SubagentPanelService.ts#L97-L102)),
  which is why it can't load `dist/webview` assets. Mirror the sidebar's roots
  ([chatViewProvider.ts:268-277](src/chatViewProvider.ts#L268-L277)): `extensionUri`, `~/.copilot`,
  `os.tmpdir()`, workspace folders.
- **`registerWebviewPanelSerializer`** — none exists anywhere in the repo today, so panels die on
  window reload. Register one that stores `sessionId` in panel state and rehydrates the host.

Reuse `setTabIcon()`'s colored-dot approach from `SubagentPanelService.ts:110-125` if per-fork tab
colors are wanted; the palette is already triplicated (`extension.ts:41`, `SubagentPanelService.ts:23`,
`SubagentDock.js:24`) — consolidate rather than add a fourth copy.

**esbuild:** no change expected. The panel reuses `dist/webview/main.js` + `styles.css` verbatim;
`main.js` instantiates its own `WebviewRpcClient` (`acquireVsCodeApi()` is per-document) and all
components arrive via ES-module imports, so only `main.js` needs a URI. **If any new webview
directory is added** (e.g. a panel header component), `esbuild.js` needs its dist-dir const,
`mkdirSync` guard, and per-file `copyFileSync` — omitting this fails silently with a blank panel.

### 2e. No global sends

With per-host wiring, `extension.ts` must stop holding `chatProvider` for message routing (it keeps
it only for `show()`/lifecycle). Every `sendXxx`/`postMessage` goes through the host that owns the
emitting `SDKSessionManager`. This dissolves the "which router gets `assistantMessage`?" problem
rather than solving it — there is no fan-out, only 1:1 wiring.

The sub-agent dock benefits: the global emitter fan-out at
[extension.ts:697-731](src/extension.ts#L697-L731) becomes per-host, so a fork's sub-agents render in
the fork's surface.

### 2f. Fork opens a tab

`handleForkSession()` becomes: SDK fork → `registry.createHost(forkId)` → `chatPanels.open(forkId)`.
The sidebar is untouched. Toast: `Forked to "<name>" — opened in a tab.`

Add command `copilot-cli-extension.openSessionInTab` (contributed in `package.json`) so *any* session,
including the sidebar's current one, can be opened in a tab. This is the general capability; fork is
its first caller.

### 2g. Seam for the "btw" side-chat

Not built here. `ChatSessionRegistry.createHost(sessionId)` accepts any session id, so a later
`/btw <question>` is: `createSession` → `createHost` → `chatPanels.open` → send. Record it in
`planning/backlog/` as a follow-up so the seam isn't optimized away.

---

## Slice 3 — Per-message fork (follow-up minor)

> Sequencing note: v4.1 is already spoken for by the ServiceBus + React webview rewrite. Slot this
> as a v4.0.x minor or renumber that plan.

Event ids are available on both paths — **verified against real data**: persisted `events.jsonl`
records carry a top-level `id` (keys are `['data','id','parentId','timestamp','type']`), and the live
envelope declares `id: string` (e.g. `UserMessageEvent` in
[session-events.ts](research/copilot-sdk/nodejs/src/generated/session-events.ts)).

- **History path** — `SessionService.loadSessionHistory` ([SessionService.ts:253](src/extension/services/SessionService.ts#L253))
  already parses each line; add `eventId` to the message it returns, and carry it through
  `backendState.addMessage` ([extension.ts:1012-1017](src/extension.ts#L1012-L1017)) and the `Message`
  interface in [backendState.ts:8-15](src/backendState.ts#L8-L15) / `src/shared/models.ts`.
- **Live path** — `SDKSessionManager` captures `event.id` on `user.message` / `assistant.message` and
  emits it with the message.
- **Webview** — `MessageDisplay` renders a per-message `⑂ Fork from here` action emitting
  `forkSession` with `{ toEventId }`.
- **RPC** — extend `ForkSessionPayload` ([messages.ts:257-259](src/shared/messages.ts#L257-L259)) with
  optional `toEventId`. The `forkSession` type is already in the runtime allowlist at :790, so only
  the payload shape changes.
- **Boundary semantics** — `toEventId` is **exclusive**: the fork contains only events *before* it.
  "Fork from here" = pass the clicked message's own event id, so the fork ends just before it. The
  Slice 1 spike must confirm the off-by-one against real session data before the UI ships.
- **Degradation** — the cpSync fallback cannot honor `toEventId`; hide the per-message affordance when
  `supportsSessionForkRpc` is false.

---

## Critical files

| File | Role |
| --- | --- |
| [src/sdkSessionManager.ts](src/sdkSessionManager.ts) | `forkSession()`; client extraction (:594, :1736, :1683-1720) |
| [src/extension.ts](src/extension.ts) | `handleForkSession` :446, `handleSwitchSession` :421, `wireManagerEvents` fan-out :697-731, `loadSessionHistory` :1006 |
| [src/chatViewProvider.ts](src/chatViewProvider.ts) | HTML builder :965 / CSP :980; handler block :320-637; `listen()` disposable :636 |
| [src/backendState.ts](src/backendState.ts) | de-singleton `getBackendState()` :203 |
| [src/extension/rpc/ExtensionRpcRouter.ts](src/extension/rpc/ExtensionRpcRouter.ts) | already per-webview (:115); last-one-wins `registerHandler` (:774) |
| [src/extension/services/SubagentPanelService.ts](src/extension/services/SubagentPanelService.ts) | **pattern reference** for panel registry/dedupe/dispose/icons |
| [src/extension/services/SessionService.ts](src/extension/services/SessionService.ts) | `forkSession` :305 (fallback), `loadSessionHistory` :253, `ensureSessionName` :150 |
| [src/shared/messages.ts](src/shared/messages.ts) | `ForkSessionPayload` :257 |
| [esbuild.js](esbuild.js) | only if a new webview directory appears |

## Verification

**Per slice:** `npm test` · `npm run check-types` · `npm run lint` · `node esbuild.js` · `./test-extension.sh`.
The `main.js size constraint` integration failure is the known baseline, not a regression.

**Slice 1** — spike script under `planning/spikes/session-fork-rpc/` runs standalone against the
bundled CLI and prints the fork's id + assigned name; fork from the sidebar and confirm the new
session shows a *distinct* name in the session dropdown.

**Slice 2** — manual, in the Extension Development Host:
1. Start a long task in the sidebar; click Fork → a tab opens focused, sidebar keeps streaming the parent.
2. Send a message in the tab while the sidebar is mid-turn — both stream, tool output lands in the right surface.
3. Sub-agent traffic in the fork renders in the fork's dock, not the sidebar's.
4. Close the tab → session survives; reopen via `Open Session in Tab` → history intact.
5. Reload the window → the tab is restored by the serializer.
6. Confirm one CLI process, not two (`ps` for the copilot node process).

**Slice 3** — fork from a mid-conversation message; the new tab's history ends immediately *before*
that message; the parent is unchanged. With `supportsSessionForkRpc` forced false, the per-message
affordance is absent and the toolbar Fork still works.

## Risks

- **Two live sessions = two token streams.** Surface the cost; consider a status-bar indicator of how
  many sessions are live.
- **`sessions.fork` is `@experimental`.** Keep the cpSync fallback and the capability flag.
- **`getBackendState()` migration** is the highest-churn part of Slice 2 — do it as its own commit with
  the full suite green before the panel work starts.
- **Panel CSP.** `SubagentPanelService` sets no CSP and no nonce; the chat panel must use the sidebar's
  nonce + CSP via the shared HTML builder, not inherit that laxity.

---

## Precedence — this is Lane B

A second session is building the **v4.0 AHP/ACP split** in parallel. Order of precedence, file
ownership, and the shared-spine steps that gate both lanes live in
**[acp-ahp-chat-tabs-dual-stream-work-order.md](../../acp-ahp-chat-tabs-dual-stream-work-order.md)** —
the canonical doc. Read it before starting any slice.

What it means for this plan:

| This plan says | Status |
| --- | --- |
| Slice 1 — v3.12.0 | ✅ **DONE — built by Lane A on the spine, do not start it.** Commits `386d6e6` + `ab6e9e8` on `feature/3.12.0-shared-spine`. See "What actually shipped" below — it differs from this plan in two ways that matter. |
| Slice 2a — `CopilotClientProvider` | **Reassigned to Lane A** as spine step **S4**. Do not build it here. It is the same extraction either way, and doing it once removes six collision points in `sdkSessionManager.ts`. |
| Slices 2b–2f | **This is Lane B's work.** The tab surface is yours. Renumbered to **v3.13.0** — "v4.0.0, phase 0" is taken by the AHP/ACP split whose Phase 0 is already complete (review I3). |
| Slice 3 — per-message fork | Lane B, renumbered to **v3.14.0** ("v4.0.x minor" was self-contradictory). |

### What actually shipped in Slice 1 — two deviations from this plan

**1. No `CliCapabilityService` flag.** This plan proposed adding `supportsSessionForkRpc`
alongside `supportsMcpListRpc`. That was dropped (review C3, option b): the service is
constructed in `cliBundleBootstrap.ts` and injected only into `ChatViewProvider` — it is
**not reachable from `SDKSessionManager`**, and `semver` is never imported there. Adding a
seam purely to gate one `@experimental` call was unjustified when a runtime probe degrades
correctly. Fork now falls back on absent-method *or* JSON-RPC `-32601`, and propagates every
other error rather than silently running a filesystem copy after a legitimate failure.

**2. Passing `name` to the RPC does not fix the label — this is the one that affects Slice 3.**
The spike ([FINDINGS](../../spikes/session-fork-rpc/FINDINGS.md), 8/8 against bundled CLI
1.0.68) found the CLI honours `name` by writing it to the fork's `workspace.yaml` as `name:`
— but never writes `session-name.txt`, and `SessionService.formatSessionLabel` reads
`session-name.txt` first, then `plan.md`'s H1, then workspace.yaml's **`summary`** (not
`name`), then the id prefix. A purely-RPC fork therefore still rendered as `385d7269`. Both
paths now write `session-name.txt` explicitly.

Consequence worth carrying into Slice 3: **`formatSessionLabel` ignores `workspace.yaml`'s
`name:` entirely**, so any CLI-named session is mislabeled in our dropdown, not just forks.
Filed as a follow-up rather than fixed, because it changes labels for existing sessions.

**File ownership after S4** — Lane B owns `extension.ts`, `chatViewProvider.ts`, `backendState.ts`,
`SessionService.ts`, `cliCapabilityService.ts`, `ExtensionRpcRouter.ts`, `shared/messages.ts`,
`SubagentPanelService.ts`, and all new files under `src/extension/session/`, `webview/`, `rpc/`.
**Lane B does not edit `sdkSessionManager.ts` or `hostBridge.ts`** — those are Lane A's, and a change
needed there is filed as a spine item rather than made directly.

**S3 already answered a question this plan left open:** `setActiveSession()` stays as it is, and both
lanes adopt **one `SDKSessionManager` per session**. That is what 2b's `ChatSessionHost` already
wanted, so nothing changes here — but it also means review item I2's warning (plan mode's dual session
is *sequential*, not concurrent) no longer blocks anything. The 2a spike for two concurrent sessions
on one client is still required, and now belongs to Lane A.

Also relocated in S3: `hostBridge.getActiveAgent()` moves off `getBackendState()` — that was Lane B's
only reason to touch a Lane A file, and it resolves review item **I1**.

*(Correction from the contention map: `getBackendState()` has **16** call sites, not the 21 quoted in
the review below — `chatViewProvider.ts` ×12, `extension.ts` ×3, `hostBridge.ts` ×1. The 75
`chatProvider.` sites figure is exact.)*

---

## Plan Review

**Reviewed:** 2026-08-15 16:05
**Reviewer:** Claude Code (plan-review-intake)
**Against:** HEAD of `feature/4.0-phase0-decouple` (`a0595f5`)

### Verification of claims

Nearly every file, line, and API reference in the plan checks out. Confirmed on disk:

| Claim | Result |
| --- | --- |
| `client.rpc.sessions.fork({sessionId, toEventId?, name?})` exists | ✅ `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts:14531` and `research/copilot-sdk/nodejs/src/generated/rpc.ts:15754` (`connection.sendRequest("sessions.fork", params)`) |
| `toEventId` is **exclusive** | ✅ Confirmed by the generated doc comment, `rpc.d.ts:11384`: *"the fork includes only events before this ID (exclusive)"* — the plan does not need the spike to discover this, only to confirm the CLI honours it |
| `@experimental` | ✅ but it is on the **`sessions` namespace** (`rpc.d.ts:14514`), not on `fork` alone — probing `rpc?.sessions?.fork` is the right shape |
| Current fork is a filesystem copy | ✅ `SessionService.ts:315-341` — `fs.cpSync` + patch `events.jsonl` line 0 + `ensureSessionName` |
| Inherited-name bug | ✅ Real. `session-name.txt` is copied by `cpSync`, and `ensureSessionName` (`:150`) is no-clobber, so the fork keeps the parent's label verbatim |
| No `registerWebviewPanelSerializer` in repo | ✅ Zero hits |
| `SubagentPanelService` passes no `localResourceRoots` | ✅ Zero hits in that file |
| `ExtensionRpcRouter` is per-webview; `registerHandler` last-one-wins | ✅ ctor `:115`; `registerHandler` `:773` with the literal comment "Only allow one handler per type (last one wins)" |
| `listen()` returns a `Disposable` and it is discarded | ✅ `:745` returns `Disposable`; `chatViewProvider.ts:636` is a bare `this.rpcRouter.listen();` |
| Two `new CopilotClient` sites | ✅ `sdkSessionManager.ts:594` and `:1736` |
| ROADMAP.md:17-18 | ✅ Exactly the two `:construction:` rows named |
| Fork test files | ✅ Exactly the four named files exist |
| Palette triplication | ✅ `extension.ts:41`, `SubagentPanelService.ts:23`, `src/webview/app/components/SubagentDock/SubagentDock.js:24` |

Discrepancies found (all minor, listed under Minor below): `SessionService.forkSession` is at `:315` not `:305`; `loadSessionHistory` is at `:256` not `:253`; `_setupRpcHandlers` contains **33** registrations, not "~80"; the SubagentDock path omits its directory.

### Strengths

- **The core premise is right, and it is the fix rather than a workaround.** Replacing a `cpSync` of `~/.copilot/session-state/` with `sessions.fork` removes a hand-rolled reimplementation of a first-party RPC. The plan follows the CLAUDE.md SDK-first rule properly: it cites the SDK source, cites the SDK's own e2e test (`rpc_session_state.e2e.test.ts`), and still demands a spike against **our bundled CLI** before implementing. That is exactly the discipline the rule asks for.
- **The inherited-name bug is a genuine, verified find.** *Context* claims the CHANGELOG's "distinct label" promise does not hold. It does not — the mechanism is confirmed. Finding a shipped-feature defect while researching an adjacent change is high-value.
- **"This is not a re-introduction of anything."** The explicit framing of `SubagentPanelService` as a *pattern reference, not a base class* pre-empts the obvious wrong turn, and 2d correctly identifies the two things that service gets away with that a real chat panel cannot (`localResourceRoots`, serializer). Both verified.
- **2c's routing analysis is correct and load-bearing.** The observation that `registerHandler` is last-one-wins, therefore every surface needs its own router, therefore the existing per-webview router construction already satisfies it — that is the single fact that makes the whole slice tractable, and it is right. Catching the discarded `listen()` disposable ("fine for one immortal sidebar and a leak for N tabs") is a genuinely sharp piece of reading.
- **2e dissolves rather than solves.** "There is no fan-out, only 1:1 wiring" is the correct answer to "which router gets `assistantMessage`?" and it is better than any routing-table scheme.
- **Slice 3's boundary semantics are stated, not assumed.** Declaring `toEventId` exclusive and defining "Fork from here" against it, plus the degradation rule (hide the affordance when the capability flag is false), is the kind of specificity that prevents an off-by-one shipping.
- **The verification section is concrete and falsifiable** — "confirm one CLI process, not two (`ps`)", "reload the window → the tab is restored by the serializer". Manual steps that can actually fail.

### Issues

#### Critical (Must Address Before Implementation)

**C1 — Concurrent file mutation by two live sessions is unaddressed, and it is the headline use case.**

*Section: 2a/2e, Risks, Verification.* The plan's motivating scenario is "a long task running in the panel while a second conversation happens in a tab". `FileSnapshotService` is instantiated **per manager** (`sdkSessionManager.ts:431`), and snapshots are captured by path on `assistant.message` before tool execution. Two hosts means two independent snapshot stores over one shared workspace. If both sessions touch the same file, accepting one session's diff writes a snapshot-derived result that silently discards the other's edits — a data-loss path, not a cosmetic race. Permissions compound it: both sessions run `onPermissionRequest: approveAll` (`:500`, `:2339`), so nothing prompts.

The Risks section lists only token cost. Verification step 2 says "both stream, tool output lands in the right surface" — it never tests two sessions editing one file.

*Fix:* State the concurrency contract explicitly. Minimum viable: a workspace-level write-lock or a "another session is editing `<file>`" warning surfaced in both surfaces; or an explicit, documented decision that concurrent writes are the user's problem, with a warning on the second surface. Add a verification step that has both sessions edit the same file. Do not ship 2f without an answer here.

**C2 — Slice 2 has no task decomposition, and its scope is understated.**

*Section: Slice 2 in full.* Six lettered subsections of prose with no numbered tasks, no ordering beyond one sentence in Risks, and no per-task verification. The real scope, measured:

- `getBackendState()`: 21 call sites across 4 files (`extension.ts`, `chatViewProvider.ts`, `backendState.ts`, **`hostBridge.ts`** — see I1).
- `chatProvider.*` in `extension.ts`: **75 call sites across 39 distinct methods**, all of which 2e requires rerouting through the owning host.
- `manager.onDid*` wirings in `extension.ts`: 17.
- Handler block extraction: 317 lines, 33 registrations.
- Plus: `CopilotClientProvider` extraction from a 2532-line file, a new `ChatSurface` interface with two implementations, a new panel service, and a serializer.

Risks names the `getBackendState()` migration as "the highest-churn part". It is not — the 75 `chatProvider.*` sites are roughly 3.5× larger and far more delicate, because each one must be re-pointed at the host that owns the emitting manager. That misjudgement will wreck the sequencing.

*Fix:* Decompose Slice 2 into numbered tasks with explicit dependencies and a verification command per task. A defensible ordering: (1) `CopilotClientProvider` extraction + spike; (2) `buildChatHtml` extraction, sidebar unchanged, suite green; (3) `registerChatHandlers` extraction, sidebar unchanged, suite green; (4) de-singleton `BackendState` behind `ChatSessionHost`, one host only; (5) reroute the 75 `chatProvider.*` sites through the host; (6) `ChatSurface` + `ChatPanelService` + serializer; (7) 2f. Each of 2–6 is its own commit with the full suite green. Steps 4 and 5 are each multi-session on their own.

**C3 — Slice 1's capability flag has nowhere to live and no version to gate on.**

*Section: Slice 1.* The plan says "add a `supportsSessionForkRpc` flag to `CliCapabilityService` alongside `supportsMcpListRpc`". Two problems, both verified:

1. `SDKSessionManager` has **no reference to `CliCapabilityService`**. It is constructed in `cliBundleBootstrap.ts:39` and injected into `ChatViewProvider` (`chatViewProvider.ts:82/89/98`). There is no wiring from it to the manager, and the plan does not add one. `forkSession()` as specified cannot consult it.
2. Every existing flag is a `semver.gte` against a named constant (`MCP_LIST_MIN = '1.0.36'`). The plan proposes no `SESSION_FORK_MIN` and no way to derive one. The spike is the only thing that can produce that number, and the plan does not list "determine the minimum CLI version" among the spike's four objectives.

*Fix:* Either (a) add "establish `SESSION_FORK_MIN`" as a fifth spike objective and thread `CliCapabilityService` into the manager's constructor (small, and it belongs behind `HostBridge` or alongside it — see I1); or (b) drop the version gate entirely and rely on the runtime probe + try/catch → cpSync fallback, which is what the `@experimental` namespace justifies anyway. (b) is simpler and is the recommended path.

**C4 — The fallback path does not get the name fix, so the advertised bug is only half-fixed.**

*Section: Slice 1.* The name fix is described purely as `name:` passed to the RPC. When the RPC is absent and `SessionService.forkSession()` runs, `session-name.txt` is still copied by `cpSync` and `ensureSessionName` (`:150`) is still no-clobber — **the fork still inherits the parent's name verbatim.** The plan opens by calling this a shipped bug, then leaves it live on the exact path it insists on keeping.

*Fix:* In `SessionService.forkSession`, replace the `ensureSessionName(destDir)` call at `:338` with an unconditional write of `${parentName} (fork)` via the existing `setSessionName` helper (`:136`). One line, and it makes the two paths agree. Add the assertion to `session-fork.test.js`.

#### Important (Should Address)

**I1 — The plan does not know `HostBridge` exists.**

*Section: 2a/2b.* Phase 0.1 (`5da6697`) landed `src/extension/hostBridge.ts` as *the* seam between the agent loop and its host, and it is the load-bearing artifact of the branch this plan targets. The plan never mentions it. Two concrete consequences:

- `createVSCodeHostBridge().getActiveAgent()` (`hostBridge.ts:127`) calls `getBackendState()`. 2b's "stop using it" therefore has a fourth call site the plan's inventory misses, and it sits in the one file whose entire purpose is to have no host coupling. Per-session `BackendState` means `HostBridge` must be constructed per host, or `getActiveAgent` must move.
- 2a's `CopilotClientProvider` extraction is pulling the client lifecycle *out* of `SDKSessionManager` — which is directly aligned with IN-3 (an agent process owning one client and N sessions) and should be framed and reviewed as such, not as an incidental refactor.

*Fix:* Add `hostBridge.ts` to Critical files. State whether `HostBridge` becomes per-host or stays per-activation with `getActiveAgent` relocated. Note the IN-3 alignment of 2a explicitly — it is the plan's best defence.

**I2 — "Plan mode already runs a second session on the same client" is weaker precedent than stated.**

*Section: 2a.* Verified: plan mode does create a second session on one client (`:1954`), but `setActiveSession` (`:762`) assigns `this._sessionSub.value`, a `MutableDisposable` — **subscribing to the new session disposes the old subscription.** `SDKSessionManager` supports exactly one *event-emitting* session at a time. Plan mode's dual session is sequential, not concurrent. So the precedent proves the client tolerates two sessions existing; it proves nothing about two sessions streaming.

The plan half-acknowledges this ("The spike below confirms it for two *interactive* sessions"), but "Precedent that multiple sessions on one client work" overstates it and could license skipping the spike.

*Fix:* Reword to "plan mode proves one client can hold two sessions; it does **not** prove concurrent event routing, because `setActiveSession` disposes the prior subscription (`sdkSessionManager.ts:762`). The spike is load-bearing, not confirmatory."

**I3 — Version numbering for Slice 2 collides with the roadmap and misapplies semver.**

*Section: Slice 2 heading, Slice 3 sequencing note.* "v4.0.0, phase 0" is wrong twice over: **v4.0.0 is already claimed** by `planning/roadmap/v4.0-ahp-acp-split.md` (the AHP/ACP split), and **Phase 0 of that plan is complete** as of `a0595f5`. Reusing both labels for unrelated work will corrupt release planning. Separately, CLAUDE.md reserves major for "breaking changes, architectural rewrites, or incompatible API changes" — a new editor-tab chat surface is a new capability with no breaking change, i.e. **minor**. Slice 3's "v4.0.x minor" is self-contradictory (`.x` is the patch position).

*Fix:* Slice 1 → v3.12.0 (defensible; CLAUDE.md says bump minor when in doubt). Slice 2 → **v3.13.0**. Slice 3 → v3.14.0. Leave v4.0.0 to the AHP/ACP split, and delete the "renumber that plan" suggestion.

**I4 — Unresolved strategic tension with the v4.0 design constraint.**

*Section: Context / 2f.* `v4.0-ahp-acp-split.md` carries a stated design constraint: *"The dock stays a depth view; the Agents window is the breadth view… Do not grow the dock into a session browser, and do not feature-match the Agents window."* Chat-in-a-tab creates a breadth surface — N sessions visible at once — which is what VS Code's Agents window is being built to be. The plan does not mention this constraint or argue against it.

The plan probably wins this argument, and should make the argument rather than sidestep it: the constraint is about the *dock* (a read-only sub-agent depth view), and a full chat surface in a tab is a different thing. Also, the Agents window is gated on B1 (confidence **Low–Medium**, untriaged, no `agentHost` proposal file), so betting the multi-session story on it is betting on someone else's roadmap.

*Fix:* Add a paragraph under *Decisions taken* stating the relationship: chat-in-a-tab is our breadth surface, owned by us, independent of B1/B2 landing; the dock stays depth-only and does not become a session browser. Explicitly note that `ChatPanelService` must not grow a session list.

**I5 — Sidebar-optimised CSS in a full-width editor tab.**

*Section: 2d/2c.* "The panel reuses `dist/webview/main.js` + `styles.css` verbatim" is technically true and produces a working panel. It will not produce a good one: the entire stylesheet is authored for a narrow sidebar column. A chat transcript stretched to full editor width is a known-bad reading experience, and CLAUDE.md's *Useful > Fast* section says a half-baked feature damages trust.

*Fix:* Add a task: `buildChatHtml(webview, extensionUri, opts)` sets a `data-surface="panel"` attribute on `<body>`, and `styles.css` gains a max-width content column under that selector. This also keeps the esbuild claim true — no new directory, so no `esbuild.js` change. Note that if a panel header component is later added, the esbuild triple (dist-dir const, `mkdirSync`, `copyFileSync`) is mandatory; the plan already flags this correctly, which is good.

**I6 — Sub-agent pop-out ownership under two hosts.**

*Section: 2e.* Making the emitter fan-out per-host fixes the dock. But `subagentPanels` (`SubagentPanelService`) is created **once per activation** (`extension.ts:65`, with a comment explicitly saying it must not live in `wireManagerEvents`) and keyed by `agentId` alone. With two hosts, sub-agent traffic from both sessions lands in one activation-global map. Collisions are unlikely (`agentId == toolCallId`), but a popped-out sub-agent tab has no owning session, so it will not close or clean up when its parent chat tab closes.

*Fix:* Key the pop-out map by `${sessionId}:${agentId}` and have `ChatSessionHost.dispose()` close the pop-outs it owns. One line of keying plus a disposal hook.

#### Minor (Consider)

- **M1 — "~80 registrations"** in 2c. Actual count in `chatViewProvider.ts:320-637` is **33** `this.rpcRouter.on*` calls. Over-stating by 2.4× inflates the perceived risk of the extraction, which is the *easiest* mechanical step in Slice 2. Correct it.
- **M2 — Line-number drift.** `SessionService.forkSession` is `:315` (plan says `:305`); `loadSessionHistory` is `:256` (plan says `:253`). `sdkSessionManager` lifecycle listeners are `:1682-1712` (plan says `:1683-1720`). All still findable; fix on the next edit.
- **M3 — SubagentDock path.** The plan writes `SubagentDock.js:24`; the actual path is `src/webview/app/components/SubagentDock/SubagentDock.js`. It is a directory-per-component, which matters precisely because of the esbuild rule.
- **M4 — CLAUDE.md is now stale.** It says "CSP config is at line ~494" of `chatViewProvider.ts`; it is at `:980`. Not the plan's fault, but the plan touches that exact line and should update CLAUDE.md as part of the HTML extraction — the new home will be `src/extension/webview/chatHtml.ts`.
- **M5 — Serializer rehydration cost.** 2d registers a serializer but does not say what happens when three tabs plus the sidebar all rehydrate on window reload: four `resumeSession` calls racing on one client at startup. Worth a sentence on serialising or lazily resuming until a tab is focused.
- **M6 — The spike can drop one objective.** Slice 1's spike is asked to prove "`toEventId` is exclusive". The generated SDK doc comment already states it (`rpc.d.ts:11384`). Keep the *empirical* check against real session data (Slice 3 rightly wants that), but the spike is confirming documented behaviour, not discovering it.
- **M7 — `planning/backlog/` follow-up.** 2g says "record it in `planning/backlog/`". That directory exists and follows a naming convention (`FEATURE-*.md` / kebab-case). Name the file so it actually gets written.

### Recommendations

**On the IN-4 question — build it. This is not throwaway work, and it should not be deferred on those grounds.**

The concern is that Slice 2 grows the bespoke 66-message RPC that IN-4 must tear out. Measured against the plan, it does the opposite. Count what Slice 2 *adds* to the RPC surface: one optional field (`ForkSessionPayload.toEventId`, Slice 3) and one VS Code **command** (`openSessionInTab`, not a message type at all). Zero new message types. Everything else in Slice 2 is *restructuring* existing surface, and the restructuring is precisely what IN-4 presupposes:

- **`ChatSessionHost` + `ChatSessionRegistry` is the thing IN-4 needs most and does not have.** IN-4's own stated blocker is "the webview has **no state model to migrate** — no store, no reducer, state scattered across module-level `let`s, component fields, and the DOM." A per-session host with its own `BackendState` is the first real state boundary this codebase would have. And the gap register's Category A lists **"Session multiplicity — AHP multi-chat: *one scope, many streams*"** as already shipped upstream. A `Map<sessionId, Host>` registry is that shape. Building it now means IN-4 starts from a session-scoped architecture instead of a singleton one.
- **`CopilotClientProvider` (2a) is IN-3 work.** An out-of-host agent process owns one client and serves N sessions. Extracting client lifecycle out of the 2532-line manager is on IN-3's critical path regardless of whether a single chat tab ever ships.
- **`registerChatHandlers(router, host, deps)` makes IN-4 *cheaper*, not more expensive.** Right now the bespoke RPC is 317 lines welded inside `ChatViewProvider`. After extraction it is one file taking a `router` — which is exactly the swap point where an `AhpClient` adapter replaces it. Deleting one module beats unpicking a method.
- **`ChatSurface`, `buildChatHtml`, and the serializer all survive IN-4 verbatim.** A React/AHP webview still needs an HTML shell, still needs a sidebar and a panel implementation, still needs to survive window reload.

The genuinely throwaway portion is small: the mechanical re-pointing of 75 `chatProvider.*` call sites (C2) will be rewritten by IN-4's event model. But that work is *unavoidable* — de-singletoning is a prerequisite for AHP's multi-chat model whether it happens now or during IN-4, and doing it now, against a working sidebar with 1772 green tests, is far safer than doing it inside a protocol migration.

The real cost is not waste, it is **serialisation**. `v4.0-ahp-acp-split.md` says "IN-3 — ready now, no dependency" is next, and Slice 2 touches the same 2532-line file IN-3 needs. One engineer cannot do both. So:

1. **Ship Slice 1 immediately, standalone, as v3.12.0.** It is small, it deletes a hand-rolled reimplementation, it fixes a shipped bug, it has zero webview surface, and it survives every v4.0 outcome — the roadmap's own "do only work that survives every outcome" rule endorses it without qualification. Fix C3 and C4 first (both are small).
2. **Do 2a (`CopilotClientProvider`) next and bill it to IN-3**, not to this plan. It is the same extraction either way, and IN-3 is the ticket that makes it unambiguously required.
3. **Then decide Slice 2b–2f against IN-3's actual start date.** If IN-3 is genuinely starting, Slice 2 waits — not because it is wasteful but because it competes. If IN-3 is waiting on OUT-1's answer (it is drafted but unsent), Slice 2 is the best available use of that gap, and it lands real user value on a shipped extension while the protocol question resolves.

**Other recommendations:**

- Send OUT-1 before starting Slice 2. It is drafted, unsent, costs nothing, and its answer changes how much of Slice 2 is worth investing in.
- Consolidate the triplicated palette (`extension.ts:41`, `SubagentPanelService.ts:23`, `SubagentDock.js:24`) as a standalone commit *before* Slice 2 rather than inside it. The plan already says "consolidate rather than add a fourth copy" — make it a task, not an aside, or it will be skipped under deadline.
- Add a status-bar "N sessions live" indicator to Slice 2 proper rather than leaving it as a Risks-section "consider". With C1's concurrency hazard, knowing how many agents are writing to your workspace is not a nice-to-have; it is the mitigation.
- Per CLAUDE.md TDD: state that the new `ChatSessionRegistry` / `ChatSurface` tests must `require` the compiled `out/` modules (Slice 2 is extension-side, so `npm run compile-tests` is a prerequisite) and must not assert on source strings. The existing failure mode CLAUDE.md documents — a test passing because a string appeared inside a comment — is exactly what a "surface abstraction" refactor invites.

### Assessment

**Implementable as written?** **With fixes.**

**Reasoning:** Slice 1 is nearly ready — its central API claim is verified in the installed SDK, and it needs only C3 (the capability flag has no home and no version constant) and C4 (the fallback path doesn't get the name fix it advertises) before an engineer can start. Slice 2 is a sound and strategically well-aligned architecture — it builds the session-scoped state boundary that IN-4 explicitly lacks and adds essentially nothing to the bespoke RPC — but it is a design document, not an implementation plan: it has no task decomposition, understates its largest workstream by 3.5× (75 `chatProvider.*` sites, not the `getBackendState()` migration it flags), does not account for the `HostBridge` seam that Phase 0.1 just landed, and has no answer for concurrent file mutation, which is the very scenario it exists to enable.

---

## Plan Review

**Reviewed:** 2026-08-15 18:02
**Reviewer:** Claude Code (plan-review-intake)

### Strengths
- **Context / Decisions taken:** The plan correctly treats chat-in-a-tab as an architectural decoupling problem, not a UI pop-out. Keeping the sidebar on the parent and opening the fork in a tab is a coherent product decision.
- **Section 2c / 2d:** Reusing the existing chat HTML and per-webview router follows the codebase's current patterns and respects the CLAUDE.md webview/CSP constraints.
- **Precedence — this is Lane B:** The lane ownership and version renumbering reduce branch-collision risk and make the shared-spine dependency explicit.
- **Verification:** The manual checks are concrete and falsifiable, especially tab restore, dual streaming, and single-CLI-process validation.

### Issues

#### Critical (Must Address Before Implementation)
- **Reference:** Sections **2a / 2e / Risks / Verification**
  - **What's wrong or missing:** The plan does not define the concurrency contract for two live sessions editing the same workspace files.
  - **Why it matters:** `SDKSessionManager` owns a per-manager `FileSnapshotService`, and permissions are auto-approved. Two sessions can independently snapshot and write the same file, creating a real lost-update/data-loss path.
  - **Suggested fix:** Add an explicit rule before Slice 2 ships: shared write lock, conflict warning, or serialized accept/apply behavior. Add a verification step where both sessions modify the same file and confirm the second action is blocked, warned, or conflict-resolved.

- **Reference:** Sections **2b / 2c / 2d**
  - **What's wrong or missing:** The plan does not separate **surface attachment** from **session bootstrap/resume**.
  - **Why it matters:** Today the sidebar's ready flow is split across `chatViewProvider.ts` and `extension.ts` and includes auto-resume on webview readiness. If that behavior is copied into tabs/serializer rehydration, opening or restoring a tab can incorrectly re-resume, double-init, or recreate an already-live session.
  - **Suggested fix:** Add a dedicated lifecycle task: `ChatSessionHost` owns resume/start; surfaces only attach/detach. Specify serializer behavior for (a) live session, (b) resumable stopped session, and (c) missing/expired session.

#### Important (Should Address)
- **Reference:** Section **2b**
  - **What's wrong or missing:** The plan treats `BackendState` as purely session-scoped, but it currently mixes session state with shared/environment state (`workspacePath`, `activeFilePath`, MCP server tools/status).
  - **Why it matters:** Blindly making one `BackendState` per host will duplicate or stale shared state across surfaces and create inconsistent MCP/status behavior.
  - **Suggested fix:** Split `BackendState` into session-scoped vs shared runtime/UI state, or explicitly document which fields stay shared and where that shared store lives.

- **Reference:** Section **Slice 3 — Degradation** and **Verification**, versus **"What actually shipped in Slice 1"**
  - **What's wrong or missing:** Slice 3 still depends on `supportsSessionForkRpc`, but the plan later says that flag was intentionally not added.
  - **Why it matters:** The per-message fork affordance is not implementable as specified because its gating signal no longer exists.
  - **Suggested fix:** Replace the flag with a real capability source (for example, a host/session-level "exclusive fork supported" result derived from runtime probing/spike findings) and update verification accordingly.

- **Reference:** Sections **2b–2f**
  - **What's wrong or missing:** The Lane B work is still large prose slices rather than ordered implementation tasks with explicit entry criteria and per-task verification.
  - **Why it matters:** This is a high-churn refactor across `extension.ts`, `chatViewProvider.ts`, `backendState.ts`, new host/registry code, and panel lifecycle. Without finer decomposition, it is easy to start before the S4 prerequisite lands or to bundle too much risk into one pass.
  - **Suggested fix:** Break 2b–2f into numbered tasks with dependencies, each with a verification command/checkpoint. Make "S4 landed" an explicit prerequisite, not just a note.

#### Minor (Consider)
- **Reference:** Section **2f**
  - **What's wrong or missing:** `copilot-cli-extension.openSessionInTab` is described as opening "any session," but the command contract is not specified.
  - **Why it matters:** Implementation will diverge unless it is clear whether the command takes a `sessionId`, opens the current session, or prompts with a picker.
  - **Suggested fix:** State the invocation contract explicitly.

### Recommendations
- Add a short lifecycle diagram for **create host / attach surface / resume session / restore panel**.
- Split shared vs per-session state before the de-singleton migration starts.
- Turn Lane B into a gated checklist: prerequisite landed, one refactor step, full verification, then next step.

### Assessment
**Implementable as written?** With fixes
**Reasoning:** The architectural direction is strong and aligned with the codebase, but the current plan leaves multi-session write safety and tab/bootstrap lifecycle behavior unresolved. Those gaps would likely cause rework or correctness bugs if implementation started exactly from this version.
