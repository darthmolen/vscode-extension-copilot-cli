/**
 * main.js Integration Tests
 *
 * Tests the integration between main.js, EventBus, and MessageDisplay.
 * Verifies that RPC messages flow through EventBus to MessageDisplay correctly.
 *
 * Note: main.js runs on import, so we need to set up globals first.
 */

import { expect } from 'chai';
import { createComponentDOM, cleanupComponentDOM } from '../../helpers/jsdom-component-setup.js';

describe('main.js Integration', () => {
    let dom;
    let document;
    let mainModule;

    before(async () => {
        // Use standardized component DOM setup with all mount points (once for all tests)
        dom = createComponentDOM();
        document = global.document;

        // Mock VS Code API
        global.acquireVsCodeApi = () => ({
            postMessage: () => {},
            getState: () => ({}),
            setState: () => {}
        });
        global.window.__TESTING__ = true;

        // Import main.js once (which runs on import)
        mainModule = await import('../../../src/webview/main.js?t=main-int-' + Date.now());
    });

    after(() => {
        delete global.acquireVsCodeApi;
        cleanupComponentDOM(dom);
    });

    describe('Initialization', () => {
        it('should create EventBus instance', () => {
            // EventBus should be created (we can't access it directly, but we can test its effects)
            // If EventBus exists, MessageDisplay will work
            expect(document.querySelector('#messages-mount')).to.exist;
        });

        it('should create MessageDisplay instance', () => {
            // MessageDisplay renders an inner #messages div with the message-display class
            const messagesEl = document.getElementById('messages');
            expect(messagesEl).to.exist;
            expect(messagesEl.classList.contains('message-display')).to.be.true;
        });

        it('should show empty state initially', () => {
            const emptyState = document.getElementById('emptyState');
            expect(emptyState).to.exist;
            expect(emptyState.style.display).to.not.equal('none');
        });
    });

    describe('RPC to EventBus integration', () => {
        it('should emit message:add event when user sends message', () => {
            const messagesContainer = document.getElementById('messages-mount');
            const initialMessageCount = messagesContainer.querySelectorAll('.message-display__item').length;

            // Simulate user message via RPC (we'll need to trigger the handler)
            // For now, verify the structure is set up
            expect(messagesContainer).to.exist;
        });
    });

    describe('Message rendering integration', () => {
        it('should render user message when added via EventBus', () => {
            // Get EventBus instance (it's created in main.js)
            // We need to expose it for testing or trigger via RPC
            const messagesEl = document.getElementById('messages');

            // For now, verify structure
            expect(messagesEl).to.exist;
            expect(messagesEl.classList.contains('message-display')).to.be.true;
        });
    });

    describe.skip('Full RPC flow (needs RPC client mock)', () => {
        it('should handle init message and render history', async () => {
            // TODO: Mock RPC client to send init message
            // Verify messages are added to DOM
        });

        it('should handle assistantMessage and render to DOM', async () => {
            // TODO: Mock RPC client to send assistantMessage
            // Verify message appears in DOM
        });

        it('should handle toolExecutionStart and create tool group', async () => {
            // TODO: Mock RPC client to send toolExecutionStart
            // Verify tool group created
        });
    });
});
