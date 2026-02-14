/**
 * Unit tests for webview message handlers
 * Testing individual handler functions extracted from switch statement
 */

import assert from 'assert/strict';
import { createComponentDOM, cleanupComponentDOM } from '../../helpers/jsdom-component-setup.js';

describe('Webview Message Handler Tests', function () {
	let dom;
	let mainModule;

	before(async function () {
		this.timeout(30000);

		// Use standardized component DOM setup with all mount points and polyfills
		dom = createComponentDOM();

		// Additional globals needed by some tests
		global.HTMLElement = dom.window.HTMLElement;
		global.MessageEvent = dom.window.MessageEvent;

		// Mark as test environment so main.js skips rpc.ready()
		global.window.__TESTING__ = true;

		// Mock acquireVsCodeApi (needed by main.js)
		global.acquireVsCodeApi = () => ({
			postMessage: () => {},
			setState: () => {},
			getState: () => ({})
		});

		// Import main.js to get handler functions (use unique query to avoid module cache)
		const mainPath = '../../../src/webview/main.js?t=msg-handlers-' + Date.now();
		mainModule = await import(mainPath);

		// main.js uses bare `thinking` and `statusIndicator` as globals
		// (browser auto-global from element IDs). Polyfill them for Node.
		global.thinking = document.getElementById('thinking');
		global.statusIndicator = document.getElementById('statusIndicator');
	});

	after(function () {
		// Clean up additional globals
		delete global.HTMLElement;
		delete global.MessageEvent;
		delete global.acquireVsCodeApi;
		delete global.thinking;
		delete global.statusIndicator;
		cleanupComponentDOM(dom);
	});

	it('handleThinkingMessage works', function () {
		const thinkingEl = document.getElementById('thinking');

		if (!mainModule.handleThinkingMessage) {
			throw new Error('handleThinkingMessage not exported');
		}

		// Test showing thinking
		mainModule.handleThinkingMessage({ isThinking: true });
		assert.ok(thinkingEl.classList.contains('active'), 'Should add active class when thinking');
		assert.equal(thinkingEl.getAttribute('aria-busy'), 'true', 'Should set aria-busy to true');

		// Test hiding thinking
		mainModule.handleThinkingMessage({ isThinking: false });
		assert.ok(!thinkingEl.classList.contains('active'), 'Should remove active class when not thinking');
		assert.equal(thinkingEl.getAttribute('aria-busy'), 'false', 'Should set aria-busy to false');
	});

	it('handleSessionStatusMessage works', function () {
		if (!mainModule.handleSessionStatusMessage) {
			throw new Error('handleSessionStatusMessage not exported');
		}

		// Test active session
		mainModule.handleSessionStatusMessage({ active: true });
		const statusEl = document.getElementById('statusIndicator');
		assert.ok(statusEl.classList.contains('active'), 'Status indicator should have active class when active');

		// Test inactive session
		mainModule.handleSessionStatusMessage({ active: false });
		assert.ok(!statusEl.classList.contains('active'), 'Status indicator should not have active class when inactive');
	});

	it('handleAppendMessageMessage works', function () {
		const messagesContainer = document.getElementById('messages');

		if (!mainModule.handleAppendMessageMessage) {
			throw new Error('handleAppendMessageMessage not exported');
		}

		// Add a message first via the component's internal DOM
		const msgDiv = document.createElement('div');
		msgDiv.className = 'message';
		const contentDiv = document.createElement('div');
		contentDiv.className = 'message-content';
		contentDiv.textContent = 'Hello';
		msgDiv.appendChild(contentDiv);
		messagesContainer.appendChild(msgDiv);

		// Append to it
		mainModule.handleAppendMessageMessage({ text: ' World' });

		const messageContent = messagesContainer.querySelector('.message-content');
		assert.equal(messageContent.textContent, 'Hello World', 'Should append text to last message');
	});

	it('handleUserMessageMessage works', function () {
		const messagesContainer = document.getElementById('messages');

		if (!mainModule.handleUserMessageMessage) {
			throw new Error('handleUserMessageMessage not exported');
		}

		// Clear via component (preserves internal DOM structure)
		mainModule.handleClearMessagesMessage({});
		mainModule.handleUserMessageMessage({ text: 'Hello AI', attachments: [] });

		// Component uses class: message message-display__item message-display__item--user
		const messages = messagesContainer.querySelectorAll('.message-display__item');
		assert.ok(messages.length >= 1, 'Should add at least one user message');
		assert.ok(messagesContainer.textContent.includes('Hello AI'), 'Should contain message text');
	});

	it('handleAssistantMessageMessage works', function () {
		const messagesContainer = document.getElementById('messages');
		const thinkingEl = document.getElementById('thinking');

		if (!mainModule.handleAssistantMessageMessage) {
			throw new Error('handleAssistantMessageMessage not exported');
		}

		// Set thinking active first
		thinkingEl.classList.add('active');

		// Clear via component and add message
		mainModule.handleClearMessagesMessage({});
		mainModule.handleAssistantMessageMessage({ text: 'Hello human' });

		const messages = messagesContainer.querySelectorAll('.message-display__item');
		assert.ok(messages.length >= 1, 'Should add at least one assistant message');
		assert.ok(messagesContainer.textContent.includes('Hello human'), 'Should contain message text');
		assert.ok(!thinkingEl.classList.contains('active'), 'Should hide thinking indicator');
	});

	it('handleReasoningMessageMessage works', function () {
		const messagesContainer = document.getElementById('messages');

		if (!mainModule.handleReasoningMessageMessage) {
			throw new Error('handleReasoningMessageMessage not exported');
		}

		// Clear via component and add message
		mainModule.handleClearMessagesMessage({});
		mainModule.handleReasoningMessageMessage({ text: 'Let me think...' });

		// Component adds messages via eventBus
		const messages = messagesContainer.querySelectorAll('.message-display__item');
		assert.ok(messages.length >= 1, 'Should add at least one reasoning message');
		assert.ok(messagesContainer.textContent.includes('Let me think'), 'Should contain reasoning text');
	});

	it('handleWorkspacePathMessage works', function () {
		if (!mainModule.handleWorkspacePathMessage) {
			throw new Error('handleWorkspacePathMessage not exported');
		}

		// With workspace path - the component now uses setPlanFileExists
		mainModule.handleWorkspacePathMessage({ path: '/home/user/project' });
		const viewPlanBtn = document.querySelector('#viewPlanBtn, .session-toolbar__btn--view-plan');
		assert.ok(viewPlanBtn, 'View plan button should exist');

		// Without workspace path
		mainModule.handleWorkspacePathMessage({ path: null });
	});

	it('handleActiveFileChangedMessage works', function () {
		if (!mainModule.handleActiveFileChangedMessage) {
			throw new Error('handleActiveFileChangedMessage not exported');
		}

		// With file path - delegates to InputArea component
		mainModule.handleActiveFileChangedMessage({ filePath: '/home/user/test.js' });

		// Without file path
		mainModule.handleActiveFileChangedMessage({ filePath: null });
	});

	it('handleClearMessagesMessage works', function () {
		if (!mainModule.handleClearMessagesMessage) {
			throw new Error('handleClearMessagesMessage not exported');
		}

		// First, add a message so there is something to clear
		mainModule.handleUserMessageMessage({ text: 'Temp message', attachments: [] });

		const messagesContainer = document.getElementById('messages');
		const itemsBefore = messagesContainer.querySelectorAll('.message-display__item');
		assert.ok(itemsBefore.length >= 1, 'Should have at least one message before clear');

		// Clear messages - delegates to MessageDisplay.clear()
		mainModule.handleClearMessagesMessage({});

		const itemsAfter = messagesContainer.querySelectorAll('.message-display__item');
		assert.equal(itemsAfter.length, 0, 'Should clear all message items');
	});

	it('handleUpdateSessionsMessage works', function () {
		if (!mainModule.handleUpdateSessionsMessage) {
			throw new Error('handleUpdateSessionsMessage not exported');
		}

		// Update with sessions - delegates to SessionToolbar component
		mainModule.handleUpdateSessionsMessage({
			currentSessionId: 'session2',
			sessions: [
				{ id: 'session1', label: 'Session 1' },
				{ id: 'session2', label: 'Session 2' }
			]
		});

		const sessionDropdown = document.getElementById('sessionDropdown');
		const options = sessionDropdown.querySelectorAll('option');
		assert.ok(options.length >= 2, 'Should have at least 2 session options');
	});

	it('handleToolStartMessage works', function () {
		const messagesContainer = document.getElementById('messages');

		if (!mainModule.handleToolStartMessage) {
			throw new Error('handleToolStartMessage not exported');
		}

		// Start a tool with realistic ToolState shape
		mainModule.handleToolStartMessage({
			toolState: {
				toolCallId: 'tool1',
				toolName: 'test_tool',
				status: 'running',
				arguments: { test: 'arg' },
				startTime: Date.now()
			}
		});

		// Tool should be rendered by ToolExecution component
		const toolEl = messagesContainer.querySelector('[data-tool-id="tool1"]');
		assert.ok(toolEl, 'Should add tool element');
	});

	it('handleToolUpdateMessage works', function () {
		const messagesContainer = document.getElementById('messages');

		if (!mainModule.handleToolUpdateMessage) {
			throw new Error('handleToolUpdateMessage not exported');
		}

		// Update existing tool
		mainModule.handleToolUpdateMessage({
			toolState: {
				toolCallId: 'tool1',
				toolName: 'test_tool',
				status: 'complete',
				arguments: { test: 'arg' },
				startTime: Date.now() - 1000,
				endTime: Date.now(),
				result: 'Success'
			}
		});

		const toolEl = messagesContainer.querySelector('[data-tool-id="tool1"]');
		assert.ok(toolEl, 'Tool should still exist');
	});

	it('handleDiffAvailableMessage works', function () {
		if (!mainModule.handleDiffAvailableMessage) {
			throw new Error('handleDiffAvailableMessage not exported');
		}

		// Add diff availability - delegates via eventBus
		mainModule.handleDiffAvailableMessage({
			data: {
				toolCallId: 'tool-diff',
				filePath: '/test.js'
			}
		});

		// Should not throw
	});

	it('handleUsageInfoMessage works', function () {
		if (!mainModule.handleUsageInfoMessage) {
			throw new Error('handleUsageInfoMessage not exported');
		}

		// Update with usage data - delegates to InputArea/StatusBar components
		mainModule.handleUsageInfoMessage({
			data: {
				currentTokens: 50000,
				tokenLimit: 100000,
				remainingPercentage: 75
			}
		});

		// Should not throw
	});

	it('handleResetPlanModeMessage works', function () {
		if (!mainModule.handleResetPlanModeMessage) {
			throw new Error('handleResetPlanModeMessage not exported');
		}

		// Should execute without error
		mainModule.handleResetPlanModeMessage({});
	});

	it('handleStatusMessage works', function () {
		if (!mainModule.handleStatusMessage) {
			throw new Error('handleStatusMessage not exported');
		}

		// Test status update (simple case)
		mainModule.handleStatusMessage({
			data: { status: 'ready' }
		});

		// Should not throw
	});

	it('handleFilesSelectedMessage works', function () {
		if (!mainModule.handleFilesSelectedMessage) {
			throw new Error('handleFilesSelectedMessage not exported');
		}

		// Should execute without error (modifies internal state)
		mainModule.handleFilesSelectedMessage({
			attachments: [
				{ displayName: 'test.js', webviewUri: 'file://test.js' }
			]
		});
	});

	it('handleInitMessage works', function () {
		if (!mainModule.handleInitMessage) {
			throw new Error('handleInitMessage not exported');
		}

		// Init with messages
		mainModule.handleInitMessage({
			messages: [
				{ type: 'user', content: 'Hello' },
				{ type: 'assistant', content: 'Hi there!' }
			],
			sessionActive: true
		});

		const messagesContainer = document.getElementById('messages');
		const messages = messagesContainer.querySelectorAll('.message');
		assert.ok(messages.length >= 2, 'Should load at least 2 messages from init');

		const statusEl = document.getElementById('statusIndicator');
		assert.ok(statusEl.classList.contains('active'), 'Should activate session');
	});
});
