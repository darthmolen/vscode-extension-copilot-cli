/**
 * TDD Test for Plan Mode State Synchronization Bug
 * 
 * Bug: InputArea.planMode state not updated when plan_mode_enabled fires
 * Result: /exit, /accept, /reject commands fail with "not valid in current context"
 * 
 * TDD Process:
 * 🔴 RED: Write tests that WILL FAIL - verify InputArea state updates
 * 🟢 GREEN: Fix by adding inputArea.setPlanMode() calls
 * 🔵 REFACTOR: Clean up if needed
 * 
 * These tests import actual production code from main.js and components
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('Plan Mode State Synchronization - Integration', () => {
	let dom, document, window, mainModule;
	let mockVscode;

	beforeEach(async () => {
		// Create DOM matching actual webview structure (InputArea creates child components)
		dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
			<body>
				<div id="session-toolbar-mount"></div>
				<div id="acceptance-mount"></div>
				<div id="messages-mount"></div>
				<div id="input-mount"></div>
			</body>
			</html>
		`, { url: 'http://localhost' });

		document = dom.window.document;
		window = dom.window;
		global.window = window;
		global.document = document;

		// Mock VS Code API
		mockVscode = {
			postMessage: () => {},
			getState: () => null,
			setState: () => {}
		};
		global.acquireVsCodeApi = () => mockVscode;

		// Mock marked
		global.marked = { parse: (text) => `<p>${text}</p>` };

		// Import main.js - this initializes components
		mainModule = await import('../src/webview/main.js');
	});

	afterEach(() => {
		delete global.window;
		delete global.document;
		delete global.acquireVsCodeApi;
		delete global.marked;
	});

	it('🔴 RED: should update InputArea.planMode when plan_mode_enabled received', async () => {
		const { inputArea, handleStatusMessage } = mainModule.__testExports;

		// Initial state - should be false
		assert.strictEqual(inputArea.planMode, false, 'InputArea.planMode should start false');

		// Receive plan_mode_enabled status
		await handleStatusMessage({
			data: {
				status: 'plan_mode_enabled',
				planSessionId: 'test-123-plan',
				workSessionId: 'test-123'
			}
		});

		// CRITICAL: InputArea state MUST update
		// This test WILL FAIL before fix is applied!
		assert.strictEqual(inputArea.planMode, true, 
			'InputArea.planMode MUST be true after plan_mode_enabled');
	});

	it('🔴 RED: should show PlanModeControls exit button when plan mode enabled', async () => {
		const { handleStatusMessage } = mainModule.__testExports;

		// Receive plan_mode_enabled status
		await handleStatusMessage({
			data: {
				status: 'plan_mode_enabled',
				planSessionId: 'test-123-plan',
				workSessionId: 'test-123'
			}
		});

		// Query AFTER status message handled - components are initialized by main.js
		// Use global.document explicitly to ensure we're using JSDOM
		const exitBtn = global.document.querySelector('#exitPlanModeBtn');
		assert.ok(exitBtn, 'Exit button should exist');

		// CRITICAL: Exit button MUST be visible
		// This test WILL FAIL before fix is applied!
		assert.strictEqual(exitBtn.style.display, '', 
			'Exit button MUST be visible when plan mode enabled');
	});

	it('🔴 RED: should hide enter button when plan mode enabled', async () => {
		const { handleStatusMessage } = mainModule.__testExports;

		// Receive plan_mode_enabled status
		await handleStatusMessage({
			data: {
				status: 'plan_mode_enabled',
				planSessionId: 'test-123-plan',
				workSessionId: 'test-123'
			}
		});

		// Query AFTER status message - use global.document
		const enterBtn = global.document.querySelector('#enterPlanModeBtn');
		assert.ok(enterBtn, 'Enter button should exist');

		// Enter button should be hidden
		assert.strictEqual(enterBtn.style.display, 'none', 
			'Enter button MUST be hidden when plan mode enabled');
	});

	it('🔴 RED: should update InputArea.planReady when plan_ready received', async () => {
		const { inputArea, handleStatusMessage } = mainModule.__testExports;

		// First enable plan mode
		await handleStatusMessage({
			data: {
				status: 'plan_mode_enabled',
				planSessionId: 'test-123-plan',
				workSessionId: 'test-123'
			}
		});

		// Initial plan ready state
		assert.strictEqual(inputArea.planReady, false, 'planReady should start false');

		// Receive plan_ready status
		await handleStatusMessage({
			data: {
				status: 'plan_ready'
			}
		});

		// CRITICAL: planReady MUST update
		// This test WILL FAIL before fix is applied!
		assert.strictEqual(inputArea.planReady, true, 
			'InputArea.planReady MUST be true after plan_ready');
	});

	it('🔴 RED: should show accept and reject buttons when plan ready', async () => {
		const { handleStatusMessage } = mainModule.__testExports;

		// Enable plan mode first
		await handleStatusMessage({
			data: {
				status: 'plan_mode_enabled',
				planSessionId: 'test-123-plan',
				workSessionId: 'test-123'
			}
		});

		// Receive plan_ready status
		await handleStatusMessage({
			data: {
				status: 'plan_ready'
			}
		});

		// Query AFTER plan_ready - use global.document
		const acceptBtn = global.document.querySelector('#acceptPlanBtn');
		const rejectBtn = global.document.querySelector('#rejectPlanBtn');
		const exitBtn = global.document.querySelector('#exitPlanModeBtn');

		assert.ok(acceptBtn, 'Accept button should exist');
		assert.ok(rejectBtn, 'Reject button should exist');
		assert.ok(exitBtn, 'Exit button should exist');

		// CRITICAL: All three buttons should be visible!
		// This test WILL FAIL before fix is applied!
		assert.strictEqual(acceptBtn.style.display, '', 
			'Accept button MUST be visible when plan ready');
		assert.strictEqual(rejectBtn.style.display, '', 
			'Reject button MUST be visible when plan ready');
		assert.strictEqual(exitBtn.style.display, '', 
			'Exit button MUST STILL be visible when plan ready');
	});

	it('🔴 RED: should reset InputArea state when plan_mode_disabled received', async () => {
		const { inputArea, handleStatusMessage } = mainModule.__testExports;

		// Enable plan mode and make plan ready
		await handleStatusMessage({
			data: {
				status: 'plan_mode_enabled',
				planSessionId: 'test-123-plan',
				workSessionId: 'test-123'
			}
		});

		await handleStatusMessage({
			data: {
				status: 'plan_ready'
			}
		});

		// Verify state is set
		assert.strictEqual(inputArea.planMode, true, 'Should be in plan mode');
		assert.strictEqual(inputArea.planReady, true, 'Should be plan ready');

		// Disable plan mode
		await handleStatusMessage({
			data: {
				status: 'plan_mode_disabled'
			}
		});

		// CRITICAL: Both states MUST reset
		// This test WILL FAIL before fix is applied!
		assert.strictEqual(inputArea.planMode, false, 
			'InputArea.planMode MUST be false after plan_mode_disabled');
		assert.strictEqual(inputArea.planReady, false, 
			'InputArea.planReady MUST be false after plan_mode_disabled');
	});
});
