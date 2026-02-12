/**
 * TDD Test for Metrics Display Bug
 * 
 * Bug: Usage metrics (window %, used tokens, remaining %) not updating
 * Cause: After refactor, statusBar update calls were commented out in handleUsageInfoMessage
 * 
 * TDD Process:
 * 🔴 RED: Write tests that verify metrics update when usage_info received
 * 🟢 GREEN: Uncomment and fix the update calls to use inputArea instead of statusBar
 * 🔵 REFACTOR: Verify metrics display correctly
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('Metrics Display - Integration', () => {
	let dom, document, window, mainModule;
	let mockVscode;

	beforeEach(async () => {
		// Create DOM matching actual webview structure
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

	it('🔴 RED: should update window usage when usage_info received', async () => {
		const { handleUsageInfoMessage } = mainModule.__testExports;

		// Send usage_info message
		await handleUsageInfoMessage({
			data: {
				currentTokens: 50000,
				tokenLimit: 100000,
				remainingPercentage: 75
			}
		});

		// Query StatusBar element (inside InputArea)
		const usageWindow = global.document.querySelector('#usageWindow');
		assert.ok(usageWindow, 'Usage window element should exist');

		// CRITICAL: Window usage should update to 50%
		// This test WILL FAIL before fix is applied!
		const windowText = usageWindow.textContent;
		assert.strictEqual(windowText, 'Window: 50%', 
			`Window usage should show 50%, got: ${windowText}`);
	});

	it('🔴 RED: should update used tokens when usage_info received', async () => {
		const { handleUsageInfoMessage } = mainModule.__testExports;

		// Send usage_info message
		await handleUsageInfoMessage({
			data: {
				currentTokens: 1500000,
				tokenLimit: 2000000,
				remainingPercentage: 80
			}
		});

		const usageUsed = global.document.querySelector('#usageUsed');
		assert.ok(usageUsed, 'Usage used element should exist');

		// CRITICAL: Should show compact format (1.5M)
		// This test WILL FAIL before fix is applied!
		const usedText = usageUsed.textContent;
		assert.strictEqual(usedText, 'Used: 1.5M', 
			`Used tokens should show 1.5M, got: ${usedText}`);
	});

	it('🔴 RED: should update remaining percentage when usage_info received', async () => {
		const { handleUsageInfoMessage } = mainModule.__testExports;

		// Send usage_info message
		await handleUsageInfoMessage({
			data: {
				currentTokens: 10000,
				tokenLimit: 100000,
				remainingPercentage: 95
			}
		});

		const usageRemaining = global.document.querySelector('#usageRemaining');
		assert.ok(usageRemaining, 'Usage remaining element should exist');

		// CRITICAL: Should show remaining percentage
		// This test WILL FAIL before fix is applied!
		const remainingText = usageRemaining.textContent;
		assert.strictEqual(remainingText, 'Remaining: 95', 
			`Remaining should show 95, got: ${remainingText}`);
	});

	it('🔴 RED: should handle missing remainingPercentage gracefully', async () => {
		const { handleUsageInfoMessage } = mainModule.__testExports;

		// Send usage_info without remainingPercentage
		await handleUsageInfoMessage({
			data: {
				currentTokens: 5000,
				tokenLimit: 100000
			}
		});

		const usageRemaining = global.document.querySelector('#usageRemaining');
		
		// Should still show placeholder
		const remainingText = usageRemaining.textContent;
		assert.ok(remainingText.includes('--') || remainingText.includes('Remaining'), 
			`Should show placeholder when no remainingPercentage, got: ${remainingText}`);
	});

	it('🔴 RED: should update all metrics together', async () => {
		const { handleUsageInfoMessage } = mainModule.__testExports;

		// Send complete usage_info
		await handleUsageInfoMessage({
			data: {
				currentTokens: 750000,
				tokenLimit: 1000000,
				remainingPercentage: 42
			}
		});

		const usageWindow = global.document.querySelector('#usageWindow');
		const usageUsed = global.document.querySelector('#usageUsed');
		const usageRemaining = global.document.querySelector('#usageRemaining');

		// All three should update
		assert.strictEqual(usageWindow.textContent, 'Window: 75%');
		assert.strictEqual(usageUsed.textContent, 'Used: 750.0K');
		assert.strictEqual(usageRemaining.textContent, 'Remaining: 42');
	});
});
