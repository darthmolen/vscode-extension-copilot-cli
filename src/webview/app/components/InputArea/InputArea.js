import { escapeHtml } from '../../utils/webview-utils.js';

/**
 * InputArea Component
 * Manages message input, send/abort buttons, attachments, history navigation, and auto-resize
 */
export class InputArea {
	constructor(elements, eventBus) {
		this.messageInput = elements.messageInput;
		this.sendButton = elements.sendButton;
		this.attachButton = elements.attachButton;
		this.attachmentsPreview = elements.attachmentsPreview;
		this.attachCount = elements.attachCount;
		this.eventBus = eventBus;

		// State
		this.pendingAttachments = [];
		this.messageHistory = [];
		this.MAX_HISTORY = 20;
		this.historyIndex = -1; // -1 means current draft (not in history)
		this.currentDraft = ''; // Stores unsent message when navigating history
		this.sessionActive = false;

		// Bind methods to preserve 'this' context
		this.handleInput = this.handleInput.bind(this);
		this.handleSendClick = this.handleSendClick.bind(this);
		this.handleAttachClick = this.handleAttachClick.bind(this);
		this.handleKeydown = this.handleKeydown.bind(this);
		this.sendMessage = this.sendMessage.bind(this);
		this.handleSessionActive = this.handleSessionActive.bind(this);
		this.handleSessionThinking = this.handleSessionThinking.bind(this);

		this.attachListeners();
	}

	attachListeners() {
		// Input events
		this.messageInput.addEventListener('input', this.handleInput);
		this.messageInput.addEventListener('keydown', this.handleKeydown);

		// Button events
		this.sendButton.addEventListener('click', this.handleSendClick);
		this.attachButton.addEventListener('click', this.handleAttachClick);

		// EventBus events
		this.eventBus.on('session:active', this.handleSessionActive);
		this.eventBus.on('session:thinking', this.handleSessionThinking);
	}

	handleInput() {
		// Auto-resize textarea
		this.messageInput.style.height = 'auto';
		this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
	}

	handleSendClick() {
		const isStopButton = this.sendButton.classList.contains('stop-button');
		
		if (isStopButton) {
			// Abort current generation
			this.eventBus.emit('input:abort');
		} else {
			// Send message
			this.sendMessage();
		}
	}

	handleAttachClick() {
		this.eventBus.emit('input:attachFiles');
	}

	handleKeydown(e) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			this.sendMessage();
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			// Check cursor position
			const cursorPos = this.messageInput.selectionStart;
			const textLength = this.messageInput.value.length;
			
			// Only navigate if cursor is at start (ArrowUp) or end (ArrowDown)
			const shouldNavigate = (e.key === 'ArrowUp' && cursorPos === 0) || 
			                        (e.key === 'ArrowDown' && cursorPos === textLength);
			
			if (shouldNavigate || this.historyIndex !== -1) {
				// If already navigating history, always allow navigation
				e.preventDefault();
				this.navigateHistory(e.key === 'ArrowUp' ? 'up' : 'down');
			}
		}
	}

	sendMessage() {
		const text = this.messageInput.value.trim();
		if (!text || !this.sessionActive) return;

		console.log('[InputArea] sendMessage() called, text:', text.substring(0, 50));
		console.log('[InputArea] Pending attachments:', this.pendingAttachments.length);

		// Save to history (without [[PLAN]] prefix - save what user typed)
		this.messageHistory.push(text);
		if (this.messageHistory.length > this.MAX_HISTORY) {
			this.messageHistory.shift(); // Remove oldest
		}

		// Reset history navigation
		this.historyIndex = -1;
		this.currentDraft = '';

		// Emit event with message data
		this.eventBus.emit('input:sendMessage', {
			text,
			attachments: this.pendingAttachments.length > 0 ? this.pendingAttachments : []
		});

		// Clear input
		this.messageInput.value = '';
		this.messageInput.style.height = 'auto';

		// Clear attachments
		this.clearAttachments();
	}

	navigateHistory(direction) {
		if (this.messageHistory.length === 0) return;

		// Save current draft when first navigating away
		if (this.historyIndex === -1 && direction === 'up') {
			this.currentDraft = this.messageInput.value;
		}

		if (direction === 'up') {
			// Navigate to older messages
			if (this.historyIndex < this.messageHistory.length - 1) {
				this.historyIndex++;
				const historyMessage = this.messageHistory[this.messageHistory.length - 1 - this.historyIndex];
				this.messageInput.value = historyMessage;
				this.messageInput.style.height = 'auto';
				this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
			}
			// If already at oldest, do nothing (stay at oldest)
		} else if (direction === 'down') {
			// Navigate to newer messages
			if (this.historyIndex > 0) {
				this.historyIndex--;
				const historyMessage = this.messageHistory[this.messageHistory.length - 1 - this.historyIndex];
				this.messageInput.value = historyMessage;
				this.messageInput.style.height = 'auto';
				this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
			} else if (this.historyIndex === 0) {
				// Return to current draft
				this.historyIndex = -1;
				this.messageInput.value = this.currentDraft;
				this.messageInput.style.height = 'auto';
				this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
			}
			// If already at current (historyIndex === -1), do nothing
		}
	}

	addAttachment(attachment) {
		this.pendingAttachments.push(attachment);
		this.updateAttachmentsPreview();
		this.updateAttachCount();
	}

	removeAttachment(index) {
		this.pendingAttachments.splice(index, 1);
		this.updateAttachmentsPreview();
		this.updateAttachCount();
	}

	clearAttachments() {
		this.pendingAttachments = [];
		this.updateAttachmentsPreview();
		this.updateAttachCount();
	}

	updateAttachmentsPreview() {
		console.log('[InputArea] updateAttachmentsPreview called with', this.pendingAttachments.length, 'attachments');

		if (this.pendingAttachments.length === 0) {
			this.attachmentsPreview.style.display = 'none';
			this.attachmentsPreview.innerHTML = '';
			return;
		}

		this.attachmentsPreview.style.display = 'flex';

		this.attachmentsPreview.innerHTML = this.pendingAttachments.map((att, index) => {
			const imgSrc = att.webviewUri || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect fill='%23ccc' width='80' height='80'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%23666' font-size='12'%3EImage%3C/text%3E%3C/svg%3E";
			const safeName = escapeHtml(att.displayName);

			return `
				<div class="attachment-item">
					<button class="attachment-remove" data-attachment-index="${index}" title="Remove">&times;</button>
					<img class="attachment-thumbnail" src="${imgSrc}" alt="${safeName}" />
					<div class="attachment-name" title="${safeName}">${safeName}</div>
				</div>
			`;
		}).join('');

		// Add event listeners to remove buttons
		this.attachmentsPreview.querySelectorAll('.attachment-remove').forEach(btn => {
			btn.addEventListener('click', (e) => {
				const index = parseInt(e.target.getAttribute('data-attachment-index'));
				this.removeAttachment(index);
			});
		});
	}

	updateAttachCount() {
		if (this.pendingAttachments.length > 0) {
			this.attachCount.textContent = this.pendingAttachments.length;
			this.attachCount.style.display = 'block';
		} else {
			this.attachCount.style.display = 'none';
		}
	}

	handleSessionActive(active) {
		this.sessionActive = active;
		this.messageInput.disabled = !active;
		this.sendButton.disabled = !active;

		if (active) {
			this.messageInput.placeholder = 'Type a message...';
			this.messageInput.focus();
		} else {
			this.messageInput.placeholder = 'Start a session to chat';
		}
	}

	handleSessionThinking(thinking) {
		if (thinking) {
			this.sendButton.textContent = 'Stop';
			this.sendButton.setAttribute('aria-label', 'Stop generation');
			this.sendButton.classList.add('stop-button');
		} else {
			this.sendButton.textContent = 'Send';
			this.sendButton.setAttribute('aria-label', 'Send message');
			this.sendButton.classList.remove('stop-button');
		}
	}
}
