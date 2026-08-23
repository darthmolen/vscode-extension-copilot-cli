# Backlog: File-Diff Coverage for Shell Writes + Multi-Session Attribution

Two related defects in `FileSnapshotService`, both surfaced while planning chat-in-a-tab
(`planning/needs-review/completed/2026-08-16-v3-13-0-chat-in-a-tab.md`). The first is live today and
affects every user; the second only bites once more than one session runs at a time.

## Problem 1 — Shell writes produce no diff at all

`FileSnapshotService` captures only for two tool names, at both entry points:

```ts
// fileSnapshotService.ts:49  (captureFileSnapshot)
// fileSnapshotService.ts:123 (captureByPath)
if (toolName !== 'edit' && toolName !== 'create') { return; }
```

Anything the agent writes through a shell — `bash` heredoc, `sed -i`, `tee`, `mv`, or `powershell` —
never gets a snapshot, so no `beforeUri` exists and **no diff is ever shown**. The change lands on
disk silently.

This is not an edge case. Tool-call counts measured from `tests/logs/server/*.log`:

| Tool | Calls | Snapshot captured? |
| --- | ---: | --- |
| `bash` | 382 | **no** |
| `edit` | 93 | yes |
| `create` | 18 | yes |
| `powershell` | 12 | **no** |

Shell invocations outnumber `edit` + `create` by roughly 3.4:1. Most are reads or builds, but every
mutating one bypasses the diff UI. The SDK also declares a `write` tool name in its generated types
that our gate does not list.

## Problem 2 — Snapshots are per-manager, so diffs misattribute across sessions

`FileSnapshotService` is instantiated per `SDKSessionManager` (`sdkSessionManager.ts:465`). Once
chat-in-a-tab lands, two live sessions share one workspace with two independent snapshot stores. If
session B edits a file between session A's snapshot and A's diff render, **A's diff shows B's changes
as though they were A's**.

Scope note, because an earlier draft of the v3.13.0 plan got this wrong and a review endorsed the
error: this is *not* a data-loss path. `snapshot.tempFilePath` has exactly one consumer —
`sdkSessionManager.ts:1239`, which passes it as `beforeUri` to the diff view, followed by
`cleanupSnapshot` at :1253. Nothing writes it back; there is no restore or revert. The accept/reject
handlers in `chatViewProvider.ts` are `onAcceptPlan`/`onRejectPlan`, i.e. plan mode, not file diffs.
**Snapshots are display-only; the CLI performs the writes.** The cost is a misleading diff, not lost
work.

## Proposed Solution

**For Problem 1** — decouple snapshot capture from the tool name. Options, roughly in order of effort:

1. Widen the allowlist to include `write` and any other declared mutating tool. Cheapest, still
   misses shell writes entirely.
2. Snapshot on *path*, not tool: use the `workspace.file_changed` session event the SDK already emits
   to detect a mutation, and reconstruct a before-state from git (`git show :file`) when no snapshot
   exists. Covers shell writes without predicting tool names.
3. Register a custom `bash` wrapper that snapshots any path appearing in a write-shaped command.
   Fragile — command parsing is unbounded — and it fights the CLI rather than using its events.

Option 2 is the one worth spiking. It inverts the design from "guess which tools write" to "observe
what changed", which is the only version that stays correct as the CLI's tool set evolves.

**For Problem 2** — an `EditActivityLog` (`Map<path, { sessionId, at }>`) on the window-scoped shared
state, recorded at snapshot capture and cleared at cleanup. When a diff renders and another session
touched that path inside the window, label it *"also modified by `<other session>`"*. Detect and
inform; do not lock. A lock would need cross-session coordination and would block the parallelism the
tab feature exists to provide — and we cannot do compare-and-swap on writes we do not perform.

For contrast: Claude Code's harness solves the same class of problem with optimistic concurrency —
the write tool refuses to apply against a file that changed since it was read, and the agent re-reads
and retries. Correctness never depends on the model noticing. We cannot copy the mechanism because we
are not the writer, only the posture: make the conflict visible.

## Value

Problem 1 is a silent correctness gap in the feature users most rely on for trust — the diff is how
they verify what the agent did. Today it covers under a third of mutating tool calls. Problem 2 is
cheap insurance that keeps that trust intact once two sessions share a worktree.

## Scope

Problem 1 needs a spike before an estimate (per CLAUDE.md's SDK-first rule): confirm
`workspace.file_changed` fires for shell writes and carries a usable path. Problem 2 is small once
v3.13.0's shared state exists — it has no home before then.

## Dependencies

Problem 2's `EditActivityLog` lands on `WorkspaceRuntimeState`, introduced in v3.13.0 Task 3. Problem
1 is independent and could ship any time.
