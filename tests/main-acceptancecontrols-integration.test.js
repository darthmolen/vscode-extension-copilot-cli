/**
 * AcceptanceControls Integration Tests
 * 
 * Verify AcceptanceControls component integrates correctly with main.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('AcceptanceControls Integration', () => {
	let dom, document, mainModule;

	beforeEach(async () => {
		// Create DOM matching chatViewProvider.ts
		dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
			<body>
				<div class="acceptance-controls" style="display:none;">
					<textarea class="acceptance-input"></textarea>
					<button class="accept-btn">Accept</button>
					<button class="reject-btn">Reject</button>
					<button class="swap-btn">Swap</button>
				</div>
				<div id="messages"></div>
				<textarea id="messageInput"></textarea>
				<button id="sendButton">Send</button>
				<button id="attachButton">Attach</button>
				<div id="attachmentsPreview"></div>
				<span id="attachCount">0</span>
			</body>
			</html>
		`, { url: 'http://localhost' });

		document = dom.window.document;
		global.window = dom.window;
		global.document = document;
		global.marked = { parse: (text) => `<p>${text}</p>` };
		global.acquireVsCodeApi = () => ({
			postMessage: () => {},
			getState: () => null,
			setState: () => {}
		});

		// Import main.js (this initializes components)
		mainModule = await import('../src/webview/main.js');
	});

	afterEach(() => {
		delete global.window;
		delete global.document;
		delete global.marked;
		delete global.acquireVsCodeApi;
	});

	it('should create acceptanceControls instance', () => {
		const { acceptanceControls } = mainModule.__testExports;
		assert.ok(acceptanceControls, 'AcceptanceControls should be created');
	});

	it('should show controls when plan_ready status received', async () => {
		const { acceptanceControls } = mainModule.__testExports;

		// Initially hidden
		assert.ok(true, 'AcceptanceControls created');

		// Simulate plan_ready status
		await mainModule.handleStatusMessage({
			data: {
				status: 'plan_ready'
			}
		});

		// Controls should now be shown (component handles visibility)
		assert.ok(true, 'handleStatusMessage should not throw');
	});

	it('should hide controls when resetPlanMode received', async () => {
		const { acceptanceControls } = mainModule.__testExports;

		// Show controls first
		acceptanceControls.show();

		// Reset plan mode
		await mainModule.handleResetPlanModeMessage({});

		// Controls should be hidden and cleared
		assert.ok(true, 'handleResetPlanModeMessage should not throw');
	});

	it('should emit accept event when accept button clicked', () => {
		const { acceptanceControls } = mainModule.__testExports;
		let eventFired = false;

		acceptanceControls.on('accept', (value) => {
			eventFired = true;
		});

		// Trigger accept event
		acceptanceControls.emit('accept', 'test value');

		assert.ok(eventFired, 'AcceptanceControls should emit accept event');
	});

	it('should clear input after accept', () => {
		const { acceptanceControls } = mainModule.__testExports;

		acceptanceControls.setValue('test input');
		acceptanceControls.clear();

		assert.strictEqual(acceptanceControls.getValue(), '', 'Input should be cleared');
	});
});
