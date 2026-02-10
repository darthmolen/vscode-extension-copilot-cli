# Process Explorer Workspace Bug - TDD Victory

**Date:** 2026-02-10  
**Bug:** Session dropdown shows "No sessions" when panel dragged from Process Explorer to main window  
**Result:** ✅ FIXED with proper RED-GREEN-REFACTOR

## The Bug

When chat panel opened in Process Explorer (auxiliary window) and then dragged to main editor window:
- Sessions appeared correctly in Process Explorer
- After dragging to main window: dropdown showed "No sessions"
- Workspace context was correct (logged as `/home/smolen/dev/vscode-copilot-cli-extension`)
- But dropdown never refreshed

## Investigation Process

### Step 1: Add Debug Logging
Added comprehensive workspace context logging in three locations:
- `updateSessionsList()`: Log workspace path and filtering
- `createOrShow()`: Log workspace when panel created
- `onDidChangeViewState`: Log workspace when panel moves

### Step 2: Analyze Logs
Discovered:
- `onDidChangeViewState` triggered when panel moved ✅
- Workspace context was correct (same path) ✅
- **BUT**: `updateSessionsList()` was NOT called ❌

### Step 3: Root Cause
```typescript
// BEFORE (buggy code):
ChatPanelProvider.panel.onDidChangeViewState(
    e => {
        // Logs workspace context
        // But never calls updateSessionsList()!
    },
    null,
    disposables
);
```

The handler logged for debugging but never refreshed the dropdown.

## The Fix (RED-GREEN-REFACTOR)

### RED Phase - Write Failing Tests

Created `tests/panel-viewstate-update.test.js` with 2 tests:
1. Verify `updateSessionsList()` called in `onDidChangeViewState` handler
2. Verify dropdown refreshes when panel moves

**Tests read actual source code** - not mocks!

```javascript
const handlerMatch = sourceCode.match(/onDidChangeViewState\s*\(\s*e\s*=>\s*{([\s\S]*?)},\s*null,\s*disposables/);
const handlerBody = handlerMatch[1];
expect(handlerBody).to.match(/updateSessionsList\s*\(/);
```

**Result:** Both tests FAILED ✅
```
AssertionError: onDidChangeViewState should call updateSessionsList() when panel moves
expected '...Log when panel mo...' to match /updateSessionsList\s*\(/
```

### GREEN Phase - Minimal Fix

Added 3 lines to `src/chatViewProvider.ts`:
```typescript
// Fix: Update session list when panel moves
const { updateSessionsList } = require('./extension');
updateSessionsList();
```

**Result:** Both tests PASSED ✅

### Manual Verification

1. Built and installed extension v3.0.0
2. Opened Process Explorer
3. Clicked Copilot CLI status bar → panel opened in Process Explorer
4. Verified sessions appeared in dropdown
5. Dragged panel to main editor window
6. **✅ SUCCESS: Sessions still appear in dropdown!**

## Lessons Learned

### "Measure Twice, Fix Once"

1. **Measure #1**: Add comprehensive debug logging
2. **Measure #2**: Write failing tests that prove the bug
3. **Fix Once**: Apply minimal change, verify tests pass

### TDD Discipline Pays Off

- Found bug through manual testing
- Added logging to understand root cause
- Wrote tests that FAILED against buggy code (RED)
- Applied minimal fix (GREEN)
- Tests PASSED
- Manual verification confirmed fix works

**No rework. No guessing. No wasted effort.**

### Defense in Depth

This was the **FOURTH** timing/state bug we found in Phase 4:
1. View Plan button: Workspace path arrives after init
2. Session dropdown (first): Updated before session has ID
3. Session dropdown (second): Updated before session resumes
4. **Process Explorer**: Dropdown never refreshed on panel move

All four bugs taught us: **Watch state changes. Update UI when state changes.**

## Test Evidence

**Before (buggy code):**
```bash
$ npx mocha tests/panel-viewstate-update.test.js

  Panel ViewState Change
    1) should call updateSessionsList when viewState changes
    2) should update dropdown when panel moves between windows

  0 passing (3ms)
  2 failing
```

**After (fixed code):**
```bash
$ npx mocha tests/panel-viewstate-update.test.js

  Panel ViewState Change
    ✔ should call updateSessionsList when viewState changes
    ✔ should update dropdown when panel moves between windows

  2 passing (2ms)
```

## Commit

**Commit:** `825a703`  
**Message:** `fix: Update session dropdown when panel moves between windows`  
**Tests:** 73 total (was 71)  
**Branch:** `feature/3.0.0`

## Impact

Users can now:
- Open chat panel in any window (Process Explorer, main editor, etc.)
- Drag panel between windows
- **Sessions always appear correctly in dropdown** ✅

No more "No sessions" mystery bug!
