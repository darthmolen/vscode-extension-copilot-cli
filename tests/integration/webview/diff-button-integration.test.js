/**
 * PROPER Integration Test for Diff Button Functionality
 * 
 * This test demonstrates what we SHOULD have done in Phase 0.2.
 * It would have caught BOTH bugs:
 * 1. RPC data flow bug (button not appearing)
 * 2. Click handler bug (wrong data sent)
 * 
 * Following TDD Iron Laws:
 * - Imports ACTUAL production code (not mocks)
 * - Uses JSDOM to test real DOM
 * - Tests user interactions (button clicks)
 * - Verifies end-to-end message flow
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const { JSDOM } = require('jsdom');

describe('Diff Button Integration - Proper TDD', () => {
	let dom, document, window, rpcSentMessages, handleDiffAvailableMessage, buildToolHtml;
	
	beforeEach(() => {
		// Setup JSDOM environment with ALL required DOM elements
		dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
			<body>
				<div id="messages"></div>
				<div id="input-container">
					<textarea id="user-input"></textarea>
					<button id="send-button">Send</button>
					<button id="abort-button">Abort</button>
				</div>
				<input type="checkbox" id="show-reasoning" />
				<div id="quota-bar"></div>
				<div id="quota-text"></div>
			</body>
			</html>
		`, {
			url: 'http://localhost',
			runScripts: 'outside-only'
		});
		
		document = dom.window.document;
		window = dom.window;
		
		// Set global references for the webview code
		global.document = document;
		global.window = window;
		
		// Mock VS Code API (required by WebviewRpcClient)
		global.acquireVsCodeApi = () => ({
			postMessage: (msg) => {
				// Track messages sent to extension
			}
		});
		
		// Mock messagesContainer (exists in actual main.js)
		global.messagesContainer = document.getElementById('messages');
		
		// Track RPC messages sent from webview
		rpcSentMessages = [];
		global.rpc = {
			viewDiff: (data) => {
				rpcSentMessages.push({ method: 'viewDiff', data });
			}
		};
		
		// Import ACTUAL production code (not mocks!)
		// This is the key - we're testing the real implementation
		delete require.cache[require.resolve('../../../src/webview/main.js')];
		const mainModule = require('../../../src/webview/main.js');
		handleDiffAvailableMessage = mainModule.handleDiffAvailableMessage;
		buildToolHtml = mainModule.buildToolHtml;
	});
	
	afterEach(() => {
		// Cleanup globals
		delete global.document;
		delete global.window;
		delete global.messagesContainer;
		delete global.rpc;
		delete global.acquireVsCodeApi;
		dom.window.close();
	});
	
	/**
	 * TEST 1: Would have caught the "button doesn't appear" bug
	 * 
	 * This test verifies that when we receive a diffAvailable message,
	 * a diff button is actually added to the DOM.
	 */
	it('should add diff button to DOM when diffAvailable message received', () => {
		// Setup: Add a tool element to the DOM
		const toolDiv = document.createElement('div');
		toolDiv.setAttribute('data-tool-id', 'toolu_test_123');
		toolDiv.className = 'tool-execution';
		toolDiv._toolState = {
			toolCallId: 'toolu_test_123',
			toolName: 'edit',
			status: 'complete'
		};
		messagesContainer.appendChild(toolDiv);
		
		// ACT: Call the actual handleDiffAvailableMessage function
		handleDiffAvailableMessage({
			type: 'diffAvailable',
			toolCallId: 'toolu_test_123',
			beforeUri: '/tmp/copilot-snapshots/test-before.ts',
			afterUri: '/workspace/test-after.ts',
			title: 'test.ts (Before ↔ After)'
		});
		
		// ASSERT: Verify diff button exists in real DOM
		const diffButton = toolDiv.querySelector('.view-diff-btn');
		expect(diffButton, 'Diff button should exist in DOM').to.exist;
		expect(diffButton.textContent).to.include('View Diff');
	});
	
	/**
	 * TEST 2: Would have caught the "click sends wrong data" bug
	 * 
	 * This test verifies that clicking the diff button sends the correct
	 * data via RPC, not undefined or empty objects.
	 * 
	 * BUG WE FOUND: Line 780 used payload.data instead of data
	 */
	it('should send correct diff data when button clicked', () => {
		// Setup: Add tool element
		const toolDiv = document.createElement('div');
		toolDiv.setAttribute('data-tool-id', 'toolu_click_test');
		toolDiv.className = 'tool-execution';
		toolDiv._toolState = {
			toolCallId: 'toolu_click_test',
			toolName: 'edit',
			status: 'complete'
		};
		messagesContainer.appendChild(toolDiv);
		
		// Receive diffAvailable message
		const diffData = {
			type: 'diffAvailable',
			toolCallId: 'toolu_click_test',
			beforeUri: '/tmp/snapshot/file.ts',
			afterUri: '/workspace/file.ts',
			title: 'file.ts (Before ↔ After)'
		};
		
		handleDiffAvailableMessage(diffData);
		
		// Find and click the button
		const diffButton = toolDiv.querySelector('.view-diff-btn');
		expect(diffButton, 'Setup: diff button must exist').to.exist;
		
		// ACT: Click the actual button
		diffButton.click();
		
		// ASSERT: Verify correct RPC call was made
		expect(rpcSentMessages).to.have.length(1, 'Should send exactly one RPC message');
		
		const sentMessage = rpcSentMessages[0];
		expect(sentMessage.method).to.equal('viewDiff');
		expect(sentMessage.data).to.exist;
		expect(sentMessage.data.toolCallId).to.equal('toolu_click_test', 
			'toolCallId must be sent (BUG: was undefined)');
		expect(sentMessage.data.beforeUri).to.equal('/tmp/snapshot/file.ts',
			'beforeUri must be sent');
		expect(sentMessage.data.afterUri).to.equal('/workspace/file.ts',
			'afterUri must be sent');
		expect(sentMessage.data.title).to.equal('file.ts (Before ↔ After)',
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
		const toolDiv1 = document.createElement('div');
		toolDiv1.setAttribute('data-tool-id', 'toolu_flat');
		toolDiv1._toolState = { toolCallId: 'toolu_flat', toolName: 'edit', status: 'complete' };
		messagesContainer.appendChild(toolDiv1);
		
		handleDiffAvailableMessage({
			type: 'diffAvailable',
			toolCallId: 'toolu_flat',
			beforeUri: '/tmp/before',
			afterUri: '/workspace/after',
			title: 'Test'
		});
		
		const btn1 = toolDiv1.querySelector('.view-diff-btn');
		expect(btn1, 'Flat format: button should exist').to.exist;
		btn1.click();
		expect(rpcSentMessages[0].data.toolCallId).to.equal('toolu_flat');
		
		// Test 2: Wrapped format (legacy/alternative)
		rpcSentMessages = [];
		const toolDiv2 = document.createElement('div');
		toolDiv2.setAttribute('data-tool-id', 'toolu_wrapped');
		toolDiv2._toolState = { toolCallId: 'toolu_wrapped', toolName: 'edit', status: 'complete' };
		messagesContainer.appendChild(toolDiv2);
		
		handleDiffAvailableMessage({
			type: 'diffAvailable',
			data: {
				toolCallId: 'toolu_wrapped',
				beforeUri: '/tmp/before',
				afterUri: '/workspace/after',
				title: 'Test'
			}
		});
		
		const btn2 = toolDiv2.querySelector('.view-diff-btn');
		expect(btn2, 'Wrapped format: button should exist').to.exist;
		btn2.click();
		expect(rpcSentMessages[0].data.toolCallId).to.equal('toolu_wrapped');
	});
	
	/**
	 * TEST 4: End-to-end integration test
	 * 
	 * Simulates the complete flow:
	 * 1. Backend sends diffAvailable
	 * 2. Webview renders button
	 * 3. User clicks button
	 * 4. Webview sends viewDiff RPC
	 * 5. Extension receives correct data
	 */
	it('should complete full diff flow end-to-end', () => {
		// Simulate real-world scenario
		const realDiffData = {
			type: 'diffAvailable',
			toolCallId: 'toolu_vrtx_018aE2wvyqg3rPubHbVcCY3d',
			beforeUri: '/tmp/copilot-cli-snapshots-ZW5SWl/3.0-CODE-REFACTOR.md',
			afterUri: '/home/smolen/dev/vscode-copilot-cli-extension/planning/in-progress/3.0-CODE-REFACTOR.md',
			title: '3.0-CODE-REFACTOR.md (Before ↔ After)'
		};
		
		// 1. Add tool to DOM (from tool execution)
		const toolDiv = document.createElement('div');
		toolDiv.setAttribute('data-tool-id', realDiffData.toolCallId);
		toolDiv.className = 'tool-execution';
		toolDiv._toolState = {
			toolCallId: realDiffData.toolCallId,
			toolName: 'edit',
			status: 'complete'
		};
		messagesContainer.appendChild(toolDiv);
		
		// 2. Backend sends diffAvailable
		handleDiffAvailableMessage(realDiffData);
		
		// 3. Verify button exists with correct text
		const diffButton = toolDiv.querySelector('.view-diff-btn');
		expect(diffButton).to.exist;
		expect(diffButton.classList.contains('view-diff-btn')).to.be.true;
		
		// 4. User clicks button
		diffButton.click();
		
		// 5. Verify RPC message sent to extension
		expect(rpcSentMessages).to.have.length(1);
		const rpcCall = rpcSentMessages[0];
		
		// 6. Verify extension would receive ALL data needed
		expect(rpcCall.data).to.deep.equal({
			toolCallId: realDiffData.toolCallId,
			beforeUri: realDiffData.beforeUri,
			afterUri: realDiffData.afterUri,
			title: realDiffData.title
		});
	});
	
	/**
	 * TEST 5: Regression test for the specific bugs we found
	 * 
	 * This test documents the exact failures we encountered:
	 * - Bug 1: Button not appearing (RPC data loss)
	 * - Bug 2: Click sending undefined (payload.data vs data)
	 */
	it('should prevent regression of Phase 0.2 bugs', () => {
		const toolDiv = document.createElement('div');
		toolDiv.setAttribute('data-tool-id', 'toolu_regression');
		toolDiv._toolState = {
			toolCallId: 'toolu_regression',
			toolName: 'edit',
			status: 'complete'
		};
		messagesContainer.appendChild(toolDiv);
		
		// Simulate exact payload from backend
		const backendPayload = {
			type: 'diffAvailable',
			toolCallId: 'toolu_regression',
			beforeUri: '/tmp/snapshot.ts',
			afterUri: '/workspace/file.ts',
			title: 'file.ts (Before ↔ After)'
		};
		
		// BUG 1: Would fail if button doesn't appear
		handleDiffAvailableMessage(backendPayload);
		const button = toolDiv.querySelector('.view-diff-btn');
		expect(button, 'REGRESSION: Button must appear (Bug #1)').to.exist;
		
		// BUG 2: Would fail if click sends undefined/empty
		button.click();
		expect(rpcSentMessages, 'REGRESSION: Must send RPC message').to.have.length(1);
		
		const sentData = rpcSentMessages[0].data;
		expect(sentData, 'REGRESSION: Data must not be undefined (Bug #2)').to.exist;
		expect(sentData.toolCallId, 'REGRESSION: toolCallId must be defined').to.exist;
		expect(sentData.beforeUri, 'REGRESSION: beforeUri must be defined').to.exist;
		expect(sentData.afterUri, 'REGRESSION: afterUri must be defined').to.exist;
		
		// Verify exact match (would catch any field name changes)
		expect(sentData).to.deep.equal(backendPayload);
	});
});

/**
 * These tests follow TDD Iron Laws:
 * 
 * 1. ✅ Import production code - handleDiffAvailableMessage from main.js
 * 2. ✅ Use JSDOM - real DOM, not mocks
 * 3. ✅ Test user interactions - actual button.click()
 * 4. ✅ Test message flow - verify RPC calls
 * 5. ✅ Would catch both bugs we found in production
 * 
 * If we had written these tests FIRST and watched them FAIL,
 * we would have caught both bugs before committing.
 */
