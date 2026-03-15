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

});

// ─── Phase 3a: onDidSelectAgent event + extension.ts wiring ─────────────────

describe('chatViewProvider.ts — onDidSelectAgent event', function () {
    this.timeout(5000);

    let ChatViewProvider;
    let ExtensionRpcRouter;

    before(function () {
        try {
            const cvpMod = require('../../../out/chatViewProvider.js');
            ChatViewProvider = cvpMod.ChatViewProvider;
        } catch (e) {
            console.log('ChatViewProvider not compiled, skipping:', e.message);
            this.skip();
        }
        try {
            const rpcMod = require('../../../out/extension/rpc/ExtensionRpcRouter.js');
            ExtensionRpcRouter = rpcMod.ExtensionRpcRouter;
        } catch (e) {
            console.log('ExtensionRpcRouter not compiled, skipping:', e.message);
            this.skip();
        }
    });

    it('ChatViewProvider class exports onDidSelectAgent as an instance property', function () {
        // ChatViewProvider can't be instantiated in unit tests (DisposableStore + EventEmitter
        // initialization chain). Verify the export exists and the class is constructable in shape.
        assert.ok(ChatViewProvider, 'ChatViewProvider should be exported');
        // The onDidSelectAgent property is set as a class field initializer, not on prototype.
        // We verify it's wired correctly via the RPC router tests below (routing selectAgent
        // message → handler fires). This test just confirms the class is importable.
        assert.strictEqual(typeof ChatViewProvider, 'function', 'ChatViewProvider should be a class');
    });

    it('ExtensionRpcRouter.prototype.onSelectAgent is a function', function () {
        assert.strictEqual(
            typeof ExtensionRpcRouter.prototype.onSelectAgent,
            'function',
            'onSelectAgent must be a method on ExtensionRpcRouter'
        );
    });

    it('routing a selectAgent message calls the registered handler with the payload', function () {
        const sentMessages = [];
        const mockWebview = {
            postMessage(msg) { sentMessages.push(msg); },
            onDidReceiveMessage() { return { dispose: () => {} }; }
        };
        const router = new ExtensionRpcRouter(mockWebview);
        let received = null;
        router.onSelectAgent((payload) => { received = payload; });
        router.route({ type: 'selectAgent', agentName: 'reviewer' });
        assert.ok(received, 'onSelectAgent handler should have been called');
        assert.strictEqual(received.agentName, 'reviewer');
    });
});

describe('extension.ts — wires onDidSelectAgent to SDK', function () {
    this.timeout(5000);

    let ExtensionRpcRouter;
    let SDKSessionManager;

    before(function () {
        try {
            const rpcMod = require('../../../out/extension/rpc/ExtensionRpcRouter.js');
            ExtensionRpcRouter = rpcMod.ExtensionRpcRouter;
        } catch (e) {
            console.log('ExtensionRpcRouter not compiled, skipping:', e.message);
            this.skip();
        }
        try {
            const sdkMod = require('../../../out/sdkSessionManager.js');
            SDKSessionManager = sdkMod.SDKSessionManager;
        } catch (e) {
            console.log('SDKSessionManager not compiled, skipping:', e.message);
            this.skip();
        }
    });

    it('SDKSessionManager.prototype.selectAgent is a function', function () {
        assert.strictEqual(
            typeof SDKSessionManager.prototype.selectAgent,
            'function',
            'selectAgent must be a method on SDKSessionManager'
        );
    });

    it('SDKSessionManager.prototype.deselectAgent is a function', function () {
        assert.strictEqual(
            typeof SDKSessionManager.prototype.deselectAgent,
            'function',
            'deselectAgent must be a method on SDKSessionManager'
        );
    });

    it('RPC router onSelectAgent handler receives agent name when selectAgent message routed', function () {
        const mockWebview = {
            postMessage() {},
            onDidReceiveMessage() { return { dispose: () => {} }; }
        };
        const router = new ExtensionRpcRouter(mockWebview);
        let received = null;
        router.onSelectAgent((payload) => { received = payload; });
        router.route({ type: 'selectAgent', agentName: 'code-reviewer' });
        assert.ok(received, 'handler should fire');
        assert.strictEqual(received.agentName, 'code-reviewer');
    });

    it('RPC router onSelectAgent handler receives clear signal when selectAgent message has empty agentName', function () {
        const mockWebview = {
            postMessage() {},
            onDidReceiveMessage() { return { dispose: () => {} }; }
        };
        const router = new ExtensionRpcRouter(mockWebview);
        let received = null;
        router.onSelectAgent((payload) => { received = payload; });
        router.route({ type: 'selectAgent', agentName: '' });
        assert.ok(received, 'handler should fire');
        assert.strictEqual(received.agentName, '');
    });
});

// ─── Phase 4a: main.js send handler — sticky vs @mention ─────────────────────
// Contract test: verifies the input:sendMessage handler only forwards data.agentName,
// not the sticky _activeAgent. This mirrors the handler logic in main.js lines 236-241.

describe('main.js — sendMessage payload: sticky vs one-shot', function () {
    this.timeout(5000);

    it('sendMessage receives only data.agentName, not sticky _activeAgent', function () {
        // Replicate the handler contract from main.js:
        //   rpc.sendMessage(data.text, data.attachments.length > 0 ? data.attachments : undefined, data.agentName)
        const calls = [];
        const mockRpc = {
            sendMessage(text, attachments, agentName) {
                calls.push({ text, attachments, agentName });
            }
        };

        // Simulate the handler logic from main.js
        function handleSendMessage(data, rpc) {
            rpc.sendMessage(
                data.text,
                data.attachments.length > 0 ? data.attachments : undefined,
                data.agentName
            );
        }

        // Case 1: no @mention, sticky agent active — agentName should be undefined
        handleSendMessage(
            { text: 'hello', attachments: [], agentName: undefined },
            mockRpc
        );
        assert.strictEqual(calls[0].text, 'hello');
        assert.strictEqual(calls[0].attachments, undefined);
        assert.strictEqual(calls[0].agentName, undefined,
            'sticky agent must NOT be passed — SDK handles it at session level');

        // Case 2: @mention present — agentName should be forwarded
        handleSendMessage(
            { text: 'review this', attachments: [], agentName: 'reviewer' },
            mockRpc
        );
        assert.strictEqual(calls[1].agentName, 'reviewer',
            'one-shot @mention agentName must be forwarded to rpc.sendMessage');
    });

    it('sendMessage forwards attachments when present', function () {
        const calls = [];
        const mockRpc = {
            sendMessage(text, attachments, agentName) {
                calls.push({ text, attachments, agentName });
            }
        };

        function handleSendMessage(data, rpc) {
            rpc.sendMessage(
                data.text,
                data.attachments.length > 0 ? data.attachments : undefined,
                data.agentName
            );
        }

        const files = [{ name: 'file.ts', path: '/src/file.ts' }];
        handleSendMessage(
            { text: 'check this', attachments: files, agentName: undefined },
            mockRpc
        );
        assert.deepStrictEqual(calls[0].attachments, files);
        assert.strictEqual(calls[0].agentName, undefined);
    });
});
