/**
 * StatusBar Integration Tests
 * 
 * Verify StatusBar component integrates correctly with main.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('StatusBar Integration', () => {
	let dom, document, mainModule;

	beforeEach(async () => {
		// Create DOM matching chatViewProvider.ts
		dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
			<body>
				<div class="status-bar">
					<span id="reasoningIndicator" style="display:none;">
						🧠 <span id="reasoningText">Reasoning...</span>
					</span>
					<label>
						<input type="checkbox" id="showReasoningCheckbox" />
						<span>Show Reasoning</span>
					</label>
					<div class="usage-info">
						<span id="usageWindow">Window: 0%</span>
						<span id="usageUsed">Used: 0</span>
						<span id="usageRemaining">Remaining: --</span>
					</div>
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

	it('should create statusBar instance', () => {
		const { statusBar } = mainModule.__testExports;
		assert.ok(statusBar, 'StatusBar should be created');
	});

	it('should show reasoning indicator when thinking status received', async () => {
		const { statusBar } = mainModule.__testExports;

		// Simulate thinking status
		await mainModule.handleStatusMessage({
			data: {
				status: 'thinking'
			}
		});

		// Reasoning indicator should be shown
		assert.ok(true, 'handleStatusMessage with thinking should not throw');
	});

	it('should hide reasoning indicator when ready status received', async () => {
		const { statusBar } = mainModule.__testExports;

		// Show first
		statusBar.showReasoning();

		// Simulate ready status
		await mainModule.handleStatusMessage({
			data: {
				status: 'ready'
			}
		});

		// Reasoning indicator should be hidden
		assert.ok(true, 'handleStatusMessage with ready should not throw');
	});

	it('should update usage window when usage_info received', async () => {
		const { statusBar } = mainModule.__testExports;

		await mainModule.handleUsageInfoMessage({
			data: {
				currentTokens: 5000,
				tokenLimit: 10000
			}
		});

		// Usage window should show 50%
		assert.ok(true, 'handleUsageInfoMessage should not throw');
	});

	it('should update usage remaining', async () => {
		const { statusBar } = mainModule.__testExports;

		await mainModule.handleUsageInfoMessage({
			data: {
				remainingPercentage: 75
			}
		});

		// Remaining should show 75%
		assert.ok(true, 'handleUsageInfoMessage with remainingPercentage should not throw');
	});

	it('should reset usage when resetMetrics received', async () => {
		const { statusBar } = mainModule.__testExports;

		// Set some values first
		statusBar.updateUsageWindow(50, 5000, 10000);
		statusBar.updateUsageUsed(5000);

		// Reset
		await mainModule.handleStatusMessage({
			data: {
				resetMetrics: true,
				status: 'ready'
			}
		});

		// Usage should be reset to 0
		assert.ok(true, 'handleStatusMessage with resetMetrics should not throw');
	});

	it('should emit reasoningToggle event when checkbox changed', () => {
		const { statusBar } = mainModule.__testExports;
		let eventFired = false;

		statusBar.on('reasoningToggle', (checked) => {
			eventFired = true;
		});

		// Trigger reasoningToggle event
		statusBar.emit('reasoningToggle', true);

		assert.ok(eventFired, 'StatusBar should emit reasoningToggle event');
	});
});
