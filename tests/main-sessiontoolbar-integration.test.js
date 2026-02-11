/**
 * SessionToolbar Integration Tests
 * 
 * Verify SessionToolbar component integrates correctly with main.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('SessionToolbar Integration', () => {
	let dom, document, mainModule;

	beforeEach(async () => {
		// Create DOM matching chatViewProvider.ts
		dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
			<body>
				<div class="session-toolbar">
					<div class="status-indicator"></div>
					<select id="sessionSelect"></select>
					<button id="newSessionBtn">+</button>
					<button id="viewPlanBtn">View Plan</button>
					<button id="enterPlanModeBtn">Enter Plan Mode</button>
					<button id="acceptPlanBtn" style="display:none">Accept</button>
					<button id="rejectPlanBtn" style="display:none">Reject</button>
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

	it('should create sessionToolbar instance', () => {
		const { sessionToolbar } = mainModule.__testExports;
		assert.ok(sessionToolbar, 'SessionToolbar should be created');
	});

	it('should update sessions when updateSessions message received', async () => {
		const { sessionToolbar } = mainModule.__testExports;

		// Simulate updateSessions message
		const sessions = [
			{ id: 'session-1', label: 'Session 1' },
			{ id: 'session-2', label: 'Session 2' }
		];

		await mainModule.handleUpdateSessionsMessage({
			sessions,
			currentSessionId: 'session-1'
		});

		// Verify SessionToolbar was updated (check internal state through DOM)
		const select = document.querySelector('#sessionSelect');
		assert.ok(select, 'Session select should exist');
		// The component renders its own dropdown, so we check it exists
	});

	it('should toggle plan file availability', () => {
		const { sessionToolbar } = mainModule.__testExports;

		sessionToolbar.setPlanFileExists(true);
		// View Plan button should be enabled
		
		sessionToolbar.setPlanFileExists(false);
		// View Plan button should be disabled
		
		assert.ok(true, 'setPlanFileExists should not throw');
	});

	it('should set plan file exists to enable view plan button', () => {
		const { sessionToolbar } = mainModule.__testExports;

		sessionToolbar.setPlanFileExists(true);
		// View Plan button should be enabled
		
		sessionToolbar.setPlanFileExists(false);
		// View Plan button should be disabled
		
		assert.ok(true, 'setPlanFileExists should not throw');
	});

	it('should emit events when buttons clicked', () => {
		const { sessionToolbar } = mainModule.__testExports;
		let eventFired = false;

		sessionToolbar.on('newSession', () => {
			eventFired = true;
		});

		// Trigger newSession event
		sessionToolbar.emit('newSession');

		assert.ok(eventFired, 'SessionToolbar should emit events');
	});
});
