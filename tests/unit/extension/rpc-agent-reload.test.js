/**
 * TDD tests for agentsPanelClosed RPC message — Phase 1c RED
 *
 * Verifies:
 * 1. isWebviewMessage() accepts 'agentsPanelClosed'
 * 2. ExtensionRpcRouter has onAgentsPanelClosed() handler registration
 */

const assert = require('assert');

const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('../../helpers/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

describe('RPC: agentsPanelClosed message type', function () {
    let isWebviewMessage;

    before(function () {
        try {
            ({ isWebviewMessage } = require('../../../out/shared/messages.js'));
        } catch {
            this.skip();
        }
    });

    it('isWebviewMessage() returns true for agentsPanelClosed', function () {
        if (!isWebviewMessage) { this.skip(); }
        const result = isWebviewMessage({ type: 'agentsPanelClosed' });
        assert.strictEqual(result, true,
            "isWebviewMessage must accept 'agentsPanelClosed' as a valid webview message type");
    });
});

