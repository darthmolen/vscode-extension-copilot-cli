/**
 * Integration Tests: main.js ToolExecution Integration
 *
 * Tests the ACTUAL production flow:
 * RPC message → main.js handler → EventBus event → ToolExecution → DOM
 *
 * ToolExecution is created internally by MessageDisplay (component hierarchy).
 * These tests verify the EventBus-driven flow works end-to-end.
 */

import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { createComponentDOM, cleanupComponentDOM } from '../../helpers/jsdom-component-setup.js';

describe('main.js + ToolExecution Integration', () => {
    let dom, window, document;
    let messagesContainer, eventBus, messageDisplay, toolExecution;

    let mainModule;

    before(async () => {
        // Use standardized component DOM setup with all mount points
        dom = createComponentDOM();
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

        messagesContainer = document.getElementById('messages-mount');

        // Import main.js - it runs and creates instances (ONCE)
        // Use unique query to avoid module cache conflicts with other test files
        mainModule = await import('../../../src/webview/main.js?t=toolexec-' + Date.now());

        // Extract instances from __testExports
        eventBus = mainModule.__testExports.eventBus;
        messageDisplay = mainModule.__testExports.messageDisplay;
        // ToolExecution is created internally by MessageDisplay (component hierarchy)
        toolExecution = messageDisplay.toolExecution;
    });

    after(() => {
        delete global.acquireVsCodeApi;
        cleanupComponentDOM(dom);
    });

    beforeEach(() => {
        // Clear the INNER messages container (not the outer mount point).
        // MessageDisplay renders into an inner #messages div, and ToolExecution's
        // this.container references that inner div. Clearing the outer mount
        // would orphan it.
        const innerMessages = messageDisplay.messagesContainer;
        if (innerMessages) {
            innerMessages.innerHTML = '';
        }

        // Reset ToolExecution internal state
        if (toolExecution) {
            toolExecution.currentToolGroup = null;
            toolExecution.toolGroupExpanded = false;
            toolExecution.tools.clear();
            toolExecution.collapsedCards.clear();
        }
    });

    afterEach(() => {
        const innerMessages = messageDisplay.messagesContainer;
        if (innerMessages) {
            innerMessages.innerHTML = '';
        }
    });

    describe('MessageDisplay creates ToolExecution as child component', () => {
        it('should create ToolExecution instance internally', async () => {
            const { ToolExecution } = await import('../../../src/webview/app/components/ToolExecution/ToolExecution.js');

            expect(toolExecution, 'MessageDisplay should create ToolExecution instance').to.exist;
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

            // ACT: User message arrives — closes current tool group
            eventBus.emit('message:add', {
                role: 'user',
                content: 'What did those tools find?'
            });

            // Add another tool - should start a NEW group
            eventBus.emit('tool:start', {
                toolCallId: 'new-tool',
                toolName: 'bash',
                startTime: Date.now()
            });

            // ASSERT: Two separate groups (user message splits them)
            const groups = messagesContainer.querySelectorAll('.tool-execution__group');
            expect(groups.length).to.equal(2, 'User message should start a new tool group');
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
            // Reuse the main module imported in before() hook
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
