# Plan Acceptance Workflow - Integration Test Strategy

## Challenge: Human-in-the-Loop Testing

The plan acceptance workflow requires human interaction:
1. User enters plan mode
2. Agent creates a plan using `update_work_plan`
3. Agent calls `present_plan` to notify user
4. **HUMAN INTERACTION**: User reviews plan and chooses:
   - Accept and change to work mode
   - No, keep planning
   - Type alternative instructions

## Testing Approaches

### 1. Unit Tests (Completed ✅)
**File**: `tests/present-plan-tool.test.js`

Tests the `present_plan` tool in isolation:
- Tool handler executes without error
- Event is emitted with correct structure
- Event contains `plan_ready` status
- Summary parameter is handled correctly
- Error handling works

**Status**: All 13 tests passing

### 2. Integration Test with Mock UI
**Approach**: Simulate the entire workflow without human interaction

```javascript
// tests/plan-acceptance-integration.test.js

async function testPlanAcceptanceWorkflow() {
    // 1. Create SDK session manager in plan mode
    const manager = new SDKSessionManager(context, config);
    await manager.enablePlanMode();
    
    // 2. Mock the UI event listener
    const uiEvents = [];
    manager.onMessage((event) => {
        uiEvents.push(event);
    });
    
    // 3. Get the present_plan tool
    const tools = manager.getCustomTools(); // Need to expose this
    const presentPlanTool = tools.find(t => t.name === 'present_plan');
    
    // 4. Simulate agent calling the tool
    await presentPlanTool.handler({ 
        summary: 'Plan for implementing UI enhancements' 
    });
    
    // 5. Verify event was emitted
    const planReadyEvent = uiEvents.find(
        e => e.type === 'status' && e.data.status === 'plan_ready'
    );
    
    assert(planReadyEvent !== null, 'plan_ready event should be emitted');
    assert(planReadyEvent.data.summary === 'Plan for implementing UI enhancements');
    
    // 6. Simulate user accepting the plan
    await manager.acceptPlan();
    
    // 7. Verify plan mode is disabled
    const planAcceptedEvent = uiEvents.find(
        e => e.type === 'status' && e.data.status === 'plan_accepted'
    );
    assert(planAcceptedEvent !== null, 'plan_accepted event should be emitted');
}
```

**Pros**:
- No LLM dependency
- Fully automated
- Tests the event flow end-to-end

**Cons**:
- Doesn't test actual UI rendering
- Doesn't test user interaction (clicks, keyboard)

### 3. UI Component Test (webview)
**Approach**: Test the webview JavaScript in isolation

```javascript
// tests/acceptance-controls-ui.test.js

describe('Acceptance Controls UI', () => {
    let mockVscode;
    let document;
    
    beforeEach(() => {
        // Setup JSDOM or similar
        document = createMockDOM();
        mockVscode = {
            postMessage: jest.fn()
        };
    });
    
    it('should show acceptance controls on plan_ready status', () => {
        // Simulate receiving plan_ready message
        const event = {
            data: {
                type: 'status',
                data: { status: 'plan_ready' }
            }
        };
        
        window.dispatchEvent(new MessageEvent('message', event));
        
        // Verify controls are visible
        const controls = document.getElementById('acceptanceControls');
        expect(controls.classList.contains('active')).toBe(true);
    });
    
    it('should hide regular controls when acceptance controls shown', () => {
        // ... test control surface swap
    });
    
    it('should send acceptPlan message when button clicked', () => {
        // ... test button interaction
    });
});
```

**Pros**:
- Tests actual UI behavior
- Can test DOM manipulation
- Can simulate user clicks/keyboard

**Cons**:
- Requires DOM testing setup (JSDOM)
- Doesn't test VS Code webview specifics

### 4. End-to-End Manual Test
**Approach**: Documented manual testing procedure

```markdown
## Manual Test Procedure

### Prerequisites
1. Build and install the extension
2. Reload VS Code
3. Open Copilot CLI chat panel

### Test Steps

**Test 1: Basic Plan Acceptance Flow**
1. Enter plan mode (click 📝 button)
2. Send message: "Create a plan for adding a new feature"
3. Wait for agent to create plan
4. Wait for agent to call `present_plan`
5. ✅ Verify acceptance controls appear
6. ✅ Verify regular controls are hidden
7. ✅ Verify "Accept this plan?" text is visible
8. Click "Accept and change to work mode"
9. ✅ Verify controls swap back to regular
10. ✅ Verify plan mode is disabled

**Test 2: Keep Planning Flow**
1. Enter plan mode
2. Send message to create plan
3. Wait for acceptance controls
4. Click "No, Keep Planning"
5. ✅ Verify controls swap back to regular
6. ✅ Verify still in plan mode
7. ✅ Verify can continue planning

**Test 3: Alternative Instructions Flow**
1. Enter plan mode
2. Send message to create plan
3. Wait for acceptance controls
4. Type in input: "Actually, change the approach to use X instead"
5. Press Enter
6. ✅ Verify message is sent
7. ✅ Verify controls swap back
8. ✅ Verify agent receives new instructions

**Test 4: ESC Key**
1. Enter plan mode
2. Wait for acceptance controls
3. Press ESC key
4. ✅ Verify controls swap back to regular
```

**Pros**:
- Tests real user experience
- Tests actual VS Code integration
- Catches visual/UX issues

**Cons**:
- Time consuming
- Not automated
- Requires LLM cooperation

### 5. Automated E2E with UI Automation
**Approach**: Use VS Code extension testing API + UI automation

```javascript
// tests/e2e/plan-acceptance.e2e.test.ts
import * as vscode from 'vscode';

describe('Plan Acceptance E2E', () => {
    it('should show acceptance controls when plan ready', async () => {
        // 1. Activate extension
        await vscode.commands.executeCommand('copilot-cli-extension.openChat');
        
        // 2. Enter plan mode
        await vscode.commands.executeCommand('copilot-cli-extension.togglePlanMode', true);
        
        // 3. Trigger plan creation (requires mock agent or actual LLM)
        // ... complex setup
        
        // 4. Verify UI state
        // ... requires webview inspection (challenging)
    });
});
```

**Pros**:
- Fully automated E2E
- Tests actual extension

**Cons**:
- Very complex to set up
- Requires webview inspection (VS Code limitation)
- Still needs mock/stub for LLM

## Recommended Testing Strategy

### Immediate (Completed)
1. ✅ Unit tests for `present_plan` tool
2. ✅ Verify event emission

### Short Term
1. Integration test with mock UI (approach #2)
2. Manual test procedure documentation (approach #4)

### Long Term
1. UI component tests (approach #3) - if webview becomes more complex
2. Automated E2E (approach #5) - if tooling improves

## Current Status

✅ **Unit Tests**: Complete (13/13 passing)
- Tool handler logic
- Event emission
- Parameter handling
- Error handling

⏳ **Integration Tests**: Recommended next step
- Would test event flow end-to-end
- Relatively easy to implement
- Good ROI

📝 **Manual Tests**: Documented above
- Should be run before each release
- Can be executed by developer or QA

## Alternative: Record/Replay Testing

**Idea**: Record a successful plan acceptance flow and replay it

```javascript
// tests/fixtures/plan-acceptance-flow.json
{
  "events": [
    { "type": "status", "data": { "status": "plan_mode_enabled" } },
    { "type": "tool_complete", "data": { "toolName": "update_work_plan" } },
    { "type": "status", "data": { "status": "plan_ready" } },
    { "type": "user_action", "action": "acceptPlan" },
    { "type": "status", "data": { "status": "plan_accepted" } }
  ]
}

// Test replays this sequence and validates state at each step
```

**Pros**:
- No LLM needed
- Repeatable
- Can test edge cases

**Cons**:
- Doesn't test actual agent behavior
- Fixtures can become stale
