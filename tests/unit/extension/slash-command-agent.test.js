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
