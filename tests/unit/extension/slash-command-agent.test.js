/**
 * TDD tests for /agent slash command handler (Phase 12c/12d)
 *
 * Tests the activeAgent state in BackendState and the selectAgent event handler.
 *
 * RED phase: Tests fail because activeAgent doesn't exist in BackendState yet.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('../../helpers/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('/agent slash command handler', function () {
    this.timeout(5000);

    let BackendState;

    before(function () {
        try {
            const mod = require('../../../out/backendState.js');
            BackendState = mod.BackendState;
        } catch (e) {
            console.log('BackendState not compiled, skipping:', e.message);
            this.skip();
        }
    });

    // ─── BackendState.activeAgent ──────────────────────────────────────────────

    it('BackendState.setActiveAgent() stores the agent name', function () {
        const state = new BackendState();
        state.setActiveAgent('reviewer');
        assert.strictEqual(state.getActiveAgent(), 'reviewer');
    });

    it('BackendState.setActiveAgent(null) clears the active agent', function () {
        const state = new BackendState();
        state.setActiveAgent('reviewer');
        state.setActiveAgent(null);
        assert.strictEqual(state.getActiveAgent(), null);
    });

    it('BackendState.getActiveAgent() returns null initially', function () {
        const state = new BackendState();
        assert.strictEqual(state.getActiveAgent(), null);
    });

    // ─── Source-level: chatViewProvider.ts handles selectAgent ────────────────

    it('chatViewProvider.ts registers a selectAgent handler', function () {
        const src = fs.readFileSync(
            path.join(__dirname, '../../../src/chatViewProvider.ts'), 'utf-8'
        );
        assert.ok(
            src.includes('selectAgent'),
            'chatViewProvider.ts must handle the selectAgent event from the slash command'
        );
    });

    it('chatViewProvider.ts calls setActiveAgent when handling selectAgent', function () {
        const src = fs.readFileSync(
            path.join(__dirname, '../../../src/chatViewProvider.ts'), 'utf-8'
        );
        assert.ok(
            src.includes('setActiveAgent'),
            'chatViewProvider.ts must call backendState.setActiveAgent() in the selectAgent handler'
        );
    });
});

// ─── Phase 3a: onDidSelectAgent event + extension.ts wiring ─────────────────

describe('chatViewProvider.ts — onDidSelectAgent event', function () {
    let src;
    before(function () {
        src = fs.readFileSync(
            path.join(__dirname, '../../../src/chatViewProvider.ts'), 'utf-8'
        );
    });

    it('declares _onDidSelectAgent EventEmitter', function () {
        assert.ok(
            src.includes('_onDidSelectAgent'),
            'chatViewProvider.ts must declare _onDidSelectAgent EventEmitter'
        );
    });

    it('exposes onDidSelectAgent public event', function () {
        assert.ok(
            src.includes('onDidSelectAgent'),
            'chatViewProvider.ts must expose onDidSelectAgent public event'
        );
    });

    it('fires _onDidSelectAgent in the selectAgent handler', function () {
        // The handler must fire the event with the agent name (or null for clear)
        assert.ok(
            src.includes('_onDidSelectAgent.fire'),
            'chatViewProvider.ts selectAgent handler must call _onDidSelectAgent.fire()'
        );
    });
});

describe('extension.ts — wires onDidSelectAgent to SDK', function () {
    let src;
    before(function () {
        src = fs.readFileSync(
            path.join(__dirname, '../../../src/extension.ts'), 'utf-8'
        );
    });

    it('subscribes to chatProvider.onDidSelectAgent', function () {
        assert.ok(
            src.includes('onDidSelectAgent'),
            'extension.ts must subscribe to chatProvider.onDidSelectAgent'
        );
    });

    it('calls cliManager.selectAgent() when agent name provided', function () {
        assert.ok(
            src.includes('cliManager.selectAgent') || src.includes('selectAgent('),
            'extension.ts must call cliManager.selectAgent() when onDidSelectAgent fires with a name'
        );
    });

    it('calls cliManager.deselectAgent() when agent cleared', function () {
        assert.ok(
            src.includes('cliManager.deselectAgent') || src.includes('deselectAgent()'),
            'extension.ts must call cliManager.deselectAgent() when onDidSelectAgent fires with null'
        );
    });
});

// ─── Phase 4a: main.js send handler — sticky vs @mention ─────────────────────

describe('main.js — sendMessage payload: sticky vs one-shot', function () {
    let mainSrc;
    before(function () {
        mainSrc = fs.readFileSync(
            path.join(__dirname, '../../../src/webview/main.js'), 'utf-8'
        );
    });

    it('does NOT pass _activeAgent.name as agentName in sendMessage', function () {
        // The old buggy code: `data.agentName || (_activeAgent ? _activeAgent.name : undefined)`
        // Sticky agent is already selected at SDK level via selectAgent().
        assert.ok(
            !mainSrc.includes('_activeAgent.name'),
            'main.js must not pass _activeAgent.name as agentName in rpc.sendMessage — sticky is handled by SDK session'
        );
    });

    it('passes data.agentName (one-shot @mention) directly to rpc.sendMessage', function () {
        assert.ok(
            mainSrc.includes('data.agentName'),
            'main.js must pass data.agentName to rpc.sendMessage for one-shot @mentions'
        );
    });
});
