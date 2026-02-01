# Integration Test Plan for Plan Mode Issues

## Overview
Create SDK-based integration tests (NOT mocked) to verify:
- Issue #4: Plan mode custom tools work correctly with SDK
- Issue #5: Session persistence and event handlers after plan mode exit
- Issue #6: UI button states transition correctly (needs investigation)

## Current Test Files
- `plan-mode-tools.test.js` - Direct tool handler tests (no SDK)
- `plan-mode-integration.test.js` - SDK integration tests (has mocks for vscode)

## Test Strategy

### Issue #4: Plan Mode Custom Tools with SDK

**Goal**: Verify all custom tools work with real SDK (`defineTool()` wrappers)

**Tests Needed**:

1. ✅ **update_work_plan tool exists**
   - Send message requesting tool use
   - Verify SDK doesn't return "tool does not exist" error
   - Verify plan file gets created/updated
   - Verify content matches what was requested

2. ✅ **create tool (allowed case)**
   - Delete plan.md if exists
   - Request creating session plan.md with content
   - Verify file created with correct content
   - Verify SUCCESS response, not "blocked" message

3. ✅ **create tool (blocked case - wrong path)**
   - Request creating file OTHER than plan.md
   - Verify file is NOT created
   - Verify BLOCKED response message

4. ✅ **create tool (blocked case - already exists)**
   - Ensure plan.md exists
   - Request creating plan.md again
   - Verify BLOCKED response (use update_work_plan instead)

5. ✅ **bash tool (allowed commands)**
   - Test read-only commands: `ls`, `git status`, `cat`, `grep`, `find`, `pwd`
   - Verify commands execute successfully
   - Verify output returned

6. ✅ **bash tool (blocked commands)**
   - Test dangerous commands: `rm`, `git commit`, `npm install`, `make`
   - Verify commands are BLOCKED
   - Verify appropriate error message

7. ✅ **bash tool (unknown commands)**
   - Test commands not in whitelist: `./script.sh`, `my-tool`
   - Verify commands are REJECTED
   - Verify "not in whitelist" message

8. **SDK tool registration**
   - After enablePlanMode(), inspect registered tools
   - Verify custom tools appear in session.tools
   - Verify tool names match: `update_work_plan`, `create`, `bash`

9. **Multiple tool calls in sequence**
   - Call update_work_plan, then bash, then create
   - Verify all work without interference
   - Verify session state remains stable

**Implementation**:
- Extend `plan-mode-integration.test.js`
- Use real SDK session creation
- Don't mock SDK or CLI server responses
- Test actual tool invocation through `sendMessage()`
- Verify by checking filesystem and response content

---

### Issue #5: Session Persistence After Plan Mode

**Goal**: Verify work session stays alive and event handlers work after exiting plan mode

**Tests Needed**:

1. **Work session survives plan mode entry**
   - Start work session, capture session ID
   - Enable plan mode
   - Verify work session object still exists
   - Verify workSessionId field preserved

2. **Work session resumed after plan mode exit**
   - Enable plan mode
   - Disable plan mode
   - Verify session ID matches original work session ID
   - Verify currentMode === 'work'

3. **Event handlers re-attached**
   - Start work session
   - Capture initial event handler registration
   - Enable plan mode (handlers unsubscribed)
   - Disable plan mode
   - Send message and verify events fire (proves handlers working)
   - Check: assistant.message, assistant.usage, assistant.done events

4. **Messages work after plan mode exit**
   - Enable then disable plan mode
   - Send a simple message like "say hello"
   - Verify response received
   - Verify no session errors

5. **Accept plan flow**
   - Enable plan mode
   - Accept plan (acceptPlan())
   - Verify work session resumed
   - Verify plan changes kept
   - Verify can send messages

6. **Reject plan flow**
   - Enable plan mode with existing plan.md
   - Make changes to plan
   - Reject plan (rejectPlan())
   - Verify work session resumed
   - Verify plan reverted to snapshot

7. **Event subscription tracking**
   - Check sessionUnsubscribe is set after setupSessionEventHandlers()
   - Enable plan mode - verify sessionUnsubscribe called
   - Disable plan mode - verify new sessionUnsubscribe created
   - No double-subscriptions

**Implementation**:
- Create new test file: `tests/plan-mode-session-state.test.js`
- Track session IDs through mode transitions
- Monitor event emissions
- Test both accept and reject flows
- Verify no "session does not exist" errors

---

### Issue #6: UI Button State Transitions

**Goal**: Understand and test why buttons don't update correctly

**Investigation Needed First**:

1. **Check status event emission**
   - In sdkSessionManager.ts, verify status events emitted:
     - `plan_mode_enabled` when enablePlanMode() called
     - `plan_mode_disabled` when disablePlanMode() called
     - `plan_accepted` when acceptPlan() called
     - `plan_rejected` when rejectPlan() called

2. **Check webview receives events**
   - In chatViewProvider.ts, verify message handler receives status events
   - Add logging in updatePlanModeUI() to see if it's called

3. **Check button element state**
   - After updatePlanModeUI(), verify button display properties set correctly
   - Check if buttons are being recreated/lost somehow

**Tests Needed** (after investigation):

1. **Status event emitted on plan mode entry**
   - Enable plan mode
   - Capture onMessage events
   - Verify `plan_mode_enabled` status event emitted with correct data

2. **Status event emitted on plan mode exit**
   - Disable plan mode
   - Verify `plan_mode_disabled` status event emitted

3. **Status event emitted on accept**
   - Accept plan
   - Verify `plan_accepted` status event emitted

4. **Status event emitted on reject**
   - Reject plan
   - Verify `plan_rejected` status event emitted

5. **Event data structure**
   - Verify status events have correct shape:
     ```js
     {
       type: 'status',
       data: { status: 'plan_mode_enabled', ... },
       timestamp: number
     }
     ```

**Implementation**:
- Create test file: `tests/plan-mode-ui-events.test.js`
- Mock chatViewProvider or test from extension.ts
- Capture all events fired through onMessageEmitter
- Verify event sequence and data
- This might reveal WHY buttons aren't updating

---

## Test Execution Plan

### Phase 1: Fix Issue #4 Tests (PRIORITY)
1. Compile extension with `defineTool()` fixes
2. Run `npm test` or `node tests/plan-mode-integration.test.js`
3. Verify all custom tools work
4. Check logs for "Tool does not exist" errors (should be none)

### Phase 2: Create Issue #5 Tests
1. Write `plan-mode-session-state.test.js`
2. Test session ID persistence
3. Test event handler re-attachment
4. Test accept/reject flows
5. Verify no session recreation when not needed

### Phase 3: Investigate Issue #6
1. Add debug logging to sessionManager status event emissions
2. Add debug logging to chatViewProvider event handling
3. Add debug logging to updatePlanModeUI()
4. Reproduce button issue manually
5. Check logs to see where event flow breaks

### Phase 4: Create Issue #6 Tests
1. Write `plan-mode-ui-events.test.js`
2. Test all status event emissions
3. Test event data correctness
4. Create UI test if possible (hard without real webview)

---

## Success Criteria

### Issue #4: Custom Tools
- [ ] All 3 custom tools (`update_work_plan`, `create`, `bash`) work with SDK
- [ ] No "Tool does not exist" errors
- [ ] Tools enforce restrictions correctly (bash read-only, create plan.md-only)
- [ ] Multiple tool calls don't interfere with each other

### Issue #5: Session Persistence
- [ ] Work session ID unchanged after plan mode entry/exit
- [ ] Event handlers work after plan mode exit
- [ ] Messages can be sent after plan mode exit
- [ ] Accept plan keeps work session alive
- [ ] Reject plan keeps work session alive
- [ ] No double event subscriptions

### Issue #6: Button States
- [ ] Entering plan mode emits `plan_mode_enabled` event
- [ ] Exiting plan mode emits `plan_mode_disabled` event
- [ ] Accept emits `plan_accepted` event
- [ ] Reject emits `plan_rejected` event
- [ ] UI receives and processes all events
- [ ] Buttons update to correct visibility state

---

## Notes

- **DO NOT mock SDK or CLI server** - use real @github/copilot-sdk
- **CAN mock VS Code API** - extension context, workspace, etc.
- **Test with actual filesystem** - create/delete real plan.md files
- **Use temporary session IDs** - clean up after tests
- **Check logs for errors** - verbose logging during tests
- **Run in CI** - ensure tests pass in clean environment
