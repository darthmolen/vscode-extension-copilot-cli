# v3.4.1: Plan Mode Session Recovery + Meaningful Kickoff Labels

**Date:** 2026-03-09
**Branch:** feature/3.4.1
**Spike research:** `planning/spikes/bug-session-resume/`

## Problem

Two bugs when exiting plan mode after extended planning:

1. **Work session expires** — CLI server GCs idle sessions (~1-2h TTL). The work session sits unused during planning, gets deleted server-side. `acceptPlan()` sends a kickoff message → "Session not found" → recovery modal.
2. **Garbled session label** — The kickoff message "I just finished planning..." becomes the `workspace.yaml` summary → truncated to "l j..." in the dropdown.

## Fix

### Bug 1: Silent session recovery in `disablePlanMode()`
After restoring the work session reference, `ensureSessionAlive()` uses a lightweight `abort()` call to verify the session is alive. If expired, silently creates a new session via `createSessionWithModelFallback()`. Non-expired errors propagate to `sendMessage()`'s existing recovery.

### Bug 2: Meaningful kickoff message
`extractPlanHeading()` reads the first `#` heading from `plan.md`. The kickoff message leads with that heading (e.g., "v3.4.0 Release Documentation"). The heading is also written to `session-name.txt` for immediate label priority in the dropdown.

## Bugs Found During Manual Testing

### Bug A: Permission errors — "Unhandled permission result kind: [object Object]"

**Root cause**: `disablePlanMode()` health check used `onPermissionRequest: () => ({ allow: true })` but the SDK expects the `approveAll` function (imported from SDK at module init). The inline lambda returns the wrong object format.

**Fix**: Changed to `onPermissionRequest: approveAll` — the SDK's own permission handler already available at module scope (line 173/181 in sdkSessionManager.ts).

### Bug B: Doubled SDK events — every output fires twice

**Root cause (REVISED)**: NOT a double `setActiveSession()` call — `MutableDisposable` correctly replaces subscriptions. The real cause is **server-side**: `client.resumeSession()` sends `session.resume` RPC to the CLI server, which re-registers the session for event notifications. Since the work session was already active (from the original `session.create`), the server now has TWO internal event subscriptions for the same session ID. Every event fires two JSON-RPC `session.event` notifications.

**Evidence**: In `3-4-1-double-assistant-prompt.log`, events are SINGLE during plan mode (plan session was `createSession`, no resume) but DOUBLED after `disablePlanMode()` calls `resumeSession` on the already-active work session. After Developer: Reload Window (fresh CLI process), events return to single.

**Fix**: Changed `ensureSessionAlive()` to use `session.abort()` instead of `client.resumeSession()`. `abort()` is a lightweight no-op on idle sessions that throws if the session is dead — perfect for a health check without server-side side effects. On success, returns the EXISTING session reference (no new `CopilotSession`, no server re-subscription).

```typescript
const result = await ensureSessionAlive(
    this.workSession,  // existing session with abort()
    () => this.createSessionWithModelFallback({...}),
    this.logger
);
verifiedSession = result.session;
// ...
this.setActiveSession(verifiedSession);  // exactly once
```

## Files Changed

| File | Change |
|------|--------|
| `src/extension/utils/planModeUtils.ts` | `extractPlanHeading()`, `buildKickoffMessage()` |
| `src/sessionErrorUtils.ts` | `ensureSessionAlive()` |
| `src/sdkSessionManager.ts` | Health check in `disablePlanMode()`, kickoff rewrite in `acceptPlan()` |
| `tests/unit/extension/plan-mode-kickoff.test.js` | 12 tests for pure functions |
| `tests/unit/extension/ensure-session-alive.test.js` | 3 tests for session health check |

## Design Decisions

- **`ensureSessionAlive` in `sessionErrorUtils.ts`** — Reusable, testable with mock session. Uses `abort()` for lightweight liveness check (not `resumeSession()` which causes server-side event doubling). Uses existing `classifySessionError()` to distinguish expired vs transient errors. Pure function — returns a result, doesn't mutate state.
- **Pure functions in `planModeUtils.ts`** — No vscode/SDK dependencies, directly unit-testable.
- **Silent recovery, no modal** — The user just accepted a plan; showing an error modal for a system-initiated action is wrong UX.
- **Heading as session name** — Written to `session-name.txt` which has highest priority in `formatSessionLabel()`.
- **Single `setActiveSession()` call** — SOC: health check decides, `disablePlanMode()` acts. No state mutation inside the health check.
- **`approveAll` from SDK** — Never roll your own permission handler format; use the SDK's exported function.
