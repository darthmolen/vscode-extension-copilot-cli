---
type: plan-review
plan: 2026-06-14-sub-agent-dock-live-status-and-tool-calls.md
reviewed: 2026-06-14
---

# Plan Review: Sub-Agent Dock — Live Status and Tool Calls

## Strengths

- **Spike-grounded design.** Every key decision (attribution via `event.agentId`, shared dock, event-driven completion) cites proven facts from the June 2026 SDK 0.3.0 spikes. No speculation.
- **Concrete file references.** Each task names the exact file and approximate line range to modify, making each task directly actionable without further investigation.
- **Explicit TDD structure.** Every task has a discrete RED (failing test) and GREEN (minimal fix) phase with specific test file names and assertion targets.
- **esbuild.js called out explicitly in Task 5.** This is the most common cause of silent webview failures in this project; the plan does not omit it.
- **Regression guard included (Task 9).** The flat-path (no `agentId`) regression test and dock-hidden-when-empty case prevent the existing ToolExecution path from breaking.
- **Clear out-of-scope section.** SDK contribution and message-text streaming are deferred cleanly without bleeding into this plan.
- **Correct versioning.** v3.10.0 as a minor bump is correct for new feature/UI per CLAUDE.md semver rules.

## Issues

### Critical (Must Address Before Implementation)

None.

### Important (Should Address)

**1. Stale tile cleanup — no handling when a sub-agent never completes**
- **Where:** Architecture / Tasks 3–8 (no task covers this)
- **What's missing:** If a session ends unexpectedly (crash, `session.error`, `session.idle` after abort) while tiles are in `running` state, they remain stuck. There is no task that listens for session lifecycle events and marks in-progress tiles as failed.
- **Why it matters:** Users will see perpetually-spinning tiles after a failed run — a worse UX than no dock at all.
- **Suggested fix:** Add a guard in Task 8 or a Task 8b: on `session.error` or `session.idle` (with no subsequent `subagent.completed`), call `handleComplete` with `status:'failed', error:'Session ended'` for any tiles still in running state.

**2. Attribution key inconsistency between Task 2 and Task 3**
- **Where:** Task 2 GREEN uses `data.parentToolCallId`; Task 3 GREEN uses `event.agentId ?? event.data.toolCallId`
- **What's missing:** The plan uses three different field names interchangeably (`event.agentId`, `data.parentToolCallId`, `event.data.toolCallId`) without a canonical resolution rule.
- **Why it matters:** If the routing in `sdkSessionManager.ts` uses a different key than the dock's `Map`, tiles won't match and tools will fall through to the flat path incorrectly.
- **Suggested fix:** Add one sentence to the architecture section: "The canonical key is always `event.agentId` (the envelope field). `data.toolCallId` (from `subagent.started`) is used only to seed the tile's initial `agentId`. `data.parentToolCallId` on tool events is a read-only fallback if `event.agentId` is absent." Then ensure Tasks 2–4 all use the same field name for the Map key.

### Minor (Consider)

**1. `main.js` size constraint will grow**
- Task 5 adds a new component file (SubagentDock.js) and Task 5's GREEN wires it into `main.js`. The existing known baseline failure is `main.js size constraint`. The plan doesn't address whether adding the dock will push the size further or whether the constraint threshold needs updating.
- Consider noting: "After Task 5, re-check `main.js` size against the constraint; update threshold if the increase is intentional."

**2. No visual spec for dock CSS**
- Task 5 says "Add `.subagent-dock*` CSS" with no further detail. This is fine for a plan, but without a mockup or reference to an existing component's CSS patterns, implementation may require iteration.
- Consider referencing the ToolExecution CSS conventions as a starting point.

## Recommendations

- Resolve the attribution key naming before starting Task 2. A one-paragraph addendum to the Architecture section is sufficient. This is cheap to do now and prevents a subtle routing bug that would only surface under concurrency.
- The stale-tile issue is easy to address: a single `onDidSessionIdle` / `onDidSessionError` hook that iterates the dock's `Map` and closes any open tiles. Add it as Task 8b or a bullet in Task 8's GREEN.
- The plan's sequential task ordering (types → capture → lifecycle → RPC → UI → behavior) is correct and the dependencies are implicitly sound. No reordering needed.

## Assessment

**Implementable as written?** Yes — with the Important issues noted above being low-effort to address before or during implementation.

**Reasoning:** The design is firmly grounded in spike-verified SDK behavior, follows all project conventions (TDD, esbuild.js, component hierarchy, BufferedEmitter patterns), and covers the critical concurrency and regression scenarios. The stale-tile gap and attribution key ambiguity are real but small; neither requires architectural rework.
