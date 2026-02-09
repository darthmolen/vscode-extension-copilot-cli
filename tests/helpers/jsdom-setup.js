/**
 * JSDOM Test Utilities
 * 
 * Provides utilities for testing webview code in a Node.js environment.
 * Uses JSDOM to create a fake browser environment for DOM testing.
 */

import { JSDOM } from 'jsdom';

/**
 * Creates a JSDOM instance with the given HTML
 * Sets global.window and global.document for tests
 * 
 * @param {string} html - HTML to inject into the body
 * @returns {JSDOM} - The JSDOM instance (call dom.window.close() to clean up)
 */
export function createTestDOM(html = '<div id="app"></div>') {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
		url: 'http://localhost',
		runScripts: 'outside-only'
	});
	
	global.window = dom.window;
	global.document = dom.window.document;
	
	return dom;
}

/**
 * Cleans up global DOM references
 * Call this in afterEach() to prevent test pollution
 * 
 * @param {JSDOM} dom - The JSDOM instance to close
 */
export function cleanupTestDOM(dom) {
	delete global.window;
	delete global.document;
	if (dom && dom.window) {
		dom.window.close();
	}
}

/**
 * Creates a mock RPC client for testing
 * Tracks all calls made to RPC methods
 * 
 * @returns {Object} - Mock RPC client with tracking methods
 */
export function createMockRpc() {
	const calls = [];
	
	const mock = {
		// Session methods
		switchSession: (id) => calls.push({ method: 'switchSession', id }),
		newSession: () => calls.push({ method: 'newSession' }),
		
		// Plan mode methods
		viewPlan: () => calls.push({ method: 'viewPlan' }),
		acceptPlan: () => calls.push({ method: 'acceptPlan' }),
		rejectPlan: () => calls.push({ method: 'rejectPlan' }),
		togglePlanMode: (enabled) => calls.push({ method: 'togglePlanMode', enabled }),
		
		// Message methods
		sendMessage: (msg) => calls.push({ method: 'sendMessage', msg }),
		selectFiles: () => calls.push({ method: 'selectFiles' }),
		pickFiles: () => calls.push({ method: 'selectFiles' }), // Alias
		abortMessage: () => calls.push({ method: 'abortMessage' }),
		
		// Diff methods
		viewDiff: (data) => calls.push({ method: 'viewDiff', data }),
		
		// Tracking methods
		getCalls: () => calls,
		clearCalls: () => { calls.length = 0; },
		
		// Helper to get the last call
		getLastCall: () => calls[calls.length - 1],
		
		// Helper to find calls by method name
		getCallsByMethod: (methodName) => calls.filter(c => c.method === methodName)
	};
	
	return mock;
}
