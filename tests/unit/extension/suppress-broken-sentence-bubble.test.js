/**
 * TDD tests for Part 2: Suppress Broken Sentence Bubble
 *
 * RED phase: Tests FAIL before implementation.
 * Pattern: source-code scan for backend change + JSDOM for webview guard.
 *
 * Covers:
 * 1. sdkSessionManager does NOT fire _onDidReceiveOutput when toolRequests are present
 * 2. sdkSessionManager DOES fire _onDidReceiveOutput when toolRequests absent
 * 3. sdkSessionManager sends empty finalization signal when toolRequests present + messageId
 * 4. MessageDisplay.addMessage skips empty assistant bubbles (no streaming bubble + empty content)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SDK_SOURCE = path.join(__dirname, '../../../src/sdkSessionManager.ts');

describe('Part 2 — Suppress Broken Sentence Bubble', function () {
    this.timeout(10000);

    let sdkSource;

    before(function () {
        sdkSource = fs.readFileSync(SDK_SOURCE, 'utf8');
    });

    // -------------------------------------------------------------------------
    // 1. Suppression when toolRequests present
    // -------------------------------------------------------------------------

    describe('sdkSessionManager — assistant.message handler', function () {
        it('should check for toolRequests before firing _onDidReceiveOutput', function () {
            // The handler must check hasToolRequests before calling _onDidReceiveOutput.fire
            // Look for the pattern that guards on toolRequests being absent
            const hasGuard = sdkSource.includes('hasToolRequests') || 
                sdkSource.includes('toolRequests.length > 0');
            assert.ok(hasGuard,
                'assistant.message handler must check for toolRequests before firing _onDidReceiveOutput');
        });

        it('should not fire _onDidReceiveOutput with content when toolRequests are present', function () {
            // The fire call must be conditioned on !hasToolRequests
            // Check that content + messageId fire only when no tool requests
            const hasConditionalFire = 
                sdkSource.includes('!hasToolRequests') ||
                (sdkSource.includes('hasToolRequests') && sdkSource.includes('!hasToolRequests'));
            assert.ok(hasConditionalFire,
                '_onDidReceiveOutput.fire must be gated on !hasToolRequests');
        });

        it('should send finalization signal (empty content + messageId) when toolRequests present', function () {
            // When toolRequests are present, we still need to finalize streaming bubbles.
            // The code must fire _onDidReceiveOutput with empty content and the messageId
            // so MessageDisplay can finalize any in-progress streaming bubble.
            const hasFinalizeSignal = 
                sdkSource.includes("content: ''") ||
                sdkSource.includes('content: ""');
            assert.ok(hasFinalizeSignal,
                'Must fire _onDidReceiveOutput with empty content to finalize streaming bubble when toolRequests present');
        });
    });

    // -------------------------------------------------------------------------
    // 2. MessageDisplay guard: skip empty assistant bubbles
    // -------------------------------------------------------------------------

    describe('MessageDisplay — addMessage empty bubble guard', function () {
        let dom;
        let MessageDisplay;
        let EventBus;
        let createComponentDOM;
        let cleanupComponentDOM;

        before(async function () {
            const helpers = require('../../helpers/jsdom-component-setup');
            createComponentDOM = helpers.createComponentDOM;
            cleanupComponentDOM = helpers.cleanupComponentDOM;

            const mdModule = await import('../../../src/webview/app/components/MessageDisplay/MessageDisplay.js');
            MessageDisplay = mdModule.MessageDisplay;

            const busModule = await import('../../../src/webview/app/state/EventBus.js');
            EventBus = busModule.EventBus;
        });

        beforeEach(function () {
            dom = createComponentDOM();
            global.marked = { parse: (text) => `<p>${text}</p>` };
        });

        afterEach(function () {
            cleanupComponentDOM(dom);
            delete global.marked;
        });

        it('does not create a new assistant bubble when content is empty and no streaming bubble exists', function () {
            const container = document.getElementById('messages-mount');
            const eventBus = new EventBus();
            const md = new MessageDisplay(container, eventBus);

            const before = md.messagesContainer.querySelectorAll('.message-display__item--assistant').length;

            // Emit message:add with empty content and no matching streaming bubble
            eventBus.emit('message:add', {
                role: 'assistant',
                content: '',
                messageId: 'no-bubble-id-xyz',
                timestamp: Date.now()
            });

            const after = md.messagesContainer.querySelectorAll('.message-display__item--assistant').length;
            assert.strictEqual(after, before, 
                'Should NOT create a new assistant bubble when content is empty and no streaming bubble exists');
        });

        it('finalizes a streaming bubble when content is empty but messageId matches existing streaming bubble', function () {
            const container = document.getElementById('messages-mount');
            const eventBus = new EventBus();
            const md = new MessageDisplay(container, eventBus);

            // Create a streaming bubble by sending a delta
            eventBus.emit('message:delta', {
                messageId: 'streaming-id-abc',
                deltaContent: 'Some content being streamed'
            });

            assert.ok(md.streamingBubbles.has('streaming-id-abc'), 'Streaming bubble should exist');

            // Now finalize it with empty content signal (the Part 2 suppression path)
            eventBus.emit('message:add', {
                role: 'assistant',
                content: '',
                messageId: 'streaming-id-abc',
                timestamp: Date.now()
            });

            // Streaming bubble should be finalized (removed from map)
            assert.ok(!md.streamingBubbles.has('streaming-id-abc'), 
                'Streaming bubble should be finalized even with empty content');
            // The bubble element should still be in the DOM (not removed)
            const bubble = container.querySelector('[data-message-id="streaming-id-abc"]');
            assert.ok(bubble, 'Finalized bubble element should remain in DOM');
        });
    });
});
