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

Reviewer: the question is not "is P2 real" — it is reproduced below with line numbers. The question is
whether **the reframing is right**, whether the **three open decisions** are decided correctly, and
whether anything in *Not yet verified* should block.

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
| `tool.execution_start` | 48 | `toolCallId`, `toolName`, `arguments`, `model`, `turnId` |
| `tool.execution_complete` | 48 | `toolCallId`, **`success: true`**, `result.content`, telemetry |

Joined on `toolCallId`, that is name, arguments and **final status** — strictly more than the
`status: 'running'` we write ourselves and never update.

Two further measurements on the same file:

- **26 of the 48** `tool.execution_start` events carry **`agentId`**. Sub-agent tool calls stay
  distinguishable in the log, so replay can make the same dock-vs-transcript split the live path makes
  (`ToolExecution.js` suppresses `agentId`-tagged tools; `SubagentDock` renders them).
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

### 5.1 One discriminant (agreed in principle, needs the exact shape ratified)

Replace the `role`/`type` pair on the wire with a single field plus optional tool members:

```ts
export interface Message {
    kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'error' | 'system';
    content: string;
    timestamp: number;
    attachments?: Attachment[];
    toolName?: string;
    status?: 'running' | 'success' | 'error';
    agentId?: string;   // present => belongs to the sub-agent dock, not the transcript
}
```

`role` is kept as a deprecated alias for one release so the migration is mechanical rather than a
flag day. `backendState.ts`'s `Message` collapses into this same type — the point is to stop having
two.

**Rejected: a discriminated union** (`ChatMessage | ToolMessage | ErrorMessage`). It is the more
correct TypeScript, and it would confine `toolName`/`status` to the variant that owns them. But the
webview is plain untyped JavaScript, so the safety lands only on the side that already compiles, at
several times the churn. Recorded so the reviewer can overrule it.

### 5.2 One reader, tool-aware

Extend `loadSessionHistory` to emit tool entries by joining `tool.execution_start` with
`tool.execution_complete` on `toolCallId`:

- `kind: 'tool'`, `toolName` from start, `agentId` from start when present.
- `status` from `complete.success` → `success | error`. **A start with no matching complete replays as
  `running`** — that is truthful, it was interrupted.
- `content` keeps the current display string, so nothing about bubble rendering changes shape.

This removes the frozen-at-`running` problem **without adding any state write path**, because the
status comes from the log rather than from us.

### 5.3 One replay source

`getFullState()` stops being a second, lossier copy of the event log. Both triggers in §4 go through
the reader in §5.2. Then:

- Delete the `addToolExecution` side-write and the `storeInBackend` parameter
  (`src/chatViewProvider.ts:434-447`).
- `src/webview/main.js:605-614` stops collapsing `type` into `role` and forwards `kind`, `toolName`,
  `status`, `agentId`.
- Replayed `agentId` entries route to `SubagentDock`, matching live behaviour and the shipped
  principle that sub-agent traffic stays out of the main transcript.

**Net effect on the parent plan:** P2 stops being "widen a type, then add persistence" and becomes
"widen a type, fix the reader, delete a redundant write." Task 7 loses a persistence workstream and
gains a contract change it was already going to make.

## 6. Open decisions for the reviewer

1. **Ratify or replace the §5.1 shape**, including the `role` deprecation window and whether
   `agentId` belongs on `Message` at all (the alternative is a parallel channel keyed by `agentId`,
   which is closer to how live traffic already flows).
2. **SDK read or file read.** The SDK exposes `session.getEvents()` (`session.ts:1272`, over
   `session.getMessages`) and an `@experimental` cursor-based `session.eventLog.read`
   (`generated/rpc.ts:17395-17404`). Both are **methods on a live session object** and the doc comment
   says `getEvents` throws if the session is disconnected. Replay is needed precisely when a session is
   *not* live — Task 6's cases (b) and (c). Recommendation: **keep reading the JSONL**, because
   `SessionService.forkSession` already copies and patches `events.jsonl` and rewrites its
   `session.start` record, so that file is a load-bearing dependency we cannot pretend not to have —
   and use the SDK path only where a live session already exists. This is the one place this plan
   knowingly reads against CLAUDE.md's SDK-first rule, so it should be overruled explicitly if wrong.
3. **What "faithful" owes on grouping.** Live rendering groups consecutive tools into cards and closes
   a group on the next user/assistant message with content. Replay could reproduce grouping from
   `turnId`, which is present on both tool events — or emit flat chips and accept that history looks
   tidier than the live view. Cheaper is flat; more honest is grouped. Not decided.

## 7. Not yet verified

- **Extension-authored sessions.** The measured session's `session.start` reads
  `producer: "copilot-agent"`, `copilotVersion: 1.0.68`. It is a CLI session in this repo, not one
  created by this extension. The event log is written by the CLI in both cases, so the shapes should
  match — but **this must be confirmed against a session the extension created** before building on
  it, and specifically for our plan-mode custom tools, which are registered by us.
- **`result.content` size.** Tool results are stored in full. A large `bash` or file-read result could
  make replay heavy if content is ever surfaced. Current design uses only `success`, not `result`, so
  this is latent rather than active — flagged so it is a decision and not an accident.
- **Compaction.** `session.history.compact` and `assistant.compaction*` events exist. What a compacted
  session's log does to tool-event pairing is unexamined. A `start` whose `complete` was compacted away
  replays as `running` under §5.2, which is at least not a crash.
- No measurement of replay cost at the observed 61-message / 48-tool scale.

## 8. Verification

TDD per CLAUDE.md — test first, seen to fail.

1. **Reader unit tests** against a fixture `events.jsonl`: start+complete pairs to `success`/`error`;
   an unmatched start to `running`; `agentId` preserved; non-tool events unaffected.
2. **Contract test** that the same session replays identically through both §4 triggers — the
   regression test for the divergence.
3. **Round-trip test**: a message with `kind: 'tool'`, `toolName` and `status` survives
   `getFullState()` → `sendInit` → `handleInitMessage` with all fields intact. This is the test that
   would have caught the original bug.
4. **Webview test**: a replayed `agentId` entry reaches the dock, not the transcript.
5. Suite / `check-types` / `lint` / `node esbuild.js` green. **The suite is flaky in a documented way
   — a failure counts only if it also fails when its file is run alone** (`npx mocha <file>
   --timeout 20000`).
6. **Manual, in the Extension Development Host:** reload the sidebar on a session with tool calls —
   real tool names, real final statuses, no "Tool execution" wall; then switch away and back and get
   the same transcript.

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
