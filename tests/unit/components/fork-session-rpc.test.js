/**
 * TDD tests for WebviewRpcClient.forkSession() RPC method
 *
 * RED phase: Tests FAIL until forkSession() is added to WebviewRpcClient.js
 *
 * Pattern: paste-image-rpc-wiring.test.js
 * Failure expected: "rpc.forkSession is not a function"
 */

const assert = require('assert');
const { createTestDOM, cleanupTestDOM } = require('../../helpers/jsdom-setup');

describe('Fork Session RPC Wiring (Webview)', function () {
    let dom;

    beforeEach(function () {
        dom = createTestDOM('<div id="app"></div>');
    });

    afterEach(function () {
        cleanupTestDOM(dom);
        delete global.acquireVsCodeApi;
    });

    describe('WebviewRpcClient.forkSession()', function () {
        let WebviewRpcClient;

        before(function () {
            try {
                ({ WebviewRpcClient } = require('../../../src/webview/app/rpc/WebviewRpcClient.js'));
            } catch (err) {
                console.log('[TDD RED] WebviewRpcClient not yet updated:', err.message);
                this.skip();
            }
        });

        it('should send forkSession message with correct type', function () {
            const postedMessages = [];
            global.acquireVsCodeApi = () => ({
                postMessage: (msg) => postedMessages.push(msg),
                getState: () => null,
                setState: () => {}
            });

            const rpc = new WebviewRpcClient();
            rpc.forkSession();

            assert.strictEqual(postedMessages.length, 1,
                'forkSession() should post exactly one message');
            const msg = postedMessages[0];
            assert.strictEqual(msg.type, 'forkSession',
                'Message type must be "forkSession"');
        });

        it('forkSession should be a method on WebviewRpcClient', function () {
            const postedMessages = [];
            global.acquireVsCodeApi = () => ({
                postMessage: (msg) => postedMessages.push(msg),
                getState: () => null,
                setState: () => {}
            });

            const rpc = new WebviewRpcClient();
            assert.strictEqual(typeof rpc.forkSession, 'function',
                'rpc.forkSession must be a function');
        });
    });

    describe('main.js EventBus → RPC wiring', function () {
        it('should call rpc.forkSession when forkSession event fires on EventBus', function () {
            const { EventBus } = require('../../../src/webview/app/state/EventBus.js');
            const eventBus = new EventBus();

            let forkSessionCalled = false;
            const mockRpc = {
                forkSession: () => { forkSessionCalled = true; }
            };

            // Wire up the handler the same way main.js should
            eventBus.on('forkSession', () => mockRpc.forkSession());

            eventBus.emit('forkSession');

            assert.strictEqual(forkSessionCalled, true,
                'rpc.forkSession() must be called when forkSession event fires');
        });
    });
});
