/**
 * Unit tests for WebviewRpcClient
 * Tests the type-safe RPC client for webview → extension communication
 */

const assert = require('assert').strict;
const { JSDOM } = require('jsdom');

async function runTests() {
	console.log('='.repeat(70));
	console.log('WebviewRpcClient Unit Tests');
	console.log('='.repeat(70));
	
	const testResults = [];
	
	function recordTest(name, passed, details = '') {
		testResults.push({ name, passed, details });
		const icon = passed ? '✅' : '❌';
		console.log(`${icon} ${name}${details ? ': ' + details : ''}`);
	}
	
	// Set up JSDOM environment
	const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
		url: 'http://localhost',
		pretendToBeVisual: true
	});
	
	// Make DOM globals available
	global.window = dom.window;
	global.document = dom.window.document;
	global.MessageEvent = dom.window.MessageEvent;
	
	// Mock acquireVsCodeApi
	let mockVsCodeApi = null;
	global.acquireVsCodeApi = () => mockVsCodeApi;
	
	try {
		// Import WebviewRpcClient
		const clientPath = '../src/webview/app/rpc/WebviewRpcClient.js';
		
		// Clear require cache to get fresh instance
		delete require.cache[require.resolve(clientPath)];
		const { WebviewRpcClient } = require(clientPath);
		
		if (!WebviewRpcClient) {
			recordTest('Import WebviewRpcClient', false, 'Not exported');
			return;
		}
		recordTest('Import WebviewRpcClient', true);
		
		// Test 1: Client instantiation
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			assert.ok(client, 'Client should be created');
			recordTest('Client instantiation', true);
		} catch (error) {
			recordTest('Client instantiation', false, error.message);
		}
		
		// Test 2: Send sendMessage
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			const attachments = [
				{ type: 'file', path: '/test.ts', displayName: 'test.ts' }
			];
			
			client.sendMessage('Hello', attachments);
			
			const sent = mockVsCodeApi._getSentMessages();
			assert.equal(sent.length, 1);
			assert.equal(sent[0].type, 'sendMessage');
			assert.equal(sent[0].text, 'Hello');
			assert.deepEqual(sent[0].attachments, attachments);
			
			recordTest('Send sendMessage with attachments', true);
		} catch (error) {
			recordTest('Send sendMessage with attachments', false, error.message);
		}
		
		// Test 3: Send sendMessage with default empty attachments
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			client.sendMessage('Hello');
			
			const sent = mockVsCodeApi._getSentMessages();
			assert.equal(sent.length, 1);
			assert.deepEqual(sent[0].attachments, []);
			
			recordTest('Send sendMessage with default attachments', true);
		} catch (error) {
			recordTest('Send sendMessage with default attachments', false, error.message);
		}
		
		// Test 4: Send various message types
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			client.abortMessage();
			client.ready();
			client.newSession();
			client.viewPlan();
			
			const sent = mockVsCodeApi._getSentMessages();
			assert.equal(sent.length, 4);
			assert.equal(sent[0].type, 'abortMessage');
			assert.equal(sent[1].type, 'ready');
			assert.equal(sent[2].type, 'newSession');
			assert.equal(sent[3].type, 'viewPlan');
			
			recordTest('Send various message types', true);
		} catch (error) {
			recordTest('Send various message types', false, error.message);
		}
		
		// Test 5: Send switchSession with sessionId
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			client.switchSession('new-session-123');
			
			const sent = mockVsCodeApi._getSentMessages();
			assert.equal(sent[0].type, 'switchSession');
			assert.equal(sent[0].sessionId, 'new-session-123');
			
			recordTest('Send switchSession with sessionId', true);
		} catch (error) {
			recordTest('Send switchSession with sessionId', false, error.message);
		}
		
		// Test 6: Send togglePlanMode with boolean
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			client.togglePlanMode(true);
			
			const sent = mockVsCodeApi._getSentMessages();
			assert.equal(sent[0].type, 'togglePlanMode');
			assert.equal(sent[0].enabled, true);
			
			recordTest('Send togglePlanMode with enabled flag', true);
		} catch (error) {
			recordTest('Send togglePlanMode with enabled flag', false, error.message);
		}
		
		// Test 7: Receive init message
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			let receivedPayload = null;
			client.onInit((payload) => {
				receivedPayload = payload;
			});
			
			// Simulate extension sending init message
			const initMessage = {
				type: 'init',
				sessionId: 'test-session',
				sessionActive: true,
				messages: [],
				planModeStatus: null,
				workspacePath: null,
				activeFilePath: null
			};
			
			window.dispatchEvent(new MessageEvent('message', { data: initMessage }));
			
			assert.ok(receivedPayload);
			assert.equal(receivedPayload.type, 'init');
			assert.equal(receivedPayload.sessionId, 'test-session');
			
			recordTest('Receive init message', true);
		} catch (error) {
			recordTest('Receive init message', false, error.message);
		}
		
		// Test 8: Multiple handlers for same message type
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			let callCount = 0;
			client.onStreamChunk(() => callCount++);
			client.onStreamChunk(() => callCount++);
			
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'streamChunk', chunk: 'test' }
			}));
			
			assert.equal(callCount, 2, 'Both handlers should be called');
			
			recordTest('Multiple handlers for same message type', true);
		} catch (error) {
			recordTest('Multiple handlers for same message type', false, error.message);
		}
		
		// Test 9: Disposable handler unregistration
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			let callCount = 0;
			const disposable = client.onStreamChunk(() => callCount++);
			
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'streamChunk', chunk: 'test1' }
			}));
			assert.equal(callCount, 1);
			
			disposable.dispose();
			
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'streamChunk', chunk: 'test2' }
			}));
			assert.equal(callCount, 1, 'Handler should not be called after dispose');
			
			recordTest('Disposable handler unregistration', true);
		} catch (error) {
			recordTest('Disposable handler unregistration', false, error.message);
		}
		
		// Test 10: Receive various message types
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			const received = [];
			client.onUserMessage((msg) => received.push(msg.type));
			client.onAssistantMessage((msg) => received.push(msg.type));
			client.onStreamEnd((msg) => received.push(msg.type));
			
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'userMessage', text: 'test' }
			}));
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'assistantMessage', text: 'response' }
			}));
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'streamEnd' }
			}));
			
			assert.deepEqual(received, ['userMessage', 'assistantMessage', 'streamEnd']);
			
			recordTest('Receive various message types', true);
		} catch (error) {
			recordTest('Receive various message types', false, error.message);
		}
		
		// Test 11: Invalid messages are handled gracefully
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			// Should not throw
			window.dispatchEvent(new MessageEvent('message', { data: null }));
			window.dispatchEvent(new MessageEvent('message', { data: {} }));
			window.dispatchEvent(new MessageEvent('message', { data: { noType: true } }));
			
			recordTest('Handle invalid messages gracefully', true);
		} catch (error) {
			recordTest('Handle invalid messages gracefully', false, error.message);
		}
		
		// Test 12: Handler errors don't crash client
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			client.onStreamChunk(() => {
				throw new Error('Handler error');
			});
			
			// Should not throw - error is caught internally
			window.dispatchEvent(new MessageEvent('message', {
				data: { type: 'streamChunk', chunk: 'test' }
			}));
			
			recordTest('Handler errors are caught', true);
		} catch (error) {
			recordTest('Handler errors are caught', false, error.message);
		}
		
		// Test 13: All send methods exist
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			const sendMethods = [
				'sendMessage',
				'abortMessage',
				'ready',
				'switchSession',
				'newSession',
				'viewPlan',
				'viewDiff',
				'togglePlanMode',
				'acceptPlan',
				'rejectPlan',
				'pickFiles'
			];
			
			for (const method of sendMethods) {
				assert.equal(typeof client[method], 'function', `${method} should be a function`);
			}
			
			recordTest('All send methods exist', true);
		} catch (error) {
			recordTest('All send methods exist', false, error.message);
		}
		
		// Test 14: All receive handlers exist
		try {
			mockVsCodeApi = createMockVsCodeApi();
			const client = new WebviewRpcClient();
			
			const handlerMethods = [
				'onInit',
				'onUserMessage',
				'onAssistantMessage',
				'onReasoningMessage',
				'onToolStart',
				'onToolUpdate',
				'onStreamChunk',
				'onStreamEnd',
				'onClearMessages',
				'onSessionStatus',
				'onUpdateSessions',
				'onThinking',
				'onResetPlanMode',
				'onWorkspacePath',
				'onActiveFileChanged',
				'onDiffAvailable',
				'onAppendMessage',
				'onAttachmentValidation',
				'onStatus',
				'onUsageInfo'
			];
			
			for (const method of handlerMethods) {
				assert.equal(typeof client[method], 'function', `${method} should be a function`);
			}
			
			recordTest('All receive handlers exist', true);
		} catch (error) {
			recordTest('All receive handlers exist', false, error.message);
		}
		
	} catch (error) {
		console.error('❌ Fatal error:', error);
		recordTest('Test suite', false, error.message);
	} finally {
		// Clean up global state
		delete global.window;
		delete global.document;
		delete global.MessageEvent;
		delete global.acquireVsCodeApi;
	}
	
	// Summary
	console.log('='.repeat(70));
	console.log('Test Results Summary');
	console.log('='.repeat(70));
	
	const passed = testResults.filter(t => t.passed).length;
	const failed = testResults.filter(t => !t.passed).length;
	
	console.log(`\nTotal: ${testResults.length} | Passed: ${passed} | Failed: ${failed}\n`);
	console.log('='.repeat(70));
	
	if (failed > 0) {
		process.exit(1);
	}
}

/**
 * Create a mock VS Code API for testing
 */
function createMockVsCodeApi() {
	const sentMessages = [];
	
	return {
		postMessage(message) {
			sentMessages.push(message);
		},
		
		getState() {
			return null;
		},
		
		setState(state) {
			return state;
		},
		
		// Test helpers
		_getSentMessages() {
			return [...sentMessages];
		},
		
		_clearSentMessages() {
			sentMessages.length = 0;
		}
	};
}

// Run tests
runTests().catch(error => {
	console.error('Fatal error:', error);
	process.exit(1);
});
