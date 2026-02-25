import { escapeHtml } from '../../utils/webview-utils.js';
import { ActiveFileDisplay } from '../ActiveFileDisplay/ActiveFileDisplay.js';
import { StatusBar } from '../StatusBar/StatusBar.js';
import { PlanModeControls } from '../PlanModeControls/PlanModeControls.js';
import { SlashCommandPanel } from '../SlashCommandPanel/SlashCommandPanel.js';
import { ModelSelector } from '../ModelSelector/ModelSelector.js';
import { CommandParser } from '../../services/CommandParser.js';

/**
 * InputArea Component - Container Pattern
 * Manages message input core functionality and child components
 * 
 * Children:
 * - ActiveFileDisplay: Shows active file path
 * - StatusBar: Metrics and reasoning toggle
 * - PlanModeControls: Plan mode buttons
 * 
 * Services:
 * - CommandParser: Parses and validates slash commands
 */
export class InputArea {
	constructor(container, eventBus) {
		this.container = container;
		this.eventBus = eventBus;
		
		// Services
		this.commandParser = new CommandParser();
		
		// Element references (created in render)
		this.messageInput = null;
		this.sendButton = null;
		this.attachButton = null;
		this.attachmentsPreview = null;
		this.attachCount = null;

		// State
		this.pendingAttachments = [];
		this.pasteImageCounter = 0;
		this.messageHistory = [];
		this.MAX_HISTORY = 20;
		this.historyIndex = -1; // -1 means current draft (not in history)
		this.currentDraft = ''; // Stores unsent message when navigating history
		this.sessionActive = false;
		this.planMode = false;
		this.planReady = false;

		// Bind methods to preserve 'this' context
		this.handleInput = this.handleInput.bind(this);
		this.handleSendClick = this.handleSendClick.bind(this);
		this.handleAttachClick = this.handleAttachClick.bind(this);
		this.handleKeydown = this.handleKeydown.bind(this);
		this.handlePaste = this.handlePaste.bind(this);
		this.sendMessage = this.sendMessage.bind(this);
		this.handleSessionActive = this.handleSessionActive.bind(this);
		this.handleSessionThinking = this.handleSessionThinking.bind(this);

		this.render();
		this.createChildComponents();
		this.attachListeners();
	}
	
	render() {
		this.container.innerHTML = `
			<div class="input-controls">
				<div class="active-file-row" id="active-file-mount"></div>
				<div class="model-selector-row" id="model-selector-mount"></div>
				<div class="metrics-row" id="metrics-mount"></div>
				<div class="controls-row">
					<label class="reasoning-toggle">
						<input type="checkbox" id="reasoningCheckbox" />
						<span>Show Reasoning</span>
					</label>
					<div id="plan-controls-mount"></div>
				</div>
			</div>
			<div class="input-area">
				<div id="attachmentsPreview" class="attachments-preview" style="display: none;"></div>
				<div id="slash-command-mount"></div>
				<div class="input-wrapper">
					<button id="attachButton" class="attach-button" title="Attach files">📎</button>
					<textarea id="messageInput" class="message-input" placeholder="Type a message..." rows="1"></textarea>
					<button id="sendButton" class="send-button">Send</button>
					<span id="attachCount" class="attach-count" style="display: none;">0</span>
				</div>
			</div>
		`;
		
		// Store references to created elements
		console.log('[InputArea] Storing DOM element references');
		this.messageInput = this.container.querySelector('#messageInput');
		this.sendButton = this.container.querySelector('#sendButton');
		this.attachButton = this.container.querySelector('#attachButton');
		this.attachmentsPreview = this.container.querySelector('#attachmentsPreview');
		this.attachCount = this.container.querySelector('#attachCount');
		this.reasoningCheckbox = this.container.querySelector('#reasoningCheckbox');
	}

	/**
	 * Create child components and mount them
	 */
	createChildComponents() {
		console.log('[InputArea] Creating child components');
		
		const activeFileMount = this.container.querySelector('#active-file-mount');
		const metricsMount = this.container.querySelector('#metrics-mount');
		const planControlsMount = this.container.querySelector('#plan-controls-mount');
		const modelSelectorMount = this.container.querySelector('#model-selector-mount');
		const slashCommandMount = this.container.querySelector('#slash-command-mount');

		this.activeFileDisplay = new ActiveFileDisplay(activeFileMount, this.eventBus);
		this.statusBar = new StatusBar(metricsMount);
		this.planModeControls = new PlanModeControls(planControlsMount, this.eventBus);
		this.modelSelector = new ModelSelector(modelSelectorMount, this.eventBus);
		this.slashCommandPanel = new SlashCommandPanel(slashCommandMount);
		this.slashCommandPanel.onSelect = (commandName) => {
			this.messageInput.value = `/${commandName} `;
			this.slashCommandPanel.hide();
			this.messageInput.focus();
		};

		// Wire StatusBar help icon to EventBus
		this.statusBar.on('showHelp', () => {
			this.eventBus.emit('showHelp');
		});

		console.log('[InputArea] Child components created');
	}

	attachListeners() {
		// Input events
		this.messageInput.addEventListener('input', this.handleInput);
		this.messageInput.addEventListener('keydown', this.handleKeydown);
		this.messageInput.addEventListener('paste', this.handlePaste);

		// Button events
		this.sendButton.addEventListener('click', this.handleSendClick);
		this.attachButton.addEventListener('click', this.handleAttachClick);
		
		// Reasoning checkbox event
		if (this.reasoningCheckbox) {
			this.reasoningCheckbox.addEventListener('change', (e) => {
				console.log('[InputArea] Reasoning checkbox changed:', e.target.checked);
				this.eventBus.emit('reasoning:toggle', e.target.checked);
			});
		}

		// EventBus events
		this.eventBus.on('session:active', this.handleSessionActive);
		this.eventBus.on('session:thinking', this.handleSessionThinking);
	}

	handleInput() {
		// Auto-resize textarea
		this.messageInput.style.height = 'auto';
		this.messageInput.style.height = this.messageInput.scrollHeight + 'px';

		// Show/hide slash command panel
		const value = this.messageInput.value;
		if (value.startsWith('/') && value.indexOf(' ') === -1) {
			this.slashCommandPanel.show(this.commandParser.getVisibleCommands());
		} else {
			this.slashCommandPanel.hide();
		}
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
		if (e.key === 'Escape') {
			this.slashCommandPanel.hide();
			return;
		}
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

	handlePaste(e) {
		const items = e.clipboardData && e.clipboardData.items;
		if (!items || items.length === 0) return;

		let hasImage = false;
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.kind === 'file' && item.type.startsWith('image/')) {
				hasImage = true;
				const file = item.getAsFile();
				if (!file) continue;

				this.pasteImageCounter++;
				const ext = item.type.split('/')[1];
				const fileName = `pasted-image-${this.pasteImageCounter}.${ext}`;
				const mimeType = item.type;

				const reader = new FileReader();
				reader.onload = () => {
					this.eventBus.emit('input:pasteImage', {
						dataUri: reader.result,
						mimeType,
						fileName
					});
				};
				reader.onerror = () => {
					console.error('[PASTE] Failed to read image file:', reader.error);
				};
				reader.readAsDataURL(file);
			}
		}

		if (hasImage) {
			e.preventDefault();
		}
	}

	/**
	 * Parse slash command from text (delegates to CommandParser)
	 * @param {string} text
	 * @returns {Object|null} { command: string, args: string[] } or null
	 */
	parseCommand(text) {
		return this.commandParser.parse(text);
	}

	sendMessage() {
		const text = this.messageInput.value.trim();
		if (!text) return;

		// Check for slash command first
		const cmd = this.commandParser.parse(text);
		if (cmd) {
			console.log('[InputArea] Detected slash command:', cmd.command);
			
			// Validate command in current context
			const context = {
				planMode: this.planMode,
				planReady: this.planReady
			};
			
			if (!this.commandParser.isValid(cmd, context)) {
				console.warn('[InputArea] Command not valid in current context:', cmd.command, context);
				// Could show user feedback here
				return;
			}
			
			// Execute command
			this.commandParser.execute(cmd, this.eventBus);
			
			// Clear input after command
			this.messageInput.value = '';
			this.messageInput.style.height = 'auto';
			return;
		}

		// Regular message - needs active session
		if (!this.sessionActive) return;

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
			this.messageInput.placeholder = 'Type a message or / for commands...';
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
	
	/**
	 * Update active file display in focus file info
	 * Delegate to ActiveFileDisplay child component
	 * @param {string|null} filePath - Path to active file or null to hide
	 */
	updateFocusFile(filePath) {
		if (this.activeFileDisplay) {
			this.activeFileDisplay.setFile(filePath);
		}
	}

	/**
	 * Alias for backward compatibility
	 * @param {string|null} filePath
	 */
	setFile(filePath) {
		this.updateFocusFile(filePath);
	}

	/**
	 * Delegate to PlanModeControls child component
	 * @param {boolean} planMode
	 * @param {boolean} planReady
	 */
	setPlanMode(planMode, planReady) {
		// Track state for command validation
		this.planMode = planMode;
		this.planReady = planReady;
		
		if (this.planModeControls) {
			this.planModeControls.setPlanMode(planMode, planReady);
		}
	}

	/**
	 * Delegate to StatusBar child component
	 * @param {number} percentage
	 * @param {number} used
	 * @param {number} limit
	 */
	updateUsageWindow(percentage, used, limit) {
		if (this.statusBar) {
			this.statusBar.updateUsageWindow(percentage, used, limit);
		}
	}

	/**
	 * Delegate to StatusBar child component
	 * @param {number} tokens
	 */
	updateUsageUsed(tokens) {
		if (this.statusBar) {
			this.statusBar.updateUsageUsed(tokens);
		}
	}

	/**
	 * Delegate to StatusBar child component
	 * @param {number|null} remaining
	 */
	updateUsageRemaining(remaining) {
		if (this.statusBar) {
			this.statusBar.updateUsageRemaining(remaining);
		}
	}
	
	/**
	 * Set current model on the ModelSelector
	 * @param {string} model - Model ID
	 */
	setCurrentModel(model) {
		if (this.modelSelector) {
			this.modelSelector.setModel(model);
		}
	}

	/**
	 * Set available models on the ModelSelector
	 * @param {Array<{id: string, name: string}>} models
	 */
	setAvailableModels(models) {
		if (this.modelSelector) {
			this.modelSelector.setAvailableModels(models);
		}
	}

	/**
	 * Add attachments to pending list (called from filesSelected handler)
	 * @param {Array} attachments - Array of attachment objects
	 */
	addAttachments(attachments) {
		if (attachments && attachments.length > 0) {
			console.log('[InputArea] addAttachments called with', attachments.length, 'files');
			this.pendingAttachments.push(...attachments);
			this.updateAttachmentsPreview();
			this.updateAttachCount();
		}
	}
}
