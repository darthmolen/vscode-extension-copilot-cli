/**
 * TDD tests for Part 3 — Reasoning Delta Streaming (source-scan)
 *
 * RED phase: Tests FAIL before implementation.
 * Pattern: source-code scan of main.js, WebviewRpcClient.js, sdkSessionManager.ts,
 *          messages.ts, ExtensionRpcRouter.ts, chatViewProvider.ts, extension.ts.
 *
 * Covers:
 * 1. WebviewRpcClient has onReasoningDelta() method
 * 2. main.js wires rpc.onReasoningDelta → eventBus.emit('reasoning:delta')
 * 3. main.js gates reasoning:delta on showReasoning flag
 * 4. MessageDisplay subscribes to 'reasoning:delta'
 * 5. sdkSessionManager has _onDidReceiveReasoningDelta emitter
 * 6. sdkSessionManager handles 'assistant.reasoning_delta' case
 * 7. messages.ts has 'reasoningDelta' type and ReasoningDeltaPayload
 * 8. ExtensionRpcRouter has sendReasoningDelta()
 * 9. chatViewProvider has sendReasoningDelta()
 * 10. extension.ts wires onDidReceiveReasoningDelta to chatProvider
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const MAIN_JS = path.join(__dirname, '../../../src/webview/main.js');
const RPC_CLIENT_JS = path.join(__dirname, '../../../src/webview/app/rpc/WebviewRpcClient.js');
const MESSAGE_DISPLAY_JS = path.join(__dirname, '../../../src/webview/app/components/MessageDisplay/MessageDisplay.js');
const SDK_SOURCE = path.join(__dirname, '../../../src/sdkSessionManager.ts');
const MESSAGES_SOURCE = path.join(__dirname, '../../../src/shared/messages.ts');
const RPC_ROUTER_SOURCE = path.join(__dirname, '../../../src/extension/rpc/ExtensionRpcRouter.ts');
const CHAT_VIEW_SOURCE = path.join(__dirname, '../../../src/chatViewProvider.ts');
const EXTENSION_SOURCE = path.join(__dirname, '../../../src/extension.ts');

describe('Part 3 — Reasoning Delta Streaming (source-scan)', function () {
    this.timeout(10000);

    let mainSource, rpcClientSource, messageDisplaySource;
    let sdkSource, messagesSource, rpcRouterSource, chatViewSource, extensionSource;

    before(function () {
        mainSource = fs.readFileSync(MAIN_JS, 'utf8');
        rpcClientSource = fs.readFileSync(RPC_CLIENT_JS, 'utf8');
        messageDisplaySource = fs.readFileSync(MESSAGE_DISPLAY_JS, 'utf8');
        sdkSource = fs.readFileSync(SDK_SOURCE, 'utf8');
        messagesSource = fs.readFileSync(MESSAGES_SOURCE, 'utf8');
        rpcRouterSource = fs.readFileSync(RPC_ROUTER_SOURCE, 'utf8');
        chatViewSource = fs.readFileSync(CHAT_VIEW_SOURCE, 'utf8');
        extensionSource = fs.readFileSync(EXTENSION_SOURCE, 'utf8');
    });

    // -------------------------------------------------------------------------
    // WebviewRpcClient
    // -------------------------------------------------------------------------
    describe('WebviewRpcClient — onReasoningDelta', function () {
        it('should have onReasoningDelta() method', function () {
            assert.ok(rpcClientSource.includes('onReasoningDelta'),
                'WebviewRpcClient.js must have onReasoningDelta() method');
        });

        it('onReasoningDelta should register handler for reasoningDelta type', function () {
            assert.ok(
                rpcClientSource.includes('reasoningDelta'),
                'onReasoningDelta must reference reasoningDelta message type'
            );
        });
    });

    // -------------------------------------------------------------------------
    // main.js wiring
    // -------------------------------------------------------------------------
    describe('main.js — reasoning delta wiring', function () {
        it('should call rpc.onReasoningDelta', function () {
            assert.ok(mainSource.includes('onReasoningDelta'),
                'main.js must call rpc.onReasoningDelta');
        });

        it('should emit reasoning:delta on EventBus', function () {
            assert.ok(mainSource.includes("'reasoning:delta'") || mainSource.includes('"reasoning:delta"'),
                'main.js must emit reasoning:delta event');
        });

        it('should gate reasoning:delta emission on showReasoning', function () {
            // The handler must check showReasoning before emitting
            const idx = mainSource.indexOf('onReasoningDelta');
            assert.ok(idx >= 0, 'onReasoningDelta must exist');
            // Find the surrounding context (up to 400 chars after)
            const context = mainSource.slice(idx, idx + 400);
            assert.ok(context.includes('showReasoning'),
                'reasoning:delta handler must check showReasoning flag before emitting');
        });
    });

    // -------------------------------------------------------------------------
    // MessageDisplay.js
    // -------------------------------------------------------------------------
    describe('MessageDisplay — reasoning:delta subscription', function () {
        it('should subscribe to reasoning:delta event', function () {
            assert.ok(
                messageDisplaySource.includes("'reasoning:delta'") || messageDisplaySource.includes('"reasoning:delta"'),
                'MessageDisplay must subscribe to reasoning:delta event'
            );
        });

        it('should have reasoningStreamingBubbles Map', function () {
            assert.ok(messageDisplaySource.includes('reasoningStreamingBubbles'),
                'MessageDisplay must have reasoningStreamingBubbles Map');
        });
    });

    // -------------------------------------------------------------------------
    // sdkSessionManager.ts backend
    // -------------------------------------------------------------------------
    describe('sdkSessionManager — reasoning delta emitter', function () {
        it('should have _onDidReceiveReasoningDelta emitter', function () {
            assert.ok(sdkSource.includes('_onDidReceiveReasoningDelta'),
                'sdkSessionManager must have _onDidReceiveReasoningDelta emitter');
        });

        it('should handle assistant.reasoning_delta case', function () {
            assert.ok(sdkSource.includes("'assistant.reasoning_delta'"),
                'sdkSessionManager must handle assistant.reasoning_delta event');
        });

        it('should fire _onDidReceiveReasoningDelta with reasoningId and deltaContent', function () {
            assert.ok(
                sdkSource.includes('_onDidReceiveReasoningDelta.fire') ||
                sdkSource.includes('_onDidReceiveReasoningDelta.fire'),
                'sdkSessionManager must fire _onDidReceiveReasoningDelta on delta events'
            );
        });
    });

    // -------------------------------------------------------------------------
    // shared/messages.ts
    // -------------------------------------------------------------------------
    describe('shared/messages.ts — ReasoningDeltaPayload', function () {
        it('should have reasoningDelta in ExtensionMessageType union', function () {
            assert.ok(messagesSource.includes("'reasoningDelta'") || messagesSource.includes('"reasoningDelta"'),
                'messages.ts must include reasoningDelta in ExtensionMessageType');
        });

        it('should have ReasoningDeltaPayload interface', function () {
            assert.ok(messagesSource.includes('ReasoningDeltaPayload'),
                'messages.ts must have ReasoningDeltaPayload interface');
        });
    });

    // -------------------------------------------------------------------------
    // ExtensionRpcRouter.ts
    // -------------------------------------------------------------------------
    describe('ExtensionRpcRouter — sendReasoningDelta', function () {
        it('should have sendReasoningDelta() method', function () {
            assert.ok(rpcRouterSource.includes('sendReasoningDelta'),
                'ExtensionRpcRouter must have sendReasoningDelta() method');
        });
    });

    // -------------------------------------------------------------------------
    // chatViewProvider.ts
    // -------------------------------------------------------------------------
    describe('chatViewProvider — sendReasoningDelta', function () {
        it('should have sendReasoningDelta() method', function () {
            assert.ok(chatViewSource.includes('sendReasoningDelta'),
                'chatViewProvider must have sendReasoningDelta() method');
        });
    });

    // -------------------------------------------------------------------------
    // extension.ts wiring
    // -------------------------------------------------------------------------
    describe('extension.ts — onDidReceiveReasoningDelta wiring', function () {
        it('should subscribe to onDidReceiveReasoningDelta', function () {
            assert.ok(extensionSource.includes('onDidReceiveReasoningDelta'),
                'extension.ts must subscribe to onDidReceiveReasoningDelta');
        });

        it('should forward to chatProvider.sendReasoningDelta', function () {
            assert.ok(extensionSource.includes('sendReasoningDelta'),
                'extension.ts must call chatProvider.sendReasoningDelta');
        });
    });
});
