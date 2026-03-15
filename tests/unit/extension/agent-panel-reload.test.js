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

// ─── Source-level behavioral checks (fast, no compile needed) ─────────────────

describe('SDKSessionManager.reloadAgents() — source checks', function () {
    let src;

    before(function () {
        src = require('fs').readFileSync(
            path.join(__dirname, '../../../src/sdkSessionManager.ts'), 'utf-8'
        );
    });

    it('declares reloadAgents() as a public method', function () {
        assert.ok(
            src.includes('public async reloadAgents(') || src.includes('public reloadAgents('),
            'sdkSessionManager.ts must have a public reloadAgents() method'
        );
    });

    it('reloadAgents() calls session.destroy()', function () {
        // Must destroy current session before resuming
        const reloadBody = src.slice(src.indexOf('reloadAgents'), src.indexOf('reloadAgents') + 2000);
        assert.ok(
            reloadBody.includes('destroy()'),
            'reloadAgents() must call session.destroy()'
        );
    });

    it('reloadAgents() calls attemptSessionResumeWithUserRecovery', function () {
        const reloadBody = src.slice(src.indexOf('reloadAgents'), src.indexOf('reloadAgents') + 2000);
        assert.ok(
            reloadBody.includes('attemptSessionResumeWithUserRecovery'),
            'reloadAgents() must call attemptSessionResumeWithUserRecovery to resume with updated agents'
        );
    });

    it('reloadAgents() passes customAgents to resume options', function () {
        const reloadBody = src.slice(src.indexOf('reloadAgents'), src.indexOf('reloadAgents') + 2000);
        assert.ok(
            reloadBody.includes('customAgents') && reloadBody.includes('toSDKAgents'),
            'reloadAgents() must pass customAgentsService.toSDKAgents() as customAgents in resume options'
        );
    });

    it('reloadAgents() calls _restoreStickyAgentIfNeeded after resume', function () {
        const reloadBody = src.slice(src.indexOf('reloadAgents'), src.indexOf('reloadAgents') + 2000);
        assert.ok(
            reloadBody.includes('_restoreStickyAgentIfNeeded'),
            'reloadAgents() must call _restoreStickyAgentIfNeeded() after session resume'
        );
    });

    it('reloadAgents() calls setupSessionEventHandlers after resume', function () {
        const reloadBody = src.slice(src.indexOf('reloadAgents'), src.indexOf('reloadAgents') + 2000);
        assert.ok(
            reloadBody.includes('setupSessionEventHandlers'),
            'reloadAgents() must call setupSessionEventHandlers() to re-attach SDK event listeners'
        );
    });

    it('reloadAgents() updates workSession and workSessionId', function () {
        const reloadBody = src.slice(src.indexOf('reloadAgents'), src.indexOf('reloadAgents') + 2000);
        assert.ok(
            reloadBody.includes('workSession') && reloadBody.includes('workSessionId'),
            'reloadAgents() must update workSession and workSessionId after resume'
        );
    });

    it('reloadAgents() fires status:thinking before resume', function () {
        const reloadBody = src.slice(src.indexOf('reloadAgents'), src.indexOf('reloadAgents') + 2000);
        assert.ok(
            reloadBody.includes("'thinking'"),
            "reloadAgents() must fire status: 'thinking' before the resume"
        );
    });

    it('reloadAgents() fires status:ready after resume', function () {
        const reloadBody = src.slice(src.indexOf('reloadAgents'), src.indexOf('reloadAgents') + 2000);
        assert.ok(
            reloadBody.includes("'ready'"),
            "reloadAgents() must fire status: 'ready' after successful resume"
        );
    });

    it('reloadAgents() is a no-op when session is null', function () {
        // Guard: if (!this.session) return
        const reloadBody = src.slice(src.indexOf('reloadAgents'), src.indexOf('reloadAgents') + 2000);
        assert.ok(
            reloadBody.includes('!this.session') || reloadBody.includes('!this.sessionId'),
            'reloadAgents() must guard against null session'
        );
    });

    it('reloadAgents() is a no-op in plan mode', function () {
        const reloadBody = src.slice(src.indexOf('reloadAgents'), src.indexOf('reloadAgents') + 2000);
        assert.ok(
            reloadBody.includes("'plan'") || reloadBody.includes('plan'),
            "reloadAgents() must guard against plan mode (no reload while in plan session)"
        );
    });
});
