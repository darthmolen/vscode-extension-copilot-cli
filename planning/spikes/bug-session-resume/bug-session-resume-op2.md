# Bug Analysis: Work Session "Not Found" When Exiting Plan Mode (Second Opinion)

**Date:** 2026-03-09
**Analyst:** Opus 4.6 (independent review of Sonnet 4.6 analysis)
**First opinion:** `planning/bug-session-resume.md`
**Log:** `tests/logs/server/3-4-1-new-session-planning-mode-work-session-doesnt-exist.log`

---

## Verdict on Sonnet Analysis

**Root cause: CORRECT.** The CLI server garbage-collected the idle work session. Agreement on all major points with corrections on timeline and scope below.

**Proposed fixes: INCOMPLETE.** Better options exist. The auto-injected message is the real foot-gun.

---

## Timeline Correction

Sonnet says "~57 minutes idle." **Actual timeline: ~13 hours total.**

```
23:47:31  Session 055677c2 created
23:47:31  Plan mode enabled (first cycle)
23:47:42  Plan mode disabled (11 seconds — success, no acceptPlan called)
          ─── 13 HOURS IDLE ───
          Work session 055677c2 sits in memory, dead server-side
12:36:00  Plan mode re-enabled (second cycle, same dead work session reference)
          (~7.8 minutes in plan mode)
12:43:49  User clicks "Accept Plan"
12:43:49  disablePlanMode() → restores dead work session reference
12:43:49  acceptPlan() → sendMessage("I just finished planning...") → BOOM
12:43:49  "Session not found: 055677c2-..." from CLI server
12:43:49  Resume attempt → also fails (session truly gone)
12:43:39  All retries exhausted → modal dialog (timestamp inversion: CLI timeout fires first)
12:43:42  User picks "Start New Session" → new session e38dbdaf
12:43:44  Auto-injected message sent to e38dbdaf → poisons session label → "l j..."
```

The session survived the first plan mode exit (11 seconds) but died during the overnight idle. The second plan mode cycle inherited a stale reference.

---

## What Sonnet Missed

### 1. SDK has a `ping()` method (unused)

`research/copilot-sdk/nodejs/src/client.ts` lines 688-696:

```typescript
async ping(message?: string): Promise<{ message: string; timestamp: number; protocolVersion?: number }>
```

Sends `"ping"` RPC to the server. This is **connection-scoped** (not session-scoped), so it verifies the CLI process is alive but doesn't reset a session's TTL. Still, it's a pre-flight check we could use.

### 2. The auto-injected message is architectural malpractice

Sonnet identifies it as a problem but understates it. The auto-injected `sendMessage()` in `acceptPlan()` is:

- **System scaffolding masquerading as user input** — user never typed it
- **The first post-plan-mode RPC call** — if it hits a dead session, you get a modal for something the user didn't initiate
- **Label poison** — becomes `workspace.yaml` summary → "l j..." in dropdown
- **Redundant** — user will send a real message next; plan.md path is already visible

### 3. `resumeSession()` cannot resurrect deleted sessions

`research/copilot-sdk/nodejs/src/client.ts` lines 612-657: sends `session.resume` RPC with the sessionId. If the server has no record, it fails identically to `session.send`. There is no "create-if-not-found" mode. The SDK's internal `this.sessions` map is local-only — it has no way to detect server-side expiry without making an RPC call.

### 4. No session-scoped keepalive exists

Searched the full SDK source (`research/copilot-sdk/nodejs/src/`). No `session.ping`, `session.refresh`, `session.keepalive`, or TTL-reset mechanism exists. The only ping is connection-level. A heartbeat loop would need to be our own invention, and it's unclear whether `client.ping()` resets session TTLs.

---

## Fix Options (Ranked)

### ~~Option 0: Remove the auto-injected message~~ (REJECTED)

**CORRECTION:** The auto-injected message is NOT scaffolding — it's the **kickoff instruction** that tells the work session AI to read `plan.md` and begin implementation. Without it, the user accepts the plan and gets silence. The message is essential to the plan→implement flow. Removing it breaks the UX.

### Option 1: Ping + silent session recreation in `disablePlanMode()`

After restoring the work session, verify it's alive. If dead, create a new one silently.

```typescript
// In disablePlanMode(), after restoring work session:
try {
    await this.client.ping(); // connection alive?
    // Attempt lightweight RPC to verify SESSION is alive
    // (ping is connection-level, not session-level)
} catch {
    this.logger.warn('[Plan Mode] Connection dead after plan mode');
}

try {
    this.session = await this.client.resumeSession(this.workSessionId!, config);
} catch (error) {
    if (classifySessionError(error) === 'session_expired') {
        this.logger.warn('[Plan Mode] Work session expired; recreating silently');
        this.session = await this.createSessionWithModelFallback(config);
        this.sessionId = this.session.sessionId;
        this.workSessionId = this.sessionId;
        this.workSession = this.session;
    }
}
```

| Pros | Cons |
|------|------|
| Detects dead sessions before user interaction | 2 extra RPC round-trips per plan mode exit |
| No modal dialogs | `ping()` is connection-level, not session-level |
| Seamless UX | More code, more edge cases |

**Use as secondary fix** if the auto-injected message is deemed valuable for UX.

### Option 2: Sonnet's Option B — silent catch around `sendMessage` in `acceptPlan()`

Wrap the auto-injected `sendMessage()` in try-catch, swallow `session_expired`.

| Pros | Cons |
|------|------|
| Minimal code change | Bug #2 still happens (label pollution) |
| No modal for system message | Doesn't fix the underlying stale session |
| | User's next manual message still hits dead session |

**Not recommended.** Treats the symptom, leaves the disease.

### Option 3: Heartbeat loop while in plan mode

`setInterval` calling `client.ping()` every N minutes during plan mode.

| Pros | Cons |
|------|------|
| Keeps connection warm | `ping()` is connection-level, may not reset session TTL |
| Detects connection loss early | Network chatter, battery impact |
| | Over-engineering for a rare edge case |
| | Requires testing with CLI to confirm it even helps |

**Not recommended.** Speculative and heavy-handed.

---

## Recommended Fix

**Do Option 0 + Option 1 together:**

1. **Remove the auto-injected message** from `acceptPlan()` — eliminates both bugs immediately
2. **Add silent session recreation** in `disablePlanMode()` — ensures the work session is healthy before the user sends their first message

This gives you defense in depth: even if the session died overnight, plan mode exit recovers silently, and the user's first message goes to a live session.

---

## Files Involved

| File | What | Lines |
|------|------|-------|
| `src/sdkSessionManager.ts` | `disablePlanMode()` — restores stale work session | ~1590-1632 |
| `src/sdkSessionManager.ts` | `acceptPlan()` — auto-injects message into dead session | ~1637-1675 |
| `src/sdkSessionManager.ts` | `sendMessage()` — error recovery triggers modal | ~1038-1139 |
| `src/sessionErrorUtils.ts` | `classifySessionError()` — detects `session_expired` | ~73-84 |
| `src/extension/services/SessionService.ts` | `formatSessionLabel()` — reads poisoned workspace.yaml | ~149-214 |
| `research/copilot-sdk/nodejs/src/client.ts` | `ping()` — available, unused | 688-696 |
| `research/copilot-sdk/nodejs/src/client.ts` | `resumeSession()` — fails on deleted sessions | 612-657 |
