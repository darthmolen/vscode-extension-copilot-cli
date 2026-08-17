---
type: plan
---

# v3.13.0 P2 — Tool Replay and the Message Contract

**This is a re-review of one prerequisite, not the whole plan.** The parent plan
(`planning/in-progress/v3.13.0-chat-in-a-tab.md`, reviewed at
`planning/needs-review/completed/2026-08-16-v3-13-0-chat-in-a-tab.md`) carries P2 as a hard blocker on
Task 7. Investigation since that review found **the premise of the fix was wrong in a way that makes
the fix smaller**, and turned up a divergence nobody had recorded. The scope moved enough to be worth
a second pass.

**Reviewed 2026-08-17 — "implementable with fixes".** The three critical findings (unspecified
rendering path, a false SubagentDock routing claim, and a deletion that would have broken live tools)
are folded in below, along with a spike that cleared the one blocking unknown. Two further changes are
ours, not the reviewer's: tool messages carry a `ToolState` instead of an invented status vocabulary
(§5.1), and results load lazily (§5.4).

Nothing here is implemented. No code has changed.

---

## 1. The symptom, unchanged

Reload the sidebar on a session with tool calls and the transcript comes back as a wall of identical
bubbles reading **"Tool execution"**, each frozen at *running*. Observed live:
`[Init] Sending 61 messages to webview`.

Task 7 restores a tab through `registerWebviewPanelSerializer`, which uses this same replay path — so
tab restore inherits the bug wholesale. That is why P2 gates Task 7.

## 2. What was believed, and what is actually true

The reviewed plan diagnosed this as a **type problem with a persistence tail**: widen the wire
`Message`, then separately teach ourselves to persist tool status transitions so replay isn't frozen.
It concluded "faithful replay" would need a new data structure of our own.

**That last conclusion is false.** The CLI already records the complete tool lifecycle, with outcomes,
in the session event log. Measured on a real session (`af36eb01`, 469 events):

| Event | Count | Payload |
| --- | --- | --- |
| `tool.execution_start` | 48 | `data.toolCallId`, `.toolName`, `.arguments`, `.model`, `.turnId` |
| `tool.execution_complete` | 48 | `data.toolCallId`, **`.success`**, `.result`, `.error` (failures), telemetry |

Joined on `toolCallId`, that is name, arguments and **final status** — strictly more than the
`status: 'running'` we write ourselves and never update.

Two further measurements on the same file:

- **26 of the 48** `tool.execution_start` events carry **`agentId`** (at the event level, not under
  `data`). Sub-agent tool calls stay *distinguishable* in the log — though not routable to the dock on
  replay; see §5.3's C2 correction.
- **Zero** events carry `ephemeral: true`. The SDK defines that flag as "transient and not persisted"
  (`generated/session-events.ts:4150`); nothing in this session used it.

So the data was always there. **The defect is in our reader**, not our persistence:
`SessionService.loadSessionHistory` (`src/extension/services/SessionService.ts:256-300`) parses
`user.message` and `assistant.message` and silently drops every other event type.

## 3. The type incompatibility, restated with lines

`src/backendState.ts:22-29` versus `src/shared/models.ts:21-27` — the wire contract:

| | backend `Message` | wire `Message` |
| --- | --- | --- |
| `role` | `user \| assistant \| system` | `user \| assistant \| reasoning \| tool` |
| `type` | **required**, `user \| assistant \| reasoning \| tool \| error` | optional, **no `tool`, no `error`** |
| `toolName`, `status` | present | **absent** |

Neither is assignable to the other — `system` exists only on the backend, `reasoning` only on the
wire. Because the wire type cannot express a tool message, `src/webview/main.js:609` does:

```js
const role = msg.type || msg.role;
```

It smuggles `type` through the `role` field and drops `toolName` and `status`. That line is a symptom
of an unrepresentable contract, not a bug on its own.

Underneath sits a modelling error: `role` and `type` encode overlapping things. They collide on
`user`/`assistant`/`reasoning` and diverge exactly where it matters — `tool` and `error` are *bubble
kinds with no speaker*; `system` is a *speaker with no bubble kind*.

### Why it ended up this way

Tools were built as **ephemeral UI events**, and the front-end still treats them as a separate
species: `toolStart` → `tool:start` → the `ToolExecution` component (grouping, mutable status,
`agentId` suppression), entirely disjoint from `message:add` → `MessageDisplay`. The only wire between
them is `ToolExecution.js:35-43` listening to `message:add` to know when to *close* a group.

When persistence was needed, tool calls were written into the message store without extending the wire
contract. `git log -S` puts both the `type: 'tool'` side-write and its `storeInBackend: boolean = true`
opt-out in a single commit — `d89376c`, *"Release 2.1.1: Fix active file persistence and session
management."* Added while fixing session persistence, not while designing tool rendering. The opt-out
parameter is the tell.

## 4. Finding not in the reviewed plan: two replay paths that disagree

| Trigger | Source | Tools replay as |
| --- | --- | --- |
| Session switch → `extension.ts:1011` | JSONL via `loadSessionHistory` | **absent** — filtered out, and every surviving message is rewritten to `type: user \| assistant` |
| Webview re-init → `getFullState()` → `sendInit` | in-memory `SessionState` | the wall of "Tool execution" |

The same session has two different histories depending on how you arrived at it. Switch sessions and
tools vanish; hide and show the sidebar and they return broken.

**This is the part that most affects Task 7:** a tab serializer must pick one of these, and picking
either as-is ships one of the two bugs. The fix is to make them the same reader.

## 5. Proposed design

### 5.1 One discriminant — and no invented tool vocabulary

Replace the `role`/`type` pair on the wire with a single field:

```ts
export interface Message {
    kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'error' | 'system';
    content: string;
    timestamp: number;
    attachments?: Attachment[];
    /** Present only when kind === 'tool'. The *live* ToolState shape, not a paraphrase. */
    tool?: ToolState;
    agentId?: string;
}
```

`role` is kept as a deprecated alias for the whole v3.13.0 release — the reviewer's condition, and it
is load-bearing: `ToolExecution.js:35-43` closes tool groups on `message.role === 'assistant'`, so
dropping `role` silently breaks grouping in the **live** path. Removing the alias is a separate task
that must update that check first.

**A tool message carries a `ToolState`; it does not get `toolName`/`status` fields of its own.** The
earlier draft added them, which meant translating into a third vocabulary. There are three dialects
for one concept:

| Dialect | Owner | Who speaks it |
| --- | --- | --- |
| `data.success` boolean + `data.error` | **the CLI** — not ours | the event log |
| `ToolState.status`: `pending \| running \| complete \| failed` | ours | the live path, `buildToolHtml`, `main.js:465` |
| `Message.status`: `running \| success \| error` | ours, invented in `backendState.ts` | **nobody** |

The third is **write-only** — `git grep` finds `toolName`/`status` written once, at
`chatViewProvider.ts:445`, and read nowhere in the tree. It exists only because a tool execution was
shoehorned into a `Message` and the field had to be filled. Mapping into it is work in service of
nothing, so it goes.

What remains is **one** conversion, `data.success → complete | failed`, and that is not mapping
between our dialects — it is parsing the CLI's format at the system boundary, where the log has no
status field and never will because we do not own it. One derivation, at the edge, into the single
vocabulary the renderer already speaks.

**Rejected: a discriminated union** (`ChatMessage | ToolMessage | ErrorMessage`). Better TypeScript,
but the webview is untyped JS, so the safety lands only where things already compile.

### 5.2 One reader, tool-aware — `SessionEventReader`

**Home:** `src/extension/services/SessionEventReader.ts`, exporting
`buildSessionHistory(eventsPath: string, options?): Promise<Message[]>`. Named for what it reads, per
CLAUDE.md, and a free function rather than a method because **ACP's `session/load` is a third caller
in another process** (§8a).

Tool entries are built by joining `tool.execution_start` with `tool.execution_complete` on
`toolCallId`. **Every field is under `data`** — verified across two sessions, `toolCallId` appeared at
the top level zero times, so it is `event.data.toolCallId`, `event.data.success`. The one exception is
`agentId`, which sits at the **event** level.

| Source | Becomes |
| --- | --- |
| `start.data.toolName`, `.arguments` | `tool.toolName`, `tool.arguments` |
| `complete.data.success` | `tool.status` = `complete` \| `failed` |
| `complete.data.error.message` | `tool.error` — present on failures, `{ message, code }` |
| start with no matching complete | `tool.status` = `running` — truthful; it was interrupted |
| `event.agentId` (start) | `message.agentId` |
| start/complete `timestamp` | `tool.startTime` / `tool.endTime`, so replayed chips show real durations |

**Not carried:** `result`. See §5.4. **Not set:** `hasDiff` — the *View Diff* button points at
snapshot temp files that `cleanupSnapshot` deletes immediately after the live diff renders, so a
replayed button would be dead on arrival.

`options` takes `limit` / `fromEnd` from the outset. Not needed at the observed scale (61 messages, 48
tools) but the SDK's own `session.eventLog.read` is cursor-paged with a `types` filter and a
1000-event cap — that is the platform telling us long histories get paged, and a parameter now is
cheaper than a rewrite later.

**The reader must not assume a fixed key set.** `shellToolInfo` appears only for shell tools,
`parentToolCallId` only under sub-agents, `error` only on failures. Read the fields you need; ignore
the rest.

### 5.3 One replay source, and one renderer

`getFullState()` stops being a second, lossier copy of the event log. Both triggers in §4 go through
`buildSessionHistory`. Then:

- **`addToolExecution` keeps its `rpcRouter.toolStart(...)` call** and loses only the
  `backendState.addMessage(...)` branch and the `storeInBackend` parameter. Deleting the method
  outright — as the earlier draft said — would take the **live** tool path with it.
- `src/webview/main.js:605-614` stops collapsing `type` into `role` and forwards `kind`, `tool`,
  `agentId`, and the message's own `timestamp` (today it overwrites with `Date.now()`).

**Rendering (the reviewer's C1).** `MessageDisplay` renders a `kind: 'tool'` entry through its
existing `ToolExecution` child's **`buildToolHtml(toolState)`**, and calls nothing else on it.

That method is a pure function of `toolState` — it reads no `this.tools`, no group state, no
lifecycle. The lifecycle lives in `handleToolStart` / `getOrCreateToolGroup` / `addOrUpdateTool`,
which replay never touches. So:

- the same visual language as live, rather than a second chip design to maintain;
- **no synthetic `tool:start` events**, so live rendering is untouched (§9 holds);
- flat, not grouped — grouping *is* the lifecycle we are not calling, which is what makes the
  reviewer's Decision 3 fall out for free rather than needing enforcement;
- CLAUDE.md's hierarchy holds: `MessageDisplay` already owns the `ToolExecution` child.

This is why §5.1 carries a `ToolState`: the renderer already speaks that vocabulary, so the webview
does no translation at all.

**Sub-agents (the reviewer's C2 — the earlier claim was wrong).** `SubagentDock` subscribes to
`subagent:start`/`message`/`complete` and `tool:start`/`complete`/`progress`. It **never listens to
`message:add`**, so an `agentId` on a replayed message cannot reach it. The honest outcome: replayed
sub-agent tools appear as flat history in the transcript, and the dock is *not* re-populated, because
its tile lifecycle (`subagent:start`) has no replay counterpart. `agentId` is still carried so a
future task can route on it — separable is not the same as routed.

### 5.4 Results load lazily

`ToolState.result` is the one payload that can be large, and 48 of them would bloat every init.
`buildSessionHistory` therefore omits `result`; the chip renders collapsed, as it already does via
`collapsedCards` and `attachHeaderCollapseListener`.

Expanding a replayed chip fetches its result on demand, keyed by the id the log is already indexed by:

```
init            → { kind:'tool', tool: { toolName, status, arguments, error, startTime, endTime } }
user expands    → rpc.getToolResult(toolCallId) → the matching complete event → result.content
```

One round trip, user-initiated, and replay cost stops scaling with how chatty the tools were. It also
settles §7.2 (`result.content` size) by making it structurally impossible rather than by choosing
between fidelity and payload.

## 6. Decisions — settled by review 2026-08-17

| # | Ruling |
| --- | --- |
| 1. Message shape | **Ratified**, with the condition that `role` survives as a deprecated alias for the whole release (`ToolExecution.js:35-43` closes groups on it, in the *live* path). `agentId` belongs on `Message`. Amended further by us: no `toolName`/`status` fields — a tool message carries a `ToolState`, §5.1 |
| 2. SDK read vs file read | **JSONL endorsed.** `getEvents()` goes over a live RPC connection and throws when disconnected (`session.ts:1260`), and replay is needed precisely for non-live sessions. `forkSession` already treats `events.jsonl` as load-bearing. Not a workaround — the correct architecture for offline replay |
| 3. Grouping fidelity | **Flat.** And under §5.3's rendering decision it is free: grouping lives in the lifecycle replay does not call |

## 7. Verification status of the open risks

| Risk | State |
| --- | --- |
| **Extension-authored sessions** | ✅ **Cleared by spike** (`planning/spikes/tool-replay-reader/`). An extension-created plan session logs our own custom tools — `plan_bash_explore`, `update_work_plan`, `present_plan` — exactly like built-ins: 38 starts, 38 completes, 38 joined, every field under `data`, `toolCallId` never top-level. The reviewer's assumption that `producer` distinguishes hosts does **not** hold: every session reports `producer: "copilot-agent"`, because that is the CLI labelling itself |
| **`result.content` size** | ✅ **Resolved structurally** by §5.4 — results are never carried on init |
| **Compaction** | Open, does not block. A start whose complete was compacted away replays as `running`, which is a graceful outcome rather than a crash. `eventLog.read` reports `cursorStatus: 'expired'` for the same situation, so the platform expects it too |
| **Replay cost at scale** | Does not block at 61 messages / 48 tools; §5.2's `limit`/`fromEnd` is the seam if it ever does |

**New from the spike, and not in any earlier draft:**

- `data.error` exists on failed completes — `{ message, code }`, with `result: null`. `buildToolHtml`
  already renders `toolState.error`, so a replayed failure can say *why* it failed with no renderer
  change.
- `parentToolCallId` exists on sub-agent tool events. Unused here, but it is the field IN-7
  (arbitrary sub-agent nesting) would be built on.

## 8. Verification

TDD per CLAUDE.md — test first, seen to fail.

1. **Reader unit tests** against fixture `events.jsonl`, including the two cases the original evidence
   never covered: a **failed** tool (`success: false` with `data.error`) and a **plan-mode custom
   tool**. Plus: start+complete → `complete`; unmatched start → `running`; `agentId` preserved;
   non-tool events unaffected; `result` **absent**; `hasDiff` unset.
2. **Contract test** that the same session replays identically through both §4 triggers — the
   regression test for the divergence.
3. **Round-trip test**: `kind: 'tool'` with its `ToolState` survives `getFullState()` → `sendInit` →
   `handleInitMessage` intact — **including `timestamp`**, which `main.js:613` currently overwrites
   with `Date.now()`. Without that assertion the test passes on wrong timestamps.
4. **Webview test**: a replayed tool entry renders through `buildToolHtml` with the real tool name and
   final status icon, and **no** `tool:start` is emitted (the live path stays untouched).
5. **Lazy-result test**: expanding a replayed chip issues one `getToolResult` and renders the body;
   init carries no result.
6. Suite / `check-types` / `lint` / `node esbuild.js` green. **The suite is flaky in a documented way
   — a failure counts only if it also fails when its file is run alone** (`npx mocha <file>
   --timeout 20000`).
7. **Manual, in the Extension Development Host:** reload the sidebar on a session with tool calls —
   real tool names, real final statuses, no "Tool execution" wall; expand a chip and see its output
   arrive; switch away and back and get the same transcript.

## 8a. Addendum after queueing — a third caller (2026-08-16)

**This arrived after the file was copied for review.** It does not change the diagnosis, and it
strengthens §5.3.

Lane A (IN-3, the ACP agent) reports that **§5.2's reader is their scope item 2, `session/load`** —
ACP's history-replay method. It needs precisely what is described here: tool state rebuilt by joining
`tool.execution_start` with `tool.execution_complete`, `success` supplying status, `agentId` keeping
sub-agent traffic separable.

Two consequences:

1. **The reader must land as a reusable function**, not inline in the session-switch path, or a third
   reader grows in another process. Add that to what §8's tests should pin.
2. **"Make them one reader" is now correct independently of Task 7.** The reviewer can weigh §5.3
   without treating tab restore as its only justification — there is a caller outside this extension
   that needs the same behaviour.

Also settled since queueing, and relevant only as context: `ChatSessionHost` will not expose its
manager, and its public surface follows ACP's session verbs (`prompt` / `cancel` / update stream), so
this reader stays on the presentation side of that seam rather than becoming part of it.

## 9. Scope this does not take

- No change to live tool rendering. `tool:start`/`tool:complete` and the `ToolExecution` component are
  untouched.
- No change to `sdkSessionManager.ts` — Lane B does not own it. Should this work turn out to need one,
  it is filed as a spine item instead.
- P1 (concurrent-edit labelling) is unaffected and stays where the parent plan put it, at Task 4.

---

## Plan Review (Second Pass)

**Reviewed:** 2026-08-17 08:35
**Reviewer:** Claude Code (plan-review-intake)

### C1/C2/C3 Resolution Check

**C1 — Resolved.**

`buildToolHtml` exists at `ToolExecution.js:214`. It reads only from the `toolState` parameter — no `this.tools`, no group state, no lifecycle calls. It calls `this.formatArgumentsPreview` and `this.escapeHtml`, but those are stateless helpers reading only their arguments. `MessageDisplay` already creates a `ToolExecution` child per CLAUDE.md hierarchy, so calling `buildToolHtml` on that instance requires no new object construction. The rendering path is complete and the method is callable without touching the lifecycle.

**C2 — Resolved.**

`ToolExecution.js:35-43` confirms the listener fires on `message:add` and calls `closeCurrentToolGroup()` only for user or assistant/reasoning messages with real content. Replayed `kind: 'tool'` entries will trigger this check — benign, since there is no current group to close and `closeCurrentToolGroup()` no-ops when `this.currentToolGroup` is null. The dock concern is resolved and the reasoning is accurate.

**C3 — Resolved.**

`chatViewProvider.ts:438-451` has exactly two independent branches: `backendState.addMessage(...)` and `this.rpcRouter?.toolStart(toolState)`. Removing the first while leaving the second is a three-line deletion with no coupling risk.

---

### §5.1 `ToolState` on Message — Assessment

**Not sound as written. Must be fixed before implementation.**

The plan asserts "the webview does no translation at all" because the renderer already speaks `ToolState`. This claim is false for the type named `ToolState` in `src/shared/models.ts`.

`models.ts:ToolState` has: `id`, `name`, `input`, `output`, `error: string`.

`buildToolHtml` reads: `toolCallId`, `toolName`, `arguments`, `result`, `error: { message, code }` (an object, not a string).

Every named field is different. If an implementer adds `tool?: ToolState` to `Message` importing from `models.ts` and passes it to `buildToolHtml`, every field will be `undefined` and the chip will render "Tool execution" — the original bug, silently reproduced. No type error (webview is untyped JS), no crash.

The runtime type `buildToolHtml` actually speaks is `ToolExecutionState` in `src/sdkSessionManager.ts:225-238`: `toolCallId`, `toolName`, `arguments`, `status`, `startTime`, `endTime?`, `result?`, `error?: { message, code }`. The `models.ts:ToolState` import on `ExtensionRpcRouter.toolStart` is a type lie that compiles only because `chatViewProvider` uses `any`.

The plan must specify which shape `Message.tool` carries. Three paths forward:
1. Use `ToolExecutionState` directly (move or re-export from `src/shared/`)
2. Update `models.ts:ToolState` to match `ToolExecutionState`'s field names
3. Define a new wire-specific type that maps from `ToolExecutionState` to what `buildToolHtml` reads

Any of these works; none is described.

---

### §5.4 Lazy Loading — Assessment

**Implementable in principle, but two implementation surfaces are unacknowledged. Add detail.**

`rpc.getToolResult(toolCallId)` does not exist — `grep -rn "getToolResult" src/` returns nothing. It needs to be added to `ExtensionRpcRouter` as both a receive handler (webview → extension) and a send handler (extension → webview), with the extension serving results by re-reading the JSONL join.

The expand interaction (`<details>` with `attachHeaderCollapseListener`) is purely synchronous today. To lazy-load, it must distinguish replayed chips (no result, fetch on expand) from live chips (no result because running). This requires a change to the expand handler in `ToolExecution.js` or `MessageDisplay`. Neither surface is mentioned in the plan.

These are real mid-task discoveries, not style notes. A short paragraph naming both surfaces is all that is needed.

---

### Strengths

The spike findings are genuinely load-bearing. All three `FINDINGS.md` corrections landed without a review loop: `data.error` on failures, `parentToolCallId` on sub-agent events, and the variable key-set warning. The §7 risk table is concrete and honest. The §8a addendum (ACP's `session/load` as a third caller) strengthens the free-function architecture for `SessionEventReader` — and it arrives as context rather than a design change.

---

### Issues

#### Critical (Must Address Before Implementation)

**`ToolState` field names do not match `buildToolHtml`'s expectations**
**Section:** §5.1
**Files:** `src/shared/models.ts:41-50` vs `ToolExecution.js:214`

`models.ts:ToolState` uses `{id, name, input, output, error: string}`; `buildToolHtml` reads `{toolCallId, toolName, arguments, result, error: {message, code}}`. Every field name diverges. The renderer will silently receive `undefined` for each field. The correct shape is `ToolExecutionState` in `sdkSessionManager.ts`. The plan must specify which type lives on the wire and reconcile field names before implementation, or the C1 fix regresses silently.

---

#### Important (Should Address)

**§5.4 `rpc.getToolResult` and expand handler are unimplemented and unwired**

`getToolResult` does not exist in `ExtensionRpcRouter` or anywhere in `src/`. The expand handler in `ToolExecution.js` is synchronous with no hook for an async RPC call. Both surfaces need to be named in the plan. A paragraph identifying them (RPC method pair + expand-handler change distinguishing replayed vs. live chips) is all that is needed.

---

#### Minor (Consider)

The `role` alias retirement is noted in §5.1 as "a separate task that must update that check first" but does not appear as a step in the §8 verification checklist — easy to lose track of during implementation.

---

### Assessment

**Implementable as written? No — with fixes.**

The C1/C2/C3 fixes are genuine and the architecture is sound. One targeted correction to §5.1 (naming the correct wire type and reconciling field names) and one paragraph added to §5.4 (naming the two unacknowledged surfaces) would make this ready to hand off.
