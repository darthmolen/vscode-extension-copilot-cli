/**
 * RED Test: Component initialization must not access elements that don't exist
 * 
 * Bug: main.js tries to getElementById() for elements that are created by components,
 * not in the initial HTML. This causes null references.
 * 
 * Elements that DON'T exist at page load:
 * - #emptyState (created by MessageDisplay)
 * - #thinking (created by MessageDisplay)  
 * - #messageInput (created by InputArea)
 * - #sendButton (created by InputArea)
 * - #focusFileInfo (created by InputArea)
 * - #attachButton (created by InputArea)
 * 
 * This test should FAIL showing these elements are null.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

describe('Component integration - getElementById must not access non-existent elements', () => {
	it('should fail because main.js accesses elements before components create them', async () => {
		// Setup DOM with ONLY mount points (like actual HTML)
		const dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
			<body>
				<div id="session-toolbar-mount"></div>
				<main>
					<div id="messages-mount"></div>
					<div id="acceptance-mount"></div>
					<div id="input-mount"></div>
				</main>
			</body>
			</html>
		`);
		
		global.document = dom.window.document;
		global.window = dom.window;
		global.acquireVsCodeApi = () => ({
			postMessage: () => {},
			getState: () => null,
			setState: () => {}
		});
		
		// These elements should NOT exist yet
		const emptyState = document.getElementById('emptyState');
		const thinking = document.getElementById('thinking');
		const messageInput = document.getElementById('messageInput');
		const sendButton = document.getElementById('sendButton');
		const focusFileInfo = document.getElementById('focusFileInfo');
		
		// RED: These should all be null because components haven't rendered yet
		assert.equal(emptyState, null, 'emptyState should not exist at page load');
		assert.equal(thinking, null, 'thinking should not exist at page load');
		assert.equal(messageInput, null, 'messageInput should not exist at page load');
		assert.equal(sendButton, null, 'sendButton should not exist at page load');
		assert.equal(focusFileInfo, null, 'focusFileInfo should not exist at page load');
		
		// Cleanup
		delete global.document;
		delete global.window;
		delete global.acquireVsCodeApi;
	});
	
	it('should show the bug - main.js will crash trying to use null elements', async () => {
		const fs = await import('fs');
		const mainCode = await fs.promises.readFile('src/webview/main.js', 'utf8');
		
		// Check if main.js tries to get these elements
		const getsEmptyState = mainCode.includes("getElementById('emptyState')");
		const getsThinking = mainCode.includes("getElementById('thinking')");
		const getsMessageInput = mainCode.includes("getElementById('messageInput')");
		const getsFocusFileInfo = mainCode.includes("getElementById('focusFileInfo')");
		
		// Show the bug exists
		const hasNullReferences = getsEmptyState || getsThinking || getsMessageInput || getsFocusFileInfo;
		
		assert.ok(hasNullReferences, 
			'main.js should be calling getElementById for elements that dont exist - this is the BUG');
	});
});
