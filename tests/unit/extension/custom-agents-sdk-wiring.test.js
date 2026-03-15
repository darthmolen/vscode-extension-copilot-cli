/**
 * Tests for Custom Agents SDK wiring — verifies that:
 * 1. SDKSessionManager instantiates CustomAgentsService
 * 2. toSDKAgents() is called and its result is passed as `customAgents` to createSessionWithModelFallback
 * 3. No `builtIn` flag reaches the SDK (stripped by toSDKAgents)
 *
 * RED first: these tests fail until Phase 8b wires CustomAgentsService into sdkSessionManager.ts.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock vscode BEFORE loading any module
Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('../../helpers/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

describe('Custom Agents SDK Wiring (sdkSessionManager.ts)', function () {
    let sourceCode;
    let CustomAgentsService;

    before(function () {
        sourceCode = fs.readFileSync(
            path.join(__dirname, '../../../src/sdkSessionManager.ts'), 'utf-8'
        );

        try {
            const svcModule = require('../../../out/extension/services/CustomAgentsService.js');
            CustomAgentsService = svcModule.CustomAgentsService;
        } catch (e) {
            console.log('CustomAgentsService not compiled, skipping:', e.message);
            this.skip();
        }
    });

    // ─── Source-level wiring checks ───────────────────────────────────────────

    it('imports CustomAgentsService in sdkSessionManager.ts', function () {
        assert.ok(
            sourceCode.includes('CustomAgentsService'),
            'sdkSessionManager.ts must import or reference CustomAgentsService'
        );
    });

    it('calls toSDKAgents() somewhere in the session creation flow', function () {
        assert.ok(
            sourceCode.includes('toSDKAgents()'),
            'sdkSessionManager.ts must call toSDKAgents() to strip builtIn before passing to SDK'
        );
    });

    it('passes customAgents to createSessionWithModelFallback', function () {
        // Every createSessionWithModelFallback call site should include customAgents
        const callCount = (sourceCode.match(/this\.createSessionWithModelFallback\s*\(/g) || []).length;
        const customAgentsCount = (sourceCode.match(/customAgents:\s*this\.customAgentsService\.toSDKAgents\(\)/g) || []).length;
        assert.ok(callCount > 0, 'Expected createSessionWithModelFallback calls in source');
        assert.ok(
            customAgentsCount >= callCount,
            `Expected at least ${callCount} customAgents: toSDKAgents() assignments, found ${customAgentsCount}`
        );
    });

    // ─── Contract checks via CustomAgentsService ──────────────────────────────

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

    it('toSDKAgents() includes planner, implementer, reviewer by name', function () {
        const service = new CustomAgentsService();
        const agents = service.toSDKAgents();
        const names = agents.map(a => a.name);
        assert.ok(names.includes('planner'), 'planner agent must be included');
        assert.ok(names.includes('implementer'), 'implementer agent must be included');
        assert.ok(names.includes('reviewer'), 'reviewer agent must be included');
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

// ─── Phase 1 / 2: selectAgent / deselectAgent + per-message behavior ────────

describe('SDKSessionManager — selectAgent/deselectAgent (source checks)', function () {
    let src;

    before(function () {
        src = fs.readFileSync(
            path.join(__dirname, '../../../src/sdkSessionManager.ts'), 'utf-8'
        );
    });

    // Phase 1a — methods exist in source
    it('declares a _sessionAgent field', function () {
        assert.ok(src.includes('_sessionAgent'), 'sdkSessionManager must have _sessionAgent field');
    });

    it('has a public selectAgent() method', function () {
        assert.ok(
            src.includes('selectAgent(') || src.includes('selectAgent ('),
            'sdkSessionManager must have a selectAgent() method'
        );
    });

    it('has a public deselectAgent() method', function () {
        assert.ok(
            src.includes('deselectAgent(') || src.includes('deselectAgent ('),
            'sdkSessionManager must have a deselectAgent() method'
        );
    });

    it('selectAgent() calls session.rpc.agent.select', function () {
        assert.ok(
            src.includes('rpc.agent.select'),
            'selectAgent() must call session.rpc.agent.select'
        );
    });

    it('deselectAgent() calls session.rpc.agent.deselect', function () {
        assert.ok(
            src.includes('rpc.agent.deselect'),
            'deselectAgent() must call session.rpc.agent.deselect'
        );
    });

    // Phase 2a — sendMessage one-shot logic
    it('sendMessage uses _sessionAgent to decide whether to restore or deselect in finally', function () {
        assert.ok(
            src.includes('_sessionAgent'),
            'sendMessage must reference _sessionAgent to determine restore-vs-deselect behavior'
        );
    });

    it('sendMessage only selects agent on one-shot (@mention different from sticky)', function () {
        assert.ok(
            src.includes('isOneShot') || src.includes('one-shot') || src.includes('one_shot') ||
            src.includes('agentName !== this._sessionAgent'),
            'sendMessage must distinguish one-shot @mention from sticky agent'
        );
    });

    it('sendMessage restores sticky agent (not blindly deselects) after one-shot', function () {
        // The finally block must re-select _sessionAgent when it was set, not just call deselect()
        assert.ok(
            src.includes('this._sessionAgent') && src.includes('rpc.agent.select'),
            'sendMessage finally block must restore _sessionAgent via rpc.agent.select when sticky was active'
        );
    });
});

// ─── Phase 5: Session resume restores sticky agent ───────────────────────────

describe('SDKSessionManager — session resume/clear (source checks)', function () {
    let src;
    before(function () {
        src = fs.readFileSync(
            path.join(__dirname, '../../../src/sdkSessionManager.ts'), 'utf-8'
        );
    });

    it('clears _sessionAgent on session stop/reset', function () {
        // When session is stopped or destroyed, _sessionAgent should be reset to null
        // so a fresh session doesn't inherit stale agent state.
        assert.ok(
            src.includes('_sessionAgent = null'),
            'sdkSessionManager must reset _sessionAgent to null on session stop/reset'
        );
    });

    it('restores sticky agent after session resume if backendState has an active agent', function () {
        // After resuming a session, if backendState.getActiveAgent() is set,
        // selectAgent() should be called to re-establish the SDK session agent.
        assert.ok(
            src.includes('getActiveAgent') && src.includes('selectAgent'),
            'sdkSessionManager must call selectAgent() after resume when backendState has an active agent'
        );
    });
});
