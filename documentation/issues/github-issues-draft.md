# GitHub Issues — Filed 2026-02-22

Updated 2026-02-23 with spike findings and corrections.
Updated 2026-02-23 (evening) — #530 closed, PR #546 has review feedback from Steve.
Updated 2026-02-24 — #1606 self-closed, PR #546 reworked per Steve's feedback, SDK breaking changes discovered.
Updated 2026-03-08 — Two new issues filed during v3.4.0 session label work.
Updated 2026-03-09 — New issue: resumeSession() doubles events on already-active sessions.
Updated 2026-03-24 — **PR #546 MERGED** (Mar 19). 6 fleet issues filed (#2261–#2265 copilot-cli, #915 copilot-sdk). #989 got new community comment today.
Updated 2026-04-04 — SDK at **0.2.1**, CLI at **1.0.17** (bundled). No new maintainer responses as of Apr 4 2026.

## Key Finding (2026-02-23)

**`--headless --stdio` was never removed.** The CLI binary is a thin Go launcher that
delegates to downloaded versions in `~/.copilot/pkg/universal/`. Without `--no-auto-update`,
the launcher silently runs a newer version at runtime — causing the version drift we observed.
SDK v0.1.23+ (PR #392, Steve Sanderson) passes `--no-auto-update`. Our SDK v0.1.22 does not.

We corrected #1606 and #530 with this finding. Our workaround: `cliArgs: ['--no-auto-update']`.

## SDK Breaking Changes (0.1.22 → 0.1.26)

Our extension is on SDK **0.1.22**. Latest is **0.1.26**. Two breaking changes landed:

1. **PR #509** (v0.1.25, Feb 18) — Permissions denied by default. Must pass `onPermissionRequest`.
2. **PR #554** (merged Feb 24) — `onPermissionRequest` is now **required** on `createSession()`
   and `resumeSession()`. Omitting it throws. SDK exports `approveAll` convenience helper.

Other changes since 0.1.22:
- `--no-auto-update` baked in (can remove our `cliArgs` workaround)
- `clientName` option on `SessionConfig` (identifies app in UA headers)
- CLI dep bumped to 0.0.414
- Node engine requirement changed to 20+
- MCP env vars fix (`envValueMode: direct`)

**Upgrade is required for v3.3.0.** See `planning/v3.3.0-plan.md` (TBD).

## Issues Filed

| | # | Repo | Title | Status | Link |
|---|---|------|-------|--------|------|
| x | 1 | copilot-cli | Breaking change: --headless --stdio removed without deprecation | CLOSED (self, Feb 24) | [#1606](https://github.com/github/copilot-cli/issues/1606) |
| x | 2 | copilot-sdk | CLI v0.0.410+ auto-update breaks all SDK versions | CLOSED | [#530](https://github.com/github/copilot-sdk/issues/530) |
| x | 3 | copilot-sdk | Node SDK: getBundledCliPath() breaks in CJS bundles (VS Code extensions) | **MERGED Mar 19** | [#528](https://github.com/github/copilot-sdk/issues/528) → [PR #546](https://github.com/github/copilot-sdk/pull/546) |
| x | 4 | copilot-sdk | SDK e2e tests never run against a real CLI binary in CI | CLOSED | [#532](https://github.com/github/copilot-sdk/issues/532) |
|   | 5 | copilot-cli | [Security] ACP lacks session-level tool permission primitives | OPEN (no response) | [#1607](https://github.com/github/copilot-cli/issues/1607) |
|   | 6 | copilot-cli | Bug: session.title_changed event fires with truncated title ("I j...") | OPEN (filed Mar 8) | [#1910](https://github.com/github/copilot-cli/issues/1910) |
|   | 7 | copilot-cli | Bug: resumeSession() on active session doubles all event notifications | OPEN (filed Mar 9) | [#1933](https://github.com/github/copilot-cli/issues/1933) |
|   | 8 | copilot-sdk | resumeSession() on active session causes doubled events — SDK should guard | OPEN (filed Mar 9) | [#742](https://github.com/github/copilot-sdk/issues/742) |
|   | 9 | copilot-cli | FLEET: fleet.start() ignores customAgents — always dispatches built-in agent types | OPEN (filed Mar 24) | [#2261](https://github.com/github/copilot-cli/issues/2261) |
|   | 10 | copilot-cli | FLEET: session.task_complete does not fire after fleet execution | OPEN (filed Mar 24) | [#2262](https://github.com/github/copilot-cli/issues/2262) |
|   | 11 | copilot-cli | FLEET: session.idle fires before all sub-agents complete | OPEN (filed Mar 24) | [#2263](https://github.com/github/copilot-cli/issues/2263) |
|   | 12 | copilot-cli | FLEET: No fleet.* lifecycle events — fleet state inferred from subagent.* | OPEN (filed Mar 24) | [#2264](https://github.com/github/copilot-cli/issues/2264) |
|   | 13 | copilot-cli | FLEET: Sub-agent output not streamed per-agent — aggregated only at end | OPEN (filed Mar 24) | [#2265](https://github.com/github/copilot-cli/issues/2265) |
|   | 14 | copilot-sdk | FLEET: resumeSession() with customAgents errors with malformed timeout message | OPEN (filed Mar 24) | [#915](https://github.com/github/copilot-sdk/issues/915) |

Legend: `x` = resolved/closed, `+` = we added follow-up comments, blank = open, no action needed

### Issue Notes

**#1606** — **CLOSED (Feb 24).** Our original claim (--headless removed) was wrong. Posted
correction (Feb 23) with launcher delegation evidence. CLI team never responded. Self-closed
as "not planned" since the underlying issue (auto-update drift) was fixed in SDK v0.1.23.

**#530** — **CLOSED.** Steve replied "Thanks for confirming" and closed after our evidence
about launcher delegation and `--no-auto-update`. Resolution: our workaround (`cliArgs`) is correct,
SDK v0.1.23+ has the fix upstream. No further action.

**#528 / PR #546** — **MERGED Mar 19.** Steve approved and merged the reworked CJS compatibility fix (commit `fb679794`). Our CJS bundle path resolution fallback is now in the SDK. We can remove our local workaround when we upgrade to the version that includes this fix.

**#532** — Closed by Steve (Feb 23). He acknowledged a gap in auto-downloader E2E testing
but rejected the broader claim. Would need a narrower re-file to pursue.

**#989** — [see above]

**#1607** — No response. Triage label only. Leaving open — security issues should stay until addressed.

**#1910** — Filed Mar 8 during v3.4.0 work. When a session receives its first message, the CLI
auto-generates a title from that message and fires `session.title_changed`. The title is truncated
to ~5 characters plus `...` (e.g. `"I j..."`). Our workaround: strip `[Active File: ...]` prefix in
the `session.title_changed` handler and take the first non-empty line. The truncation itself is a
CLI-side bug we can't fix — session labels will still be short until the CLI team fixes it.

**#1865** — `/rename` fails with `Workspace not found` on resumed sessions (v0.0.421). Our workaround:
write `session-name.txt` proactively before sending `/rename` to CLI, so the label updates even when
CLI throws. The `session_renamed` status event fires correctly after our proactive write.

**#7 / [#1933](https://github.com/github/copilot-cli/issues/1933)** — `resumeSession()` on an already-active session doubles all `session.event` notifications.
Reproduced with bare-bones spike (`planning/spikes/resume-event-doubling/`): `createSession` → `sendAndWait`
(events single) → `resumeSession` on same ID → `sendAndWait` (7 of 8 event types doubled, 1.9x total).
Only `session.idle` stays single. Root cause: server-side `session.resume` re-registers the session for
event notifications without checking for existing subscription on the same connection. Workaround: use
`session.abort()` as lightweight liveness check instead of `resumeSession()`.

<details>
<summary>Draft issue body for copilot-cli</summary>

**Title:** `session.resume` on active session doubles `session.event` notifications

**Body:**

## Bug

Calling `session.resume` on a session that is already active on the same client connection causes all subsequent `session.event` JSON-RPC notifications to fire **twice** for that session. The doubling persists until the CLI process restarts.

## Reproduction

Minimal SDK script (requires Node 22.5+):

```javascript
const { CopilotClient, approveAll } = await import('@github/copilot-sdk');

const client = new CopilotClient({ cwd: process.cwd(), autoStart: true });

// Phase 1: create + send — events are SINGLE
const session = await client.createSession({
    model: 'claude-sonnet-4-5',
    onPermissionRequest: approveAll,
});

let count1 = 0;
const unsub1 = session.on(() => count1++);
await session.sendAndWait({ prompt: 'Say hello' });
unsub1();
console.log(`Phase 1 events: ${count1}`); // ~9

// Phase 2: resume same session + send — events are DOUBLED
const resumed = await client.resumeSession(session.sessionId, {
    onPermissionRequest: approveAll,
});

let count2 = 0;
const unsub2 = resumed.on(() => count2++);
await resumed.sendAndWait({ prompt: 'Say hello again' });
unsub2();
console.log(`Phase 2 events: ${count2}`); // ~17 (1.9x)
```

## Expected

Event counts should be the same in both phases. `session.resume` on an already-active session should be idempotent with respect to event subscriptions.

## Actual

After `session.resume`, 7 of 8 event types fire twice per occurrence:
- `user.message`, `assistant.message`, `assistant.turn_start`, `assistant.turn_end`, `assistant.usage`, `session.usage_info`, `pending_messages.modified` — all doubled
- `session.idle` — stays single (different code path?)

## Impact

Any SDK client that uses `resumeSession()` as a health check (to verify a session is still alive before sending a message) will get doubled events for the rest of the session lifetime. This causes duplicate UI rendering, duplicate tool executions, and doubled state updates.

## Environment

- CLI: v0.0.421 (latest as of Mar 2026)
- SDK: v0.1.22
- Node: v24.13.1

## Workaround

Use `session.abort()` as a lightweight liveness check instead of `resumeSession()`. `abort()` is a no-op on idle sessions and throws if the session has been garbage-collected — same signal, no side effects.

</details>

**#8 / [#742](https://github.com/github/copilot-sdk/issues/742)** — SDK-level guard for the same doubling bug. Even if the CLI server
fixes the duplicate subscription, the SDK should protect callers from this footgun. Two possible
SDK-level fixes: (1) `resumeSession()` checks `this.sessions.has(sessionId)` and returns the
existing `CopilotSession` instead of creating a duplicate, or (2) `resumeSession()` deletes the
old session from the Map before creating the new one (ensuring the server-side subscription is
replaced, not duplicated). Option 1 is cleaner — callers who want to re-configure can destroy first.

Filed at SDK level because Steve (Sphephen) actually responds. CLI team is 0-for-6.

<details>
<summary>Draft issue body for copilot-sdk</summary>

**Title:** `resumeSession()` on already-active session causes doubled events — SDK should guard

**Body:**

## Problem

Calling `client.resumeSession(sessionId)` on a session that's already active (created via `createSession()` on the same connection) causes all subsequent `session.event` notifications to fire **twice**. This is a server-side issue (the CLI registers a second event subscription without deduplicating), but the SDK can and should protect callers.

## Reproduction

```javascript
const { CopilotClient, approveAll } = await import('@github/copilot-sdk');
const client = new CopilotClient({ cwd: process.cwd(), autoStart: true });

const session = await client.createSession({
    model: 'claude-sonnet-4-5',
    onPermissionRequest: approveAll,
});

// Events are single here ✅
let count1 = 0;
const unsub1 = session.on(() => count1++);
await session.sendAndWait({ prompt: 'Say hello' });
unsub1();

// Resume the SAME active session
const resumed = await client.resumeSession(session.sessionId, {
    onPermissionRequest: approveAll,
});

// Events are now doubled ❌
let count2 = 0;
const unsub2 = resumed.on(() => count2++);
await resumed.sendAndWait({ prompt: 'Say hello again' });
unsub2();

console.log(count1, count2); // ~9, ~17
```

## Suggested Fix

In `client.ts` `resumeSession()`, check if the session already exists in the local `sessions` Map before sending `session.resume` to the server:

```typescript
async resumeSession(sessionId: string, config: ResumeSessionConfig): Promise<CopilotSession> {
    // Guard: if we already have a live session for this ID, return it
    const existing = this.sessions.get(sessionId);
    if (existing) {
        // Re-register handlers if config changed
        existing.registerTools(config.tools);
        existing.registerPermissionHandler(config.onPermissionRequest);
        if (config.hooks) existing.registerHooks(config.hooks);
        return existing;
    }

    // ... existing resumeSession logic for truly new sessions
}
```

This prevents the server-side duplicate subscription while still allowing callers to update tools/permissions. Callers who genuinely want a fresh session can `destroy()` first.

## Impact

Any SDK caller that uses `resumeSession()` as a health check (verify session is alive before sending a message) gets silently broken — doubled events for the rest of the session. We discovered this when implementing plan-mode session recovery in a VS Code extension.

## Workaround

We use `session.abort()` as a lightweight liveness check instead of `resumeSession()`. `abort()` is a no-op on idle sessions and throws `"Session not found"` if the session was garbage-collected. Same signal, no side effects.

## Environment

- SDK: v0.1.22
- CLI: v0.0.421
- Node: v24.13.1

</details>

## Comments Added

| | Issue | Repo | What we added | Date | Link |
|---|-------|------|---------------|------|------|
| + | #1606 | copilot-cli | Correction: --headless not removed, explained launcher delegation | Feb 23 | [comment](https://github.com/github/copilot-cli/issues/1606#issuecomment-3946451605) |
| + | #530 | copilot-sdk | Evidence: launcher behavior, SDK version boundary, semver question | Feb 23 | [comment](https://github.com/github/copilot-sdk/issues/530#issuecomment-3946437228) |
|   | #1574 | copilot-cli | Custom tools silently ignored — spike evidence | Feb 22 | [comment](https://github.com/github/copilot-cli/issues/1574#issuecomment-3940880424) |
|   | #989 | copilot-cli | Tool ID mismatch confirmed + permission response format | Feb 22 | [comment](https://github.com/github/copilot-cli/issues/989#issuecomment-3940880714) |
|   | #377 | copilot-sdk | Context: CLI broke SDK, not "universal SDK" request | Feb 22 | [comment](https://github.com/github/copilot-sdk/issues/377#issuecomment-3940880905) |

## Upvoted

- [copilot-cli #1574](https://github.com/github/copilot-cli/issues/1574) — custom tools ignored in ACP

## Related Issues (existing, for monitoring)

| | Issue | Repo | Title | Status | Maintainer Response |
|---|-------|------|-------|--------|---------------------|
|   | [#989](https://github.com/github/copilot-cli/issues/989) | copilot-cli | ACP incorrect tool IDs in permission requests | OPEN | **5 confirmations** (Mar 24 fresh activity)
|   | [#1574](https://github.com/github/copilot-cli/issues/1574) | copilot-cli | ACP agent ignores custom tools | OPEN | None |
|   | [#728](https://github.com/github/copilot-cli/issues/728) | copilot-cli | Model selection not reflected in responses | OPEN | andyfeller (Dec 2025, cosmetic) |
|   | [#1865](https://github.com/github/copilot-cli/issues/1865) | copilot-cli | /rename fails with 'Workspace not found' on resumed sessions | OPEN — workaround applied | None |
| x | [#377](https://github.com/github/copilot-sdk/issues/377) | copilot-sdk | ACP support request (wontfix) | CLOSED | friggeri closed as wontfix |
|   | [#137](https://github.com/github/copilot-sdk/issues/137) | copilot-sdk | No minimum CLI version docs | OPEN | None (dormant since Jan 23) |
| + | [#411](https://github.com/github/copilot-sdk/issues/411) | copilot-sdk | Override built-in tools | **CLOSED/SHIPPED v0.1.30** | See `planning/backlog/override_builtin_tools.md` |

## Maintainer Engagement Summary

**Steve Sanderson** (copilot-sdk) — Reviewed and **merged PR #546** on Mar 19. Responded Feb 23
on #530, #528, #532. Open to tool override (#411). Shipped two breaking changes in quick succession (permissions deny-by-default
Feb 18, required handler Feb 24). Very active pace — monitor SDK releases closely.

**copilot-cli team** — Zero maintainer engagement on any of our issues (#1606, #1607, #1910, #1933) or
community-confirmed bugs (#989, #1574). `triage` labels are being applied (someone reads them)
but no comments, no assignments, no follow-through. The pattern (active SDK community vs silent
CLI team) suggests a resourcing or prioritization gap on the CLI side. **Fleet issues #2261–#2265 filed Mar 24 — low expectations.**

## Fleet Issues (filed 2026-03-24)

Source: spikes 2026-03-17. Full detail in `documentation/issues/fleet/`. SDK version checked: 0.1.32 → 0.2.0 showed no patches.

| # | Repo | Issue # | Title | Status |
|---|------|---------|-------|--------|
| 9 | copilot-cli | [#2261](https://github.com/github/copilot-cli/issues/2261) | fleet.start() ignores customAgents | OPEN |
| 10 | copilot-cli | [#2262](https://github.com/github/copilot-cli/issues/2262) | session.task_complete never fires after fleet | OPEN |
| 11 | copilot-cli | [#2263](https://github.com/github/copilot-cli/issues/2263) | session.idle fires before sub-agents complete | OPEN |
| 12 | copilot-cli | [#2264](https://github.com/github/copilot-cli/issues/2264) | No fleet.* lifecycle events | OPEN |
| 13 | copilot-cli | [#2265](https://github.com/github/copilot-cli/issues/2265) | Sub-agent output not streamed per-agent | OPEN |
| 14 | copilot-sdk | [#915](https://github.com/github/copilot-sdk/issues/915) | resumeSession() + customAgents malformed timeout | OPEN |

## ACP Spike Scripts

Testing harness and spike scripts live on the `feature/4.0-acp-migration` branch:

- `tests/harness/acp-spike.mjs` — full ACP protocol spike (model, events, cancel, attachments, tools, MCP)
- `planning/spikes/cli-auto-update/` — auto-update verification experiments (Feb 23)

## Spike Results (2026-02-23)

CLI version sweep (all versions tested with `--no-auto-update`):

| Version | `--headless` | `--acp` | Binary Size |
|---------|-------------|---------|-------------|
| 0.0.403 | TIMEOUT (accepted) | YES | 138,480,832 |
| 0.0.409 | TIMEOUT (accepted) | YES | 138,677,440 |
| 0.0.410 | TIMEOUT (accepted) | YES | 138,677,440 |
| 0.0.411 | TIMEOUT (accepted) | YES | 138,742,976 |
| 0.0.414 | TIMEOUT (accepted) | YES | 138,742,976 |

- `--headless` is accepted on all versions (TIMEOUT = needs auth, not flag rejection)
- `--acp` works on all versions, even 0.0.403
- Auto-update delegation: without `--no-auto-update`, v0.0.403 reports as v0.0.410 at runtime
