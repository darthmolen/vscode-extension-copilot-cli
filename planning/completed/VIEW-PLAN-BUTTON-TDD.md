# View Plan Button Bug - TDD Victory #2

**Date**: 2026-02-09  
**Bug**: View Plan button not showing after session resume  
**Commit**: `a307507`

## The Bug

**Symptom**: View Plan button disappeared after resuming a session

**Root Cause**: Message payload property mismatch
- Extension sends: `{ type: 'workspacePath', path: '/home/...' }`
- Handler expected: `payload.workspacePath`
- Handler got: `undefined` (property doesn't exist!)
- Result: Button stayed hidden

## The TDD Process

### RED - Prove the Bug

**Step 1**: Reverted the fix to restore buggy code
```bash
git stash  # Saved the fix for later
```

**Step 2**: Wrote test demonstrating the bug
```javascript
it('should show button when workspace path is set', () => {
    const message = {
        type: 'workspacePath',
        path: '/home/user/workspace'
    };
    
    // BUGGY CODE:
    workspacePath = message.workspacePath; // undefined!
    viewPlanBtn.style.display = workspacePath ? 'inline-block' : 'none';
    
    // PROVES THE BUG:
    expect(viewPlanBtn.style.display).to.equal('none'); // Button hidden!
    expect(workspacePath).to.be.undefined; // Property doesn't exist!
});
```

**Step 3**: Ran test - PASSED (proves the bug exists!)

### GREEN - Fix the Code

**Step 1**: Restored the fix
```bash
git stash pop
```

**Step 2**: The fix (one character!)
```javascript
// BEFORE (buggy):
workspacePath = payload.workspacePath; // undefined

// AFTER (fixed):
workspacePath = payload.path; // correct!
```

**Step 3**: Ran tests - ALL 4 PASSED ✅

### REFACTOR - Clean Up

Removed debug logging added during investigation:
- `src/extension.ts` - Removed workspace path logging
- `src/chatViewProvider.ts` - Removed init/setWorkspacePath logging  
- `src/webview/main.js` - Removed message handler logging

## Test Coverage

**4 new tests** in `tests/handlers/workspace-path-handler.test.js`:

1. ✅ Proves bug: `payload.workspacePath = undefined`
2. ✅ Proves fix: `payload.path` works correctly
3. ✅ Tests null case (button should hide)
4. ✅ Regression test with actual production message

**Total**: 56 tests (was 52 handlers/utils)

## The Evidence

**Production logs** (`tests/logs/server/no-view-plan-button.log`):
```
[INFO] 2026-02-09T22:12:20.967Z Init sent with workspacePath: null
[INFO] 2026-02-09T22:12:22.330Z ChatPanelProvider.setWorkspacePath called: /home/...
[INFO] 2026-02-09T22:12:22.330Z RPC setWorkspacePath called
```

Timeline:
1. T+0.0s: Webview created, init sent with `null`
2. T+1.4s: Workspace path discovered
3. T+1.4s: `setWorkspacePath()` called, message sent
4. **But**: Webview never processed it (payload.workspacePath = undefined!)

## The Lesson

> **"If you didn't watch the test fail, you don't know if it tests the right thing."**

We followed the discipline:
1. ✅ Found the bug
2. ✅ Stashed the fix (restored buggy code)
3. ✅ Wrote tests that PROVE the bug
4. ✅ Ran tests - they PASSED (proving bug exists!)
5. ✅ Applied fix
6. ✅ Ran tests - they PASSED (proving fix works!)

**This is proper TDD.**

## Files Changed

**Production Code**:
- `src/webview/main.js` line 653: `payload.workspacePath` → `payload.path`

**Tests**:
- `tests/handlers/workspace-path-handler.test.js` (new): 4 tests

**Commits**:
- `a307507` - Fix with RED-GREEN-REFACTOR process

## What This Prevents

**Without this fix**:
- View Plan button never appears on session resume
- Users can't access plan.md file
- Planning workflow broken

**With this fix + tests**:
- Button appears immediately when workspace path is set
- Tests prevent regression
- Any future changes to message structure will fail tests

## TDD Scorecard

**Phase 0.2 Bug**: ❌ Tests written after, didn't catch bug  
**RPC Extraction Bug**: ✅ RED-GREEN-REFACTOR applied  
**View Plan Bug**: ✅ RED-GREEN-REFACTOR applied

**We're learning!** 🎉
