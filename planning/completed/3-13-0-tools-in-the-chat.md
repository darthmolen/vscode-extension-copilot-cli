---
type: review-request
status: reviewed — root cause confirmed independently; one claim rejected (§8)
---

# Tool calls in the chat transcript — what broke, what changed, and why

**Branch:** `feature/3.13.0-chat-in-a-tab` · **Written:** 2026-08-23 · **Author:** Lane B (Claude)
**For:** adversarial review by Copilot. **Attack the reasoning, not the prose.**
**Outcome:** reviewed 2026-08-23 — see §8. Root cause confirmed independently; the fix and its tests
endorsed; one symptom claim in the review rejected on evidence, and claim 3 stays unproven.

Two defects, both introduced by v3.13.0's own work, both found by live use after the code was
"done", both fixed before release. Neither is in the changelog: no user ever saw them.

There is a list of **falsifiable claims** at the bottom (§6). Start there if you want to go straight
at it.

---

## 1. The symptom

A chat tab, mid-run, rendering a long editing task. The transcript showed:

```
ASSISTANT   Now update the command reference tables:
ASSISTANT   Now update the not-supported section:
ASSISTANT   Now update the test coverage section:
ASSISTANT   Let me do a final check to make sure the doc reads cleanly:
```

Nine consecutive assistant bubbles. **Every tool call between them was gone** — the narration kept,
all of the doing removed. The session had in fact run an `edit` per turn; the log proves it.

---

## 2. Defect A — attaching the same manager twice released the window-scoped handlers

### The way it was

Two callers attach a manager to a host, and on one path they overlap.

`extension.ts` → `wireManagerEvents(manager, owner)`:

```ts
owner.attachManager(manager);                                  // (1)
owner.ownManagerSubscription(manager.onDidChangeStatus(...));  // ~9 window-scoped handlers,
owner.ownManagerSubscription(manager.onDidStartTool(...));     // registered AFTER (1)
...
```

`ChatSessionHost.ensureStarted()`:

```ts
this.starting = this.startManager({ ... })
    .then((manager) => {
        this.attachManager(manager);   // (2) — the SAME manager, again
        this.live = true;
    });
```

Call (2) existed because `startManager`'s contract is *"bring a session into being and hand back its
manager"* — the host then attaches it. Call (1) existed because `startCLISession` is also reached
from paths that never touch `ensureStarted` (`handleNewSession`, the switch-session resume branch,
the auth retries). **Both are legitimate on their own paths.**

Pre-fix, `attachManager` handled being handed the manager it already had like this:

```ts
if (this.#manager && this.#manager !== manager) {
    this.disposeManager();
} else {
    this.detachManager();      // ← same manager takes this branch
}
this.releaseWindowSubscriptions();   // ← and this ran unconditionally
this.#manager = manager;
// ... re-subscribes the host's OWN routing
```

So call (2) tore down and rebuilt. Harmless for the host's own routing, which it re-adds. **Fatal for
`windowSubscriptions`, which it released and nobody re-registered.**

This is my regression, from the commit that moved those subscriptions off `context.subscriptions` to
fix a real leak (~10 handlers leaked per session switch, one more per tab).

### The evidence

A natural experiment, unplanned, across two UAT logs. `[Tool Start]` is logged in two places —
`sdkSessionManager.ts:1157` (manager-level) and `extension.ts:1268` (window-scoped). So a tool that
reaches both prints twice.

`3-13-final-uat-test.md`, beside this file (the saved Output Channel, committed so the
evidence is reviewable — the other two logs below are local-only, under gitignored `tests/logs/`):

| Session | Started via | manager-level | window-scoped |
| --- | --- | --- | --- |
| `4dd65a29` (sidebar) | `handleNewSession` → `startCLISession` **directly** | 5 | **5** |
| `474592bb` (tab) | `adopt()` → `ensureStarted()` | 4 | **0** |

`tests/logs/server/3-13-lost-tools-on-change.log` — everything went through `ensureStarted`:

- manager-level tool starts: **71**
- window-scoped: **0**
- `[CLI Status]`: **4**, all at startup, then silent while **50 turns** ran

Dead for the life of the session: the sub-agent dock (`subagentPanels.onTool/onStart/onMessage/
onComplete`), the status bar, MCP server state, `plan_ready` → open plan.md, and the dropdown refresh
on rename.

### The way it is now

`attachManager` is idempotent:

```ts
if (this.#manager === manager) {
    return;
}
```

**Idempotence rather than deleting one of the two calls.** Both callers are correct in isolation;
what was wrong was that correctness depended on the order two independent callers happened to run in.
Deleting call (2) would fix this instance and leave the class of bug alive for the next caller.

Verified in `tests/logs/server/3-13-tools-work-again.log`:

| | broken run | after |
| --- | --- | --- |
| manager-level tool starts | 71 | 85 |
| window-scoped fired | **0** | **85** |
| host routed → a surface | *(no such log line yet)* | **85** |
| host routed → nothing | — | **0** |
| `[CLI Status]` | 4 | 126 |

And it matches per session: 61 on `host#1`, 24 on `host#2`, on both the manager side and the host
side. Zero drops.

---

## 3. What defect A did *not* explain

**It does not explain the missing chips**, and this is the part most worth attacking.

The host's own routing — `onDidStartTool` → `surface.notifyToolStart` — was torn down and
**re-added** by the second attach. It should have survived. The argument that it did:

> During the chip-less window (19:23–19:26), the tab's session logged **28 `[ImageResolve]` lines**.
> `_resolveAssistantImagePaths` is called only from `WebviewChatSurface.addAssistantMessage`, which
> is called only from the host's `onDidReceiveOutput` subscription — registered in the **same block**
> as `onDidStartTool`. So the host's surface routing was alive, and the extension *was* posting those
> chips.

Conclusion: in that run the chips were lost webview-side, and a reboot cleared it. Not proven; it is
the best the logs support. **If you can break that inference, do.**

A correction while we are here — Copilot's earlier write-up said the manager was *"likely briefly
disposed"*. It was not. The same-manager path took `detachManager()`, which explicitly keeps the
session alive, and `dispose()` → `stop()` always logs `Stopping SDK session manager…` — a string that
appears **zero times** in the entire broken run.

---

## 4. Defect B — a live session's transcript held the narration and none of the doing

### The way it was

On `main`, `chatViewProvider.addToolExecution` did two things:

```ts
public addToolExecution(toolState: any, storeInBackend: boolean = true) {
    if (storeInBackend) {
        getBackendState().addMessage({
            role: 'assistant',
            type: 'tool',
            content: toolState.description || toolState.name || 'Tool execution',
            toolName: toolState.name,
            status: 'running',
            timestamp: Date.now()
        });
    }
    this.rpcRouter?.toolStart(toolState);
}
```

v3.13.0 extracted the surface. `WebviewChatSurface.notifyToolStart` (`:616`) kept the second half:

```ts
public notifyToolStart(toolState: any) {
    this.rpcRouter?.toolStart(toolState);
}
```

The `storeInBackend` half was dropped. Its sibling writers — `addUserMessage`, `addAssistantMessage`,
`addReasoningMessage` (`:568`–`:604`) — all kept theirs. So a running session's `host.state` held
user, assistant and reasoning messages and **no tool calls at all**.

`sendInit()` renders from exactly that state (`webviewChatSurface.ts:270`, `messages:
fullState.messages`). So every init on a live session replayed the conversation with the tools
missing.

### Why that is reachable, not theoretical

`sendInit()` on a live session is routine. It fires from `registerChatHandlers.ts:110` (webview
`ready`) and `extension.ts:411` (`onDidBecomeReady`), plus the switch-session branches. VS Code
disposes a sidebar *view* whenever its container is hidden and re-resolves it later into the same
surface — which is exactly why `ChatWebviewSlot.closingEndsSurface` exists.

Measured in one window session (`3-13-tools-work-again.log`): **11** `[Sidebar] Chat surface
attached`, **7** `Webview is ready`, **7** `[Sidebar] [Init] Sending`.

So: collapse the sidebar container mid-run, reopen it, and the whole conversation came back with
every chip gone.

### The way it is now

Tool state is recorded into the transcript, on the host:

```ts
// ChatSessionHost.attachManager
this.subscribe(manager.onDidStartTool((toolState) => {
    this.recordTool(toolState);
    this.surface?.notifyToolStart(toolState);
}));
this.subscribe(manager.onDidUpdateTool((toolState) => {
    this.recordTool(toolState);
    this.surface?.updateToolExecution(toolState);
}));
this.subscribe(manager.onDidCompleteTool((toolState) => {
    this.recordTool(toolState);
    this.surface?.updateToolExecution(toolState);
}));
```

`SessionState.recordTool` (`backendState.ts:118`) **upserts by `toolCallId`** — a tool is one entry
in the conversation that changes state three times (start, progress, complete), and appending would
put the same `bash` in the transcript three times.

### Three decisions worth challenging

**(a) Not restored as it was.** The old recording was already lossy: `content: 'Tool execution'`, and
`toolName: toolState.name` — a field the live payload has never carried; it is `toolName`. That is
precisely the grey "Tool execution" bubble P2 set out to kill. Restoring it would have reintroduced
the bug P2 fixed. The new record matches what `sessionTranscriptBuilder` produces for
`tool.execution_start`, so the live transcript and one replayed from `events.jsonl` are the same
artefact rather than two representations kept in step by memory.

**(b) On the host, not the surface** — deliberately asymmetric with `addAssistantMessage`, which
still records surface-side by reaching back through `this.sessionHost?.state`. A host with no surface
(a closed tab winding down) is still a conversation, and there would be nothing to write through. The
asymmetry is the direction of travel, not an oversight; moving the message writers is out of scope
for a release that is otherwise done.

**(c) Results are capped through the *same* function the replay uses.** `applyResult` and
`DEFAULT_MAX_RESULT_CHARS` are now exported from `sessionTranscriptBuilder.ts` (`:38`, `:148`) and
called by the host. The replay truncates at 2,000 chars and sets `resultTruncated`; the live path did
not cap at all. One real `bash` in these logs returned **181.7 KB**. Recording verbatim would have
put megabytes in memory, shipped them on every init, and re-broken the very agreement (a) exists to
create.

### The test that found (c)

`tests/unit/extension/host-records-tools.test.js` binds the two paths by **comparing values**, not by
asserting the same field names in two files — the latter being how they drifted in the first place.
It writes a real `events.jsonl`, runs `buildSessionTranscript` over it, drives the live emitter with
the equivalent payload, and compares.

It caught two things within ten minutes of being written:

1. A fixture handing the builder a raw `1000` where the event log carries an ISO string —
   `toMillis` read it as the year 1000. My bug, in the test.
2. The uncapped result in (c). **The feature test would have passed without it.**

---

## 5. Why these were invisible to 2,159 unit tests

Both are wiring, and wiring between components that no unit test instantiates together:

- **A** needed two independent callers to attach one manager in a particular order. Every unit test
  attaches once.
- **B** needed a *live* session to be re-rendered from state. Unit tests either drive the live path
  (and assert the surface was called) or the replay path (and assert the transcript) — never one then
  the other.

Both surfaced within minutes of a real window, which is the cycle's standing lesson: the defects that
mattered were never found by the suite.

A third thing this exposed, kept because it is the useful part: **a fake that answers a question it
was never taught is the same defect as one that lies.** The status-only fake manager is a `Proxy`
whose catch-all returns a no-op subscription for any `onDid*` key. The moment the host began asking
`typeof manager.onDidBecomeIdle === 'function'`, every fake in the file answered *yes*, every test
silently moved onto the signal path, and the fallback branch stopped being exercised at all. It
surfaced only because two unrelated-looking tests went red.

---

## 6. Falsifiable claims — go at these

Each is meant to be checkable against the code or the logs. If one is wrong, say which and why.

| # | Claim | Where to check |
| --- | --- | --- |
| 1 | `attachManager` being handed the manager it already holds is always a no-op, and no caller depends on the old rebuild | `ChatSessionHost.attachManager`; grep every `attachManager(` call site |
| 2 | Idempotence is safer than deleting `ensureStarted`'s call, because both callers are reachable independently | `wireManagerEvents`, `ensureStarted`, `handleNewSession`, `handleSwitchSession` |
| 3 | The host's surface routing survived defect A, so defect A cannot explain the missing chips | the 28 `[ImageResolve]` lines argument in §3 |
| 4 | The manager was never disposed on the same-manager path | zero `Stopping SDK session manager…` in `3-13-lost-tools-on-change.log` |
| 5 | The live tool record is value-identical to the replayed one for start, complete, and truncation | `tests/unit/extension/host-records-tools.test.js` |
| 6 | Upsert-by-`toolCallId` is correct, and a tool event with no `toolCallId` is better dropped than appended | `SessionState.recordTool`, `ChatSessionHost.recordTool` |
| 7 | Capping live results at 2,000 chars loses nothing a user could see, because the *surface* still gets the full payload | `ChatSessionHost.recordTool` — cap applies to the copy, not to `notifyToolStart` |
| 8 | Recording on the host rather than the surface is right, and the asymmetry with `addAssistantMessage` is acceptable for now | §4(b) |
| 9 | `sendInit()` on a live session is routine, not exotic | 11 attaches / 7 inits in one session |
| 10 | Sub-agent tools should be recorded with their `agentId` rather than skipped | `buildSessionTranscript` sets `message.agentId`; `main.js:628` passes it through |

### Where I am least confident

- **Claim 3.** It is an inference from co-registration, not a direct observation. The webview already
  logs `[Tool Start] Received payload:` (`main.js:458`), so a webview console from a recurrence would
  settle it outright. It has not recurred since the reboot.
- **Claim 7.** The cap is applied to the recorded copy only. If any consumer reads the *transcript's*
  result expecting the full text, this silently shortens it. I believe there is no such consumer;
  worth a second pair of eyes.
- **Claim 10.** Recording sub-agent tools means they now appear in `host.state`. Whether the webview
  filters `agentId` content out of the main transcript on init is the webview's business, and the
  replay path already had this exact behaviour — so this changes nothing relative to replay. But if
  the dock and the transcript disagree, this is where to look.
- **Memory.** Capping bounds each result at 2 KB, but nothing bounds the *number* of tool messages a
  long session accumulates. A 500-tool session is ~1 MB of transcript, sent whole on every init.
  Acceptable now; a real ceiling if sessions get much longer.

---

## 7. Reproducing

**Defect B, before the fix** (worth confirming the fix actually closes it):

1. Start a session, send something that runs several tools. Chips render.
2. Collapse the Copilot CLI sidebar container, then reopen it.
3. Before: the conversation returns with every chip gone. After: chips survive.

**Defect A, before the fix:** open a chat *tab*, run a tool, and grep the Output Channel for
`[Tool Start] ` with a bare tool name. Before: absent. After: one per tool.

**Suite:** 2,159 passing over three consecutive runs. New coverage in
`tests/unit/extension/host-records-tools.test.js` and the "attaching the same manager twice" block of
`tests/unit/extension/chat-session-host-manager-lifetime.test.js`.

---

## 8. Independent review — Copilot CLI, 2026-08-23

Reviewed and blessed, with the root cause reached **independently** from the same log. Their
write-up lives at the end of `3-13-final-uat-test.md`, beside this file (see the provenance note at
the top of it). Worth reading: it identifies the double-attach, the release of
`ownManagerSubscription` entries, and the `[Tool Start]` double-line signature without having been
told any of it, and it confirms object-identity (`===`) is the right test — same instance is a no-op,
a different instance from a restart or session switch is a real replacement.

They also verified the five new cases in `chat-session-host-manager-lifetime.test.js` cover the
failure modes the guard introduces, and cited the fix commit (`6b3d65c`) correctly.

### One claim in it does not hold, and it is claim 3 again

> *"Tab tools not rendering — session `474592bb` ran 4 tool calls … that executed successfully on the
> CLI side but produced no tool chips in the tab UI."*

**Nobody observed that.** The run this log captures is the one reported as *"everything appeared to
run beautifully"*; the missing chips were seen later, in a different run, on a different session
(`568a63d0`). The claim is an **inference from the absent window-handler line** — and that inference
is precisely the conflation §3 exists to reject:

> the window-scoped handler and the chip-rendering path are different subscriptions. The host's own
> routing was torn down and **re-added** by the second attach. The 28 `[ImageResolve]` lines during
> the chip-less window prove it was alive.

So two reviewers have now independently drawn the same wrong conclusion from the same absence, which
is a decent sign that the absence *looks* like the explanation. It is not. If anything this
strengthens the case for keeping claim 3 flagged as unproven rather than quietly retiring it: the
missing chips remain **unexplained**, and a reboot is what cleared them.

### Where that leaves things

| | |
| --- | --- |
| Defect A — root cause | **confirmed twice, independently** |
| Defect A — fix and its tests | **reviewed and endorsed** |
| Defect A explains the missing chips | **no** — asserted by both reviewers, supported by neither |
| The missing chips | **still unexplained.** Not seen since; the webview console (`main.js:458`) settles it if it recurs |
