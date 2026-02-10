import { describe, it, before, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { InputArea } from '../../src/webview/app/components/InputArea/InputArea.js';
import { EventBus } from '../../src/webview/app/state/EventBus.js';

describe('InputArea Component', () => {
	let dom, document, container, eventBus, inputArea;

	before(() => {
		// Setup DOM environment once
		dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
				<body>
					<div id="container">
						<div class="input-area">
							<div id="attachmentsPreview" class="attachments-preview"></div>
							<div class="input-wrapper">
								<button id="attachButton" class="attach-button">📎</button>
								<textarea id="messageInput" class="message-input" placeholder="Type a message..."></textarea>
								<button id="sendButton" class="send-button">Send</button>
								<span id="attachCount" class="attach-count" style="display: none;">0</span>
							</div>
						</div>
					</div>
				</body>
			</html>
		`);
		document = dom.window.document;
		global.document = document;
		global.window = dom.window;
	});

	beforeEach(() => {
		// Create fresh container for each test
		container = document.getElementById('container');
		container.innerHTML = `
			<div class="input-area">
				<div id="attachmentsPreview" class="attachments-preview"></div>
				<div class="input-wrapper">
					<button id="attachButton" class="attach-button">📎</button>
					<textarea id="messageInput" class="message-input" placeholder="Type a message..."></textarea>
					<button id="sendButton" class="send-button">Send</button>
					<span id="attachCount" class="attach-count" style="display: none;">0</span>
				</div>
			</div>
		`;

		// Create fresh EventBus
		eventBus = new EventBus();

		// Create InputArea instance
		const elements = {
			messageInput: document.getElementById('messageInput'),
			sendButton: document.getElementById('sendButton'),
			attachButton: document.getElementById('attachButton'),
			attachmentsPreview: document.getElementById('attachmentsPreview'),
			attachCount: document.getElementById('attachCount')
		};
		inputArea = new InputArea(elements, eventBus);
	});

	afterEach(() => {
		// Clean up
		if (inputArea) {
			inputArea = null;
		}
	});

	describe('Initialization', () => {
		it('should initialize with provided elements', () => {
			expect(inputArea.messageInput).to.exist;
			expect(inputArea.sendButton).to.exist;
			expect(inputArea.attachButton).to.exist;
		});

		it('should set up event listeners on initialization', () => {
			const input = document.getElementById('messageInput');
			// Simulate input event
			input.value = 'test';
			input.dispatchEvent(new dom.window.Event('input'));
			// Should auto-resize (height changes)
			expect(input.style.height).to.not.equal('');
		});

		it('should initialize with empty attachments', () => {
			expect(inputArea.pendingAttachments).to.be.an('array').that.is.empty;
		});

		it('should initialize message history', () => {
			expect(inputArea.messageHistory).to.be.an('array').that.is.empty;
			expect(inputArea.historyIndex).to.equal(-1);
		});
	});

	describe('Send Button', () => {
		beforeEach(() => {
			// Activate session for these tests
			eventBus.emit('session:active', true);
		});

		it('should emit sendMessage event when send button clicked with text', () => {
			let emittedData = null;
			eventBus.on('input:sendMessage', (data) => {
				emittedData = data;
			});

			const input = document.getElementById('messageInput');
			input.value = 'Hello world';
			
			const sendBtn = document.getElementById('sendButton');
			sendBtn.click();

			expect(emittedData).to.not.be.null;
			expect(emittedData.text).to.equal('Hello world');
			expect(emittedData.attachments).to.deep.equal([]);
		});

		it('should not emit when text is empty', () => {
			let emitted = false;
			eventBus.on('input:sendMessage', () => {
				emitted = true;
			});

			const input = document.getElementById('messageInput');
			input.value = '   '; // whitespace only
			
			const sendBtn = document.getElementById('sendButton');
			sendBtn.click();

			expect(emitted).to.be.false;
		});

		it('should clear input after sending', () => {
			const input = document.getElementById('messageInput');
			input.value = 'Hello world';
			
			const sendBtn = document.getElementById('sendButton');
			sendBtn.click();

			expect(input.value).to.equal('');
		});

		it('should add message to history after sending', () => {
			const input = document.getElementById('messageInput');
			input.value = 'First message';
			
			const sendBtn = document.getElementById('sendButton');
			sendBtn.click();

			expect(inputArea.messageHistory).to.have.length(1);
			expect(inputArea.messageHistory[0]).to.equal('First message');
		});

		it('should switch to stop button when session is thinking', () => {
			eventBus.emit('session:thinking', true);

			const sendBtn = document.getElementById('sendButton');
			expect(sendBtn.textContent).to.equal('Stop');
			expect(sendBtn.classList.contains('stop-button')).to.be.true;
		});

		it('should emit abort event when stop button clicked', () => {
			let emitted = false;
			eventBus.on('input:abort', () => {
				emitted = true;
			});

			// Set to thinking state
			eventBus.emit('session:thinking', true);
			
			const sendBtn = document.getElementById('sendButton');
			sendBtn.click();

			expect(emitted).to.be.true;
		});
	});

	describe('Auto-resize', () => {
		it('should auto-resize textarea on input', () => {
			const input = document.getElementById('messageInput');
			input.value = 'Line 1\nLine 2\nLine 3';
			
			input.dispatchEvent(new dom.window.Event('input'));

			// Height should be adjusted (not 'auto')
			expect(input.style.height).to.not.equal('');
			expect(input.style.height).to.not.equal('auto');
		});
	});

	describe('History Navigation', () => {
		beforeEach(() => {
			// Activate session and add some messages to history
			eventBus.emit('session:active', true);
			
			const input = document.getElementById('messageInput');
			const sendBtn = document.getElementById('sendButton');

			input.value = 'Message 1';
			sendBtn.click();
			input.value = 'Message 2';
			sendBtn.click();
			input.value = 'Message 3';
			sendBtn.click();
		});

		it('should navigate to previous message on ArrowUp', () => {
			const input = document.getElementById('messageInput');
			input.value = 'Current draft';
			input.selectionStart = 0; // Cursor at start
			input.selectionEnd = 0;

			// Simulate ArrowUp
			const event = new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp' });
			input.dispatchEvent(event);

			expect(input.value).to.equal('Message 3');
		});

		it('should navigate to older messages on repeated ArrowUp', () => {
			const input = document.getElementById('messageInput');
			input.selectionStart = 0; // Cursor at start
			input.selectionEnd = 0;

			// First ArrowUp
			let event = new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp' });
			input.dispatchEvent(event);
			expect(input.value).to.equal('Message 3');

			// Second ArrowUp (now in history, always allow)
			event = new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp' });
			input.dispatchEvent(event);
			expect(input.value).to.equal('Message 2');

			// Third ArrowUp
			event = new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp' });
			input.dispatchEvent(event);
			expect(input.value).to.equal('Message 1');
		});

		it('should navigate back to draft on ArrowDown', () => {
			const input = document.getElementById('messageInput');
			input.value = 'Current draft';
			input.selectionStart = 0; // Cursor at start
			input.selectionEnd = 0;

			// Go up
			let event = new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp' });
			input.dispatchEvent(event);
			expect(input.value).to.equal('Message 3');

			// Go down back to draft
			event = new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' });
			input.dispatchEvent(event);
			expect(input.value).to.equal('Current draft');
		});

		it('should limit history to MAX_HISTORY items', () => {
			const input = document.getElementById('messageInput');
			const sendBtn = document.getElementById('sendButton');

			// Already have 3 messages from beforeEach
			// Add 22 more messages (25 total, MAX_HISTORY is 20)
			for (let i = 4; i <= 25; i++) {
				input.value = `Message ${i}`;
				sendBtn.click();
			}

			expect(inputArea.messageHistory).to.have.length(20);
			expect(inputArea.messageHistory[0]).to.equal('Message 6'); // First 5 dropped
		});
	});

	describe('Attachments', () => {
		beforeEach(() => {
			// Activate session for these tests
			eventBus.emit('session:active', true);
		});

		it('should emit attachFiles event when attach button clicked', () => {
			let emitted = false;
			eventBus.on('input:attachFiles', () => {
				emitted = true;
			});

			const attachBtn = document.getElementById('attachButton');
			attachBtn.click();

			expect(emitted).to.be.true;
		});

		it('should show attachments preview when attachments added', () => {
			inputArea.addAttachment({
				uri: 'file:///test.jpg',
				displayName: 'test.jpg',
				webviewUri: 'data:image/png;base64,test'
			});

			const preview = document.getElementById('attachmentsPreview');
			expect(preview.style.display).to.equal('flex');
			expect(preview.innerHTML).to.include('test.jpg');
		});

		it('should update attach count badge', () => {
			inputArea.addAttachment({
				uri: 'file:///test1.jpg',
				displayName: 'test1.jpg'
			});

			const badge = document.getElementById('attachCount');
			expect(badge.style.display).to.equal('block');
			expect(badge.textContent).to.equal('1');
		});

		it('should remove attachment when remove button clicked', () => {
			inputArea.addAttachment({
				uri: 'file:///test.jpg',
				displayName: 'test.jpg',
				webviewUri: 'data:image/png;base64,test'
			});

			expect(inputArea.pendingAttachments).to.have.length(1);

			// Find and click remove button
			const removeBtn = document.querySelector('.attachment-remove');
			removeBtn.click();

			expect(inputArea.pendingAttachments).to.have.length(0);
		});

		it('should clear attachments after sending message', () => {
			inputArea.addAttachment({
				uri: 'file:///test.jpg',
				displayName: 'test.jpg'
			});

			const input = document.getElementById('messageInput');
			input.value = 'Message with attachment';
			
			const sendBtn = document.getElementById('sendButton');
			sendBtn.click();

			expect(inputArea.pendingAttachments).to.have.length(0);
			const preview = document.getElementById('attachmentsPreview');
			expect(preview.style.display).to.equal('none');
		});

		it('should include attachments in sendMessage event', () => {
			let emittedData = null;
			eventBus.on('input:sendMessage', (data) => {
				emittedData = data;
			});

			inputArea.addAttachment({
				uri: 'file:///test.jpg',
				displayName: 'test.jpg'
			});

			const input = document.getElementById('messageInput');
			input.value = 'Message with attachment';
			
			const sendBtn = document.getElementById('sendButton');
			sendBtn.click();

			expect(emittedData.attachments).to.have.length(1);
			expect(emittedData.attachments[0].uri).to.equal('file:///test.jpg');
		});
	});

	describe('Session State', () => {
		it('should disable input when session becomes inactive', () => {
			eventBus.emit('session:active', false);

			const input = document.getElementById('messageInput');
			const sendBtn = document.getElementById('sendButton');

			expect(input.disabled).to.be.true;
			expect(sendBtn.disabled).to.be.true;
		});

		it('should enable input when session becomes active', () => {
			// First disable
			eventBus.emit('session:active', false);
			
			// Then enable
			eventBus.emit('session:active', true);

			const input = document.getElementById('messageInput');
			const sendBtn = document.getElementById('sendButton');

			expect(input.disabled).to.be.false;
			expect(sendBtn.disabled).to.be.false;
		});

		it('should update placeholder when session inactive', () => {
			eventBus.emit('session:active', false);

			const input = document.getElementById('messageInput');
			expect(input.placeholder).to.equal('Start a session to chat');
		});

		it('should update placeholder when session active', () => {
			eventBus.emit('session:active', true);

			const input = document.getElementById('messageInput');
			expect(input.placeholder).to.equal('Type a message...');
		});
	});

	describe('Keyboard Shortcuts', () => {
		beforeEach(() => {
			// Activate session for these tests
			eventBus.emit('session:active', true);
		});

		it('should send message on Enter key', () => {
			let emitted = false;
			eventBus.on('input:sendMessage', () => {
				emitted = true;
			});

			const input = document.getElementById('messageInput');
			input.value = 'Test message';

			const event = new dom.window.KeyboardEvent('keydown', { key: 'Enter' });
			input.dispatchEvent(event);

			expect(emitted).to.be.true;
		});

		it('should insert newline on Shift+Enter', () => {
			const input = document.getElementById('messageInput');
			input.value = 'Line 1';

			const event = new dom.window.KeyboardEvent('keydown', { 
				key: 'Enter',
				shiftKey: true 
			});
			input.dispatchEvent(event);

			// Should NOT send message
			expect(input.value).to.equal('Line 1'); // Value unchanged (browser handles newline)
		});
	});
});
