/**
 * PROPER Integration Test for Diff Button Functionality
 *
 * Tests the diff button flow through the component architecture:
 * 1. tool:start registers tool via EventBus -> ToolExecution
 * 2. handleDiffAvailableMessage emits tool:complete with hasDiff -> ToolExecution re-renders with diff button
 * 3. Click on diff button -> EventBus viewDiff event -> rpc.viewDiff -> vscode.postMessage
 *
 * Following TDD Iron Laws:
 * - Imports ACTUAL production code (not mocks)
 * - Uses JSDOM to test real DOM
 * - Tests user interactions (button clicks)
 * - Verifies end-to-end message flow
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { createComponentDOM, cleanupComponentDOM } from '../../helpers/jsdom-component-setup.js';

describe('Diff Button Integration - Proper TDD', () => {
	let dom, document, window;
	let rpcSentMessages, handleDiffAvailableMessage, eventBus, messagesContainer;

	beforeEach(async () => {
		// Use standardized component DOM setup with all mount points
		dom = createComponentDOM();
		document = global.document;
		window = global.window;

		// Mark as test environment so main.js skips rpc.ready()
		window.__TESTING__ = true;

		// Track RPC messages sent from webview via vscode.postMessage
		rpcSentMessages = [];

		// Mock VS Code API (required by WebviewRpcClient)
		global.acquireVsCodeApi = () => ({
			postMessage: (msg) => {
				rpcSentMessages.push(msg);
			}
		});

		// Import ACTUAL production code (ESM dynamic import with cache-bust)
		const mainModule = await import('../../../src/webview/main.js?t=' + Date.now());
		handleDiffAvailableMessage = mainModule.handleDiffAvailableMessage;
		eventBus = mainModule.__testExports.eventBus;

		// Use the messages-mount container (where components render)
		messagesContainer = document.getElementById('messages-mount');
	});

	afterEach(() => {
		// Cleanup globals
		delete global.acquireVsCodeApi;
		cleanupComponentDOM(dom);
	});

	/**
	 * Helper: Register a tool via tool:start so ToolExecution tracks it.
	 * This is required before handleDiffAvailableMessage can update it.
	 */
	function registerTool(toolCallId, toolName = 'edit') {
		eventBus.emit('tool:start', {
			toolCallId,
			toolName,
			arguments: { path: '/workspace/file.ts' },
			startTime: Date.now(),
			status: 'running'
		});
	}

	/**
	 * TEST 1: Would have caught the "button doesn't appear" bug
	 *
	 * This test verifies that when we receive a diffAvailable message,
	 * a diff button is actually added to the DOM.
	 */
	it('should add diff button to DOM when diffAvailable message received', () => {
		const toolCallId = 'toolu_test_123';

		// Register tool first (so ToolExecution tracks it)
		registerTool(toolCallId);

		// ACT: Call the actual handleDiffAvailableMessage function
		handleDiffAvailableMessage({
			type: 'diffAvailable',
			toolCallId,
			beforeUri: '/tmp/copilot-snapshots/test-before.ts',
			afterUri: '/workspace/test-after.ts',
			title: 'test.ts (Before -> After)'
		});

		// ASSERT: Verify diff button exists in real DOM
		const toolDiv = messagesContainer.querySelector(`[data-tool-id="${toolCallId}"]`);
		expect(toolDiv, 'Tool element should exist in DOM').to.exist;

		const diffButton = toolDiv.querySelector('.tool-execution__diff-btn');
		expect(diffButton, 'Diff button should exist in DOM').to.exist;
		expect(diffButton.textContent).to.include('View Diff');
	});

	/**
	 * TEST 2: Would have caught the "click sends wrong data" bug
	 *
	 * This test verifies that clicking the diff button sends the correct
	 * data via RPC, not undefined or empty objects.
	 */
	it('should send correct diff data when button clicked', () => {
		const toolCallId = 'toolu_click_test';

		// Register tool first
		registerTool(toolCallId);

		// Receive diffAvailable message
		handleDiffAvailableMessage({
			type: 'diffAvailable',
			toolCallId,
			beforeUri: '/tmp/snapshot/file.ts',
			afterUri: '/workspace/file.ts',
			title: 'file.ts (Before -> After)'
		});

		// Find and click the button
		const toolDiv = messagesContainer.querySelector(`[data-tool-id="${toolCallId}"]`);
		const diffButton = toolDiv.querySelector('.tool-execution__diff-btn');
		expect(diffButton, 'Setup: diff button must exist').to.exist;

		// ACT: Click the actual button
		diffButton.click();

		// ASSERT: Verify correct RPC call was made via vscode.postMessage
		const viewDiffMessages = rpcSentMessages.filter(m => m.type === 'viewDiff');
		expect(viewDiffMessages).to.have.length(1, 'Should send exactly one viewDiff message');

		const sentData = viewDiffMessages[0].data;
		expect(sentData).to.exist;
		expect(sentData.toolCallId).to.equal(toolCallId,
			'toolCallId must be sent');
		expect(sentData.beforeUri).to.equal('/tmp/snapshot/file.ts',
			'beforeUri must be sent');
		expect(sentData.afterUri).to.equal('/workspace/file.ts',
			'afterUri must be sent');
		expect(sentData.title).to.equal('file.ts (Before -> After)',
			'title must be sent');
	});

	/**
	 * TEST 3: Handles both payload formats (defensive coding)
	 *
	 * The code should handle both:
	 * - { type: 'diffAvailable', toolCallId, ... } (flat)
	 * - { type: 'diffAvailable', data: { toolCallId, ... } } (wrapped)
	 */
	it('should handle both flat and wrapped payload formats', () => {
		// Test 1: Flat format (what we actually use now)
		registerTool('toolu_flat');

		handleDiffAvailableMessage({
			type: 'diffAvailable',
			toolCallId: 'toolu_flat',
			beforeUri: '/tmp/before',
			afterUri: '/workspace/after',
			title: 'Test'
		});

		const toolDiv1 = messagesContainer.querySelector('[data-tool-id="toolu_flat"]');
		const btn1 = toolDiv1.querySelector('.tool-execution__diff-btn');
		expect(btn1, 'Flat format: button should exist').to.exist;
		btn1.click();

		const flatMessages = rpcSentMessages.filter(m => m.type === 'viewDiff');
		expect(flatMessages).to.have.length(1);
		expect(flatMessages[0].data.toolCallId).to.equal('toolu_flat');

		// Test 2: Wrapped format (legacy/alternative)
		rpcSentMessages = [];
		registerTool('toolu_wrapped');

		handleDiffAvailableMessage({
			type: 'diffAvailable',
			data: {
				toolCallId: 'toolu_wrapped',
				beforeUri: '/tmp/before',
				afterUri: '/workspace/after',
				title: 'Test'
			}
		});

		const toolDiv2 = messagesContainer.querySelector('[data-tool-id="toolu_wrapped"]');
		const btn2 = toolDiv2.querySelector('.tool-execution__diff-btn');
		expect(btn2, 'Wrapped format: button should exist').to.exist;
		btn2.click();

		const wrappedMessages = rpcSentMessages.filter(m => m.type === 'viewDiff');
		expect(wrappedMessages).to.have.length(1);
		expect(wrappedMessages[0].data.toolCallId).to.equal('toolu_wrapped');
	});

	/**
	 * TEST 4: End-to-end integration test
	 *
	 * Simulates the complete flow:
	 * 1. Tool starts running
	 * 2. Backend sends diffAvailable
	 * 3. Webview renders button
	 * 4. User clicks button
	 * 5. Webview sends viewDiff via postMessage
	 */
	it('should complete full diff flow end-to-end', () => {
		const realDiffData = {
			type: 'diffAvailable',
			toolCallId: 'toolu_vrtx_018aE2wvyqg3rPubHbVcCY3d',
			beforeUri: '/tmp/copilot-cli-snapshots-ZW5SWl/3.0-CODE-REFACTOR.md',
			afterUri: '/home/smolen/dev/vscode-copilot-cli-extension/planning/in-progress/3.0-CODE-REFACTOR.md',
			title: '3.0-CODE-REFACTOR.md (Before -> After)'
		};

		// 1. Tool starts running
		registerTool(realDiffData.toolCallId);

		// 2. Backend sends diffAvailable
		handleDiffAvailableMessage(realDiffData);

		// 3. Verify button exists
		const toolDiv = messagesContainer.querySelector(`[data-tool-id="${realDiffData.toolCallId}"]`);
		expect(toolDiv, 'Tool element should exist').to.exist;
		const diffButton = toolDiv.querySelector('.tool-execution__diff-btn');
		expect(diffButton).to.exist;

		// 4. User clicks button
		diffButton.click();

		// 5. Verify postMessage sent to extension
		const viewDiffMessages = rpcSentMessages.filter(m => m.type === 'viewDiff');
		expect(viewDiffMessages).to.have.length(1);

		const sentData = viewDiffMessages[0].data;
		expect(sentData.toolCallId).to.equal(realDiffData.toolCallId);
		expect(sentData.beforeUri).to.equal(realDiffData.beforeUri);
		expect(sentData.afterUri).to.equal(realDiffData.afterUri);
		expect(sentData.title).to.equal(realDiffData.title);
	});

	/**
	 * TEST 5: Regression test for the specific bugs we found
	 *
	 * This test documents the exact failures we encountered:
	 * - Bug 1: Button not appearing (RPC data loss)
	 * - Bug 2: Click sending undefined (payload.data vs data)
	 */
	it('should prevent regression of Phase 0.2 bugs', () => {
		const toolCallId = 'toolu_regression';
		registerTool(toolCallId);

		// Simulate exact payload from backend
		const backendPayload = {
			type: 'diffAvailable',
			toolCallId,
			beforeUri: '/tmp/snapshot.ts',
			afterUri: '/workspace/file.ts',
			title: 'file.ts (Before -> After)'
		};

		// BUG 1: Would fail if button doesn't appear
		handleDiffAvailableMessage(backendPayload);
		const toolDiv = messagesContainer.querySelector(`[data-tool-id="${toolCallId}"]`);
		const button = toolDiv.querySelector('.tool-execution__diff-btn');
		expect(button, 'REGRESSION: Button must appear (Bug #1)').to.exist;

		// BUG 2: Would fail if click sends undefined/empty
		button.click();
		const viewDiffMessages = rpcSentMessages.filter(m => m.type === 'viewDiff');
		expect(viewDiffMessages, 'REGRESSION: Must send RPC message').to.have.length(1);

		const sentData = viewDiffMessages[0].data;
		expect(sentData, 'REGRESSION: Data must not be undefined (Bug #2)').to.exist;
		expect(sentData.toolCallId, 'REGRESSION: toolCallId must be defined').to.exist;
		expect(sentData.beforeUri, 'REGRESSION: beforeUri must be defined').to.exist;
		expect(sentData.afterUri, 'REGRESSION: afterUri must be defined').to.exist;
	});
});

/**
 * These tests follow TDD Iron Laws:
 *
 * 1. Import production code - handleDiffAvailableMessage from main.js
 * 2. Use JSDOM - real DOM, not mocks
 * 3. Test user interactions - actual button.click()
 * 4. Test message flow - verify RPC calls via vscode.postMessage
 * 5. Work with component architecture - register tools via EventBus first
 *
 * If we had written these tests FIRST and watched them FAIL,
 * we would have caught both bugs before committing.
 */
