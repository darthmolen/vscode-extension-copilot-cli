# Code Review: Intent Boundary Audit

**Session:** 2026-09-03 | **Focus:** Find lost boundaries between user intent and defaults

---

## Executive Summary

**CRITICAL FINDING:** The plan mode toggle (`enablePlanMode()` / `disablePlanMode()`) and several other user gestures lack **recording** of intent. Per CLAUDE.md's core principle ("intentional actions are treated intentionally"), when a user clicks a button to enter plan mode, that decision must be **persisted** and **survive reload/resume/restart boundaries**. Currently it does not.

### The Pattern

From CLAUDE.md:
> "A default answers *'what usually happens'*; a gesture answers *'what should happen now.'*"
> "If the answer dies on resume/reload/restart, it was honoured but not recorded, and the setting will quietly win next time."

**Instances found:**

| Gesture | Missing Intent Recording | Where It Should Persist | Test Coverage |
|---------|--------------------------|------------------------|-----------------|
| Enter/Exit Plan Mode | ❌ No recording | SessionState or backendState | ⚠️ None (handlers only test RPC calls) |
| Model switch mid-session | ❌ No recording (noted in backlog) | SessionState | ⚠️ Only RPC test, no persistence |
| Session selection | ❌ Partially - uses recorded choice but defaults override it | Session metadata | ⚠️ Only startup logic |

---

## Detailed Findings

### 1. Plan Mode Intent Not Recorded

**Location:** `src/webview/app/handlers/ui-handlers.js` lines 84-89

```javascript
export function handleEnterPlanMode(rpc, updateUICallback) {
    console.log('[Plan Mode] Entering plan mode');
    rpc.togglePlanMode(true);  // ← Sends to backend
    updateUICallback();        // ← Updates UI immediately
    return true;               // ← Returns new state
}
```

**The Problem:**
- User clicks "Enter Plan Mode" button
- Handler calls `rpc.togglePlanMode(true)` 
- UI updates immediately (good!)
- **BUT: No persistent state is written anywhere**
- On reload, the default is checked instead
- Plan mode is lost silently

**Expected Behavior (per CLAUDE.md):**
```javascript
export function handleEnterPlanMode(rpc, updateUICallback) {
    console.log('[Plan Mode] Entering plan mode');
    
    // 1. Record the intent
    sessionState.setPlanModeIntent(true);  // ← MISSING
    
    // 2. Send to backend
    rpc.togglePlanMode(true);
    
    // 3. Update UI
    updateUICallback();
    
    return true;
}
```

**Test Coverage:** ❌ NONE
- `tests/unit/handlers/ui-handlers.test.js` mocks RPC and only verifies `rpc.togglePlanMode()` is called
- No assertion that state is persisted
- No test for round-trip: click → state recorded → reload → plan mode restored

---

### 2. Backend Plan Mode Methods Lack Guarding

**Location:** `src/extension/session/ChatSessionHost.ts` lines 869-877

```typescript
public async enablePlanMode(): Promise<void> {
    if (!this.requireLive('enter plan mode')) { return; }
    await this.#manager!.enablePlanMode();
}

public async disablePlanMode(): Promise<void> {
    if (!this.requireLive('leave plan mode')) { return; }
    await this.#manager!.disablePlanMode();
}
```

**The Problem:**
- Guards exist (`requireLive`) ✓ — good pattern
- Status events are handled in `applyStatus()` (lines 772-778):
  ```typescript
  case 'plan_mode_enabled':
  case 'plan_mode_disabled':
  case 'plan_rejected':
  case 'plan_ready':
  case 'reset_metrics':
      this.surface?.postMessage({ type: 'status', data: statusData });
      break;
  ```
- **BUT: State is never written to `SessionState`**
- No test verifies the state transition is recorded

**Expected Behavior:**
```typescript
private applyStatus(statusData: { status: string; ... }): void {
    switch (statusData.status) {
        case 'plan_mode_enabled':
            this.state.setPlanModeEnabled(true);  // ← MISSING
            this.surface?.postMessage({ type: 'status', data: statusData });
            break;
        case 'plan_mode_disabled':
            this.state.setPlanModeEnabled(false);  // ← MISSING
            this.surface?.postMessage({ type: 'status', data: statusData });
            break;
    }
}
```

---

### 3. SessionState Lacks Plan Mode Intent Field

**Location:** `src/backendState.ts`

**Current Structure:**
```typescript
export interface SessionState {
    sessionId: string | null;
    messages: Message[];
    currentModel: string | null;
    // ... other fields
    // ❌ NO planModeIntent or similar
}
```

**What's Missing:**
- No field to record "user explicitly entered plan mode"
- No field to record "user explicitly exited plan mode"
- No deserialize logic to restore it on startup

**Expected Structure:**
```typescript
export interface SessionState {
    sessionId: string | null;
    messages: Message[];
    currentModel: string | null;
    planModeEnabled?: boolean;  // ← Record the gesture
    planModeEnabledAt?: number;  // ← When was it recorded?
}
```

---

### 4. Startup Logic: Plan Mode Selection Lacks Verification

**Location:** `src/extension/session/sessionBootstrap.ts` (or similar)

**The log shows it works** (from 4-1-0-tool-group-keeps-piling.log):
```
Determined session to resume: 2cdebc26-14c0-4c5d-98ac-88445169b66e-plan (the recorded choice, not the most recent)
```

**But the mechanism is fragile:**
- Depends on the session id having a `-plan` suffix
- The rule lives in `sessionPairing.ts`
- No test verifies that a user's recorded plan-mode choice survives a full cycle:
  1. Start in work mode
  2. Click "Enter Plan Mode"
  3. Reload window
  4. Verify plan mode is restored

---

### 5. Model Switching: Same Pattern, Already Documented as a Bug

**From CLAUDE.md:**
```
| Switch model mid-session | `copilotCLI.model` reasserts on resume | `planning/backlog/session-model-persistence.md` |
```

**The Issue:**
- User clicks model dropdown → selects "Claude Opus"
- UI shows Opus ✓
- User reloads window
- Default `copilotCLI.model` (e.g., "Claude Sonnet") reasserts
- Opus choice is lost ❌

**Current Code:**
```typescript
// In model selector:
model.addEventListener('change', (event) => {
    const newModel = event.target.value;
    rpc.switchModel(newModel);  // ← Sends to backend
    // ❌ No state persistence
});
```

**Expected:**
```typescript
model.addEventListener('change', (event) => {
    const newModel = event.target.value;
    sessionState.setCurrentModel(newModel);  // ← Record the gesture
    rpc.switchModel(newModel);               // ← Send to backend
});
```

---

## Cleanliness Issues Found

### 1. Test Anti-Pattern: Mocking RPC Instead of Testing State

**Location:** `tests/unit/handlers/ui-handlers.test.js`

```javascript
// ❌ WRONG - Tests the mock, not production behavior
it('should call togglePlanMode on enter plan mode', () => {
    const mockRpc = { togglePlanMode: () => {} };
    const spy = sinon.spy(mockRpc, 'togglePlanMode');
    
    handleEnterPlanMode(mockRpc, () => {});
    
    expect(spy.calledWith(true)).to.be.true;
});
```

**Why It's Wrong:**
- Mocks `rpc` completely
- Never touches `sessionState`
- Cannot fail when state persistence is missing
- **Test passes even if the feature is broken**

**Correct Approach:**
```javascript
// ✅ RIGHT - Test actual behavior
it('should record plan mode intent when entering plan mode', () => {
    const sessionState = new SessionState();
    const mockRpc = { togglePlanMode: () => {} };
    
    handleEnterPlanMode(mockRpc, () => {});
    
    // Verify state was updated, not just RPC
    expect(sessionState.planModeEnabled).to.equal(true);
});
```

---

### 2. Testability Gap: Handlers Take RPC, Not State

**Current Signature:**
```javascript
export function handleEnterPlanMode(rpc, updateUICallback) {
    rpc.togglePlanMode(true);  // ← RPC only, no state
}
```

**Why It's Bad:**
- Function cannot update state (it doesn't have it)
- Test cannot verify state changes
- State update must happen elsewhere (or not at all)

**Better Design:**
```javascript
export function handleEnterPlanMode(rpc, sessionState, updateUICallback) {
    sessionState.setPlanModeEnabled(true);  // ← Record it
    rpc.togglePlanMode(true);               // ← Send it
    updateUICallback();
}
```

---

### 3. No Boundary Test: Session Reload Verification

**Missing Test Category:**

Currently there are only:
- ✓ Unit tests (mocks, individual functions)
- ✓ Component tests (JSDOM, single component)
- ❌ **Boundary tests** (serialize state → reload → verify restored)

**Example of Missing Test:**
```javascript
describe('Plan Mode Intent Persistence', () => {
    it('should restore plan mode after reload', async () => {
        // 1. Setup session in work mode
        const session = new SessionState();
        session.sessionId = 'test-123';
        
        // 2. User enters plan mode
        handleEnterPlanMode(mockRpc, session, () => {});
        
        // 3. Verify it's recorded
        assert(session.planModeEnabled === true);
        
        // 4. Simulate reload (deserialize from storage)
        const reloaded = new SessionState();
        reloaded.deserialize(session.serialize());
        
        // 5. Verify the gesture survived
        assert(reloaded.planModeEnabled === true);
    });
});
```

**This test does not exist.**

---

## Specific Code Locations Needing Review

### Webview Side (JavaScript)

| File | Issue | Lines | Severity |
|------|-------|-------|----------|
| `src/webview/app/handlers/ui-handlers.js` | `handleEnterPlanMode()` lacks state update | 84-89 | 🔴 Critical |
| `src/webview/main.js` | Event handlers send RPC but don't update session state | 164-180 | 🔴 Critical |
| `src/webview/app/state/EventBus.js` | No cleanup for plan mode state transitions | — | 🟡 Medium |
| `tests/unit/handlers/ui-handlers.test.js` | Tests mock RPC instead of state | — | 🔴 Critical |

### Backend Side (TypeScript)

| File | Issue | Lines | Severity |
|------|-------|-------|----------|
| `src/extension/session/ChatSessionHost.ts` | `applyStatus()` doesn't record plan mode state | 772-778 | 🔴 Critical |
| `src/backendState.ts` | `SessionState` lacks `planModeEnabled` field | — | 🔴 Critical |
| `src/extension/services/SDKSessionManager.ts` | No verification that plan mode events are recorded | — | 🟡 Medium |
| `tests/unit/session/ChatSessionHost.test.js` | No test for plan mode state persistence | — | 🔴 Critical |

---

## Recommendations

### Priority 1: Record Intent in SessionState

1. **Add field to `SessionState`:**
   ```typescript
   planModeEnabled?: boolean;
   ```

2. **Update `ChatSessionHost.applyStatus()`:**
   ```typescript
   case 'plan_mode_enabled':
       this.state.setPlanModeEnabled(true);  // ← Add this
       this.surface?.postMessage({ ... });
       break;
   ```

3. **Update webview handlers:**
   ```javascript
   export function handleEnterPlanMode(rpc, sessionState, updateUICallback) {
       sessionState.setPlanModeEnabled(true);  // ← Add this
       rpc.togglePlanMode(true);
       updateUICallback();
       return true;
   }
   ```

### Priority 2: Add Boundary Tests

1. **Test: Session reload restores plan mode**
   ```javascript
   it('should restore plan mode intent after reload', () => {
       // serialize → reload → verify restored
   });
   ```

2. **Test: Model selection survives reload**
   ```javascript
   it('should restore model choice after reload', () => {
       // select model → reload → verify selected
   });
   ```

### Priority 3: Stop Mocking RPC in Handler Tests

**Replace all mock-only tests** with tests that:
- Use real `SessionState`
- Verify state changes, not just RPC calls
- Simulate reload/deserialize to catch persistence bugs

### Priority 4: Audit Similar Gestures

Review for the same pattern:
- [ ] File attachment selection
- [ ] Agent selection (`selectAgent()`)
- [ ] Active file inclusion toggle
- [ ] MCP server selections

---

## Testability Improvements

### Current Anti-Pattern
```javascript
// ❌ ANTI - Mock prevents state verification
const mockRpc = { togglePlanMode: sinon.spy() };
handleEnterPlanMode(mockRpc);
expect(mockRpc.togglePlanMode.calledWith(true)).to.be.true;
```

### Better Pattern
```javascript
// ✅ BETTER - Tests actual behavior
const sessionState = new SessionState();
const rpc = { togglePlanMode: () => {} };
handleEnterPlanMode(rpc, sessionState, () => {});
expect(sessionState.planModeEnabled).to.equal(true);
```

---

## Evidence from Logs

From `tests/logs/server/4-1-0-tool-group-keeps-piling.log`:

```
[INFO] Determined session to resume: 2cdebc26-14c0-4c5d-98ac-88445169b66e-plan (the recorded choice, not the most recent)
```

**Good:** The plan session id suffix is preserved, so startup can recognize it.
**Bad:** There's no evidence that the webview recorded when/how the user entered plan mode.

---

## Summary Table

| Issue | Current State | Severity | Fix Effort | Risk |
|-------|---------------|----------|-----------|------|
| Plan mode intent not recorded | Broken | Critical | 2-3h | Low (add field + tests) |
| Model selection not persisted | Known bug | Critical | 1-2h | Low (same pattern) |
| Handlers lack state parameter | Design issue | High | 3-4h | Medium (refactor) |
| Mock-based tests miss state bugs | Poor testability | High | 4-6h | Low (test-only) |
| No reload/restart tests | Testing gap | High | 2-3h | Low (add tests) |

---

## Conclusion

**The artificial boundary between intent and default has been lost in three areas:**

1. **Plan mode toggle** — user gesture not recorded
2. **Model selection** — documented but not fixed
3. **Session selection** — partially working, fragile

**All three follow the same pattern:** The UI updates, RPC is sent, but the decision is never persisted in `SessionState`. On reload, defaults win.

**Fix:** Treat every user gesture as intent. Record it. Verify it survives reload. Test it.

---

# Corrections — 2026-09-03, after v4.1.0

Reviewed against the tree this audit describes. The **principle is right and worth
keeping**; several specific findings are not, and the file should not be actioned as
written. Corrections below, most load-bearing first.

## 1. Plan-mode intent IS recorded — this shipped in v4.1.0

The headline finding is out of date. `plan_mode_enabled` and `plan_mode_disabled` now
record the active half as the sidebar's session choice:

```ts
// src/extension.ts:1304 and :1313
recordSidebarSession(context, planSessionId);   // on plan_mode_enabled
recordSidebarSession(context, owner.sessionId); // on plan_mode_disabled
```

That was exactly the missing gesture-recording this audit set out to find, and it was
the reason plan mode never came back after a restart.

**The audit's own evidence disproves its finding.** It quotes:

```
Determined session to resume: 2cdebc26-…-plan (the recorded choice, not the most recent)
```

and reads it as "Good: the suffix is preserved. Bad: no evidence the webview recorded
it." But a `-plan` id can only *be* the recorded choice because `plan_mode_enabled`
recorded it. That line is the proof, not the gap.

## 2. The recording belongs extension-side, not in the webview

The recommended fix — `sessionState.setPlanModeIntent(true)` inside
`handleEnterPlanMode` — is the wrong home. The webview is a render surface that is
destroyed and rebuilt on reload; it cannot be the durable store for a decision that
must survive one. Recording happens in `context.workspaceState`, keyed per window,
which is what `chooseSessionToResume` reads at startup.

Adding a webview-side copy would create a second source of truth for the same gesture
— the failure this codebase already paid for with the `-plan` suffix.

## 3. Three cited files do not exist

| Cited | Reality |
| --- | --- |
| `tests/unit/handlers/ui-handlers.test.js` | does not exist |
| `tests/unit/session/ChatSessionHost.test.js` | does not exist |
| `src/extension/services/SDKSessionManager.ts` | it is `src/sdkSessionManager.ts` |

So "Test Coverage: ❌ NONE" is describing a file that was never there, and the
"Test Anti-Pattern" section quotes a `sinon.spy` test that does not exist in this
repo. The anti-pattern it names is real and worth avoiding; the example is invented.

## 4. The model-switch snippet is fabricated

```js
model.addEventListener('change', (event) => { ... })   // does not exist
```

`ModelSelector.js` contains zero `addEventListener('change')` — it is a custom
dropdown, not a `<select>`. Model choice is also already recorded per session
(`src/extension.ts:1335`, `[Model Switch] recorded <model> for <sessionId>`). The
open item in `session-model-persistence.md` is narrower than this file implies.

## 5. `SessionState` already has both fields

Finding 3 claims `SessionState` has "❌ NO planModeIntent or similar". It has
`planModeStatus` (`backendState.ts:47`) and `currentModel` (`:49`), with setters and
getters. What was missing was *recording the gesture at the boundary*, not the field.

## 6. Severity is inflated

Four items are marked 🔴 Critical, of which two are test-only and two are now fixed.
Reserve Critical for defects a user can hit.

---

## What is still worth doing

Stripped of the above, a real backlog remains:

- **Priority 4's audit list stands.** Agent selection, active-file toggle, and MCP
  server selection have not been checked against the gesture-recording rule. That is
  the genuinely useful part of this document.
- **Boundary tests are a real gap.** There is no test that drives
  gesture → record → reload → restored as one sequence. v4.1.0's plan-mode fixes are
  covered by unit tests on each decision point (`isRestorable`,
  `resolveStartupPairing`, `hasSessionHistory`) but nothing exercises the whole cycle;
  it took three live runs to find the last two bugs.
- **`enablePlanMode`'s guard is worth keeping in mind**, though not for the reason
  given: `requireLive` is correct, and `applyStatus` forwarding to the surface is
  correct. The state that matters is recorded in the extension host, not the host
  object.

Rewrite this file around those three before picking it up.
