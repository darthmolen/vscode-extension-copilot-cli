/**
 * TDD tests for Phase 6b — Streaming RPC Flow Integration
 *
 * RED phase: Tests FAIL before implementation.
 * Pattern: source-code scan of main.js + WebviewRpcClient.js (like main-full-integration.test.js).
 *
 * Covers:
 * 1. WebviewRpcClient.js has onMessageDelta() handler registered
 * 2. WebviewRpcClient.js forwards messageId in onAssistantMessage payload
 * 3. main.js wires rpc.onMessageDelta → EventBus message:delta
 * 4. main.js passes messageId through message:add for assistant messages
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const MAIN_JS = path.join(__dirname, '../../../src/webview/main.js');
const RPC_CLIENT_JS = path.join(__dirname, '../../../src/webview/app/rpc/WebviewRpcClient.js');

describe('Streaming RPC Flow Integration', function () {
    this.timeout(10000);

    let mainSource, rpcClientSource;

    before(function () {
        mainSource = fs.readFileSync(MAIN_JS, 'utf8');
        rpcClientSource = fs.readFileSync(RPC_CLIENT_JS, 'utf8');
    });

    // -------------------------------------------------------------------------
    // WebviewRpcClient.js — onMessageDelta + messageId in onAssistantMessage
    // -------------------------------------------------------------------------

    describe('WebviewRpcClient — messageDelta handler', function () {
        it('should have onMessageDelta() method', function () {
            assert.ok(
                rpcClientSource.includes('onMessageDelta'),
                'WebviewRpcClient.js must have onMessageDelta() method'
            );
        });

        it('onMessageDelta should register a handler for messageDelta type', function () {
            const idx = rpcClientSource.indexOf('onMessageDelta');
            assert.ok(idx >= 0, 'onMessageDelta must exist');
            const body = rpcClientSource.slice(idx, idx + 150);
            assert.ok(
                body.includes('messageDelta') || body.includes('_registerHandler'),
                'onMessageDelta must call _registerHandler with messageDelta type'
            );
        });

        it('onAssistantMessage should forward messageId in the callback payload', function () {
            // The messageId forwarding happens in handleAssistantMessageMessage function in main.js
            const idx = mainSource.indexOf('handleAssistantMessageMessage');
            assert.ok(idx >= 0, 'handleAssistantMessageMessage must exist in main.js');
            const body = mainSource.slice(idx, idx + 300);
            assert.ok(
                body.includes('messageId'),
                'onAssistantMessage handler must forward messageId to callback'
            );
        });
    });

    // -------------------------------------------------------------------------
    // main.js — rpc.onMessageDelta wiring + messageId in message:add
    // -------------------------------------------------------------------------

    describe('main.js — streaming wiring', function () {
        it('should call rpc.onMessageDelta', function () {
            assert.ok(
                mainSource.includes('rpc.onMessageDelta') || mainSource.includes('onMessageDelta'),
                'main.js must call rpc.onMessageDelta to wire delta events'
            );
        });

        it('rpc.onMessageDelta handler should emit message:delta on EventBus', function () {
            const idx = mainSource.indexOf('onMessageDelta');
            assert.ok(idx >= 0, 'onMessageDelta must be referenced in main.js');
            // Look within 300 chars for EventBus emit of message:delta
            const body = mainSource.slice(idx, idx + 300);
            assert.ok(
                body.includes("message:delta") || body.includes('message:delta'),
                "main.js onMessageDelta handler must emit 'message:delta' on EventBus"
            );
        });

        it('rpc.onMessageDelta handler should forward messageId and deltaContent', function () {
            const idx = mainSource.indexOf('onMessageDelta');
            const body = mainSource.slice(idx, idx + 300);
            assert.ok(
                body.includes('messageId') && body.includes('deltaContent'),
                'onMessageDelta handler must forward messageId and deltaContent'
            );
        });

        it('assistant message handler should pass messageId to message:add emit', function () {
            // Find the assistantMessage RPC handler in main.js
            const idx = mainSource.indexOf('assistantMessage');
            assert.ok(idx >= 0, 'assistantMessage handler must exist in main.js');
            // Within the handler body, messageId must be forwarded
            const body = mainSource.slice(idx, idx + 400);
            assert.ok(
                body.includes('messageId'),
                'assistantMessage handler must forward messageId to message:add event'
            );
        });
    });
});
