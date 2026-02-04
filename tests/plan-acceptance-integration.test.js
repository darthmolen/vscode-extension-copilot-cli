/**
 * Plan Acceptance Integration Test
 * Tests the complete plan acceptance workflow with mocked components
 * Does NOT require LLM or human interaction
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const EventEmitter = require('events');

// Test results tracking
let testResults = [];

function recordTest(name, passed, details = '') {
    testResults.push({ name, passed, details });
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${name}${details ? ': ' + details : ''}`);
}

/**
 * Mock SDKSessionManager with minimal plan mode support
 */
class MockSDKSessionManager {
    constructor() {
        this.currentMode = 'work';
        this.workSessionId = randomUUID();
        this.onMessageEmitter = new EventEmitter();
        this.customTools = [];
    }

    async enablePlanMode() {
        this.currentMode = 'plan';
        this.customTools = this.getCustomTools();
        
        // Emit plan mode enabled event
        this.onMessageEmitter.emit('message', {
            type: 'status',
            data: { status: 'plan_mode_enabled' },
            timestamp: Date.now()
        });
    }

    getCustomTools() {
        if (this.currentMode === 'plan') {
            return [
                this.createUpdateWorkPlanTool(),
                this.createPresentPlanTool(),
            ];
        }
        return [];
    }

    createUpdateWorkPlanTool() {
        return {
            name: 'update_work_plan',
            handler: async ({ content }) => {
                const homeDir = os.homedir();
                const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId);
                const planPath = path.join(workSessionPath, 'plan.md');
                
                if (!fs.existsSync(workSessionPath)) {
                    fs.mkdirSync(workSessionPath, { recursive: true });
                }
                
                await fs.promises.writeFile(planPath, content, 'utf-8');
                return 'Plan updated successfully!';
            }
        };
    }

    createPresentPlanTool() {
        return {
            name: 'present_plan',
            handler: async ({ summary }) => {
                // Emit plan_ready event
                this.onMessageEmitter.emit('message', {
                    type: 'status',
                    data: { 
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                });
                return 'Plan presented to user.';
            }
        };
    }

    async acceptPlan() {
        this.currentMode = 'work';
        this.onMessageEmitter.emit('message', {
            type: 'status',
            data: { status: 'plan_accepted' },
            timestamp: Date.now()
        });
    }

    async rejectPlan() {
        this.currentMode = 'work';
        this.onMessageEmitter.emit('message', {
            type: 'status',
            data: { status: 'plan_rejected' },
            timestamp: Date.now()
        });
    }

    onMessage(handler) {
        this.onMessageEmitter.on('message', handler);
    }
}

/**
 * Mock UI event handler
 */
class MockUI {
    constructor() {
        this.events = [];
        this.acceptanceControlsVisible = false;
        this.regularControlsVisible = true;
        this.planMode = false;
    }

    handleMessage(message) {
        this.events.push(message);

        switch (message.type) {
            case 'status':
                if (message.data.status === 'plan_mode_enabled') {
                    this.planMode = true;
                } else if (message.data.status === 'plan_ready') {
                    // Swap to acceptance controls
                    this.acceptanceControlsVisible = true;
                    this.regularControlsVisible = false;
                } else if (message.data.status === 'plan_accepted' || message.data.status === 'plan_rejected') {
                    // Swap back to regular controls
                    this.acceptanceControlsVisible = false;
                    this.regularControlsVisible = true;
                    this.planMode = false;
                }
                break;
        }
    }

    getEvent(predicate) {
        return this.events.find(predicate);
    }

    getAllEvents(predicate) {
        return this.events.filter(predicate);
    }
}

async function runIntegrationTests() {
    console.log('='.repeat(70));
    console.log('Plan Acceptance Integration Tests');
    console.log('Testing complete workflow with mocked components');
    console.log('='.repeat(70));

    // Test 1: Basic plan acceptance workflow
    console.log('\n📋 Test 1: Complete plan acceptance workflow');
    {
        try {
            const manager = new MockSDKSessionManager();
            const ui = new MockUI();

            // Connect UI to manager
            manager.onMessage((msg) => ui.handleMessage(msg));

            // Step 1: Enable plan mode
            await manager.enablePlanMode();
            recordTest('Plan mode enabled', ui.planMode === true);
            
            const planEnabledEvent = ui.getEvent(e => 
                e.type === 'status' && e.data.status === 'plan_mode_enabled'
            );
            recordTest('plan_mode_enabled event received', planEnabledEvent !== undefined);

            // Step 2: Verify tools are available
            const tools = manager.getCustomTools();
            const hasPresentPlan = tools.some(t => t.name === 'present_plan');
            const hasUpdatePlan = tools.some(t => t.name === 'update_work_plan');
            
            recordTest('update_work_plan tool available', hasUpdatePlan);
            recordTest('present_plan tool available', hasPresentPlan);

            // Step 3: Create a plan
            const updateTool = tools.find(t => t.name === 'update_work_plan');
            const planContent = '# Test Plan\n\n## Tasks\n- [ ] Task 1\n- [ ] Task 2';
            await updateTool.handler({ content: planContent });

            // Step 4: Present the plan
            const presentTool = tools.find(t => t.name === 'present_plan');
            const result = await presentTool.handler({ summary: 'Test plan summary' });
            
            recordTest('present_plan returns success', result.includes('Plan presented'));

            // Step 5: Verify plan_ready event
            const planReadyEvent = ui.getEvent(e => 
                e.type === 'status' && e.data.status === 'plan_ready'
            );
            recordTest('plan_ready event emitted', planReadyEvent !== undefined);
            recordTest('plan_ready contains summary', planReadyEvent?.data?.summary === 'Test plan summary');

            // Step 6: Verify UI state
            recordTest('Acceptance controls visible', ui.acceptanceControlsVisible === true);
            recordTest('Regular controls hidden', ui.regularControlsVisible === false);

            // Step 7: Accept the plan
            await manager.acceptPlan();

            // Step 8: Verify plan accepted
            const acceptedEvent = ui.getEvent(e => 
                e.type === 'status' && e.data.status === 'plan_accepted'
            );
            recordTest('plan_accepted event emitted', acceptedEvent !== undefined);
            recordTest('Controls swapped back', ui.acceptanceControlsVisible === false);
            recordTest('Regular controls visible', ui.regularControlsVisible === true);
            recordTest('Plan mode disabled', ui.planMode === false);

        } catch (error) {
            recordTest('Complete workflow test', false, error.message);
        }
    }

    // Test 2: Reject plan workflow
    console.log('\n📋 Test 2: Reject plan workflow');
    {
        try {
            const manager = new MockSDKSessionManager();
            const ui = new MockUI();
            manager.onMessage((msg) => ui.handleMessage(msg));

            await manager.enablePlanMode();
            
            const tools = manager.getCustomTools();
            const presentTool = tools.find(t => t.name === 'present_plan');
            await presentTool.handler({ summary: 'Plan to reject' });

            // User rejects the plan
            await manager.rejectPlan();

            const rejectedEvent = ui.getEvent(e => 
                e.type === 'status' && e.data.status === 'plan_rejected'
            );
            
            recordTest('plan_rejected event emitted', rejectedEvent !== undefined);
            recordTest('Controls restored after reject', ui.regularControlsVisible === true);
            recordTest('Plan mode disabled after reject', ui.planMode === false);

        } catch (error) {
            recordTest('Reject workflow test', false, error.message);
        }
    }

    // Test 3: Multiple plan presentations
    console.log('\n📋 Test 3: Multiple plan presentations (iterative planning)');
    {
        try {
            const manager = new MockSDKSessionManager();
            const ui = new MockUI();
            manager.onMessage((msg) => ui.handleMessage(msg));

            await manager.enablePlanMode();
            
            const tools = manager.getCustomTools();
            const presentTool = tools.find(t => t.name === 'present_plan');

            // Present plan multiple times
            await presentTool.handler({ summary: 'First draft' });
            await presentTool.handler({ summary: 'Second draft' });
            await presentTool.handler({ summary: 'Final draft' });

            const planReadyEvents = ui.getAllEvents(e => 
                e.type === 'status' && e.data.status === 'plan_ready'
            );

            recordTest('Multiple plan_ready events emitted', planReadyEvents.length === 3);
            recordTest('Each event has different summary', 
                planReadyEvents[0].data.summary === 'First draft' &&
                planReadyEvents[1].data.summary === 'Second draft' &&
                planReadyEvents[2].data.summary === 'Final draft'
            );

        } catch (error) {
            recordTest('Multiple presentations test', false, error.message);
        }
    }

    // Test 4: Plan file creation and presentation
    console.log('\n📋 Test 4: Plan file is created before presentation');
    {
        try {
            const manager = new MockSDKSessionManager();
            const ui = new MockUI();
            manager.onMessage((msg) => ui.handleMessage(msg));

            await manager.enablePlanMode();
            
            const homeDir = os.homedir();
            const planPath = path.join(homeDir, '.copilot', 'session-state', manager.workSessionId, 'plan.md');

            // Create plan
            const tools = manager.getCustomTools();
            const updateTool = tools.find(t => t.name === 'update_work_plan');
            const planContent = '# Integration Test Plan\n\n## Objective\nTest plan creation';
            await updateTool.handler({ content: planContent });

            // Verify file exists
            const fileExists = fs.existsSync(planPath);
            recordTest('Plan file created', fileExists);

            // Verify content
            const actualContent = fs.readFileSync(planPath, 'utf-8');
            recordTest('Plan content matches', actualContent === planContent);

            // Present plan
            const presentTool = tools.find(t => t.name === 'present_plan');
            await presentTool.handler({ summary: 'Integration test complete' });

            const planReadyEvent = ui.getEvent(e => 
                e.type === 'status' && e.data.status === 'plan_ready'
            );
            recordTest('Plan presented after file creation', planReadyEvent !== undefined);

            // Cleanup
            if (fs.existsSync(planPath)) {
                fs.unlinkSync(planPath);
                const sessionDir = path.dirname(planPath);
                if (fs.existsSync(sessionDir)) {
                    fs.rmdirSync(sessionDir);
                }
            }

        } catch (error) {
            recordTest('Plan file creation test', false, error.message);
        }
    }

    // Test 5: Tool availability in different modes
    console.log('\n📋 Test 5: Tool availability in work vs plan mode');
    {
        try {
            const manager = new MockSDKSessionManager();

            // Work mode - no custom tools
            let tools = manager.getCustomTools();
            recordTest('No custom tools in work mode', tools.length === 0);

            // Plan mode - tools available
            await manager.enablePlanMode();
            tools = manager.getCustomTools();
            recordTest('Custom tools in plan mode', tools.length === 2);
            recordTest('Tools include present_plan', tools.some(t => t.name === 'present_plan'));

            // Back to work mode
            await manager.acceptPlan();
            manager.currentMode = 'work';
            tools = manager.getCustomTools();
            recordTest('Tools removed after leaving plan mode', tools.length === 0);

        } catch (error) {
            recordTest('Tool availability test', false, error.message);
        }
    }

    // Test 6: Event ordering
    console.log('\n📋 Test 6: Correct event ordering in workflow');
    {
        try {
            const manager = new MockSDKSessionManager();
            const ui = new MockUI();
            manager.onMessage((msg) => ui.handleMessage(msg));

            await manager.enablePlanMode();
            
            const tools = manager.getCustomTools();
            const presentTool = tools.find(t => t.name === 'present_plan');
            await presentTool.handler({ summary: 'Test' });
            
            await manager.acceptPlan();

            // Verify event order
            const eventTypes = ui.events.map(e => e.data.status);
            const expectedOrder = ['plan_mode_enabled', 'plan_ready', 'plan_accepted'];
            
            recordTest('Events in correct order', 
                eventTypes[0] === expectedOrder[0] &&
                eventTypes[1] === expectedOrder[1] &&
                eventTypes[2] === expectedOrder[2]
            );

        } catch (error) {
            recordTest('Event ordering test', false, error.message);
        }
    }

    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('Test Summary');
    console.log('='.repeat(70));
    const passed = testResults.filter(r => r.passed).length;
    const total = testResults.length;
    const failed = total - passed;
    
    console.log(`Total: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    
    if (failed > 0) {
        console.log('\nFailed tests:');
        testResults.filter(r => !r.passed).forEach(r => {
            console.log(`  - ${r.name}${r.details ? ': ' + r.details : ''}`);
        });
    }
    
    process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runIntegrationTests().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
});
