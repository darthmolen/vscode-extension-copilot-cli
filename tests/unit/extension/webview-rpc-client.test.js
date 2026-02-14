/**
 * Unit tests for WebviewRpcClient
 * Tests the type-safe RPC client for webview -> extension communication
 */

const assert = require('assert').strict;
const { JSDOM } = require('jsdom');

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

describe('WebviewRpcClient Unit Tests', function () {
	let dom;
	let WebviewRpcClient;
	let mockVsCodeApi;

	before(async function () {
		this.timeout(30000);

		// Set up JSDOM environment
		dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
			url: 'http://localhost',
			pretendToBeVisual: true
		});

		// Make DOM globals available
		global.window = dom.window;
		global.document = dom.window.document;
		global.MessageEvent = dom.window.MessageEvent;

		// Mock acquireVsCodeApi
		mockVsCodeApi = null;
		global.acquireVsCodeApi = () => mockVsCodeApi;

		// Import WebviewRpcClient using ES6 dynamic import
		const clientPath = '../../../src/webview/app/rpc/WebviewRpcClient.js';
		const module = await import(clientPath);
		WebviewRpcClient = module.WebviewRpcClient;
	});

	after(function () {
		// Clean up global state
		delete global.window;
		delete global.document;
		delete global.MessageEvent;
		delete global.acquireVsCodeApi;
	});

	it('should import WebviewRpcClient', function () {
		assert.ok(WebviewRpcClient, 'WebviewRpcClient should be exported');
	});

	it('should instantiate client', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();
		assert.ok(client, 'Client should be created');
	});

	it('should send sendMessage with attachments', function () {
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
	});

	it('should send sendMessage with default empty attachments', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		client.sendMessage('Hello');

		const sent = mockVsCodeApi._getSentMessages();
		assert.equal(sent.length, 1);
		assert.deepEqual(sent[0].attachments, []);
	});

	it('should send various message types', function () {
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
	});

	it('should send switchSession with sessionId', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		client.switchSession('new-session-123');

		const sent = mockVsCodeApi._getSentMessages();
		assert.equal(sent[0].type, 'switchSession');
		assert.equal(sent[0].sessionId, 'new-session-123');
	});

	it('should send togglePlanMode with enabled flag', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		client.togglePlanMode(true);

		const sent = mockVsCodeApi._getSentMessages();
		assert.equal(sent[0].type, 'togglePlanMode');
		assert.equal(sent[0].enabled, true);
	});

	it('should receive init message', function () {
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
	});

	it('should call multiple handlers for same message type', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		let callCount = 0;
		client.onStreamChunk(() => callCount++);
		client.onStreamChunk(() => callCount++);

		window.dispatchEvent(new MessageEvent('message', {
			data: { type: 'streamChunk', chunk: 'test' }
		}));

		assert.equal(callCount, 2, 'Both handlers should be called');
	});

	it('should support disposable handler unregistration', function () {
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
	});

	it('should receive various message types', function () {
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
	});

	it('should handle invalid messages gracefully', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		// Should not throw
		window.dispatchEvent(new MessageEvent('message', { data: null }));
		window.dispatchEvent(new MessageEvent('message', { data: {} }));
		window.dispatchEvent(new MessageEvent('message', { data: { noType: true } }));
	});

	it('should catch handler errors without crashing', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		client.onStreamChunk(() => {
			throw new Error('Handler error');
		});

		// Should not throw - error is caught internally
		window.dispatchEvent(new MessageEvent('message', {
			data: { type: 'streamChunk', chunk: 'test' }
		}));
	});

	it('should have all send methods', function () {
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
	});

	it('should have all receive handlers', function () {
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
	});

	// ========================================================================
	// New Slash Command RPC Methods Tests
	// ========================================================================

	it('should send showPlanContent message', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		client.showPlanContent();

		const messages = mockVsCodeApi._getSentMessages();
		assert.equal(messages.length, 1);
		assert.equal(messages[0].type, 'showPlanContent');
	});

	it('should send openDiffView message with file paths', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		client.openDiffView('src/file1.ts', 'src/file2.ts');

		const messages = mockVsCodeApi._getSentMessages();
		assert.equal(messages.length, 1);
		assert.equal(messages[0].type, 'openDiffView');
		assert.equal(messages[0].file1, 'src/file1.ts');
		assert.equal(messages[0].file2, 'src/file2.ts');
	});

	it('should send showMcpConfig message', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		client.showMcpConfig();

		const messages = mockVsCodeApi._getSentMessages();
		assert.equal(messages.length, 1);
		assert.equal(messages[0].type, 'showMcpConfig');
	});

	it('should send showUsageMetrics message', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		client.showUsageMetrics();

		const messages = mockVsCodeApi._getSentMessages();
		assert.equal(messages.length, 1);
		assert.equal(messages[0].type, 'showUsageMetrics');
	});

	it('should send showHelp message without command', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		client.showHelp();

		const messages = mockVsCodeApi._getSentMessages();
		assert.equal(messages.length, 1);
		assert.equal(messages[0].type, 'showHelp');
		assert.equal(messages[0].command, undefined);
	});

	it('should send showHelp message with specific command', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		client.showHelp('review');

		const messages = mockVsCodeApi._getSentMessages();
		assert.equal(messages.length, 1);
		assert.equal(messages[0].type, 'showHelp');
		assert.equal(messages[0].command, 'review');
	});

	it('should send showNotSupported message with command name', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		client.showNotSupported('clear');

		const messages = mockVsCodeApi._getSentMessages();
		assert.equal(messages.length, 1);
		assert.equal(messages[0].type, 'showNotSupported');
		assert.equal(messages[0].command, 'clear');
	});

	it('should send openInCLI message with command', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		client.openInCLI('/delegate my task');

		const messages = mockVsCodeApi._getSentMessages();
		assert.equal(messages.length, 1);
		assert.equal(messages[0].type, 'openInCLI');
		assert.equal(messages[0].command, '/delegate my task');
	});

	it('should have all new slash command send methods', function () {
		mockVsCodeApi = createMockVsCodeApi();
		const client = new WebviewRpcClient();

		const newSendMethods = [
			'showPlanContent',
			'openDiffView',
			'showMcpConfig',
			'showUsageMetrics',
			'showHelp',
			'showNotSupported',
			'openInCLI'
		];

		for (const method of newSendMethods) {
			assert.equal(typeof client[method], 'function', `${method} should be a function`);
		}
	});
});
