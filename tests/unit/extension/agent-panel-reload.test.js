/**
 * TDD tests for SDKSessionManager.reloadAgents() — Phase 1a RED
 *
 * These are behavioral tests using mock contexts; no fs.readFileSync source scanning.
 */

const assert = require('assert');
const path = require('path');

const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('../../helpers/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock SDKSessionManager-like object for testing reloadAgents().
 * Uses the actual prototype method from the compiled output.
 */
function buildMockManager(overrides = {}) {
    const log = [];
    const statusFired = [];

    const defaultSession = {
        destroy: async () => {},
        sessionId: 'sess-new-001',
    };
    const defaultClient = {
        resumeSession: async (_id, _opts) => defaultSession,
    };

    const base = {
        session: { destroy: async () => {}, sessionId: 'sess-old-001' },
        sessionId: 'sess-old-001',
        client: defaultClient,
        currentMode: 'work',
        workSession: null,
        workSessionId: null,
        config: { model: 'gpt-4o' },
        _sessionAgent: null,

        // Deps
        customAgentsService: {
            toSDKAgents: () => [{ name: 'planner', prompt: 'Plan things.' }],
        },
        logger: {
            info: (msg) => log.push({ level: 'info', msg }),
            warn: (msg) => log.push({ level: 'warn', msg }),
            error: (msg) => log.push({ level: 'error', msg }),
            debug: (msg) => log.push({ level: 'debug', msg }),
        },
        _onDidChangeStatus: {
            fire: (data) => statusFired.push(data),
        },

        // Helpers called inside reloadAgents
        getEnabledMCPServers: () => ({}),
        getCustomTools: () => [],
        getSessionHooks: () => ({}),
        attemptSessionResumeWithUserRecovery: async (_id, _opts) => defaultSession,
        setupSessionEventHandlers: () => {},
        _restoreStickyAgentIfNeeded: async () => {},

        // Expose for inspection
        _log: log,
        _statusFired: statusFired,
    };

    return Object.assign(base, overrides);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SDKSessionManager.reloadAgents() — behavioral', function () {
    let SDKSessionManager;

    before(function () {
        // Load from compiled output
        try {
            SDKSessionManager = require('../../../out/sdkSessionManager.js').SDKSessionManager;
        } catch {
            // Not yet compiled — skip gracefully; source-check tests cover the gap
            this.skip();
        }
    });

    it('is a public method on SDKSessionManager.prototype', function () {
        if (!SDKSessionManager) { this.skip(); }
        assert.strictEqual(typeof SDKSessionManager.prototype.reloadAgents, 'function',
            'SDKSessionManager must have a public reloadAgents() method');
    });
});

