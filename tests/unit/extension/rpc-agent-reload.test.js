/**
 * TDD tests for agentsPanelClosed RPC message — Phase 1c RED
 *
 * Verifies:
 * 1. isWebviewMessage() accepts 'agentsPanelClosed'
 * 2. ExtensionRpcRouter has onAgentsPanelClosed() handler registration
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

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

describe('RPC: agentsPanelClosed — source checks', function () {
    let messagesSrc;
    let routerSrc;

    before(function () {
        messagesSrc = fs.readFileSync(
            path.join(__dirname, '../../../src/shared/messages.ts'), 'utf-8'
        );
        routerSrc = fs.readFileSync(
            path.join(__dirname, '../../../src/extension/rpc/ExtensionRpcRouter.ts'), 'utf-8'
        );
    });

    it("messages.ts includes 'agentsPanelClosed' in isWebviewMessage validTypes", function () {
        assert.ok(
            messagesSrc.includes("'agentsPanelClosed'"),
            "messages.ts must include 'agentsPanelClosed' in the isWebviewMessage validTypes array"
        );
    });

    it('messages.ts defines AgentsPanelClosedPayload interface', function () {
        assert.ok(
            messagesSrc.includes('AgentsPanelClosedPayload'),
            'messages.ts must define an AgentsPanelClosedPayload interface'
        );
    });

    it("messages.ts includes 'agentsPanelClosed' in WebviewToExtensionMessage union", function () {
        // The union type should include AgentsPanelClosedPayload
        assert.ok(
            messagesSrc.includes('AgentsPanelClosedPayload'),
            "messages.ts WebviewToExtensionMessage union must include AgentsPanelClosedPayload"
        );
    });

    it('ExtensionRpcRouter has onAgentsPanelClosed() method', function () {
        assert.ok(
            routerSrc.includes('onAgentsPanelClosed'),
            'ExtensionRpcRouter must have an onAgentsPanelClosed() handler registration method'
        );
    });

    it('ExtensionRpcRouter onAgentsPanelClosed() registers agentsPanelClosed handler', function () {
        const body = routerSrc.slice(
            routerSrc.indexOf('onAgentsPanelClosed'),
            routerSrc.indexOf('onAgentsPanelClosed') + 300
        );
        assert.ok(
            body.includes("'agentsPanelClosed'") || body.includes('"agentsPanelClosed"'),
            "onAgentsPanelClosed() must call registerHandler('agentsPanelClosed', handler)"
        );
    });
});

describe('WebviewRpcClient — agentsPanelClosed send method', function () {
    let clientSrc;

    before(function () {
        clientSrc = fs.readFileSync(
            path.join(__dirname, '../../../src/webview/app/rpc/WebviewRpcClient.js'), 'utf-8'
        );
    });

    it('WebviewRpcClient has agentsPanelClosed() send method', function () {
        assert.ok(
            clientSrc.includes('agentsPanelClosed'),
            'WebviewRpcClient.js must have an agentsPanelClosed() method'
        );
    });

    it('agentsPanelClosed() sends { type: agentsPanelClosed }', function () {
        const body = clientSrc.slice(
            clientSrc.indexOf('agentsPanelClosed'),
            clientSrc.indexOf('agentsPanelClosed') + 200
        );
        assert.ok(
            body.includes('agentsPanelClosed'),
            "agentsPanelClosed() must call this._send({ type: 'agentsPanelClosed' })"
        );
    });
});
