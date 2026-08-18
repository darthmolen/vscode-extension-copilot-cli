---
type: plan
---

# v3.13.0 Task 7 — Chat in an Editor Tab

**The feature the rest of v3.13.0 was plumbing for.** Tasks 1–6 and P2 have landed and are verified
live; this is the first task that produces something a user can see. Reviewer: the diagnosis work is
done and evidenced below — what needs attacking is **the three decisions in §2**, the sequencing, and
whether the verification would actually catch a regression.

Nothing here is implemented.

---

## 1. Where this starts from

| Landed | What it gives Task 7 |
| --- | --- |
| Task 4 (`b861086`, `5fe2c45`) | `ChatSessionHost` + `ChatSessionRegistry`; `registry.get()` answers "is this session live?" **without starting anything** |
| Task 5 (`0b0066e`, `685a15a`, `27f47cc`) | All 15 manager events route to the **owning session's** surface. `ChatSurface` already exists as a declared interface with `ChatViewProvider` as its first implementation |
| Task 6 (`3488fe8`, `0d371eb`) | `ensureStarted()` — attach ≠ bootstrap; a surface commands its own session through the host; `.manager` is `#private` |
| P2 (`56a7fe8`, `194afb5`) | One transcript projection; replayed tools render as real chips. **Verified live**: `Loaded 21 messages (15 tool calls)`, chips confirmed by eye |

**What is missing is only a second surface and a way for VS Code to restore it.**

## 2. Decisions taken — attack these first

### 2.1 One `ChatSurface` class, N instances — *not* a second class

An earlier draft proposed a separate `PanelChatSurface` alongside a thinned `ChatViewProvider`, on the
grounds that the plan's `{router, postMessage, reveal, dispose}` was a different contract from the
15-method `ChatSurface` that hosts write to. **That reasoning was wrong and is withdrawn.** The 15
methods are *implemented by* `postMessage` through the router — one is sugar over the other, two zoom
levels on one object.

Measured, not assumed: in ~600 lines, `ChatViewProvider` touches its VS Code object for exactly four
things, and every one is on `.webview`:

| Use | Line | Type |
| --- | --- | --- |
| `postMessage` | `chatViewProvider.ts:417` | `vscode.Webview` |
| `asWebviewUri` | `:583`, `:633`, `:688` | `vscode.Webview` |
| set `.html` | `:728` | `vscode.Webview` |
| existence check | `:355` | — |

`vscode.Webview` is the **identical type** on `WebviewView` and `WebviewPanel`. The only view-shaped
calls in the file are `onDidChangeVisibility` (`:322`) and `show()` — whose own docstring already says
*"Replaces `panel.reveal()` for commands like openChat"* (`:345`). The code had already worked out
these are one concept.

**So the difference is four members, not a class:**

```ts
interface ChatWebviewSlot {
    readonly webview: vscode.Webview;
    reveal(preserveFocus?: boolean): void;            // show() | reveal()
    readonly onDidChangeVisibility: vscode.Event<void>;
    readonly onDidDispose?: vscode.Event<void>;       // panels only — see below
}
```

Two ~10-line adapters, `SidebarSlot` and `PanelSlot`. `chatViewProvider.ts:736` already records the
asymmetry the optional `onDidDispose` encodes: *"Don't dispose `_view` — VS Code owns the sidebar view
lifecycle."* A panel is the opposite; the user can close it.

**`ChatViewProvider` keeps only its registration role.** `resolveWebviewView` is genuinely
sidebar-specific — it is how VS Code hands us a sidebar — so it shrinks to a shim that builds a
`SidebarSlot` and gives it to the sidebar's `ChatSurface` instance.

> **Reviewer:** the risk in this decision is that `ChatSurface` currently carries collaborators that
> are *not* per-surface — `cliCapability`, the three MCP providers, `customAgentsService`,
> `compactHandlers`. N instances would rebuild them. The plan is to split them the way Task 4 split
> the slash-command services: window-scoped ones injected and shared, session-scoped ones read from
> the host. **Is that split right for each of those five, or does one of them belong somewhere else?**

### 2.2 Window state becomes observable, rather than broadcast

`updateActiveFile` (3 sites) and `updateSessionsList` (2 sites) push window state at the sidebar. With
N surfaces they must reach all of them — but they are **not the same shape of problem**:

| | `updateActiveFile` | `updateSessionsList` |
| --- | --- | --- |
| Payload | one path, identical everywhere | window-scoped **list** + `currentSessionId` |
| With N surfaces | pure broadcast | list identical, **"which one is mine" differs per surface** |

`updateSessionsList` ends with `sessionManager?.getSessionId()` (`extension.ts:989`) — the *window's*
session. Each surface's dropdown must highlight *its own*.

**Decision: `WorkspaceRuntimeState` gains a change event; surfaces subscribe.** Task 3 built that
object as "state per window, shared by every surface", `activeFilePath` **already lives in it**, and
`updateActiveFile` already writes there *and* pushes separately — so the write exists and only the
notification is missing. The sessions list moves in beside it, and each surface combines the shared
list with its **own host's** `sessionId` at render time, which dissolves the per-surface wrinkle
instead of special-casing it.

Rejected alternatives: fan-out from `ChatSessionRegistry` (a *session* registry distributing *window*
state, and no answer for the list case); a second `ChatSurfaceRegistry` (a parallel registry to keep
in step when surfaces are already reachable through hosts); an inline loop at each call site (the
failure mode that produced three init payloads and two argument formatters this week — every new
value repeats the loop until one call site quietly doesn't).

Plain callbacks, as `ChatSessionHost.onAdoptSessionId` already does, so `backendState.ts` stays free
of `vscode` and testable from plain mocha.

> **Reviewer:** subscription lifetime is the exposure. A surface must unsubscribe on dispose or a
> closed tab keeps receiving window updates and writing to a dead webview. **Is `onDidDispose` →
> unsubscribe sufficient, given VS Code never disposes the sidebar view?**

### 2.3 One router per surface

`ExtensionRpcRouter.registerHandler` is last-one-wins per message type, so surfaces must never share
one — the constraint `registerChatHandlers`'s own header already states. Each panel builds its own
router and calls `registerChatHandlers` once.

## 3. The work

### 3.1 `ChatPanelService`

`createWebviewPanel('copilotChatPanel', …)` keyed by sessionId, reveal-if-exists — the shape
`SubagentPanelService.open()` already uses (`:90-106`), with one correction:

**`localResourceRoots` is required, and the existing panel service is the cautionary tale.** It passes
`{ enableScripts: true, retainContextWhenHidden: true }` and nothing else (`:97-102`), which is
precisely why it cannot load `dist/webview` assets. Chat panels must mirror the sidebar's four roots
(`chatViewProvider.ts:268-277`): `extensionUri`, `~/.copilot`, `os.tmpdir()` — pasted images land in
random `copilot-paste-<uuid>` directories — and every workspace folder.

### 3.2 The serializer

`grep -rn "registerWebviewPanelSerializer" src/` returns **zero**: panels die on window reload today.

Registered in `activate()`, **never inside a command handler** — VS Code restores panels during
activation, before any command would have run.

Restore reads the sessionId from serialized state and goes through `registry.getOrCreate(sessionId)` →
`host.ensureStarted()` → attach, which is Task 6's three cases doing their job: live → attach only,
start nothing; stopped → resume; gone → fresh session with a notice.

**Serialized state carries the sessionId and nothing else.** The transcript comes from the P2
projection on restore; persisting a transcript would reintroduce the second lossy copy P2 deleted.

## 4. Sequencing

Four commits, each green before the next, so a regression has a small blast radius:

1. **The slot seam + `ChatSurface`** — behaviour-neutral; the sidebar is still the only surface.
2. **Observable window state** (§2.2) — still one surface, so it is provably a no-op live.
3. **`ChatPanelService`** — a tab appears.
4. **The serializer** — the tab survives reload.

## 5. Verification

**Unit.** `ChatWebviewSlot` is the seam that makes this testable: two surfaces over fake slots, driven
from the suite, no `vscode` needed.

- Each surface renders its own session; neither receives the other's traffic.
- One active-file change reaches both.
- Each highlights **its own** session in the shared list.
- Disposing one leaves the other subscribed and working.
- A disposed surface receives nothing further.

**Live**, in the Extension Development Host:

1. Long task streaming in the sidebar; open a tab — both stream concurrently, into the right surface.
2. Reload the window — the tab restores; `[Init] Sending N messages` appears once per surface, and
   nothing double-inits or re-resumes.
3. Cold start with zero prior tabs — nothing restored, nothing thrown.
4. Restore a session whose state directory is gone — fresh session, notice, no exception.
5. Change the active file — sidebar **and** tab update.
6. Sub-agent traffic from the tab's session lands in the tab's dock, not the sidebar's.
7. One CLI process, not N (`ps` for the copilot node process).

**The suite is flaky in a documented way** — a failure counts only if it also fails when its file is
run alone (`npx mocha <file> --timeout 20000`). There is no sanctioned baseline failure.

## 6. Risks

- **`forceRecreate()` sets `.html`** (`:728`) to rebuild the sidebar. Fine on a panel; on a view, VS
  Code may re-resolve. Task 8 makes it palette-only, so it is worth confirming rather than assuming.
- **`retainContextWhenHidden` on N panels** costs memory per hidden panel. The sidebar already uses
  it; copying it reflexively to every tab should be a decision, not a default.
- **A session is not always a surface.** Plan mode starts a second CLI session (`<id>-plan`) that
  deliberately has no host, so `registry.get(planSessionId)` will always miss. The serializer must not
  treat that miss as "session gone".
- **Two hosts claiming one session** — the registry logs a warning and the newcomer wins the index.
  Task 7 is the first task that can actually cause it, by restoring a tab for a session the sidebar
  already shows. **This is the backstop, not the mechanism**; `registry.get()` before creating is the
  mechanism.

## 7. Scope this does not take

- **The sub-agent dock is not re-populated on replay.** Its tile lifecycle (`subagent:start`) has no
  replay counterpart; replayed sub-agent tools appear as flat history. Deliberate, and unchanged here.
- **No `sdkSessionManager.ts` or `hostBridge.ts` edits** — Lane A owns both.
- **The ~15 remaining `sessionManager` call sites** in command handlers (plan mode, accept/reject,
  `validateAttachments`) keep their cross-session flaw until Task 8, which is also where plan mode
  deserves a design pass given it is a first-class ACP concept (`session/set_mode`).

---

## Plan Review

**Reviewed:** 2026-08-18 08:06
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

- **§2.1 / §2.3** correctly identifies the right abstraction boundary: a surface-specific router plus a shared surface contract is consistent with the current `registerChatHandlers()` / `ExtensionRpcRouter` design.
- **§3.1** catches a real implementation hazard: `localResourceRoots` must be mirrored for panels or asset/image loading will break.
- **§3.2** is right to register the serializer in `activate()` rather than lazily in a command.
- **§4 / §5** show good sequencing and verification intent: reducing blast radius before adding panels, and checking restore/double-init behavior explicitly.

### Issues

#### Critical (Must Address Before Implementation)

1. **§1 / §2.1 — plan understates remaining global-session coupling**
   - **Section:** §1 / §2.1
   - **What's wrong:** The plan says "only a second surface" is missing, but `ChatViewProvider` still reads/writes global `getBackendState()` for init, transcript mutation, and image/session resolution (`sendInit`, `addUserMessage`, `addAssistantMessage`, `addReasoningMessage`, `_resolveAssistantImagePaths`). `registerChatHandlers` also still reads global backend state for some actions.
   - **Why it matters:** As written, a panel surface will not have isolated per-session state; it will read/write the sidebar's singleton state.
   - **Suggested fix:** Add an explicit refactor task before panel work: surface state must come from `ChatSessionHost.state` / injected accessors, and transcript loading must target the host being opened/restored, not the singleton.

2. **§3.2 — serializer restore path assumes `ensureStarted()` resumes the requested session, but current composition root does not**
   - **Section:** §3.2
   - **What's wrong:** `ChatSessionHost.ensureStarted()` passes `{ sessionId, resume }`, but `extension.ts` currently injects `startManager: async () => resumeAndStartSession(context)` and ignores those options.
   - **Why it matters:** Restoring/opening a tab for session X can resume the wrong session or the "last session" instead of X.
   - **Suggested fix:** Add concrete work to thread `sessionId`/`resume` through `startManager`, `resumeAndStartSession`, and `startCLISession`, with tests for "restore specific stopped session".

3. **§2.1 / §5 / §6 — host/surface cardinality is unresolved**
   - **Section:** §2.1 / §5 / §6
   - **What's wrong:** The plan wants one host per session (`registry.get()` before create) and also expects sidebar + tab to stream concurrently, but `ChatSessionHost` currently supports only **one** `surface` (`attachSurface()` replaces it).
   - **Why it matters:** Same-session sidebar+tab behavior is undefined: either the tab steals the host from the sidebar, or duplicate hosts appear.
   - **Suggested fix:** Decide explicitly — either **one host → many surfaces** (fan out events), or **opening in tab transfers ownership** from sidebar. Then align sequencing and verification with that choice.

#### Important (Should Address)

1. **§3.1 — no entry point for opening a chat tab is planned**
   - **Section:** §3.1
   - **What's wrong:** The plan adds `ChatPanelService` but does not say what command/UI/RPC opens it. Current shared messages expose `subagentPopout`, not chat popout.
   - **Why it matters:** The feature is not user-reachable as written.
   - **Suggested fix:** Add the exact trigger: command ID, toolbar/menu location, and any required `messages.ts` / handler changes.

2. **§2.2 — subscription lifetime is noted as a risk, but the plan does not define the ownership model**
   - **Section:** §2.2
   - **What's wrong:** The plan asks whether `onDidDispose → unsubscribe` is sufficient, but does not convert that into a task. Sidebar lifecycle is different from panel lifecycle, and sidebar resolve/dispose/re-resolve needs explicit handling.
   - **Why it matters:** Easy source of leaks and duplicate broadcasts.
   - **Suggested fix:** Add a concrete task defining who owns the workspace-state subscription and how it is torn down/replaced for both panel dispose and sidebar re-resolve.

3. **§4 / §5 — tasks are still too coarse for strict TDD execution**
   - **Section:** §4 / §5
   - **What's wrong:** The plan has four commit-sized phases, but not the file-by-file, failing-test-first steps this repo expects.
   - **Why it matters:** It is implementable for the author, but weaker as a handoff plan and easier to execute out of order.
   - **Suggested fix:** Break each phase into smaller tasks with exact files and explicit RED → GREEN verification commands.

#### Minor (Consider)

1. **§6 — identified risks are not all converted into explicit work items**
   - **Section:** §6
   - **What's wrong:** `forceRecreate()` behavior and `retainContextWhenHidden` memory cost are documented as risks but not assigned to a task/decision point.
   - **Why it matters:** These can become "known unknowns" left unresolved during implementation.
   - **Suggested fix:** Attach each risk to a specific verification step or decision in §4.

### Recommendations

- Add a **pre-panel refactor phase** for removing singleton session-state usage from `ChatViewProvider`/handler paths.
- Make the **session ownership model** explicit before implementation starts.
- Expand the plan into **smaller TDD tasks** with exact files and commands, especially around serializer restore and multi-surface behavior.

### Assessment

**Implementable as written?** With fixes

**Reasoning:** The architectural direction is mostly sound, but the plan currently misses three load-bearing realities in the codebase: singleton session state in the surface, ignored `ensureStarted()` resume parameters, and the unresolved one-host/one-surface conflict. These need to be fixed in the plan before implementation.
