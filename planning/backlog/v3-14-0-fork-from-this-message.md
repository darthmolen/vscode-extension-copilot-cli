
---

## 3.13 Post-Mortem: Watch Items & Pushbacks

*Added 2026-08-22 after reviewing the 3.13 file growth diff.*

### Watch: `ChatSessionHost.ts` growing toward god object

`ChatSessionHost.ts` is currently **970 lines**. It replaced `chatViewProvider.ts` as the conversation nexus, and the vscode-free boundary is real discipline — but at that size it is on track to become the new god object. Watch for 3.14 pulling more into it. If it crosses ~1,200 lines, it needs a design pass.

### Pushbacks: Three over-extracted files in `session/`

Three files in `src/extension/session/` have good logic but don't justify standalone files:

**`sessionBootstrap.ts` (50 lines)** — Two trivial delegation functions (`recordSessionStart`, `loadTranscriptInto`) that just call through to `ChatSessionHost` methods. The comment's own testability justification is circular: `ChatSessionHost` is already vscode-free. These belong as methods on `ChatSessionHost` directly.

**`sessionToResume.ts` (42 lines)** — A single 5-line pure function (`chooseSessionToResume`). The "recorded beats mtime" precedence rule is correct and worth keeping, but a private function in `SessionService` is the right home.

**`sessionModel.ts` (36 lines)** — `chooseStartupModel` is a one-liner. Same story. Could be a private function in `SDKSessionManager` or `SessionService`.

Combined: ~128 lines across 3 files that add import graph weight without encapsulating meaningful logic. Candidates to fold in next time those files are touched anyway.

---

## Plan Review

**Reviewed:** 2026-08-16 13:41
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

**Context section — forward reference analysis.** The parentId/forward-ref table is one of the best plan artifacts I've seen. Rather than asserting "chain integrity holds," it specifies the exact property that matters (zero forward references), cites measured data from four live sessions, and explicitly strikes the wrong claim (every parent resolves) rather than ignoring it. This is directly verifiable and an implementer cannot mistake what the unit test must assert.

**Capability gate deletion argument.** The argument is grounded in what the fallback *can* do (truncate), not in speculation. The plan identifies the original reason for the gate, shows it no longer holds, and derives deletion from that — rather than the reflexive "add a capability flag" solution. The S3/C3 back-reference is traceable.

**Spike-first with explicit stop gates.** Task 1's three open questions are distinguished from settled upstream facts (with line citations to `rpc_session_state.e2e.test.ts:603–670`), which prevents the spike from re-proving things already in evidence. The gate "if (1) or (3) contradict expectations, stop and re-plan" is clear and correctly placed before Task 3.

**All key claims verified against the codebase:**
- `sdkSessionManager.ts:1639` — `forkSession` confirmed (plan cites :1640, off by one, irrelevant)
- `forkSession.ts:41` — `fork` as injected `ForkSessionDeps` dep confirmed
- `ForkSessionPayload` — `{ type: 'forkSession' }` with no fields, confirmed
- `ManagedClient` at `CopilotClientProvider.ts:29-32` — `{ start, stop }` only, confirmed
- `events.jsonl` key structure — `['data','id','parentId','timestamp','type']`, confirmed against live session
- No per-message action row or `data-` identity on bubbles beyond timestamp — confirmed from `addMessage` at :272+

---

### Issues

#### Critical (Must Address Before Implementation)

None.

---

#### Important (Should Address)

**I1 — `chatViewProvider.ts` and `extension.ts` are missing from the critical files table**

**Section:** Task 4 / Critical files table

The `messageIndex` from `ForkSessionPayload` must flow through two intermediate layers that are not listed:

1. `chatViewProvider.ts:559` — the `onForkSession` handler is currently `() => { this._onDidRequestForkSession.fire(); }`. The `void` arrow signature silently drops all payload. `_onDidRequestForkSession` at :65 is typed `EventEmitter<void>` and `onDidRequestForkSession` at :77 fires `void`.
2. `extension.ts:284` — the subscriber is `async () => { await forkCurrentSession({...}) }` — again `void`, no payload forwarded.

An implementer who reads only the critical files table implements the webview side and `commands/forkSession.ts` correctly, and `messageIndex` is still silently dropped at `chatViewProvider.ts:559`. The plan describes the webview flow precisely but stops there, never tracing the extension-side leg.

**Why it matters:** Both files are Lane B owned, so there's no lane conflict. The omission causes silent data loss, not a crash — which makes it harder to catch in testing until the e2e step.

**Suggested fix:** Add `chatViewProvider.ts` (typed event emitter and handler) and `extension.ts` (subscriber forwarding index to `forkCurrentSession`) to the critical files table with a one-line description of the required change.

---

**I2 — `ForkSessionDeps` widening is not called out**

**Section:** Task 3 / Critical files table (`commands/forkSession.ts`)

`ForkSessionDeps` at `forkSession.ts:22-27` currently declares `fork(sessionId: string, opts: { sessionStateDir: string }): Promise<string>`. Task 3 says `commands/forkSession.ts` will "resolve index → eventId, pass through," which requires:

- A `resolveEventId` (or similar) function added to `ForkSessionDeps`, injected from `SessionService.resolveEventIdForMessageIndex` at the `extension.ts` composition root.
- `opts` widened to include `toEventId?: string`.

Neither change is mentioned. The plan names the file and describes the outcome but not the interface changes. `extension.ts` is the construction site where both additions land — another reason it belongs in the critical files table (see I1).

**Why it matters:** Without `resolveEventIdForMessageIndex` in `ForkSessionDeps`, `forkCurrentSession` has no way to call it; the index arrives as a `number` and goes nowhere.

---

#### Minor (Consider)

**m1 — Confirmation copy is required but unspecified**

**Section:** Task 5

Task 5 states "the label must say the fork stops *before* that message, since the exclusive boundary is the one thing users will get wrong" — a functional requirement on the confirmation dialog. No example text is provided. An implementer must invent copy that correctly communicates the exclusive boundary semantic. Given that the plan explicitly identifies user confusion as the risk, leaving copy to the implementer is a gap worth flagging.

---

### Recommendations

The coordination section recommends merging S4 now and not bundling S5. That's the right call for the stated reason (preserving the sync-point discipline), backed by the work order's collision-point analysis.

One thing worth confirming before Task 2 implementation: the unit test plan correctly excludes "every parent resolves" as an assertion. Make sure the fixture `events.jsonl` used in `resolveEventIdForMessageIndex`'s test includes dangling-parent records (11–28% in real data), otherwise the test passes on a clean fixture that no real session resembles.

---

### Assessment

**Implementable as written?** With fixes

**Reasoning:** The architecture is sound and all referenced APIs exist exactly as claimed. The one concrete gap is that `chatViewProvider.ts` and `extension.ts` — both Lane B files — are absent from the critical files table, creating a silent data-loss path for `messageIndex` that an implementer working from the table alone would miss. Adding those two files to the table and noting the `ForkSessionDeps` interface widening closes the gap without changing any design decision.
