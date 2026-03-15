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
