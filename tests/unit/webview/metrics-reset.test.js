/**
 * TDD tests for compaction metrics reset bug
 *
 * Bug: handleStatusMessage({ data: { resetMetrics: true } }) should call
 * inputArea.updateUsageWindow(0, 0, 1) and inputArea.updateUsageUsed(0)
 * but the code is commented out and references wrong component (statusBar).
 *
 * Fix location: src/webview/main.js:441-445
 */

import assert from 'assert/strict';
import { createComponentDOM, cleanupComponentDOM } from '../../helpers/jsdom-component-setup.js';

describe('Compaction Metrics Reset', function () {
	let dom;
	let mainModule;

	before(async function () {
		this.timeout(30000);

		dom = createComponentDOM();

		global.HTMLElement = dom.window.HTMLElement;
		global.MessageEvent = dom.window.MessageEvent;
		global.window.__TESTING__ = true;

		global.acquireVsCodeApi = () => ({
			postMessage: () => {},
			setState: () => {},
			getState: () => ({})
		});

		// Import main.js with unique cache-buster
		const mainPath = '../../../src/webview/main.js?t=metrics-reset-' + Date.now();
		mainModule = await import(mainPath);

		global.thinking = document.getElementById('thinking');
		global.statusIndicator = document.getElementById('statusIndicator');
	});

	after(function () {
		delete global.HTMLElement;
		delete global.MessageEvent;
		delete global.acquireVsCodeApi;
		delete global.thinking;
		delete global.statusIndicator;
		cleanupComponentDOM(dom);
	});

	it('resets usage metrics when resetMetrics is true', function () {
		const { handleStatusMessage, inputArea, handleUsageInfoMessage } = mainModule.__testExports;

		// Set non-zero usage first so we can verify the reset
		handleUsageInfoMessage({
			data: {
				currentTokens: 50000,
				tokenLimit: 100000,
				remainingPercentage: 50
			}
		});

		// Verify non-zero state is set
		const usageWindow = document.getElementById('usageWindow');
		const usageUsed = document.getElementById('usageUsed');
		assert.ok(usageWindow.textContent !== 'Window: 0%', 'Usage window should show non-zero before reset');

		// Trigger metrics reset via status message
		handleStatusMessage({ data: { resetMetrics: true } });

		// After reset, usage should be zeroed out
		assert.equal(usageWindow.textContent, 'Window: 0%', 'Usage window should be reset to 0%');
		assert.equal(usageUsed.textContent, 'Used: 0', 'Usage used should be reset to 0');
	});

	it('does not reset metrics when resetMetrics is absent', function () {
		const { handleStatusMessage, handleUsageInfoMessage } = mainModule.__testExports;

		// Set non-zero usage
		handleUsageInfoMessage({
			data: {
				currentTokens: 75000,
				tokenLimit: 100000,
				remainingPercentage: 25
			}
		});

		const usageWindow = document.getElementById('usageWindow');
		const usageUsed = document.getElementById('usageUsed');
		const windowBefore = usageWindow.textContent;
		const usedBefore = usageUsed.textContent;

		// Send status message without resetMetrics
		handleStatusMessage({ data: { status: 'ready' } });

		// Usage should be unchanged
		assert.equal(usageWindow.textContent, windowBefore, 'Usage window should not change without resetMetrics');
		assert.equal(usageUsed.textContent, usedBefore, 'Usage used should not change without resetMetrics');
	});
});
