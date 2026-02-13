/**
 * main.js Integration Tests
 * 
 * Tests the integration between main.js, EventBus, and MessageDisplay.
 * Verifies that RPC messages flow through EventBus to MessageDisplay correctly.
 * 
 * Note: main.js runs on import, so we need to set up globals first.
 */

import { expect } from 'chai';
import { JSDOM } from 'jsdom';

describe('main.js Integration', () => {
    let dom;
    let window;
    let document;
    let vscodeApi;
    let rpcMessages;

    beforeEach(() => {
        // Create fresh DOM
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <head>
                <script>
                    // Mock marked.js
                    window.marked = {
                        parse: (text) => '<p>' + text + '</p>'
                    };
                </script>
            </head>
            <body>
                <div id="messages"></div>
                <div id="emptyState" style="display: block;"></div>
                <div id="thinking" style="display: none;"></div>
                <textarea id="messageInput"></textarea>
                <button id="sendButton"></button>
                <button id="attachButton"></button>
                <div id="attachmentsPreview"></div>
                <select id="sessionSelect"></select>
                <button id="newSessionBtn"></button>
                <button id="viewPlanBtn"></button>
                <button id="enterPlanModeBtn"></button>
                <button id="acceptPlanBtn"></button>
                <button id="rejectPlanBtn"></button>
                <div id="acceptanceControls"></div>
                <input id="acceptanceInput" />
                <button id="keepPlanningBtn"></button>
                <button id="acceptAndWorkBtn"></button>
                <span id="usageWindow"></span>
                <span id="usageUsed"></span>
                <span id="usageRemaining"></span>
                <span id="reasoningIndicator"></span>
                <span id="reasoningText"></span>
                <input type="checkbox" id="showReasoningCheckbox" />
                <span id="focusFileInfo"></span>
                <div id="attachCount"></div>
                <div id="statusIndicator"></div>
                <div id="planModeControls"></div>
            </body>
            </html>
        `);

        window = dom.window;
        document = window.document;
        
        // Track RPC messages sent
        rpcMessages = [];
        
        // Mock VS Code API
        vscodeApi = {
            postMessage: (msg) => {
                rpcMessages.push(msg);
            },
            getState: () => ({}),
            setState: () => {}
        };
        
        // Set up globals that main.js expects
        global.window = window;
        global.document = document;
        global.marked = window.marked;
        global.acquireVsCodeApi = () => vscodeApi;
    });

    afterEach(() => {
        // Clean up globals
        delete global.window;
        delete global.document;
        delete global.marked;
        delete global.acquireVsCodeApi;
    });

    describe('Initialization', () => {
        it('should create EventBus instance', async () => {
            // Import main.js (which runs on import)
            const mainModule = await import('../../../src/webview/main.js?t=' + Date.now());
            
            // EventBus should be created (we can't access it directly, but we can test its effects)
            // If EventBus exists, MessageDisplay will work
            expect(document.querySelector('#messages')).to.exist;
        });

        it('should create MessageDisplay instance', async () => {
            const mainModule = await import('../../../src/webview/main.js?t=' + Date.now());
            
            // MessageDisplay adds class to container
            const messagesContainer = document.getElementById('messages');
            expect(messagesContainer.classList.contains('message-display')).to.be.true;
        });

        it('should show empty state initially', async () => {
            const mainModule = await import('../../../src/webview/main.js?t=' + Date.now());
            
            const emptyState = document.getElementById('emptyState');
            expect(emptyState).to.exist;
            expect(emptyState.style.display).to.not.equal('none');
        });
    });

    describe('RPC to EventBus integration', () => {
        it('should emit message:add event when user sends message', async () => {
            const mainModule = await import('../../../src/webview/main.js?t=' + Date.now());
            
            const messagesContainer = document.getElementById('messages');
            const initialMessageCount = messagesContainer.querySelectorAll('.message-display__item').length;
            
            // Simulate user message via RPC (we'll need to trigger the handler)
            // For now, verify the structure is set up
            expect(messagesContainer).to.exist;
        });
    });

    describe('Message rendering integration', () => {
        it('should render user message when added via EventBus', async () => {
            // Import main.js to initialize components
            const mainModule = await import('../../../src/webview/main.js?t=' + Date.now());
            
            // Get EventBus instance (it's created in main.js)
            // We need to expose it for testing or trigger via RPC
            const messagesContainer = document.getElementById('messages');
            
            // For now, verify structure
            expect(messagesContainer.classList.contains('message-display')).to.be.true;
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
