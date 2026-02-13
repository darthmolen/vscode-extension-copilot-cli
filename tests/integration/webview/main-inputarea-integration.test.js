import { describe, it, before, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';

describe('main.js → InputArea Integration', () => {
	let dom, document, window, mainModule;

	before(async () => {
		// Setup DOM environment
		dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
				<head><style></style></head>
				<body>
					<div id="messages"></div>
					<div id="emptyState"></div>
					<div id="thinking" style="display: none;"></div>
					<div id="statusIndicator"></div>
					<div id="reasoningIndicator" style="display: none;"></div>
					<div id="usageWindow" style="display: none;">
						<span id="usageUsed"></span>
						<span id="usageRemaining"></span>
					</div>
					<div id="focusFileInfo" style="display: none;"></div>
					
					<!-- Session controls -->
					<select id="sessionSelect"></select>
					<button id="newSessionBtn">New Session</button>
					<button id="viewPlanBtn">View Plan</button>
					<input type="checkbox" id="showReasoningCheckbox" />
					<button id="enterPlanModeBtn">Enter Plan Mode</button>
					<button id="acceptPlanBtn" style="display: none;">Accept Plan</button>
					<button id="rejectPlanBtn" style="display: none;">Reject Plan</button>
					
					<!-- Input area -->
					<div class="input-area">
						<div id="attachmentsPreview" class="attachments-preview"></div>
						<div class="input-wrapper">
							<button id="attachButton" class="attach-button">📎</button>
							<textarea id="messageInput" class="message-input" placeholder="Type a message..."></textarea>
							<button id="sendButton" class="send-button">Send</button>
							<span id="attachCount" class="attach-count" style="display: none;">0</span>
						</div>
					</div>

					<!-- Acceptance controls -->
					<div id="acceptanceControls" style="display: none;">
						<textarea id="acceptanceInput" placeholder="Enter acceptance criteria..."></textarea>
						<button id="acceptAndWorkBtn">Accept and Work</button>
						<button id="keepPlanningBtn">Keep Planning</button>
					</div>
				</body>
			</html>
		`, {
			url: 'file:///test.html',
			pretendToBeVisual: true,
			resources: 'usable'
		});

		document = dom.window.document;
		window = dom.window;
		global.document = document;
		global.window = window;
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

		// Import main.js
		mainModule = await import('../../../src/webview/main.js');
	});

	beforeEach(() => {
		// Clear DOM
		document.getElementById('messages').innerHTML = '';
		document.getElementById('messageInput').value = '';
		
		// Reset InputArea state if it exists
		if (mainModule.__testExports && mainModule.__testExports.inputArea) {
			const inputArea = mainModule.__testExports.inputArea;
			inputArea.pendingAttachments = [];
			inputArea.messageHistory = [];
			inputArea.historyIndex = -1;
			inputArea.currentDraft = '';
			
			// Reset DOM
			document.getElementById('attachmentsPreview').innerHTML = '';
			document.getElementById('attachmentsPreview').style.display = 'none';
			document.getElementById('attachCount').style.display = 'none';
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
		const input = document.getElementById('messageInput');
		input.value = 'Test message';
		
		const sendBtn = document.getElementById('sendButton');
		sendBtn.click();

		expect(emittedData).to.not.be.null;
		expect(emittedData.text).to.equal('Test message');
	});

	it('should listen for session:active events from EventBus', () => {
		const { eventBus } = mainModule.__testExports;

		const input = document.getElementById('messageInput');
		const sendBtn = document.getElementById('sendButton');

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
		const { eventBus } = mainModule.__testExports;

		const sendBtn = document.getElementById('sendButton');

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

		// Simulate RPC message from extension
		const mockAttachment = {
			uri: 'file:///test.jpg',
			displayName: 'test.jpg',
			webviewUri: 'vscode-webview://test.jpg'
		};

		// Call addAttachment directly (simulating RPC handler)
		inputArea.addAttachment(mockAttachment);

		expect(inputArea.pendingAttachments).to.have.length(1);
		expect(inputArea.pendingAttachments[0].displayName).to.equal('test.jpg');

		const preview = document.getElementById('attachmentsPreview');
		expect(preview.style.display).to.equal('flex');
	});

	it('should clear attachments after sending', () => {
		const { inputArea } = mainModule.__testExports;

		// Add attachment
		inputArea.addAttachment({
			uri: 'file:///test.jpg',
			displayName: 'test.jpg'
		});

		expect(inputArea.pendingAttachments).to.have.length(1);

		// Send message
		const input = document.getElementById('messageInput');
		input.value = 'Message with attachment';
		
		const sendBtn = document.getElementById('sendButton');
		sendBtn.click();

		expect(inputArea.pendingAttachments).to.have.length(0);
	});

	it('should auto-resize textarea on input', () => {
		const input = document.getElementById('messageInput');
		
		input.value = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
		input.dispatchEvent(new window.Event('input'));

		// Height should be adjusted
		expect(input.style.height).to.not.equal('');
		expect(input.style.height).to.not.equal('auto');
	});

	it('should navigate history with arrow keys', () => {
		const { inputArea } = mainModule.__testExports;
		const input = document.getElementById('messageInput');
		const sendBtn = document.getElementById('sendButton');

		// Send a few messages
		input.value = 'Message 1';
		sendBtn.click();
		input.value = 'Message 2';
		sendBtn.click();

		// Navigate up
		const upEvent = new window.KeyboardEvent('keydown', { key: 'ArrowUp' });
		input.dispatchEvent(upEvent);

		expect(input.value).to.equal('Message 2');
	});
});
