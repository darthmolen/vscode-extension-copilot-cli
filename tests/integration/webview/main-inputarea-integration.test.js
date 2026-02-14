import { describe, it, before, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import { createComponentDOM, cleanupComponentDOM } from '../../helpers/jsdom-component-setup.js';

describe('main.js → InputArea Integration', () => {
	let dom, document, window, mainModule;

	before(async () => {
		dom = createComponentDOM();
		document = global.document;
		window = global.window;

		// Additional globals needed by InputArea
		global.HTMLElement = window.HTMLElement;
		global.Event = window.Event;
		global.KeyboardEvent = window.KeyboardEvent;

		// Mock vscode API
		global.acquireVsCodeApi = () => ({
			postMessage: () => {},
			getState: () => null,
			setState: () => {}
		});

		// Set testing flag to prevent auto-initialization
		window.__TESTING__ = true;

		// Import main.js with cache-busting
		mainModule = await import(`../../../src/webview/main.js?t=${Date.now()}`);
	});

	after(() => {
		delete global.HTMLElement;
		delete global.Event;
		delete global.KeyboardEvent;
		delete global.acquireVsCodeApi;
		cleanupComponentDOM(dom);
	});

	beforeEach(() => {
		// Clear messages container
		const messagesEl = document.getElementById('messages-mount');
		if (messagesEl) {
			const innerMessages = messagesEl.querySelector('#messages');
			if (innerMessages) innerMessages.innerHTML = '';
		}

		// Reset InputArea state if it exists
		if (mainModule.__testExports && mainModule.__testExports.inputArea) {
			const inputArea = mainModule.__testExports.inputArea;
			inputArea.pendingAttachments = [];
			inputArea.messageHistory = [];
			inputArea.historyIndex = -1;
			inputArea.currentDraft = '';

			// Reset attachments preview
			const preview = document.getElementById('attachmentsPreview');
			if (preview) {
				preview.innerHTML = '';
				preview.style.display = 'none';
			}
			const count = document.getElementById('attachCount');
			if (count) count.style.display = 'none';
		}
	});

	it('should export InputArea instance in __testExports', () => {
		expect(mainModule.__testExports).to.exist;
		expect(mainModule.__testExports.inputArea).to.exist;
		expect(mainModule.__testExports.inputArea.messageInput).to.exist;
	});

	it('should create InputArea with DOM elements', () => {
		const { inputArea } = mainModule.__testExports;

		expect(inputArea.messageInput.id).to.equal('messageInput');
		expect(inputArea.sendButton.id).to.equal('sendButton');
		expect(inputArea.attachButton.id).to.equal('attachButton');
	});

	it('should wire EventBus to InputArea', () => {
		const { eventBus, inputArea } = mainModule.__testExports;

		// Activate session first
		eventBus.emit('session:active', true);

		let emittedData = null;
		eventBus.on('input:sendMessage', (data) => {
			emittedData = data;
		});

		// Simulate user typing and sending
		inputArea.messageInput.value = 'Test message';
		inputArea.sendButton.click();

		expect(emittedData).to.not.be.null;
		expect(emittedData.text).to.equal('Test message');
	});

	it('should listen for session:active events from EventBus', () => {
		const { eventBus, inputArea } = mainModule.__testExports;

		const input = inputArea.messageInput;
		const sendBtn = inputArea.sendButton;

		// Disable
		eventBus.emit('session:active', false);
		expect(input.disabled).to.be.true;
		expect(sendBtn.disabled).to.be.true;

		// Enable
		eventBus.emit('session:active', true);
		expect(input.disabled).to.be.false;
		expect(sendBtn.disabled).to.be.false;
	});

	it('should listen for session:thinking events to toggle stop button', () => {
		const { eventBus, inputArea } = mainModule.__testExports;

		const sendBtn = inputArea.sendButton;

		// Start thinking
		eventBus.emit('session:thinking', true);
		expect(sendBtn.textContent).to.equal('Stop');
		expect(sendBtn.classList.contains('stop-button')).to.be.true;

		// Stop thinking
		eventBus.emit('session:thinking', false);
		expect(sendBtn.textContent).to.equal('Send');
		expect(sendBtn.classList.contains('stop-button')).to.be.false;
	});

	it('should handle addAttachment RPC message', () => {
		const { inputArea } = mainModule.__testExports;

		const mockAttachment = {
			uri: 'file:///test.jpg',
			displayName: 'test.jpg',
			webviewUri: 'vscode-webview://test.jpg'
		};

		inputArea.addAttachment(mockAttachment);

		expect(inputArea.pendingAttachments).to.have.length(1);
		expect(inputArea.pendingAttachments[0].displayName).to.equal('test.jpg');

		const preview = document.getElementById('attachmentsPreview');
		expect(preview.style.display).to.equal('flex');
	});

	it('should clear attachments after sending', () => {
		const { inputArea, eventBus } = mainModule.__testExports;

		// Activate session
		eventBus.emit('session:active', true);

		// Add attachment
		inputArea.addAttachment({
			uri: 'file:///test.jpg',
			displayName: 'test.jpg'
		});

		expect(inputArea.pendingAttachments).to.have.length(1);

		// Send message
		inputArea.messageInput.value = 'Message with attachment';
		inputArea.sendButton.click();

		expect(inputArea.pendingAttachments).to.have.length(0);
	});

	it('should auto-resize textarea on input', () => {
		const { inputArea } = mainModule.__testExports;
		const input = inputArea.messageInput;

		input.value = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
		input.dispatchEvent(new window.Event('input'));

		expect(input.style.height).to.not.equal('');
		expect(input.style.height).to.not.equal('auto');
	});

	it('should navigate history with arrow keys', () => {
		const { inputArea, eventBus } = mainModule.__testExports;
		const input = inputArea.messageInput;

		// Activate session
		eventBus.emit('session:active', true);

		// Send a few messages
		input.value = 'Message 1';
		inputArea.sendButton.click();
		input.value = 'Message 2';
		inputArea.sendButton.click();

		// Navigate up
		const upEvent = new window.KeyboardEvent('keydown', { key: 'ArrowUp' });
		input.dispatchEvent(upEvent);

		expect(input.value).to.equal('Message 2');
	});
});
