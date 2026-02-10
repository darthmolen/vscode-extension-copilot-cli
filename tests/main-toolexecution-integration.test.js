/**
 * Integration Tests: main.js ToolExecution Integration
 * 
 * Tests the ACTUAL production flow:
 * RPC message → main.js handler → EventBus event → ToolExecution → DOM
 * 
 * CRITICAL: These tests MUST import and test actual main.js
 * They should FAIL until main.js is integrated with ToolExecution component
 */

import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';

describe('main.js + ToolExecution Integration', () => {
    let dom, window, document;
    let messagesContainer, eventBus, messageDisplay, toolExecution;

    before(async () => {
        // Setup JSDOM with full HTML structure main.js expects (ONCE for all tests)
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <body>
                <div id="messages"></div>
                <div id="emptyState"></div>
                <div id="thinking"></div>
                <textarea id="messageInput"></textarea>
                <button id="sendButton"></button>
                <div id="statusIndicator"></div>
                <select id="sessionSelect"></select>
                <button id="newSessionBtn"></button>
                <button id="viewPlanBtn"></button>
                <input type="checkbox" id="showReasoningCheckbox" />
                <button id="enterPlanModeBtn"></button>
                <button id="acceptPlanBtn"></button>
                <button id="rejectPlanBtn"></button>
                <div id="reasoningIndicator"></div>
                <div id="usageWindow"></div>
                <div id="usageUsed"></div>
                <div id="usageRemaining"></div>
                <div id="focusFileInfo"></div>
                <div id="acceptanceControls"></div>
                <textarea id="acceptanceInput"></textarea>
                <button id="keepPlanningBtn"></button>
                <button id="acceptAndWorkBtn"></button>
                <button id="attachButton"></button>
                <div id="attachmentsPreview"></div>
                <span id="attachCount"></span>
            </body>
            </html>
        `, { 
            url: 'http://localhost',
            runScripts: 'outside-only'
        });

        global.window = dom.window;
        global.document = dom.window.document;
        window = global.window;
        document = global.document;

        // Set testing flag BEFORE importing main.js
        window.__TESTING__ = true;

        // Mock vscode API
        global.acquireVsCodeApi = () => ({
            postMessage: () => {},
            getState: () => null,
            setState: () => {}
        });

        // Mock marked
        global.marked = { parse: (text) => `<p>${text}</p>` };

        messagesContainer = document.getElementById('messages');

        // Import main.js - it runs and creates instances (ONCE)
        const mainModule = await import('../src/webview/main.js');
        
        // Extract instances from __testExports
        eventBus = mainModule.__testExports.eventBus;
        messageDisplay = mainModule.__testExports.messageDisplay;
        toolExecution = mainModule.__testExports.toolExecution;
    });

    beforeEach(() => {
        // Clear messages container before each test
        messagesContainer.innerHTML = '';
        
        // Reset ToolExecution internal state
        if (toolExecution) {
            toolExecution.currentToolGroup = null;
            toolExecution.toolGroupExpanded = false;
            toolExecution.tools.clear();
        }
    });

    afterEach(() => {
        // Clear messages container for next test
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
        }
    });

    describe('main.js creates ToolExecution component', () => {
        it('should create ToolExecution instance on initialization', async () => {
            // This test will FAIL because main.js doesn't create ToolExecution yet
            const { ToolExecution } = await import('../src/webview/app/components/ToolExecution/ToolExecution.js');
            
            expect(toolExecution, 'main.js should create ToolExecution instance').to.exist;
            expect(toolExecution).to.be.instanceOf(ToolExecution);
        });

        it('should create EventBus instance', () => {
            expect(eventBus, 'main.js should create EventBus').to.exist;
        });

        it('should create MessageDisplay instance', () => {
            expect(messageDisplay, 'main.js should create MessageDisplay').to.exist;
        });
    });

    describe('RPC → EventBus → ToolExecution flow', () => {
        it('should have working EventBus → ToolExecution flow', async () => {
            // Verify DOM is empty
            expect(messagesContainer.querySelector('[data-tool-id]')).to.be.null;

            // ACT: Emit tool:start event (what main.js does when receiving RPC)
            eventBus.emit('tool:start', {
                toolCallId: 'test-123',
                toolName: 'bash',
                arguments: { command: 'ls -la' },
                startTime: Date.now()
            });

            // ASSERT: ToolExecution rendered it
            const toolDiv = messagesContainer.querySelector('[data-tool-id="test-123"]');
            expect(toolDiv, 'Tool should be rendered after tool:start event').to.exist;
            expect(toolDiv.textContent).to.include('bash');
        });

        it('should update tool when tool:complete emitted', async () => {
            // Start tool
            const startTime = Date.now();
            eventBus.emit('tool:start', {
                toolCallId: 'test-456',
                toolName: 'view',
                startTime
            });

            // Verify tool was created
            let toolDiv = messagesContainer.querySelector('[data-tool-id="test-456"]');
            expect(toolDiv, 'Tool should be created by tool:start').to.exist;

            // ACT: Complete tool
            eventBus.emit('tool:complete', {
                toolCallId: 'test-456',
                status: 'complete',
                result: 'File contents',
                endTime: startTime + 1000
            });

            // ASSERT: Tool updated
            toolDiv = messagesContainer.querySelector('[data-tool-id="test-456"]');
            expect(toolDiv, 'Tool should still exist after completion').to.exist;
            expect(toolDiv.textContent).to.include('✅');
            expect(toolDiv.textContent).to.include('1.00s');
        });

        it('should close tool group when user message received', async () => {
            // Add many tools to create a group
            for (let i = 0; i < 5; i++) {
                eventBus.emit('tool:start', {
                    toolCallId: `tool-${i}`,
                    toolName: 'bash',
                    startTime: Date.now()
                });
            }

            // ACT: User message closes current tool group
            eventBus.emit('message:add', {
                role: 'user',
                content: 'What did those tools find?'
            });

            // Add another tool - should create NEW group
            eventBus.emit('tool:start', {
                toolCallId: 'new-tool',
                toolName: 'bash',
                startTime: Date.now()
            });

            // ASSERT: Two separate groups
            const groups = messagesContainer.querySelectorAll('.tool-execution__group');
            expect(groups.length).to.equal(2, 'Should have old group + new group after message');
        });
    });

    describe('Diff button RPC integration', () => {
        it('should handle viewDiff event and send RPC message', async () => {
            // Listen for viewDiff events
            let rpcSent = null;
            eventBus.on('viewDiff', (data) => {
                rpcSent = data;
            });

            // Add tool with diff
            const diffData = {
                toolCallId: 'diff-tool',
                beforeUri: '/tmp/before.ts',
                afterUri: '/workspace/after.ts',
                title: 'Test File'
            };

            eventBus.emit('tool:start', {
                ...diffData,
                toolName: 'edit',
                startTime: Date.now(),
                hasDiff: true,
                diffData
            });

            // Click diff button
            const diffBtn = messagesContainer.querySelector('.tool-execution__diff-btn');
            expect(diffBtn).to.exist;
            diffBtn.click();

            // ASSERT: viewDiff event emitted
            expect(rpcSent).to.deep.equal(diffData);
        });

        it('should handle diffAvailable RPC message and add diff button to existing tool', async () => {
            // Import the actual handler function
            const mainModule = await import('../src/webview/main.js');
            const handleDiffAvailableMessage = mainModule.handleDiffAvailableMessage;

            // 1. Tool starts without diff
            eventBus.emit('tool:start', {
                toolCallId: 'late-diff-tool',
                toolName: 'edit',
                arguments: { path: '/workspace/file.ts' },
                startTime: Date.now()
            });

            // Verify no diff button initially
            let diffBtn = messagesContainer.querySelector('[data-tool-id="late-diff-tool"] .tool-execution__diff-btn');
            expect(diffBtn, 'Should not have diff button initially').to.be.null;

            // 2. Simulate RPC diffAvailable message arriving
            const diffData = {
                toolCallId: 'late-diff-tool',
                beforeUri: '/tmp/before.ts',
                afterUri: '/workspace/file.ts',
                title: 'file.ts'
            };

            // THIS SHOULD CALL handleDiffAvailableMessage which will fail with "buildToolHtml is not defined"
            handleDiffAvailableMessage({ data: diffData });

            // ASSERT: Diff button now exists
            diffBtn = messagesContainer.querySelector('[data-tool-id="late-diff-tool"] .tool-execution__diff-btn');
            expect(diffBtn, 'Should have diff button after diffAvailable').to.exist;

            // Click it and verify event
            let emittedData = null;
            eventBus.on('viewDiff', (data) => { emittedData = data; });
            diffBtn.click();
            
            expect(emittedData).to.deep.equal(diffData);
        });
    });
});
