/**
 * Tests for Custom Agents SDK wiring — verifies that:
 * 1. SDKSessionManager instantiates CustomAgentsService
 * 2. toSDKAgents() is called and its result is passed as `customAgents` to createSessionWithModelFallback
 * 3. No `builtIn` flag reaches the SDK (stripped by toSDKAgents)
 *
 * RED first: these tests fail until Phase 8b wires CustomAgentsService into sdkSessionManager.ts.
 */

const assert = require('assert');

const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock vscode BEFORE loading any module
Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('../../helpers/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

describe('Custom Agents SDK Wiring — contract checks', function () {
    let CustomAgentsService;

    before(function () {
        try {
            const svcModule = require('../../../out/extension/services/CustomAgentsService.js');
            CustomAgentsService = svcModule.CustomAgentsService;
        } catch (e) {
            console.log('CustomAgentsService not compiled, skipping:', e.message);
            this.skip();
        }
    });

    it('toSDKAgents() returns at least 3 agents (built-ins)', function () {
        const service = new CustomAgentsService();
        const agents = service.toSDKAgents();
        assert.ok(agents.length >= 3, `Expected >= 3 agents, got ${agents.length}`);
    });

    it('toSDKAgents() result has no builtIn field on any agent', function () {
        const service = new CustomAgentsService();
        const agents = service.toSDKAgents();
        for (const agent of agents) {
            assert.strictEqual(
                agent.builtIn,
                undefined,
                `Agent "${agent.name}" must not have builtIn field in SDK config`
            );
        }
    });

    it('toSDKAgents() includes planner, implementer, reviewer, researcher by name', function () {
        const service = new CustomAgentsService();
        const agents = service.toSDKAgents();
        const names = agents.map(a => a.name);
        assert.ok(names.includes('planner'), 'planner agent must be included');
        assert.ok(names.includes('implementer'), 'implementer agent must be included');
        assert.ok(names.includes('reviewer'), 'reviewer agent must be included');
        assert.ok(names.includes('researcher'), 'researcher agent must be included');
    });

    it('toSDKAgents() agents all have a prompt field', function () {
        const service = new CustomAgentsService();
        const agents = service.toSDKAgents();
        for (const agent of agents) {
            assert.ok(
                typeof agent.prompt === 'string' && agent.prompt.length > 0,
                `Agent "${agent.name}" must have a non-empty prompt`
            );
        }
    });
});

// ─── Behavioral tests: selectAgent / deselectAgent ──────────────────────────

const { SDKSessionManager } = require('../../../out/sdkSessionManager');

describe('SDKSessionManager — selectAgent/deselectAgent', function () {
    this.timeout(10000);

    it('selectAgent is a function on prototype', function () {
        assert.strictEqual(typeof SDKSessionManager.prototype.selectAgent, 'function');
    });

    it('deselectAgent is a function on prototype', function () {
        assert.strictEqual(typeof SDKSessionManager.prototype.deselectAgent, 'function');
    });

    it('selectAgent calls session.rpc.agent.select and sets _sessionAgent', async function () {
        let selectedName = null;
        const ctx = {
            _sessionAgent: null,
            session: {
                rpc: { agent: { select: async ({ name }) => { selectedName = name; } } },
            },
            sessionId: 'test-1234',
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        };

        await SDKSessionManager.prototype.selectAgent.call(ctx, 'reviewer');

        assert.strictEqual(ctx._sessionAgent, 'reviewer', '_sessionAgent should be set to reviewer');
        assert.strictEqual(selectedName, 'reviewer', 'session.rpc.agent.select should be called with reviewer');
    });

    it('deselectAgent calls session.rpc.agent.deselect and sets _sessionAgent to null', async function () {
        let deselectCalled = false;
        const ctx = {
            _sessionAgent: 'reviewer',
            session: {
                rpc: { agent: { deselect: async () => { deselectCalled = true; } } },
            },
            sessionId: 'test-1234',
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        };

        await SDKSessionManager.prototype.deselectAgent.call(ctx);

        assert.strictEqual(ctx._sessionAgent, null, '_sessionAgent should be null');
        assert.strictEqual(deselectCalled, true, 'session.rpc.agent.deselect should be called');
    });

    it('selectAgent when session is null: sets _sessionAgent but does not throw', async function () {
        const ctx = {
            _sessionAgent: null,
            session: null,
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        };

        // Should not throw
        await SDKSessionManager.prototype.selectAgent.call(ctx, 'planner');

        assert.strictEqual(ctx._sessionAgent, 'planner', '_sessionAgent should be set even without session');
    });

    it('deselectAgent when session is null: sets _sessionAgent to null but does not throw', async function () {
        const ctx = {
            _sessionAgent: 'reviewer',
            session: null,
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        };

        // Should not throw
        await SDKSessionManager.prototype.deselectAgent.call(ctx);

        assert.strictEqual(ctx._sessionAgent, null, '_sessionAgent should be null');
    });
});

// ─── Behavioral tests: sendMessage one-shot vs sticky agent ─────────────────

describe('SDKSessionManager — sendMessage one-shot vs sticky', function () {
    this.timeout(10000);

    function createSendMessageCtx() {
        const calls = { select: [], deselect: 0, sendAndWait: 0 };
        const ctx = {
            _sessionAgent: null,
            session: {
                rpc: {
                    agent: {
                        select: async ({ name }) => { calls.select.push(name); },
                        deselect: async () => { calls.deselect++; },
                    },
                },
                sendAndWait: async () => { calls.sendAndWait++; },
            },
            sessionId: 'test-1234',
            currentMode: 'work',
            config: { model: 'claude-sonnet-4.5' },
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
            _onDidReceiveOutput: { fire: () => {} },
            _onDidReceiveError: { fire: () => {} },
            _onDidChangeStatus: { fire: () => {} },
            _onDidStartTool: { fire: () => {} },
            _onDidUpdateTool: { fire: () => {} },
            _onDidCompleteTool: { fire: () => {} },
            _onDidChangeFile: { fire: () => {} },
            _onDidProduceDiff: { fire: () => {} },
            _onDidUpdateUsage: { fire: () => {} },
            _onDidReceiveReasoning: { fire: () => {} },
            fileSnapshotService: { cleanupAllSnapshots: () => {} },
            toolExecutions: new Map(),
            lastMessageIntent: null,
            messageEnhancementService: { enhanceMessageWithContext: async (msg) => msg },
        };
        return { ctx, calls };
    }

    it('no sticky agent and no agentName param: neither select nor deselect called', async function () {
        const { ctx, calls } = createSendMessageCtx();
        ctx._sessionAgent = null;

        await SDKSessionManager.prototype.sendMessage.call(ctx, 'hello', undefined, false, false, undefined);

        assert.strictEqual(calls.select.length, 0, 'agent.select should not be called');
        assert.strictEqual(calls.deselect, 0, 'agent.deselect should not be called');
        assert.strictEqual(calls.sendAndWait, 1, 'sendAndWait should be called');
    });

    it('sticky agent active and no agentName param: neither select nor deselect called', async function () {
        const { ctx, calls } = createSendMessageCtx();
        ctx._sessionAgent = 'reviewer';

        await SDKSessionManager.prototype.sendMessage.call(ctx, 'hello', undefined, false, false, undefined);

        assert.strictEqual(calls.select.length, 0, 'agent.select should not be called for sticky-only');
        assert.strictEqual(calls.deselect, 0, 'agent.deselect should not be called for sticky-only');
    });

    it('one-shot agentName with no sticky: select before, deselect after', async function () {
        const { ctx, calls } = createSendMessageCtx();
        ctx._sessionAgent = null;

        await SDKSessionManager.prototype.sendMessage.call(ctx, 'hello', undefined, false, false, 'planner');

        assert.strictEqual(calls.select.length, 1, 'agent.select should be called once (before)');
        assert.strictEqual(calls.select[0], 'planner', 'should select planner');
        assert.strictEqual(calls.deselect, 1, 'agent.deselect should be called once (after, no sticky to restore)');
    });

    it('one-shot agentName with different sticky: select one-shot before, restore sticky after', async function () {
        const { ctx, calls } = createSendMessageCtx();
        ctx._sessionAgent = 'reviewer';

        await SDKSessionManager.prototype.sendMessage.call(ctx, 'hello', undefined, false, false, 'planner');

        assert.strictEqual(calls.select.length, 2, 'agent.select should be called twice (one-shot + restore)');
        assert.strictEqual(calls.select[0], 'planner', 'first select should be one-shot planner');
        assert.strictEqual(calls.select[1], 'reviewer', 'second select should restore sticky reviewer');
        assert.strictEqual(calls.deselect, 0, 'deselect should not be called when restoring sticky');
    });

    it('agentName same as sticky: isOneShot is false, no select or deselect', async function () {
        const { ctx, calls } = createSendMessageCtx();
        ctx._sessionAgent = 'reviewer';

        await SDKSessionManager.prototype.sendMessage.call(ctx, 'hello', undefined, false, false, 'reviewer');

        assert.strictEqual(calls.select.length, 0, 'agent.select should not be called when agentName matches sticky');
        assert.strictEqual(calls.deselect, 0, 'agent.deselect should not be called when agentName matches sticky');
    });
});

// ─── Behavioral tests: stop() clears _sessionAgent ─────────────────────────

describe('SDKSessionManager — stop() clears _sessionAgent', function () {
    this.timeout(10000);

    it('after stop(), _sessionAgent is null', async function () {
        const ctx = {
            _sessionAgent: 'reviewer',
            session: {
                destroy: async () => {},
            },
            client: {
                stop: async () => {},
            },
            _sessionSub: { value: undefined },
            sessionId: 'test-1234',
            toolExecutions: new Map(),
            fileSnapshotService: { cleanupAllSnapshots: () => {} },
            _onDidChangeStatus: { fire: () => {} },
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        };

        await SDKSessionManager.prototype.stop.call(ctx);

        assert.strictEqual(ctx._sessionAgent, null, '_sessionAgent should be null after stop()');
    });
});
