# Implementation Plan: Version 2.2.3 - Session Resume Circuit Breaker

## Summary

Implement smart retry logic with exponential backoff and user recovery dialogs for session resume failures. This was deferred from v2.2.2 due to complexity but is important for reliability.

## Problem Statement

When resuming a session after VS Code restart or timeout, the extension gives up immediately on any error and creates a new session, losing conversation history. Research in v2.2.2 planning phase showed that:

1. Sessions CAN resume after 33+ minutes of inactivity (proven by logs)
2. Resume failures are often transient (CLI not ready, network hiccup)
3. Current code has no retry logic - one error = new session
4. Users lose history unnecessarily

## Solution: Circuit Breaker Pattern with User Control

**Pattern:** Retry → User Decision → Action

### State Machine
```
CLOSED (normal) 
  ↓ resumeSession() fails
RETRYING (attempt 1, 2, 3...)
  ↓ all retries fail
OPEN (show user dialog)
  ↓ user chooses
CLOSED (new session) OR HALF-OPEN (retry resume)
```

### Key Features

1. **Exponential Backoff:** 1s, 2s, 4s between retries (max 3 attempts)
2. **Smart Retry Logic:**
   - Session expired → skip retries, ask user immediately
   - Network error → retry 3 times
   - Auth error → fail fast, different error path
3. **User Control:** Dialog gives user choice to retry or start new
4. **Comprehensive Logging:** Every step logged for debugging
5. **No Infinite Loops:** Max 3 attempts + 1 optional user retry

## Tasks

### Phase 1: Error Classification Enhancement
- [ ] Review existing `authUtils.ts` error classification
- [ ] Add session-specific error types:
  - [ ] `session_expired` - session deleted/expired server-side
  - [ ] `session_not_ready` - client not connected yet
  - [ ] `network_timeout` - network issue, retriable
  - [ ] `authentication` - auth problem, not retriable
- [ ] Write tests for error classification
- [ ] Verify classification works with real SDK errors

### Phase 2: Circuit Breaker Implementation
- [ ] Create `SessionCircuitBreaker` interface in sdkSessionManager.ts
  ```typescript
  interface CircuitBreakerState {
    attempts: number;
    maxAttempts: number;
    lastError: Error | null;
    status: 'closed' | 'retrying' | 'open';
  }
  ```
- [ ] Implement `attemptSessionResume()` method:
  - [ ] Retry loop with exponential backoff
  - [ ] Call `classifySessionError()` for smart decisions
  - [ ] Session expired → skip retries
  - [ ] Network error → retry up to 3 times
  - [ ] Auth error → fail fast
- [ ] Add comprehensive logging at each retry
- [ ] Write unit tests for retry logic

### Phase 3: User Recovery Dialog
- [ ] Create `showSessionRecoveryDialog()` in extension.ts
- [ ] Different messages based on error type:
  - Session expired: "Previous session not found"
  - Network: "Cannot connect to Copilot CLI"
  - Unknown: "Failed to resume session"
- [ ] Modal dialog with:
  - [ ] Error details and attempt count
  - [ ] "Try Again" button (resets circuit, retries)
  - [ ] "Start New Session" button (creates fresh session)
- [ ] Wire up button handlers
- [ ] Test dialog appearance and behavior

### Phase 4: Integration
- [ ] Update `start()` method in sdkSessionManager.ts (lines 178-209)
- [ ] Replace current try-catch with `attemptSessionResume()` call
- [ ] Handle user's choice from recovery dialog
- [ ] Ensure session expired event fires when creating new session
- [ ] Update UI to show "Resuming..." status during retries

### Phase 5: Testing
- [ ] Manual test scenarios:
  - [ ] Network temporarily down → retries work, eventually succeeds
  - [ ] Session truly deleted → user dialog shows, can choose new session
  - [ ] User chooses "Try Again" → circuit resets, retries work
  - [ ] User chooses "New Session" → clean start with empty history
  - [ ] Auth error → fails fast without retries
- [ ] Integration test with mock SDK
- [ ] Verify logging provides good debugging info

### Phase 6: Documentation
- [ ] Update CHANGELOG.md with v2.2.3 entry
- [ ] Update README.md with resilience feature
- [ ] Add comments explaining circuit breaker pattern
- [ ] Document error classification for future maintainers

## Technical Details

### Error Classification Logic

```typescript
function classifySessionError(error: Error): ErrorType {
  const msg = error.message.toLowerCase();
  
  // Session doesn't exist anymore
  if (msg.includes('not found') || msg.includes('session') && msg.includes('invalid')) {
    return 'session_expired';
  }
  
  // Client not ready (retriable)
  if (msg.includes('not connected') || msg.includes('not ready')) {
    return 'session_not_ready';
  }
  
  // Network issues (retriable)
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('econnrefused')) {
    return 'network_timeout';
  }
  
  // Auth issues (not retriable)
  if (msg.includes('unauthorized') || msg.includes('authentication') || msg.includes('token')) {
    return 'authentication';
  }
  
  return 'unknown';
}
```

### Retry Implementation

```typescript
async attemptSessionResume(sessionId: string): Promise<Session> {
  const breaker: CircuitBreakerState = {
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    status: 'closed'
  };
  
  while (breaker.attempts < breaker.maxAttempts) {
    try {
      breaker.attempts++;
      this.logger.info(`[Resume] Attempt ${breaker.attempts}/${breaker.maxAttempts}`);
      
      const session = await this.client.resumeSession(sessionId);
      this.logger.info('[Resume] ✅ Success');
      return session;
      
    } catch (error) {
      breaker.lastError = error;
      const errorType = classifySessionError(error);
      
      this.logger.warn(`[Resume] Attempt ${breaker.attempts} failed: ${errorType}`);
      
      // Don't retry if session is expired
      if (errorType === 'session_expired') {
        this.logger.info('[Resume] Session expired, no retries');
        break;
      }
      
      // Don't retry auth errors
      if (errorType === 'authentication') {
        this.logger.error('[Resume] Auth error, failing fast');
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      if (breaker.attempts < breaker.maxAttempts) {
        const backoff = Math.pow(2, breaker.attempts - 1) * 1000;
        this.logger.info(`[Resume] Waiting ${backoff}ms before retry...`);
        await sleep(backoff);
      }
    }
  }
  
  // All retries failed - ask user
  breaker.status = 'open';
  const userChoice = await showSessionRecoveryDialog(sessionId, breaker);
  
  if (userChoice === 'retry') {
    return this.attemptSessionResume(sessionId); // Recursive retry
  } else {
    this.logger.info('[Resume] User chose new session');
    const newSession = await this.client.createSession();
    this.emitSessionExpired(newSession.sessionId);
    return newSession;
  }
}
```

### User Dialog

```typescript
async function showSessionRecoveryDialog(
  sessionId: string, 
  breaker: CircuitBreakerState
): Promise<'retry' | 'new'> {
  
  const errorType = classifySessionError(breaker.lastError);
  
  let message: string;
  let detail: string;
  
  if (errorType === 'session_expired') {
    message = 'Previous session not found';
    detail = `Session ${sessionId.substring(0, 8)}... appears to have been deleted or expired.`;
  } else if (errorType === 'network_timeout') {
    message = 'Cannot connect to Copilot CLI';
    detail = `Network error after ${breaker.attempts} attempts: ${breaker.lastError.message}`;
  } else {
    message = 'Failed to resume session';
    detail = `Unknown error after ${breaker.attempts} attempts: ${breaker.lastError.message}`;
  }
  
  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true, detail },
    'Try Again',
    'Start New Session'
  );
  
  return choice === 'Try Again' ? 'retry' : 'new';
}
```

## Benefits

✅ Handles transient network issues automatically
✅ Doesn't spam user with dialogs immediately  
✅ User has final say on session fate
✅ Better UX than silent session loss
✅ Detailed logging for debugging
✅ No infinite retry loops

## Risks & Mitigations

**Risk:** Retries delay extension startup
**Mitigation:** Max 7 seconds total (1s + 2s + 4s), reasonable for reliability

**Risk:** User confused by dialog
**Mitigation:** Clear messages explaining what happened and what options mean

**Risk:** Retry logic has bugs
**Mitigation:** Comprehensive logging, unit tests, manual testing scenarios

## Success Criteria

- [ ] Transient network errors recover automatically without user intervention
- [ ] Expired sessions show clear dialog, don't lose history silently
- [ ] Logs show detailed retry timeline for debugging
- [ ] No infinite retry loops or extension hangs
- [ ] User experience feels polished, not jarring
- [ ] All existing tests still pass
- [ ] Manual test scenarios all work correctly

## Dependencies

- Existing error classification in `authUtils.ts`
- SDK's `resumeSession()` method behavior
- VS Code dialog APIs

## Timeline Estimate

- Phase 1: Error Classification - 1-2 hours
- Phase 2: Circuit Breaker - 2-3 hours  
- Phase 3: User Dialog - 1-2 hours
- Phase 4: Integration - 1 hour
- Phase 5: Testing - 2-3 hours
- Phase 6: Documentation - 1 hour

**Total:** 8-12 hours of focused development

## References

- Original research in v2.2.2 planning: `/home/smolen/.copilot/session-state/2b44701f-c54a-46e0-8140-2d31e8db38ca/plan.md`
- SDK session tests: `research/copilot-sdk/nodejs/test/e2e/session.test.ts`
- Current implementation: `src/sdkSessionManager.ts` lines 176-209
