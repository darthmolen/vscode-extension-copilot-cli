/**
 * Plan Acceptance Integration Test
 * Tests the complete plan acceptance workflow with mocked components
 * Does NOT require LLM or human interaction
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const EventEmitter = require('events');

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

describe('Plan Acceptance Integration Tests', function () {

    describe('Complete plan acceptance workflow', function () {
        let manager;
        let ui;

        before(async function () {
            manager = new MockSDKSessionManager();
            ui = new MockUI();
            manager.onMessage((msg) => ui.handleMessage(msg));
            await manager.enablePlanMode();
        });

        it('should enable plan mode', function () {
            assert.strictEqual(ui.planMode, true);
        });

        it('should emit plan_mode_enabled event', function () {
            const planEnabledEvent = ui.getEvent(e =>
                e.type === 'status' && e.data.status === 'plan_mode_enabled'
            );
            assert.notStrictEqual(planEnabledEvent, undefined);
        });

        it('should have update_work_plan tool available', function () {
            const tools = manager.getCustomTools();
            assert.ok(tools.some(t => t.name === 'update_work_plan'));
        });

        it('should have present_plan tool available', function () {
            const tools = manager.getCustomTools();
            assert.ok(tools.some(t => t.name === 'present_plan'));
        });

        it('should create a plan and present it', async function () {
            const tools = manager.getCustomTools();
            const updateTool = tools.find(t => t.name === 'update_work_plan');
            const planContent = '# Test Plan\n\n## Tasks\n- [ ] Task 1\n- [ ] Task 2';
            await updateTool.handler({ content: planContent });

            const presentTool = tools.find(t => t.name === 'present_plan');
            const result = await presentTool.handler({ summary: 'Test plan summary' });
            assert.ok(result.includes('Plan presented'));
        });

        it('should emit plan_ready event with summary', function () {
            const planReadyEvent = ui.getEvent(e =>
                e.type === 'status' && e.data.status === 'plan_ready'
            );
            assert.notStrictEqual(planReadyEvent, undefined);
            assert.strictEqual(planReadyEvent.data.summary, 'Test plan summary');
        });

        it('should show acceptance controls and hide regular controls', function () {
            assert.strictEqual(ui.acceptanceControlsVisible, true);
            assert.strictEqual(ui.regularControlsVisible, false);
        });

        it('should accept the plan and swap controls back', async function () {
            await manager.acceptPlan();

            const acceptedEvent = ui.getEvent(e =>
                e.type === 'status' && e.data.status === 'plan_accepted'
            );
            assert.notStrictEqual(acceptedEvent, undefined);
            assert.strictEqual(ui.acceptanceControlsVisible, false);
            assert.strictEqual(ui.regularControlsVisible, true);
            assert.strictEqual(ui.planMode, false);
        });
    });

    describe('Reject plan workflow', function () {
        it('should reject plan and restore controls', async function () {
            const manager = new MockSDKSessionManager();
            const ui = new MockUI();
            manager.onMessage((msg) => ui.handleMessage(msg));

            await manager.enablePlanMode();

            const tools = manager.getCustomTools();
            const presentTool = tools.find(t => t.name === 'present_plan');
            await presentTool.handler({ summary: 'Plan to reject' });

            await manager.rejectPlan();

            const rejectedEvent = ui.getEvent(e =>
                e.type === 'status' && e.data.status === 'plan_rejected'
            );

            assert.notStrictEqual(rejectedEvent, undefined);
            assert.strictEqual(ui.regularControlsVisible, true);
            assert.strictEqual(ui.planMode, false);
        });
    });

    describe('Multiple plan presentations (iterative planning)', function () {
        it('should emit multiple plan_ready events with different summaries', async function () {
            const manager = new MockSDKSessionManager();
            const ui = new MockUI();
            manager.onMessage((msg) => ui.handleMessage(msg));

            await manager.enablePlanMode();

            const tools = manager.getCustomTools();
            const presentTool = tools.find(t => t.name === 'present_plan');

            await presentTool.handler({ summary: 'First draft' });
            await presentTool.handler({ summary: 'Second draft' });
            await presentTool.handler({ summary: 'Final draft' });

            const planReadyEvents = ui.getAllEvents(e =>
                e.type === 'status' && e.data.status === 'plan_ready'
            );

            assert.strictEqual(planReadyEvents.length, 3);
            assert.strictEqual(planReadyEvents[0].data.summary, 'First draft');
            assert.strictEqual(planReadyEvents[1].data.summary, 'Second draft');
            assert.strictEqual(planReadyEvents[2].data.summary, 'Final draft');
        });
    });

    describe('Plan file creation and presentation', function () {
        let manager;
        let planPath;

        before(async function () {
            manager = new MockSDKSessionManager();
            const ui = new MockUI();
            manager.onMessage((msg) => ui.handleMessage(msg));
            await manager.enablePlanMode();

            const homeDir = os.homedir();
            planPath = path.join(homeDir, '.copilot', 'session-state', manager.workSessionId, 'plan.md');
        });

        after(function () {
            // Cleanup
            if (fs.existsSync(planPath)) {
                fs.unlinkSync(planPath);
                const sessionDir = path.dirname(planPath);
                if (fs.existsSync(sessionDir)) {
                    fs.rmdirSync(sessionDir);
                }
            }
        });

        it('should create a plan file on disk', async function () {
            const tools = manager.getCustomTools();
            const updateTool = tools.find(t => t.name === 'update_work_plan');
            const planContent = '# Integration Test Plan\n\n## Objective\nTest plan creation';
            await updateTool.handler({ content: planContent });

            assert.ok(fs.existsSync(planPath));
        });

        it('should write correct content to plan file', function () {
            const planContent = '# Integration Test Plan\n\n## Objective\nTest plan creation';
            const actualContent = fs.readFileSync(planPath, 'utf-8');
            assert.strictEqual(actualContent, planContent);
        });

        it('should present plan after file creation', async function () {
            const ui2 = new MockUI();
            manager.onMessage((msg) => ui2.handleMessage(msg));

            const tools = manager.getCustomTools();
            const presentTool = tools.find(t => t.name === 'present_plan');
            await presentTool.handler({ summary: 'Integration test complete' });

            const planReadyEvent = ui2.getEvent(e =>
                e.type === 'status' && e.data.status === 'plan_ready'
            );
            assert.notStrictEqual(planReadyEvent, undefined);
        });
    });

    describe('Tool availability in work vs plan mode', function () {
        it('should have no custom tools in work mode', function () {
            const manager = new MockSDKSessionManager();
            const tools = manager.getCustomTools();
            assert.strictEqual(tools.length, 0);
        });

        it('should have custom tools in plan mode', async function () {
            const manager = new MockSDKSessionManager();
            await manager.enablePlanMode();
            const tools = manager.getCustomTools();
            assert.strictEqual(tools.length, 2);
            assert.ok(tools.some(t => t.name === 'present_plan'));
        });

        it('should remove tools after leaving plan mode', async function () {
            const manager = new MockSDKSessionManager();
            await manager.enablePlanMode();
            await manager.acceptPlan();
            manager.currentMode = 'work';
            const tools = manager.getCustomTools();
            assert.strictEqual(tools.length, 0);
        });
    });

    describe('Correct event ordering in workflow', function () {
        it('should emit events in correct order: plan_mode_enabled -> plan_ready -> plan_accepted', async function () {
            const manager = new MockSDKSessionManager();
            const ui = new MockUI();
            manager.onMessage((msg) => ui.handleMessage(msg));

            await manager.enablePlanMode();

            const tools = manager.getCustomTools();
            const presentTool = tools.find(t => t.name === 'present_plan');
            await presentTool.handler({ summary: 'Test' });

            await manager.acceptPlan();

            const eventTypes = ui.events.map(e => e.data.status);
            const expectedOrder = ['plan_mode_enabled', 'plan_ready', 'plan_accepted'];

            assert.strictEqual(eventTypes[0], expectedOrder[0]);
            assert.strictEqual(eventTypes[1], expectedOrder[1]);
            assert.strictEqual(eventTypes[2], expectedOrder[2]);
        });
    });
});
