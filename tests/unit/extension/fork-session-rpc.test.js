/**
 * TDD tests for fork session RPC message contract (extension side)
 *
 * RED phase: Tests FAIL until forkSession is added to messages.ts and ExtensionRpcRouter.ts
 *
 * Pattern: rename-session-rpc.test.js
 * Failure expected: isWebviewMessage returns false for forkSession (type not registered)
 */

const assert = require('assert');

describe('Fork Session RPC message contract (Extension)', () => {
    let messages;

    before(function () {
        try {
            messages = require('../../../out/shared/messages');
        } catch (err) {
            console.log('[TDD RED] Compiled messages not available:', err.message);
            this.skip();
        }
    });

    it('isWebviewMessage returns true for forkSession', function () {
        const msg = { type: 'forkSession' };
        assert.strictEqual(messages.isWebviewMessage(msg), true,
            'forkSession should be a valid webview message');
    });

    it('isWebviewMessage returns false for unknown type', function () {
        const msg = { type: 'unknownType' };
        assert.strictEqual(messages.isWebviewMessage(msg), false);
    });

    describe('ExtensionRpcRouter.onForkSession', () => {
        let ExtensionRpcRouter;

        before(function () {
            try {
                ({ ExtensionRpcRouter } = require('../../../out/extension/rpc/ExtensionRpcRouter'));
            } catch (err) {
                console.log('[TDD RED] Compiled ExtensionRpcRouter not available:', err.message);
                this.skip();
            }
        });

        it('routes forkSession messages to registered handler', function () {
            const mockWebview = {
                postMessage: () => {},
                onDidReceiveMessage: () => ({ dispose: () => {} }),
                cspSource: 'mock',
                asWebviewUri: (uri) => uri
            };

            const router = new ExtensionRpcRouter(mockWebview);

            let handlerCalled = false;
            let receivedPayload = null;
            router.onForkSession((payload) => {
                handlerCalled = true;
                receivedPayload = payload;
            });

            router.route({ type: 'forkSession' });

            assert.strictEqual(handlerCalled, true,
                'onForkSession handler must be called when forkSession message is routed');
            assert.ok(receivedPayload !== null, 'Payload must not be null');
            assert.strictEqual(receivedPayload.type, 'forkSession');
        });

        it('does not call forkSession handler for unrelated messages', function () {
            const mockWebview = {
                postMessage: () => {},
                onDidReceiveMessage: () => ({ dispose: () => {} }),
                cspSource: 'mock',
                asWebviewUri: (uri) => uri
            };

            const router = new ExtensionRpcRouter(mockWebview);

            let handlerCalled = false;
            router.onForkSession(() => { handlerCalled = true; });

            router.route({ type: 'sendMessage', text: 'hello' });

            assert.strictEqual(handlerCalled, false,
                'onForkSession handler must not fire for unrelated messages');
        });
    });
});
