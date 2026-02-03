# Console Logs: Plan Acceptance Workflow

## Overview

This document describes the expected console logs for the plan acceptance workflow implemented in v2.0.7. Use this as a reference when manually testing or debugging the feature.

## Purpose

Help developers and testers verify that the plan acceptance workflow is functioning correctly by documenting:
- Expected console log sequence
- Log prefixes and patterns
- What each log means
- How to identify issues

---

## Expected Console Log Sequence

### Phase 1: Entering Plan Mode

**When**: User clicks 📝 button to enter planning mode

**Expected Logs**:
```
[Plan Mode] Entering plan mode
[updatePlanModeUI] Called with planMode = true
[updatePlanModeUI] PLAN MODE - hiding enter, showing accept/reject
[updatePlanModeUI] Button states: {enter: none, accept: inline-block, reject: inline-block}
[STATUS EVENT] Received status: plan_mode Full data: {status: "plan_mode", ...}
[STATUS EVENT] Enabling plan mode UI
```

**What This Means**:
- Extension received request to enter plan mode
- UI is updating button visibility
- Accept/reject buttons now visible, enter button hidden
- Status event propagated to webview

---

### Phase 2: Agent Creates Plan

**When**: Agent executes `update_work_plan` tool to write plan.md

**Expected Logs**:
- No specific console logs during `update_work_plan` execution
- File operations happen silently
- Plan content written to session state directory

**Note**: Logs will appear in Phase 3 when agent presents the plan

---

### Phase 3: Agent Presents Plan

**When**: Agent calls `present_plan({ summary: "..." })` tool

**Expected Logs**:
```
[Plan Mode] Presenting plan to user: <summary text>
[STATUS EVENT] Received status: plan_ready Full data: {status: "plan_ready", summary: "...", ...}
[Plan Ready] Swapping to acceptance controls
[Control Surface] Swapping to acceptance controls
```

**What This Means**:
- Agent has finished creating plan and is ready for user review
- `present_plan` tool executed successfully
- `plan_ready` status emitted from backend
- UI switching from regular input to acceptance controls
- User now sees acceptance panel instead of normal textarea

**UI State After These Logs**:
- Regular textarea + send button: HIDDEN
- Acceptance controls: VISIBLE
  - Input: "Tell copilot what to do instead"
  - Button: "No, Keep Planning"
  - Button: "Accept and change to work mode"

---

### Phase 4: User Decision

User has three options. Exactly **one** of these log sequences will appear:

#### Path 4a: Accept and Work

**When**: User clicks "Accept and change to work mode" button

**Expected Logs**:
```
[Acceptance] Accept and work
[Plan Mode] Accepting plan
✅ Plan accepted! Ready to implement.
[STATUS EVENT] Received status: accepted Full data: {status: "accepted", ...}
[STATUS EVENT] Disabling plan mode UI, reason: accepted
[updatePlanModeUI] Called with planMode = false
[updatePlanModeUI] WORK MODE - showing enter, hiding accept/reject
[updatePlanModeUI] Button states: {enter: inline-block, accept: none, reject: none}
[Control Surface] Swapping to regular controls
```

**What This Means**:
- User accepted the plan
- Extension exiting plan mode
- UI reverting to work mode
- Regular input controls restored
- Plan mode buttons hidden
- Agent can now proceed with implementation

**UI State After These Logs**:
- Acceptance controls: HIDDEN
- Regular textarea + send button: VISIBLE
- Plan mode buttons (📝 ✅ ❌): Only 📝 visible
- Ready for implementation messages

---

#### Path 4b: Keep Planning

**When**: User clicks "No, Keep Planning" button (with empty input)

**Expected Logs**:
```
[Acceptance] Keep planning
[Control Surface] Swapping to regular controls
[SEND] sendMessage() called, text: ""
[SEND] Posting message to extension: ""
```

**What This Means**:
- User wants to stay in plan mode
- No feedback provided
- Acceptance controls hidden
- Regular input restored
- Agent can continue planning

**UI State After These Logs**:
- Acceptance controls: HIDDEN
- Regular textarea + send button: VISIBLE
- Still in plan mode (📝 ✅ ❌ all visible)
- Agent continues in plan mode context

---

#### Path 4c: Provide Alternative Instructions

**When**: User types feedback and clicks "No, Keep Planning" or "Accept and change to work mode" with text in input

**Expected Logs**:
```
[Acceptance] Sending alternative instructions: <first 50 chars of instructions>...
[Plan Mode] Rejecting plan
❌ Plan rejected. Changes discarded.
[STATUS EVENT] Received status: rejected Full data: {status: "rejected", ...}
[STATUS EVENT] Disabling plan mode UI, reason: rejected
[Control Surface] Swapping to regular controls
[SEND] sendMessage() called, text: <alternative instructions>
[SEND] Posting message to extension: <alternative instructions>
```

**What This Means**:
- User provided alternative instructions
- Plan is being rejected
- User's instructions sent to agent as new message
- Exiting plan mode
- Agent receives feedback and can revise

**UI State After These Logs**:
- Acceptance controls: HIDDEN
- Regular textarea + send button: VISIBLE
- Plan mode exited (back to work mode)
- Alternative instructions sent to agent

---

## Log Categories and Patterns

### 1. Mode Transitions

**Pattern**: `[Plan Mode]`, `[STATUS EVENT]`, `[updatePlanModeUI]`

**Purpose**: Track state transitions between plan mode and work mode

**Key Logs**:
- `[Plan Mode] Entering plan mode` - User requested plan mode
- `[Plan Mode] Accepting plan` - User accepted plan
- `[Plan Mode] Rejecting plan` - User rejected/provided alternatives
- `[STATUS EVENT] Enabling plan mode UI` - UI entering plan mode
- `[STATUS EVENT] Disabling plan mode UI, reason: <reason>` - UI exiting plan mode
- `[updatePlanModeUI] Called with planMode = <boolean>` - UI update triggered

**What to Check**:
- Transitions are clean (no stuck states)
- Reason for disabling matches user action (accepted/rejected)
- Button states match mode (plan buttons visible in plan mode, hidden in work mode)

---

### 2. UI Control Surface Changes

**Pattern**: `[Control Surface]`, `[updatePlanModeUI]`

**Purpose**: Verify button visibility swapping and UI state changes

**Key Logs**:
- `[Control Surface] Swapping to acceptance controls` - Showing acceptance panel
- `[Control Surface] Swapping to regular controls` - Hiding acceptance panel
- `[updatePlanModeUI] Button states: {...}` - Actual button visibility states

**What to Check**:
- Control swaps happen at correct times
- Button states in logs match actual UI
- No visual glitches or stuck controls
- Focus moves to correct input after swap

---

### 3. User Actions

**Pattern**: `[Acceptance]`, `[SEND]`

**Purpose**: Track user interactions and message flow

**Key Logs**:
- `[Acceptance] Accept and work` - Accept button clicked
- `[Acceptance] Keep planning` - Keep planning button clicked
- `[Acceptance] Sending alternative instructions: ...` - User provided feedback
- `[SEND] sendMessage() called, text: ...` - Message being sent
- `[SEND] Posting message to extension: ...` - Message posted to backend

**What to Check**:
- User action logs match what you clicked
- Message content is correct (check first 50 chars preview)
- Messages are actually sent (should see agent response)

---

### 4. Plan Workflow Events

**Pattern**: `[Plan Mode] Presenting plan`, `[Plan Ready]`

**Purpose**: Track agent-initiated workflow triggers

**Key Logs**:
- `[Plan Mode] Presenting plan to user: <summary>` - Tool execution
- `[Plan Ready] Swapping to acceptance controls` - Event received

**What to Check**:
- Summary text matches agent's description
- Event triggers UI swap correctly
- No delay between logs (should be immediate)

---

## How to Test with Console Logs

### 1. Setup

```bash
# Build extension
npm run build

# Package extension
vsce package

# Install in VS Code
# Extensions > ... > Install from VSIX
```

### 2. Open Developer Tools

- **Help** > **Toggle Developer Tools**
- Click **Console** tab
- Filter: `[Plan` to see only plan-related logs

### 3. Test Sequence

**Test 1: Full Accept Flow**
1. Open Copilot CLI panel
2. Click 📝 (enter plan mode)
3. Verify Phase 1 logs appear
4. Send: "Create a plan for adding a new feature"
5. Wait for agent to call `present_plan`
6. Verify Phase 3 logs appear
7. Verify acceptance controls appear in UI
8. Click "Accept and change to work mode"
9. Verify Path 4a logs appear
10. Verify UI returns to work mode

**Test 2: Keep Planning Flow**
1. Enter plan mode (📝)
2. Get agent to present plan
3. Click "No, Keep Planning" (without typing)
4. Verify Path 4b logs appear
5. Verify regular controls return but still in plan mode

**Test 3: Alternative Instructions Flow**
1. Enter plan mode (📝)
2. Get agent to present plan
3. Type: "Make it simpler"
4. Click "No, Keep Planning" or "Accept and change to work mode"
5. Verify Path 4c logs appear
6. Verify message sent to agent with your instructions

---

## Troubleshooting Guide

### Issue: No Phase 3 Logs (Acceptance Panel Doesn't Appear)

**Symptoms**:
- No `[Plan Ready]` log
- No `[Control Surface] Swapping to acceptance controls`
- Acceptance panel never appears

**Possible Causes**:
1. Agent didn't call `present_plan` tool
   - Check if agent finished creating plan
   - Agent might not know about `present_plan` tool
   
2. Event not emitted from backend
   - Check sdkSessionManager logs
   - Look for `[Plan Mode] Presenting plan to user:`
   
3. Event not received in frontend
   - Check for any JavaScript errors
   - Verify `[STATUS EVENT] Received status: plan_ready` appears

**Debug Steps**:
- Check if `present_plan` tool is in availableTools array
- Verify agent's system prompt mentions `present_plan`
- Add temporary log in sdkSessionManager.ts line 621 to confirm execution
- Check webview console for errors

---

### Issue: Controls Don't Swap

**Symptoms**:
- Logs appear but UI doesn't change
- Acceptance controls don't show/hide

**Possible Causes**:
1. CSS not loaded correctly
2. JavaScript error preventing DOM manipulation
3. Elements missing from HTML

**Debug Steps**:
1. In console, run: `document.getElementById('acceptanceControls')`
   - Should return an element
2. Check element classes: `acceptanceControls.classList`
   - Should contain 'active' when shown
3. Check CSS: `getComputedStyle(acceptanceControls).display`
   - Should be 'flex' when active, 'none' when hidden
4. Check for JavaScript errors in console

---

### Issue: Multiple Paths Executing (Duplicate Logs)

**Symptoms**:
- See logs from multiple Phase 4 paths
- Actions execute multiple times

**Possible Causes**:
- Event listeners attached multiple times
- Button clicked multiple times rapidly

**Debug Steps**:
- Check if webview was reloaded without proper cleanup
- Add debouncing to button handlers
- Verify event listeners only attached once

---

### Issue: Button States Don't Match Logs

**Symptoms**:
- Logs say buttons are visible but UI shows them hidden (or vice versa)

**Possible Causes**:
- CSS override
- Style attribute not set correctly

**Debug Steps**:
1. Inspect button in DevTools
2. Check computed styles
3. Verify inline style matches logged state
4. Check for CSS conflicts

---

## Expected Missing Logs

The following are **intentionally NOT logged**:

❌ `update_work_plan` tool execution
- Reason: File operation, no need for UI visibility

❌ File system operations for plan.md
- Reason: Implementation detail, not user-facing

❌ Normal agent streaming responses
- Reason: Separate from plan workflow

❌ Regular chat messages in plan mode
- Reason: Only plan-specific events logged

---

## Success Criteria Checklist

Use this checklist when testing:

- [ ] ✅ All Phase 1 logs appear when entering plan mode
- [ ] ✅ Phase 3 logs appear when agent calls `present_plan`
- [ ] ✅ Exactly one of Phase 4a/4b/4c logs appear based on user choice
- [ ] ✅ No console errors during workflow
- [ ] ✅ Button states in logs match actual UI state
- [ ] ✅ Status events show correct data payloads
- [ ] ✅ UI swaps happen immediately (no lag)
- [ ] ✅ Acceptance controls appear and disappear correctly
- [ ] ✅ Messages sent to agent when expected
- [ ] ✅ Mode transitions are clean and complete

---

## Log Locations in Code

**chatViewProvider.ts** (Webview UI):
- Line ~1875: `plan_ready` status handler
- Line ~1220-1235: `swapToAcceptanceControls()` and `swapToRegularControls()`
- Line ~1140-1200: Button event handlers
- Line ~970-1000: `updatePlanModeUI()` function

**sdkSessionManager.ts** (Backend):
- Line ~616-635: `createPresentPlanTool()` handler
- Line ~624: `plan_ready` status emission

---

## Additional Notes

### Log Levels

- Most UI logs use `console.log()` for visibility in browser DevTools
- Backend uses `this.logger.info()` for structured logging
- Errors use `this.logger.error()` (not in happy path)

### Event Flow Summary

```
1. User enters plan mode
   ↓
2. Agent creates plan (update_work_plan)
   ↓
3. Agent presents plan (present_plan) → emits plan_ready
   ↓
4. UI receives plan_ready → swaps to acceptance controls
   ↓
5. User makes choice:
   - Accept → exit plan mode, swap to regular controls
   - Keep planning → swap to regular controls, stay in plan mode
   - Alternative → reject plan, send instructions, exit plan mode
```

### Best Practices for Debugging

1. **Clear console before each test** to see only relevant logs
2. **Use console filters** (`[Plan`, `[Acceptance]`) to reduce noise
3. **Take screenshots** of console logs when reporting issues
4. **Check timestamps** on logs to verify event ordering
5. **Compare logs to this document** to identify missing/extra logs

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-03  
**Related**: planning/completed/UI-ENHANCEMENTS-SUMMARY.md  
**Feature Version**: v2.0.7
