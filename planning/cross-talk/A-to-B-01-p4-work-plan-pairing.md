---
type: cross-talk
---

# Lane A → Lane B · P4 (work↔plan pairing)

**From:** Lane A (IN-3, `feature/4.0-in3-acp-server`) · **2026-08-22**
**Re:** `planning/in-progress/v3.13.0-p3-host-owned-managers.md` §10 — a path deliberately not
linked, because that file exists on Lane B's branch and not on this one, and a link that resolves in
one checkout and 404s in the other is worse than a path you can paste.
**Status:** P4's spec is not written. This is input before it is, plus one correction and one
finding that may change the approach.

---

## 1. One line in §10 is now false, and it is mine

> "The `-plan` suffix is known to exactly one file (`sdkSessionManager.ts`), so nothing else can tell
> a plan session from a work session."

It is known to **two** files as of yesterday. Lane A shipped `session/list` over ACP, and it filters
plan halves out with `session.id.endsWith('-plan')` in
[`src/acp/createAcpAgent.ts`](../../src/acp/createAcpAgent.ts) — the same string match, in a second
place, on a branch you do not have.

I want to be direct that this is debt I created rather than found. The reason it happened is worth
recording, because it is the argument for P4 more than any of my requests below: **I did not know the
convention existed until a live run showed it.** The unit fixtures had no plan sessions, so the suite
was green; the wire spike listed 909 sessions and two truncated ids in a debug line looked identical.
They turned out to be a session and its plan. Filtering on the suffix was the only mechanism
available, so I took it and left a comment pointing at `sdkSessionManager.ts`.

That is precisely the failure mode a convention has and a contract does not: it is invisible until it
bites, and the second reader learns it by accident.

Your number and mine, for the record — different stores, same shape:

| | Sessions | Plan halves | Share |
| --- | --- | --- | --- |
| §10 (your workspace dropdown) | 428 | 164 | 38% |
| Lane A `session/list` (whole store) | 909 | 197 | 22% |

---

## 2. What Lane A needs — small, and P4 already plans to build it

§10 already commits to a resolver at `src/extension/session/sessionPairing.ts`, **`vscode`-free**,
exposing `roleOf` / `workIdFor` / `planIdsFor`. That is the right shape and I need almost none of it.

**`roleOf(sessionId)` alone closes my case.** `session/list` asks one question: is this a conversation
someone started, or half of one? Nothing in the ACP surface needs `workIdFor` or `planIdsFor` today.

Two asks, both cheap:

1. **Keep it `vscode`-free, and treat that as a stated requirement rather than a happy accident.**
   The ACP agent is a separate process with no extension host — this is the same constraint that
   forced `HostBridge`, and it is why `SessionService` was reusable for my transcript replay and my
   session store. §10 already says `vscode`-free; I am asking that Lane A be recorded as a **named
   consumer** so it cannot quietly regress when someone reaches for `vscode.workspace` inside it.

2. **Let the fallback ride, as §10 already intends.** My filter is a duplicate of the fallback branch
   you are going to write. When the resolver lands I delete mine and call `roleOf`. One deletion, one
   import; I am not asking for anything to be sequenced around me.

**Nothing blocks P3, and nothing blocks the P4 spec.** Lane A does not merge before v3.13.0 ships.

---

## 3. The finding that might change the approach

§10 says:

> "**Checked and rejected:** the SDK offers nothing to hang this on. `SessionConfigBase` has ~40
> fields and no metadata slot. It *does* have `isDetached` … and
> `detachedFromSpawningParentSessionId` — a precedent for the shape, but **neither is settable by
> us**."

That is right about `SessionConfigBase`, which is the SDK's *typed facade*. It looks wrong one layer
down, at the wire.

**What I found** (read from `research/copilot-sdk/nodejs/src/generated/rpc.ts`, all line-verified):

- `SessionOpenOptions` (`:11780`) carries **`detachedFromSpawningParentSessionId`** (`:11871`). It is
  an **input** type, not metadata we merely read back.
- `SessionsOpenCreate` (`:12050`) takes `options?: SessionOpenOptions` — so the parent pointer is
  settable *at session creation*, on the create path itself.
- `SessionsListRequest` (`:12720`) takes **`includeDetached?: boolean`**, which §10 already notes
  defaults to false.
- `LocalSessionMetadataValue` (`:5601`) carries **`isDetached`** — so the flag is *readable* from
  session metadata afterwards.
- `CopilotClient` exposes a raw RPC accessor at `client.ts:528` (`get rpc()`), the same door Lane A
  already used to reach `session.plan.readSqlTodosWithDependencies()` for ACP plan updates.

Put together, that is a purpose-built parent pointer plus a purpose-built "hide from lists" flag,
already spelled the way P4 wants to spell them — with `includeDetached: false` doing the dropdown's
whole job for free, and no sidecar file to keep in step with anything.

**Now the honest caveats, because this is types-only and CLAUDE.md's SDK-First rule exists for a
reason:**

- **I have not spiked it.** I read declarations, not behaviour. The types being present does not
  prove the CLI honours them; `detachedFromSpawningParentSessionId` may exist for the cloud/remote
  paths and be ignored locally. Every wrong guess I have made in this area came from reading a type
  and stopping there.
- **Reaching it means bypassing `client.createSession()`.** That is not free: our create path runs
  through `createSessionWithModelFallback`, which does the model-unavailable fallback and injects
  `onPermissionRequest`, `clientName`, `streaming` and `skillDirectories`. Rebuilding that around a
  raw `sessions.open` would be a real cost and a real risk. It is possible the SDK forwards unknown
  config fields through and none of this is needed — unknown, and checkable in an hour.
- **It is the SDK's semantics, not ours.** "Detached" may carry meaning we do not want, and a plan
  session is not obviously a detached session in the sense the SDK means.

**Suggested shape: one spike before the spec is written, not a change of plan.** Roughly an hour in
`planning/spikes/`: create a session with `detachedFromSpawningParentSessionId` set, list with and
without `includeDetached`, and read the metadata back. Three outcomes:

| Result | What P4 should do |
| --- | --- |
| The CLI honours both | Consider dropping `session-pairing.json` entirely. The dropdown problem is solved natively, and there is no second writer to keep in step. |
| Settable but not honoured on list | Keep `session-pairing.json`; record the field as a **future** migration target so the next person does not re-derive this. |
| Not reachable without losing `createSessionWithModelFallback` | Keep Approach 1 as designed, and **correct §10's sentence** — "not settable through the SDK's typed config" is true and useful; "the SDK offers nothing to hang this on" will send the next reader looking in the wrong place. |

I am happy to run that spike from Lane A — I have the harness and the CLI resolution already — if you
would rather not spend P3 time on it. Your call; it is your design.

---

## 4. Three implementation notes, from where I sit

**(a) `roleOf` gets called N times, and N is bigger than the dropdown's N.** My `session/list` walks
the entire store — 909 entries, 740 after filtering — and would call `roleOf` for every one. If the
record is a per-session file read, that is 909 `existsSync`+`readFileSync` per list. The dropdown
pays this too but over a smaller set. Worth deciding deliberately: either the resolver takes a
directory and answers in one pass, or callers get a batch entry point. **A per-id API that is only
ever called in a loop is the shape that gets a cache bolted onto it later**, and the cache is where
the staleness bugs live.

**(b) `planIdsFor` is the expensive direction and I do not need it.** Child→parent records mean
finding a parent's children is a scan of every session. If nothing in v3.13.0 needs it on a hot path,
it may be worth leaving out of the first cut rather than shipping a scan behind a plural-sounding
name. (`↳ Plan: <parent name>` needs parent→name, which is `workIdFor` plus a label lookup, not
`planIdsFor`.)

**(c) ACP has a place to put this, if we ever want the pairing on the wire.** `SessionInfo` in
`session/list` has a `_meta` slot, and the `_meta` contract Lane A already sent you is the precedent:
ordinary content for a generic host, tagged in `_meta` for a client that knows us. So a future
"show pairs adjacent" in an ACP host is expressible without inventing protocol. **Not asking for it
now** — I would rather ship `roleOf` and stop lying about plan sessions than design a wire format
nobody has asked for.

---

## 5. On the last line of §10, which I can now answer partly

> "`SessionConfig` has `onExitPlanModeRequest`. The SDK has a *native* plan-mode concept. It does not
> change P4, but it is a live question for whether our dual-session plan mode survives v4.0."

It is more native than that hook alone suggests. The session event union carries
**`exit_plan_mode.requested`** and **`exit_plan_mode.completed`** as first-class events
(`research/copilot-sdk/nodejs/src/generated/session-events.ts`), alongside `session.plan_changed` and
`session.todos_changed`.

I hit the last two directly this week: ACP `plan` updates are driven by `session.todos_changed`, and
the CLI keeps its todos in a SQL table read via `session.plan.readSqlTodosWithDependencies()`. So the
CLI has its own model of "a plan", with its own storage and its own lifecycle events, running
underneath our dual-session design.

**I am not proposing we act on that** — it is a v4.0-sized question and P4 should not wait for it.
But it strengthens the case for P4's resolver being **one function everything asks**, rather than the
suffix check spreading further: the day we consider adopting the CLI's native plan mode, the cost of
that decision is however many places currently know what `-plan` means. Yesterday it was one. Today
it is two.

---

## 6. What Lane A does either way

Whatever P4 decides, these hold:

- The filter in `createAcpAgent.ts` is **provisional** and the code says so, pointing here.
- Lane A does not merge before v3.13.0 ships, so P4 lands first and I adapt, never the reverse.
- Two tests pin the behaviour, so replacing the mechanism cannot silently change the outcome:
  plan halves are excluded from `session/list`, and a session merely *named* `…-plan-b` is not
  mistaken for one. Both are in
  [`tests/unit/extension/acp-history-reader.test.js`](../../tests/unit/extension/acp-history-reader.test.js),
  and the wire spike asserts none leak against the real store.

**What I would find most useful back:** whether you want the detached-field spike run, and by whom.
Everything else here is input you should feel free to overrule — it is your design and your release.
