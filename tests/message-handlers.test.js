/**
 * Unit tests for webview message handlers
 * Testing individual handler functions extracted from switch statement
 */

const assert = require('assert').strict;
const { JSDOM } = require('jsdom');

async function runTests() {
	console.log('='.repeat(70));
	console.log('Webview Message Handler Tests');
	console.log('='.repeat(70));
	
	const testResults = [];
	
	function recordTest(name, passed, details = '') {
		testResults.push({ name, passed, details });
		const icon = passed ? '✅' : '❌';
		console.log(`${icon} ${name}${details ? ': ' + details : ''}`);
	}
	
	// Set up JSDOM environment with all required elements
	const dom = new JSDOM(`
		<!DOCTYPE html>
		<html>
		<body>
			<div id="messages"></div>
			<div id="emptyState"></div>
			<div id="thinking" style="display: none;"></div>
			<input id="messageInput" />
			<button id="sendButton"></button>
			<div id="statusIndicator"></div>
			<select id="sessionSelect"></select>
			<button id="newSessionBtn"></button>
			<button id="viewPlanBtn"></button>
			<input type="checkbox" id="showReasoningCheckbox" />
			<button id="enterPlanModeBtn"></button>
			<button id="acceptPlanBtn"></button>
			<button id="rejectPlanBtn"></button>
			<div id="reasoningIndicator"></div>
			<div id="usageWindow"></div>
			<div id="usageUsed"></div>
			<div id="usageRemaining"></div>
			<div id="focusFileInfo"></div>
			<div id="acceptanceControls"></div>
			<input id="acceptanceInput" />
			<button id="keepPlanningBtn"></button>
			<button id="acceptAndWorkBtn"></button>
			<button id="attachButton"></button>
			<div id="attachmentsPreview"></div>
			<span id="attachCount"></span>
			<div class="input-controls" style="display: flex;"></div>
		</body>
		</html>
	`, {
		url: 'http://localhost',
		pretendToBeVisual: true
	});
	
	// Make DOM globals available
	global.window = dom.window;
	global.document = dom.window.document;
	
	// Mock marked library (needed for rendering assistant messages)
	global.marked = {
		parse: (text) => text // Simple pass-through for tests
	};
	
	// Mock acquireVsCodeApi (needed by main.js)
	global.acquireVsCodeApi = () => ({
		postMessage: () => {},
		setState: () => {},
		getState: () => ({})
	});
	
	try {
		// Import main.js to get handler functions
		const mainPath = '../src/webview/main.js';
		const mainModule = await import(mainPath);
		
		// Test 1: handleThinkingMessage - show thinking indicator
		try {
			const thinking = document.getElementById('thinking');
			
			if (!mainModule.handleThinkingMessage) {
				throw new Error('handleThinkingMessage not exported');
			}
			
			// Test showing thinking
			mainModule.handleThinkingMessage({ isThinking: true });
			assert.ok(thinking.classList.contains('active'), 'Should add active class when thinking');
			assert.equal(thinking.getAttribute('aria-busy'), 'true', 'Should set aria-busy to true');
			
			// Test hiding thinking
			mainModule.handleThinkingMessage({ isThinking: false });
			assert.ok(!thinking.classList.contains('active'), 'Should remove active class when not thinking');
			assert.equal(thinking.getAttribute('aria-busy'), 'false', 'Should set aria-busy to false');
			
			recordTest('handleThinkingMessage works', true);
		} catch (error) {
			recordTest('handleThinkingMessage works', false, error.message);
		}
		
		// Test 2: handleSessionStatusMessage - set session active state
		try {
			const sendButton = document.getElementById('sendButton');
			const messageInput = document.getElementById('messageInput');
			
			if (!mainModule.handleSessionStatusMessage) {
				throw new Error('handleSessionStatusMessage not exported');
			}
			
			// Test active session
			mainModule.handleSessionStatusMessage({ active: true });
			assert.equal(sendButton.disabled, false, 'Send button should be enabled when active');
			assert.equal(messageInput.disabled, false, 'Input should be enabled when active');
			
			// Test inactive session
			mainModule.handleSessionStatusMessage({ active: false });
			assert.equal(sendButton.disabled, true, 'Send button should be disabled when inactive');
			assert.equal(messageInput.disabled, true, 'Input should be disabled when inactive');
			
			recordTest('handleSessionStatusMessage works', true);
		} catch (error) {
			recordTest('handleSessionStatusMessage works', false, error.message);
		}
		
		// Test 3: handleAppendMessageMessage - append text to last message
		try {
			const messagesContainer = document.getElementById('messages');
			
			if (!mainModule.handleAppendMessageMessage) {
				throw new Error('handleAppendMessageMessage not exported');
			}
			
			// Add a message first
			messagesContainer.innerHTML = `
				<div class="message assistant">
					<div class="message-content">Hello</div>
				</div>
			`;
			
			// Append to it
			mainModule.handleAppendMessageMessage({ text: ' World' });
			
			const messageContent = messagesContainer.querySelector('.message-content');
			assert.equal(messageContent.textContent, 'Hello World', 'Should append text to last message');
			
			recordTest('handleAppendMessageMessage works', true);
		} catch (error) {
			recordTest('handleAppendMessageMessage works', false, error.message);
		}
		
		// Test 4: handleUserMessageMessage - add user message
		try {
			const messagesContainer = document.getElementById('messages');
			const emptyState = document.getElementById('emptyState');
			
			if (!mainModule.handleUserMessageMessage) {
				throw new Error('handleUserMessageMessage not exported');
			}
			
			// Clear and add message
			messagesContainer.innerHTML = '';
			mainModule.handleUserMessageMessage({ text: 'Hello AI', attachments: [] });
			
			const messages = messagesContainer.querySelectorAll('.message.user');
			assert.equal(messages.length, 1, 'Should add one user message');
			assert.ok(messagesContainer.textContent.includes('Hello AI'), 'Should contain message text');
			assert.ok(emptyState.classList.contains('hidden'), 'Should hide empty state');
			
			recordTest('handleUserMessageMessage works', true);
		} catch (error) {
			recordTest('handleUserMessageMessage works', false, error.message);
		}
		
		// Test 5: handleAssistantMessageMessage - add assistant message
		try {
			const messagesContainer = document.getElementById('messages');
			const thinking = document.getElementById('thinking');
			
			if (!mainModule.handleAssistantMessageMessage) {
				throw new Error('handleAssistantMessageMessage not exported');
			}
			
			// Set thinking active first
			thinking.classList.add('active');
			
			// Clear and add message
			messagesContainer.innerHTML = '';
			mainModule.handleAssistantMessageMessage({ text: 'Hello human' });
			
			const messages = messagesContainer.querySelectorAll('.message.assistant');
			assert.equal(messages.length, 1, 'Should add one assistant message');
			assert.ok(messagesContainer.textContent.includes('Hello human'), 'Should contain message text');
			assert.ok(!thinking.classList.contains('active'), 'Should hide thinking indicator');
			
			recordTest('handleAssistantMessageMessage works', true);
		} catch (error) {
			recordTest('handleAssistantMessageMessage works', false, error.message);
		}
		
		// Test 6: handleReasoningMessageMessage - add reasoning message
		try {
			const messagesContainer = document.getElementById('messages');
			const showReasoningCheckbox = document.getElementById('showReasoningCheckbox');
			
			if (!mainModule.handleReasoningMessageMessage) {
				throw new Error('handleReasoningMessageMessage not exported');
			}
			
			// Enable reasoning visibility
			showReasoningCheckbox.checked = true;
			
			// Clear and add message
			messagesContainer.innerHTML = '';
			mainModule.handleReasoningMessageMessage({ text: 'Let me think...' });
			
			const messages = messagesContainer.querySelectorAll('.message.reasoning');
			assert.equal(messages.length, 1, 'Should add one reasoning message');
			assert.ok(messagesContainer.textContent.includes('Let me think'), 'Should contain reasoning text');
			
			recordTest('handleReasoningMessageMessage works', true);
		} catch (error) {
			recordTest('handleReasoningMessageMessage works', false, error.message);
		}
		
		// Test 7: handleWorkspacePathMessage - show/hide view plan button
		try {
			const viewPlanBtn = document.getElementById('viewPlanBtn');
			
			if (!mainModule.handleWorkspacePathMessage) {
				throw new Error('handleWorkspacePathMessage not exported');
			}
			
			// With workspace path
			mainModule.handleWorkspacePathMessage({ workspacePath: '/home/user/project' });
			assert.equal(viewPlanBtn.style.display, 'inline-block', 'Should show view plan button with workspace');
			
			// Without workspace path
			mainModule.handleWorkspacePathMessage({ workspacePath: null });
			assert.equal(viewPlanBtn.style.display, 'none', 'Should hide view plan button without workspace');
			
			recordTest('handleWorkspacePathMessage works', true);
		} catch (error) {
			recordTest('handleWorkspacePathMessage works', false, error.message);
		}
		
		// Test 8: handleActiveFileChangedMessage - update active file display
		try {
			const focusFileInfo = document.getElementById('focusFileInfo');
			
			if (!mainModule.handleActiveFileChangedMessage) {
				throw new Error('handleActiveFileChangedMessage not exported');
			}
			
			// With file path
			mainModule.handleActiveFileChangedMessage({ filePath: '/home/user/test.js' });
			assert.equal(focusFileInfo.textContent, '/home/user/test.js', 'Should show file path');
			assert.equal(focusFileInfo.style.display, 'inline', 'Should display file info');
			
			// Without file path
			mainModule.handleActiveFileChangedMessage({ filePath: null });
			assert.equal(focusFileInfo.style.display, 'none', 'Should hide file info');
			
			recordTest('handleActiveFileChangedMessage works', true);
		} catch (error) {
			recordTest('handleActiveFileChangedMessage works', false, error.message);
		}
		
		// Test 9: handleClearMessagesMessage - clear all messages and show empty state
		try {
			const messagesContainer = document.getElementById('messages');
			
			if (!mainModule.handleClearMessagesMessage) {
				throw new Error('handleClearMessagesMessage not exported');
			}
			
			// Add some messages first
			messagesContainer.innerHTML = '<div class="message">Test</div>';
			
			// Clear messages
			mainModule.handleClearMessagesMessage({});
			
			const emptyState = messagesContainer.querySelector('.empty-state');
			assert.ok(emptyState, 'Should show empty state');
			assert.ok(emptyState.textContent.includes('Start a chat session'), 'Should have empty state text');
			assert.equal(messagesContainer.querySelectorAll('.message').length, 0, 'Should clear all messages');
			
			recordTest('handleClearMessagesMessage works', true);
		} catch (error) {
			recordTest('handleClearMessagesMessage works', false, error.message);
		}
		
		// Test 10: handleUpdateSessionsMessage - update session dropdown
		try {
			const sessionSelect = document.getElementById('sessionSelect');
			
			if (!mainModule.handleUpdateSessionsMessage) {
				throw new Error('handleUpdateSessionsMessage not exported');
			}
			
			// Update with sessions
			mainModule.handleUpdateSessionsMessage({
				currentSessionId: 'session2',
				sessions: [
					{ id: 'session1', label: 'Session 1' },
					{ id: 'session2', label: 'Session 2' }
				]
			});
			
			const options = sessionSelect.querySelectorAll('option');
			assert.equal(options.length, 2, 'Should have 2 session options');
			assert.equal(options[1].value, 'session2', 'Should have session2');
			assert.ok(options[1].selected, 'Session 2 should be selected');
			
			recordTest('handleUpdateSessionsMessage works', true);
		} catch (error) {
			recordTest('handleUpdateSessionsMessage works', false, error.message);
		}
		
		// Test 11: handleToolStartMessage - add tool execution display
		try {
			const messagesContainer = document.getElementById('messages');
			
			if (!mainModule.handleToolStartMessage) {
				throw new Error('handleToolStartMessage not exported');
			}
			
			// Clear messages
			messagesContainer.innerHTML = '';
			
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
			
			const toolEl = messagesContainer.querySelector('[data-tool-id="tool1"]');
			assert.ok(toolEl, 'Should add tool element');
			assert.ok(messagesContainer.textContent.includes('test_tool'), 'Should show tool name');
			
			recordTest('handleToolStartMessage works', true);
		} catch (error) {
			recordTest('handleToolStartMessage works', false, error.message);
		}
		
		// Test 12: handleToolUpdateMessage - update tool execution display
		try {
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
			
			recordTest('handleToolUpdateMessage works', true);
		} catch (error) {
			recordTest('handleToolUpdateMessage works', false, error.message);
		}
		
		// Test 13: handleDiffAvailableMessage - add diff button to tool
		try {
			const messagesContainer = document.getElementById('messages');
			
			if (!mainModule.handleDiffAvailableMessage) {
				throw new Error('handleDiffAvailableMessage not exported');
			}
			
			// Create a tool element first
			const toolDiv = document.createElement('div');
			toolDiv.setAttribute('data-tool-id', 'tool-diff');
			toolDiv._toolState = {
				toolCallId: 'tool-diff',
				toolName: 'edit',
				status: 'complete'
			};
			messagesContainer.appendChild(toolDiv);
			
			// Add diff availability
			mainModule.handleDiffAvailableMessage({
				data: {
					toolCallId: 'tool-diff',
					filePath: '/test.js'
				}
			});
			
			// Tool should still exist (might be re-rendered)
			const updatedTool = messagesContainer.querySelector('[data-tool-id="tool-diff"]');
			assert.ok(updatedTool, 'Tool should exist after diff update');
			
			recordTest('handleDiffAvailableMessage works', true);
		} catch (error) {
			recordTest('handleDiffAvailableMessage works', false, error.message);
		}
		
		// Test 14: handleUsageInfoMessage - update usage info display
		try {
			const usageWindow = document.getElementById('usageWindow');
			const usageRemaining = document.getElementById('usageRemaining');
			
			if (!mainModule.handleUsageInfoMessage) {
				throw new Error('handleUsageInfoMessage not exported');
			}
			
			// Update with usage data
			mainModule.handleUsageInfoMessage({
				data: {
					currentTokens: 50000,
					tokenLimit: 100000,
					remainingPercentage: 75
				}
			});
			
			assert.ok(usageWindow.textContent.includes('50%'), 'Should show window percentage');
			assert.ok(usageRemaining.textContent.includes('75%'), 'Should show remaining percentage');
			
			recordTest('handleUsageInfoMessage works', true);
		} catch (error) {
			recordTest('handleUsageInfoMessage works', false, error.message);
		}
		
		// Test 15: handleResetPlanModeMessage - reset plan mode
		try {
			if (!mainModule.handleResetPlanModeMessage) {
				throw new Error('handleResetPlanModeMessage not exported');
			}
			
			// Should execute without error
			mainModule.handleResetPlanModeMessage({});
			
			recordTest('handleResetPlanModeMessage works', true);
		} catch (error) {
			recordTest('handleResetPlanModeMessage works', false, error.message);
		}
		
	} catch (error) {
		recordTest('Test setup', false, error.message);
		console.error(error);
	} finally {
		// Clean up globals
		delete global.window;
		delete global.document;
	}
	
	// Summary
	console.log('='.repeat(70));
	console.log('Test Results Summary');
	console.log('='.repeat(70));
	console.log('');
	const passed = testResults.filter(r => r.passed).length;
	const failed = testResults.filter(r => !r.passed).length;
	console.log(`Total: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`);
	console.log('');
	console.log('='.repeat(70));
	
	process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
	console.error('Test runner error:', error);
	process.exit(1);
});
