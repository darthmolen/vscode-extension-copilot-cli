/**
 * TDD tests for Phase 6b — Streaming Backend
 *
 * RED phase: Tests FAIL before implementation.
 * Pattern: source-code scan (like sdk-upgrade-0132.test.js).
 *
 * Covers:
 * 1. streaming:true in createSessionWithModelFallback central config
 * 2. _onDidMessageDelta BufferedEmitter declared
 * 3. onDidMessageDelta public event exposed
 * 4. case 'assistant.message_delta' fires _onDidMessageDelta with messageId + deltaContent
 * 5. _onDidReceiveOutput fires { content, messageId } (not bare string)
 * 6. AssistantMessagePayload has messageId field in shared/messages.ts
 * 7. sendMessageDelta(messageId, deltaContent) exists in ExtensionRpcRouter.ts
 * 8. chatViewProvider.ts has public sendMessageDelta proxy
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SDK_SOURCE = path.join(__dirname, '../../../src/sdkSessionManager.ts');
const MESSAGES_SOURCE = path.join(__dirname, '../../../src/shared/messages.ts');
const RPC_ROUTER_SOURCE = path.join(__dirname, '../../../src/extension/rpc/ExtensionRpcRouter.ts');
const CHAT_VIEW_SOURCE = path.join(__dirname, '../../../src/chatViewProvider.ts');

describe('Phase 6b — Streaming Backend', function () {
    this.timeout(10000);

    let sdkSource, messagesSource, rpcSource, chatViewSource;

    before(function () {
        sdkSource = fs.readFileSync(SDK_SOURCE, 'utf8');
        messagesSource = fs.readFileSync(MESSAGES_SOURCE, 'utf8');
        rpcSource = fs.readFileSync(RPC_ROUTER_SOURCE, 'utf8');
        chatViewSource = fs.readFileSync(CHAT_VIEW_SOURCE, 'utf8');
    });

    // -------------------------------------------------------------------------
    // 1. streaming: true in central config
    // -------------------------------------------------------------------------

    describe('SDKSessionManager — streaming config', function () {
        it('should have streaming config in createSessionWithModelFallback central config injection', function () {
            // streaming is now configurable via this.config.streaming ?? true
            const hasCentralStreaming = sdkSource.includes('this.config.streaming');
            assert.ok(hasCentralStreaming, 'streaming must be configurable via this.config.streaming in sdkSessionManager.ts');
        });

        it('streaming config must be near the onPermissionRequest central injection (not a one-off)', function () {
            // Find the createSessionWithModelFallback function and verify streaming is in the config spread
            const fnIdx = sdkSource.indexOf('private async createSessionWithModelFallback');
            assert.ok(fnIdx >= 0, 'createSessionWithModelFallback must exist as private async method');
            // The function body should have both onPermissionRequest and streaming config near each other
            const fnBody = sdkSource.slice(fnIdx, fnIdx + 800);
            assert.ok(fnBody.includes('onPermissionRequest'), 'central config must have onPermissionRequest');
            assert.ok(fnBody.includes('streaming'), 'central config must have streaming alongside onPermissionRequest');
        });
    });

    // -------------------------------------------------------------------------
    // 2. _onDidMessageDelta emitter + public event
    // -------------------------------------------------------------------------

    describe('SDKSessionManager — _onDidMessageDelta emitter', function () {
        it('should declare _onDidMessageDelta as a BufferedEmitter', function () {
            assert.ok(
                sdkSource.includes('_onDidMessageDelta') && sdkSource.includes('BufferedEmitter'),
                '_onDidMessageDelta BufferedEmitter must be declared in sdkSessionManager.ts'
            );
        });

        it('should expose onDidMessageDelta as a public event', function () {
            assert.ok(
                sdkSource.includes('readonly onDidMessageDelta'),
                'onDidMessageDelta public event must be declared in sdkSessionManager.ts'
            );
        });
    });

    // -------------------------------------------------------------------------
    // 3. assistant.message_delta case fires the emitter
    // -------------------------------------------------------------------------

    describe('SDKSessionManager — assistant.message_delta handler', function () {
        it('should fire _onDidMessageDelta in the assistant.message_delta case', function () {
            // The case must fire the emitter, not just break
            const deltaIdx = sdkSource.indexOf("case 'assistant.message_delta'");
            assert.ok(deltaIdx >= 0, "case 'assistant.message_delta' must exist");
            // Check what happens right after the case (within ~300 chars)
            const caseBody = sdkSource.slice(deltaIdx, deltaIdx + 300);
            assert.ok(
                caseBody.includes('_onDidMessageDelta.fire'),
                'assistant.message_delta case must call _onDidMessageDelta.fire()'
            );
        });

        it('should pass messageId from event.data in the delta fire call', function () {
            const deltaIdx = sdkSource.indexOf("case 'assistant.message_delta'");
            const caseBody = sdkSource.slice(deltaIdx, deltaIdx + 300);
            assert.ok(
                caseBody.includes('messageId') && caseBody.includes('event.data'),
                'delta fire must include messageId from event.data'
            );
        });

        it('should pass deltaContent from event.data in the delta fire call', function () {
            const deltaIdx = sdkSource.indexOf("case 'assistant.message_delta'");
            const caseBody = sdkSource.slice(deltaIdx, deltaIdx + 300);
            assert.ok(
                caseBody.includes('deltaContent'),
                'delta fire must include deltaContent'
            );
        });
    });

    // -------------------------------------------------------------------------
    // 4. _onDidReceiveOutput fires { content, messageId } object (not bare string)
    // -------------------------------------------------------------------------

    describe('SDKSessionManager — _onDidReceiveOutput shape change', function () {
        it('_onDidReceiveOutput BufferedEmitter should be typed with object not string', function () {
            // Look for the emitter declaration — should include 'content' and 'messageId' in the type
            const emitterDecl = sdkSource.match(/private readonly _onDidReceiveOutput[^;]+;/)?.[0] ?? '';
            assert.ok(
                emitterDecl.includes('content') || emitterDecl.includes('messageId'),
                `_onDidReceiveOutput must be typed as { content, messageId } object, got: ${emitterDecl}`
            );
        });

        it('_onDidReceiveOutput.fire() in assistant.message handler should pass messageId', function () {
            // Find the assistant.message case and verify the fire call includes messageId
            const msgIdx = sdkSource.indexOf("case 'assistant.message':");
            assert.ok(msgIdx >= 0, "case 'assistant.message': must exist");
            // Look for the fire call in that case's body (up to ~2200 chars)
            const caseBody = sdkSource.slice(msgIdx, msgIdx + 2200);
            assert.ok(
                caseBody.includes('_onDidReceiveOutput.fire') && caseBody.includes('messageId'),
                '_onDidReceiveOutput.fire() must include messageId field'
            );
        });
    });

    // -------------------------------------------------------------------------
    // 5. shared/messages.ts — AssistantMessagePayload.messageId + MessageDeltaPayload
    // -------------------------------------------------------------------------

    describe('shared/messages.ts — streaming types', function () {
        it('AssistantMessagePayload should have a messageId field', function () {
            const payloadIdx = messagesSource.indexOf('AssistantMessagePayload');
            assert.ok(payloadIdx >= 0, 'AssistantMessagePayload must exist');
            const payloadBody = messagesSource.slice(payloadIdx, payloadIdx + 200);
            assert.ok(
                payloadBody.includes('messageId'),
                'AssistantMessagePayload must have messageId field'
            );
        });

        it('should have MessageDeltaPayload interface', function () {
            assert.ok(
                messagesSource.includes('MessageDeltaPayload'),
                'MessageDeltaPayload interface must exist in shared/messages.ts'
            );
        });

        it('MessageDeltaPayload should have messageId and deltaContent fields', function () {
            const idx = messagesSource.indexOf('MessageDeltaPayload');
            assert.ok(idx >= 0, 'MessageDeltaPayload must exist');
            const body = messagesSource.slice(idx, idx + 200);
            assert.ok(body.includes('messageId'), 'MessageDeltaPayload must have messageId');
            assert.ok(body.includes('deltaContent'), 'MessageDeltaPayload must have deltaContent');
        });

        it("should have 'messageDelta' in ExtensionMessageType union", function () {
            assert.ok(
                messagesSource.includes("'messageDelta'"),
                "'messageDelta' must be in ExtensionMessageType union"
            );
        });
    });

    // -------------------------------------------------------------------------
    // 6. ExtensionRpcRouter — sendMessageDelta
    // -------------------------------------------------------------------------

    describe('ExtensionRpcRouter — sendMessageDelta', function () {
        it('should have sendMessageDelta method', function () {
            assert.ok(
                rpcSource.includes('sendMessageDelta'),
                'sendMessageDelta method must exist in ExtensionRpcRouter.ts'
            );
        });

        it('sendMessageDelta should accept messageId and deltaContent parameters', function () {
            const methodIdx = rpcSource.indexOf('sendMessageDelta');
            assert.ok(methodIdx >= 0, 'sendMessageDelta must exist');
            const methodSig = rpcSource.slice(methodIdx, methodIdx + 100);
            assert.ok(
                methodSig.includes('messageId') && methodSig.includes('deltaContent'),
                'sendMessageDelta must have messageId and deltaContent params'
            );
        });

        it('addAssistantMessage should accept optional messageId parameter', function () {
            const methodIdx = rpcSource.indexOf('addAssistantMessage');
            assert.ok(methodIdx >= 0, 'addAssistantMessage must exist');
            const methodSig = rpcSource.slice(methodIdx, methodIdx + 150);
            assert.ok(
                methodSig.includes('messageId'),
                'addAssistantMessage must accept messageId parameter'
            );
        });
    });

    // -------------------------------------------------------------------------
    // 7. chatViewProvider.ts — sendMessageDelta public proxy
    // -------------------------------------------------------------------------

    describe('chatViewProvider.ts — sendMessageDelta proxy', function () {
        it('should have public sendMessageDelta method', function () {
            assert.ok(
                chatViewSource.includes('sendMessageDelta'),
                'chatViewProvider.ts must have sendMessageDelta proxy method'
            );
        });
    });
});
