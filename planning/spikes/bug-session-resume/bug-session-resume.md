# Bug: Work Session "Not Found" When Exiting Plan Mode

**Date:** 2026-03-09  
**Log:** `tests/logs/server/3-4-1-new-session-planning-mode-work-session-doesnt-exist.log`  
**Repro:** Start new session in planning mode → plan for ~57 minutes → accept plan → work session not found

---

## Two Bugs Reported

1. Exiting plan mode showed "session not found" and prompted to create a new session
2. New session name showed "l j..." (truncated from the auto-injected "I just finished planning..." message)

---

## Bug 1: Work Session Expires While Plan Mode Is Active

### Timeline from logs

```
23:47:31  New session 055677c2 created
23:47:31  Plan mode enabled; plan session 055677c2-plan created
          (57 minutes idle in plan mode — work session 055677c2 sits unused)
12:43:49  User clicks "Accept Plan"
12:43:49  disablePlanMode() runs: plan session destroyed, work session 055677c2 restored
12:43:49  acceptPlan() calls sendMessage("I just finished planning...") on 055677c2
12:43:49  session.send RPC → CLI server responds: "Session not found: 055677c2-..."
12:43:49  [WARN] Session appears to have timed out or expired during message sending
12:43:49  attemptSessionResumeWithUserRecovery(055677c2) → also fails: same session gone
12:43:39  [WARN] All retries exhausted, showing user dialog (error type: session_expired)
12:43:42  User chose "Start New Session"
12:43:42  Fresh client + new session e38dbdaf created
12:43:44  Auto-injected message sent to e38dbdaf (wrong session)
```

Note: The `12:43:39` timestamp on the resume failure is before `12:43:49` accept — this is
because the CLI-side timeout fires before the JS-side response, creating an apparent time
inversion in the log.

### Root cause

The CLI backend has a server-side session idle TTL. After ~57 minutes of no activity on
`055677c2` (the work session sat completely idle while the plan session was active),
the CLI server garbage-collected it.

`disablePlanMode()` restores `this.workSession` from the saved object reference, but that
object's underlying server-side session is gone. The next `sendMessage()` call sends a
`session.send` JSON-RPC request, which the CLI server rejects with `Session not found`.

### How the error message is constructed

The exact error string `Request session.resume failed with message: Session not found: 055677c2-...`
comes from **vscode-jsonrpc's connection layer** (`node_modules/vscode-jsonrpc/lib/common/connection.js`
line 514):

```js
replyError(new ResponseError(ErrorCodes.InternalError,
    `Request ${requestMessage.method} failed with message: ${error.message}`), ...)
```

The CLI server throws `Session not found: <id>` internally; vscode-jsonrpc wraps it into
that format before bubbling up to our code. The SDK source (`research/copilot-sdk`) does
not have this string — it comes from the transport layer.

### What the SDK does / does NOT do

- `CopilotClient` spawns one CLI process per client instance
- `session.destroy()` sends `session.destroy` RPC — this is fine, plan session is destroyed cleanly
- The SDK has **no session keepalive / heartbeat mechanism**
- The SDK has **no server-side session TTL documented** in `research/copilot-sdk/nodejs/src/`
- `resumeSession()` sends `session.resume` RPC — if the session is gone server-side, this also fails with `Session not found`
- The client's `this.sessions` map (SDK internal) still has the session registered; it has no way to know the server-side session expired

### Why resume also fails

When `sendMessage` catches the "Session not found" error, our recovery path calls
`attemptSessionResumeWithUserRecovery(055677c2, ...)` — but this also fails because
the same session ID is gone server-side. Resume cannot recreate a deleted session; it can
only re-attach to an existing one. With `session_expired` error type, `attemptSessionResumeWithRetry`
skips all retries and immediately throws, hitting the user dialog.

### Proposed fix

In `disablePlanMode()`, after restoring the work session, proactively verify the session
is still alive — and silently re-create it if not (rather than letting `sendMessage` fail
and trigger the disruptive modal).

Two approaches:

**Option A — Ping before using:**  
Call `client.ping()` or attempt a no-op to detect a dead connection, then
`resumeSession(workSessionId)` to re-attach before restoring work mode. If resume fails
(session expired), create a new session silently and update `workSessionId`.

**Option B — Wrap the auto-injected sendMessage in silent recovery:**  
In `acceptPlan()`, catch `session_expired` on the auto-injected `sendMessage` and silently
create a new session + retry, bypassing the modal dialog. The modal is appropriate for
user-initiated messages but not for a system-injected context message.

**Option B is the minimal fix** — the modal is wrong here specifically because:
1. The user didn't type a message; this is system-generated
2. The user just accepted a plan and expects seamless transition to implementation
3. The new session that gets created IS valid — the only problem is the modal and the
   wrong session name

**Option A is the more correct fix** but requires knowing what "resuming" means when
the session is truly gone (we'd need to create a new session, losing the conversation
history from plan mode — which is acceptable since plan is done).

---

## Bug 2: "l j..." Session Name

### What happens

After the forced new session `e38dbdaf` is created, the session dropdown labels it.
`SessionService.formatSessionLabel()` falls back to `workspace.yaml`'s `summary` field
when no `session-name.txt` or `plan.md` exists. The first message sent to the new session
is the auto-injected:

> "I just finished planning and accepted the plan. The plan is located at: ..."

That becomes the session's `workspace.yaml` summary. Truncated to 40 chars and displayed
in the small dropdown, it renders as `"l j..."` (chars 2-5 of "I just finished...").

Specifically: `"I just finished..."`.substring(0, 40) = `"I just finished planning and accepted th"`.
The dropdown truncates further visually, showing only `"l j..."`.

### Root cause

The auto-injected context message (`acceptPlan()` → `sendMessage(...)`) is implementation
scaffolding, not a real user message. It should not become the session's label.

### Proposed fix

Either:
- Don't send the auto-injected message at all — instead rely on the user's next message
  to establish context (the plan file path is already known to the user)
- Or prefix the injected message with a `[SYSTEM]` or similar marker, and strip that
  prefix in `formatSessionLabel()` — but this is fragile

**Simplest fix:** Remove the auto-injected `sendMessage` from `acceptPlan()` entirely.
The current session message that the user sent to this new Claude Code session ("I just
finished planning and accepted the plan...") already serves this purpose perfectly — the
user typed it manually. The auto-injection is redundant and causes two problems:
(1) it fires into a potentially-expired session, (2) it poisons the session label.

If the auto-injection is deemed useful, it should be delivered as a non-recording system
prompt amendment rather than a user message, so it doesn't appear in `events.jsonl` and
doesn't influence the session summary.

---

## Files Involved

| File | Relevance |
|------|-----------|
| `src/sdkSessionManager.ts` | `disablePlanMode()` line ~1590, `acceptPlan()` line ~1637, `sendMessage()` error recovery line ~1038 |
| `src/sessionErrorUtils.ts` | `classifySessionError()`, `attemptSessionResumeWithRetry()`, `showSessionRecoveryDialog()` |
| `src/extension/services/SessionService.ts` | `formatSessionLabel()` line ~149 |
| `research/copilot-sdk/nodejs/src/client.ts` | `resumeSession()`, session lifecycle, no keepalive |
| `research/copilot-sdk/nodejs/src/session.ts` | `sendAndWait()` — 60s default timeout |
| `node_modules/vscode-jsonrpc/lib/common/connection.js` | Source of "Request X failed with message: Y" format |
