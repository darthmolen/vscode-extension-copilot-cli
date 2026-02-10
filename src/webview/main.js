// Import RPC client for type-safe messaging
import { WebviewRpcClient } from './app/rpc/WebviewRpcClient.js';
// Import EventBus and MessageDisplay component
import { EventBus } from './app/state/EventBus.js';
import { MessageDisplay } from './app/components/MessageDisplay/MessageDisplay.js';
// Import extracted event handlers
import {
	handleReasoningToggle,
	handleSessionChange,
	handleNewSession,
	handleViewPlan,
	handleEnterPlanMode,
	handleAcceptPlan,
	handleRejectPlan
} from './app/handlers/ui-handlers.js';
import {
	handleAcceptAndWork,
	handleKeepPlanning,
	handleAcceptanceKeydown
} from './app/handlers/acceptance-handlers.js';
import {
	handleInputChange,
	handleAttachFiles,
	handleSendButtonClick,
	handleMessageKeydown
} from './app/handlers/message-handlers.js';
import { handleDiffButtonClick } from './app/handlers/diff-handler.js';
import { handleToolGroupToggle } from './app/handlers/tool-group-handler.js';
import { escapeHtml } from './app/utils/webview-utils.js';

// Initialize RPC client
const rpc = new WebviewRpcClient();
const messagesContainer = document.getElementById('messages');
const emptyState = document.getElementById('emptyState');
const thinking = document.getElementById('thinking');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const statusIndicator = document.getElementById('statusIndicator');
const sessionSelect = document.getElementById('sessionSelect');
const newSessionBtn = document.getElementById('newSessionBtn');
const viewPlanBtn = document.getElementById('viewPlanBtn');
const showReasoningCheckbox = document.getElementById('showReasoningCheckbox');
const enterPlanModeBtn = document.getElementById('enterPlanModeBtn');
const acceptPlanBtn = document.getElementById('acceptPlanBtn');
const rejectPlanBtn = document.getElementById('rejectPlanBtn');
const reasoningIndicator = document.getElementById('reasoningIndicator');
const usageWindow = document.getElementById('usageWindow');
const usageUsed = document.getElementById('usageUsed');
const usageRemaining = document.getElementById('usageRemaining');
const focusFileInfo = document.getElementById('focusFileInfo');
const acceptanceControls = document.getElementById('acceptanceControls');
const acceptanceInput = document.getElementById('acceptanceInput');
const keepPlanningBtn = document.getElementById('keepPlanningBtn');
const acceptAndWorkBtn = document.getElementById('acceptAndWorkBtn');
const attachButton = document.getElementById('attachButton');
const attachmentsPreview = document.getElementById('attachmentsPreview');
const attachCount = document.getElementById('attachCount');

let sessionActive = false;
let currentSessionId = null;
let showReasoning = false;
let planMode = false;
let workspacePath = null;
let isReasoning = false;

// Create EventBus for component communication
const eventBus = new EventBus();

// Initialize MessageDisplay component
const messageDisplay = new MessageDisplay(messagesContainer, eventBus);

// Attachments state
let pendingAttachments = [];

// Prompt history
const messageHistory = [];
const MAX_HISTORY = 20;
let historyIndex = -1; // -1 means current draft (not in history)
let currentDraft = ''; // Stores unsent message when navigating history

// Tool grouping state
let currentToolGroup = null;
let toolGroupExpanded = false;

// Show reasoning checkbox handler
showReasoningCheckbox.addEventListener('change', (e) => {
	showReasoning = handleReasoningToggle(e.target.checked, messagesContainer);
	eventBus.emit('reasoning:toggle', e.target.checked);
});

// Session selector change handler
sessionSelect.addEventListener('change', (e) => {
	currentSessionId = handleSessionChange(e.target.value, currentSessionId, rpc);
});

// New session button handler
newSessionBtn.addEventListener('click', () => {
	handleNewSession(rpc);
});

// View plan button handler
viewPlanBtn.addEventListener('click', () => {
	handleViewPlan(rpc);
});

// Plan mode button handlers
enterPlanModeBtn.addEventListener('click', () => {
	planMode = handleEnterPlanMode(rpc, updatePlanModeUI);
});

acceptPlanBtn.addEventListener('click', () => {
	handleAcceptPlan(rpc);
});

rejectPlanBtn.addEventListener('click', () => {
	handleRejectPlan(rpc);
});

// Acceptance control handlers
acceptAndWorkBtn.addEventListener('click', () => {
	handleAcceptAndWork(rpc, swapToRegularControls);
});

keepPlanningBtn.addEventListener('click', () => {
	handleKeepPlanning(swapToRegularControls);
});

acceptanceInput.addEventListener('keydown', (e) => {
	handleAcceptanceKeydown(e, acceptanceInput.value, rpc, {
		clearInput: () => { acceptanceInput.value = ''; },
		swapControls: swapToRegularControls
	});
});

function swapToAcceptanceControls() {
	console.log('[Control Surface] Swapping to acceptance controls');
	document.querySelector('.input-controls').style.display = 'none';
	acceptanceControls.classList.add('active');
	acceptanceInput.focus();
}

function swapToRegularControls() {
	console.log('[Control Surface] Swapping to regular controls');
	acceptanceControls.classList.remove('active');
	document.querySelector('.input-controls').style.display = 'flex';
	acceptanceInput.value = '';
}

function updatePlanModeUI() {
	console.log('[updatePlanModeUI] Called with planMode =', planMode);
	if (planMode) {
		// In plan mode: hide enter button, show accept/reject
		console.log('[updatePlanModeUI] PLAN MODE - hiding enter, showing accept/reject');
		enterPlanModeBtn.style.display = 'none';
		acceptPlanBtn.style.display = 'inline-block';
		rejectPlanBtn.style.display = 'inline-block';
		console.log('[updatePlanModeUI] Button states:', {
			enter: enterPlanModeBtn.style.display,
			accept: acceptPlanBtn.style.display,
			reject: rejectPlanBtn.style.display
		});
	} else {
		// In work mode: show enter button, hide accept/reject
		console.log('[updatePlanModeUI] WORK MODE - showing enter, hiding accept/reject');
		enterPlanModeBtn.style.display = 'inline-block';
		acceptPlanBtn.style.display = 'none';
		rejectPlanBtn.style.display = 'none';
		console.log('[updatePlanModeUI] Button states:', {
			enter: enterPlanModeBtn.style.display,
			accept: acceptPlanBtn.style.display,
			reject: rejectPlanBtn.style.display
		});
	}
}

// Auto-resize textarea
messageInput.addEventListener('input', () => {
	handleInputChange(messageInput);
});

// Send message on button click (or abort if thinking)
sendButton.addEventListener('click', () => {
	handleSendButtonClick(sendButton.classList.contains('stop-button'), rpc, sendMessage);
});

// Attach button click handler
attachButton.addEventListener('click', () => {
	handleAttachFiles(rpc);
});

// Send message on Enter (Shift+Enter for newline)
// Arrow keys for history navigation
messageInput.addEventListener('keydown', (e) => {
	handleMessageKeydown(e, sendMessage, navigateHistory);
});

function sendMessage() {
	const text = messageInput.value.trim();
	if (!text || !sessionActive) return;

	console.log('[SEND] sendMessage() called, text:', text.substring(0, 50));
	console.log('[SEND] Pending attachments:', pendingAttachments.length);
	
	// Save to history (without [[PLAN]] prefix - save what user typed)
	messageHistory.push(text);
	if (messageHistory.length > MAX_HISTORY) {
		messageHistory.shift(); // Remove oldest
	}
	
	// Reset history navigation
	historyIndex = -1;
	currentDraft = '';

	console.log('[SEND] Posting message to extension:', text.substring(0, 50));
	rpc.sendMessage(text, pendingAttachments.length > 0 ? pendingAttachments : undefined);

	messageInput.value = '';
	messageInput.style.height = 'auto';
	
	// Clear attachments after sending
	clearAttachments();
}

function clearAttachments() {
	pendingAttachments = [];
	updateAttachmentsPreview();
	updateAttachCount();
}

function updateAttachmentsPreview() {
	console.log('[ATTACH] updateAttachmentsPreview called with', pendingAttachments.length, 'attachments');
	
	if (pendingAttachments.length === 0) {
		attachmentsPreview.style.display = 'none';
		attachmentsPreview.innerHTML = '';
		return;
	}
	
	attachmentsPreview.style.display = 'flex';
	
	attachmentsPreview.innerHTML = pendingAttachments.map((att, index) => {
		const imgSrc = att.webviewUri || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect fill='%23ccc' width='80' height='80'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%23666' font-size='12'%3EImage%3C/text%3E%3C/svg%3E";
		const safeName = escapeHtml(att.displayName);
		
		return `
			<div class="attachment-item">
				<button class="attachment-remove" onclick="removeAttachment(${index})" title="Remove">&times;</button>
				<img class="attachment-thumbnail" src="${imgSrc}" alt="${safeName}" />
				<div class="attachment-name" title="${safeName}">${safeName}</div>
			</div>
		`;
	}).join('');
}

function updateAttachCount() {
	if (pendingAttachments.length > 0) {
		attachCount.textContent = pendingAttachments.length;
		attachCount.style.display = 'block';
	} else {
		attachCount.style.display = 'none';
	}
}

window.removeAttachment = function(index) {
	pendingAttachments.splice(index, 1);
	updateAttachmentsPreview();
	updateAttachCount();
};

function navigateHistory(direction) {
	if (messageHistory.length === 0) return;
	
	// Save current draft when first navigating away
	if (historyIndex === -1 && direction === 'up') {
		currentDraft = messageInput.value;
	}
	
	if (direction === 'up') {
		// Navigate to older messages
		if (historyIndex < messageHistory.length - 1) {
			historyIndex++;
			const historyMessage = messageHistory[messageHistory.length - 1 - historyIndex];
			messageInput.value = historyMessage;
			messageInput.style.height = 'auto';
			messageInput.style.height = messageInput.scrollHeight + 'px';
		}
		// If already at oldest, do nothing (stay at oldest)
	} else if (direction === 'down') {
		// Navigate to newer messages
		if (historyIndex > 0) {
			historyIndex--;
			const historyMessage = messageHistory[messageHistory.length - 1 - historyIndex];
			messageInput.value = historyMessage;
			messageInput.style.height = 'auto';
			messageInput.style.height = messageInput.scrollHeight + 'px';
		} else if (historyIndex === 0) {
			// Return to current draft
			historyIndex = -1;
			messageInput.value = currentDraft;
			messageInput.style.height = 'auto';
			messageInput.style.height = messageInput.scrollHeight + 'px';
		}
		// If already at current (historyIndex === -1), do nothing
	}
}

function closeCurrentToolGroup() {
	if (currentToolGroup) {
		updateToolGroupToggle();
		currentToolGroup = null;
		toolGroupExpanded = false;
	}
}

function getOrCreateToolGroup() {
	if (!currentToolGroup) {
		// Create new tool group
		const toolGroup = document.createElement('div');
		toolGroup.className = 'tool-group';
		
		const container = document.createElement('div');
		container.className = 'tool-group-container';
		
		toolGroup.appendChild(container);
		messagesContainer.appendChild(toolGroup);
		
		currentToolGroup = {
			element: toolGroup,
			container: container,
			toolCount: 0
		};
	}
	return currentToolGroup;
}

function updateToolGroupToggle() {
	if (!currentToolGroup) return;
	
	const { element, container } = currentToolGroup;
	
	// Remove existing toggle if present
	const existingToggle = element.querySelector('.tool-group-toggle');
	if (existingToggle) {
		existingToggle.remove();
	}
	
	// Check if content overflows
	const isOverflowing = container.scrollHeight > 200;
	
	if (isOverflowing) {
		// Ensure container starts collapsed
		if (!toolGroupExpanded) {
			container.classList.remove('expanded');
		}
		
		const toggle = document.createElement('div');
		toggle.className = 'tool-group-toggle';
		
		const hiddenTools = element.querySelectorAll('.tool-execution').length - Math.floor(200 / 70); // Rough estimate
		const displayCount = Math.max(1, hiddenTools);
		
		toggle.textContent = toolGroupExpanded ? 'Contract' : `Expand (${displayCount} more)`;
		toggle.addEventListener('click', () => {
			toolGroupExpanded = handleToolGroupToggle(toolGroupExpanded, container, toggle, element);
		});
		
		element.appendChild(toggle);
	} else {
		// Not overflowing - remove height restriction so details can expand fully
		container.classList.add('expanded');
	}
}

function addOrUpdateTool(toolState) {
	// Check if this tool already exists anywhere in the DOM
	let toolDiv = messagesContainer.querySelector(`[data-tool-id="${toolState.toolCallId}"]`);
	
	const toolHtml = buildToolHtml(toolState);
	
	if (toolDiv) {
		// Update existing tool (status change)
		toolDiv.innerHTML = toolHtml;
		// Store state for future updates
		toolDiv._toolState = toolState;
		
		// Re-attach diff button listener if present
		const diffBtn = toolDiv.querySelector('.view-diff-btn');
		if (diffBtn) {
			diffBtn.addEventListener('click', () => {
				rpc.viewDiff(toolState.diffData || {});
			});
		}
		
		// Update toggle if this tool group is current
		if (currentToolGroup && currentToolGroup.container.contains(toolDiv)) {
			updateToolGroupToggle();
		}
	} else {
		// Add to current tool group
		const group = getOrCreateToolGroup();
		
		const toolExecution = document.createElement('div');
		toolExecution.className = 'tool-execution';
		toolExecution.setAttribute('data-tool-id', toolState.toolCallId);
		toolExecution.innerHTML = toolHtml;
		toolExecution._toolState = toolState;
		
		// Attach diff button listener if present
		const diffBtn = toolExecution.querySelector('.view-diff-btn');
		if (diffBtn) {
			diffBtn.addEventListener('click', () => {
				rpc.viewDiff(toolState.diffData || {});
			});
		}
		
		group.container.appendChild(toolExecution);
		group.toolCount++;
		
		// Update toggle after adding tool
		updateToolGroupToggle();
	}
	
	// Scroll to show new tool
	messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function buildToolHtml(toolState) {
	const statusIcon = toolState.status === 'complete' ? '✅' : 
	                    toolState.status === 'failed' ? '❌' : 
	                    toolState.status === 'running' ? '⏳' : '⏸️';
	
	const duration = toolState.endTime ? 
		`${((toolState.endTime - toolState.startTime) / 1000).toFixed(2)}s` : '';
	
	const argsPreview = formatArgumentsPreview(toolState.toolName, toolState.arguments);
	const hasDetails = toolState.arguments || toolState.result || toolState.error;
	
	let html = `
		<div class="tool-header">
			<span class="tool-icon">${statusIcon}</span>
			<span class="tool-name">${escapeHtml(toolState.toolName)}</span>
			${toolState.intent ? `<span class="tool-intent">${escapeHtml(toolState.intent)}</span>` : ''}
			${duration ? `<span class="tool-duration">${duration}</span>` : ''}
			${toolState.hasDiff ? `<button class="view-diff-btn" data-tool-id="${toolState.toolCallId}">📄 View Diff</button>` : ''}
		</div>
	`;
	
	if (argsPreview) {
		html += `<div class="tool-args-preview">${escapeHtml(argsPreview)}</div>`;
	}
	
	if (toolState.progress) {
		html += `<div class="tool-progress">${escapeHtml(toolState.progress)}</div>`;
	}
	
	if (hasDetails) {
		const detailsId = 'details-' + toolState.toolCallId;
		html += `
			<details class="tool-details">
				<summary>Show Details</summary>
				<div class="tool-details-content">
		`;
		
		if (toolState.arguments) {
			html += `
				<div class="tool-detail-section">
					<strong>Arguments:</strong>
					<pre>${escapeHtml(JSON.stringify(toolState.arguments, null, 2))}</pre>
				</div>
			`;
		}
		
		if (toolState.result) {
			html += `
				<div class="tool-detail-section">
					<strong>Result:</strong>
					<pre>${escapeHtml(toolState.result)}</pre>
				</div>
			`;
		}
		
		if (toolState.error) {
			html += `
				<div class="tool-detail-section error">
					<strong>Error:</strong>
					<pre>${escapeHtml(toolState.error.message)}</pre>
					${toolState.error.code ? `<div>Code: ${escapeHtml(toolState.error.code)}</div>` : ''}
				</div>
			`;
		}
		
		html += `
				</div>
			</details>
		`;
	}
	
	return html;
}

function formatArgumentsPreview(toolName, args) {
	if (!args) return null;
	
	try {
		// Format based on tool type
		if (toolName === 'bash' || toolName.startsWith('shell')) {
			return `$ ${args.command || JSON.stringify(args)}`;
		} else if (toolName === 'grep') {
			return `pattern: "${args.pattern}"${args.path ? ` in ${args.path}` : ''}`;
		} else if (toolName === 'edit' || toolName === 'create') {
			return `${args.path || 'unknown file'}`;
		} else if (toolName === 'view') {
			return `${args.path || 'unknown path'}`;
		} else if (toolName === 'web_fetch') {
			return `${args.url || JSON.stringify(args)}`;
		} else if (toolName === 'glob') {
			return `pattern: "${args.pattern}"`;
		} else {
			// Generic preview - show first property or count
			const keys = Object.keys(args);
			if (keys.length === 0) return null;
			if (keys.length === 1) return `${keys[0]}: ${JSON.stringify(args[keys[0]])}`;
			return `${keys.length} parameters`;
		}
	} catch (e) {
		return null;
	}
}

function appendToLastMessage(text) {
	const messages = messagesContainer.querySelectorAll('.message');
	if (messages.length > 0) {
		const lastMessage = messages[messages.length - 1];
		const content = lastMessage.querySelector('.message-content');
		content.textContent += text;
		messagesContainer.scrollTop = messagesContainer.scrollHeight;
	}
}

function setSessionActive(active) {
	sessionActive = active;
	messageInput.disabled = !active;
	sendButton.disabled = !active;
	
	const statusText = active ? 'Connected to Copilot CLI' : 'Disconnected';
	statusIndicator.setAttribute('aria-label', statusText);
	
	if (active) {
		statusIndicator.classList.add('active');
		messageInput.placeholder = 'Type a message...';
		messageInput.focus();
	} else {
		statusIndicator.classList.remove('active');
		messageInput.placeholder = 'Start a session to chat';
	}
}

// ========================================================================
// Message Handlers (extracted from switch statement)
// ========================================================================

/**
 * Handle 'thinking' message - show/hide thinking indicator
 */
export function handleThinkingMessage(payload) {
	setThinking(payload.isThinking);
}

/**
 * Handle 'sessionStatus' message - set session active state
 */
export function handleSessionStatusMessage(payload) {
	setSessionActive(payload.active);
}

/**
 * Handle 'appendMessage' message - append text to last message
 */
export function handleAppendMessageMessage(payload) {
	appendToLastMessage(payload.text);
}

/**
 * Handle 'userMessage' message - add user message to chat
 */
export function handleUserMessageMessage(payload) {
	emptyState.classList.add('hidden');
	closeCurrentToolGroup();
	eventBus.emit('message:add', {
		role: 'user',
		content: payload.text,
		attachments: payload.attachments,
		timestamp: Date.now()
	});
}

/**
 * Handle 'assistantMessage' message - add assistant message to chat
 */
export function handleAssistantMessageMessage(payload) {
	emptyState.classList.add('hidden');
	closeCurrentToolGroup();
	eventBus.emit('message:add', {
		role: 'assistant',
		content: payload.text,
		timestamp: Date.now()
	});
	setThinking(false);
}

/**
 * Handle 'reasoningMessage' message - add reasoning message to chat
 */
export function handleReasoningMessageMessage(payload) {
	emptyState.classList.add('hidden');
	eventBus.emit('message:add', {
		role: 'reasoning',
		content: payload.text,
		timestamp: Date.now()
	});
}

/**
 * Handle 'workspacePath' message - show/hide view plan button based on workspace
 */
export function handleWorkspacePathMessage(payload) {
	console.log(`[VIEW PLAN DEBUG] workspacePath message received:`, payload);
	workspacePath = payload.path; // FIX: payload has 'path' not 'workspacePath'
	console.log(`[VIEW PLAN DEBUG] Extracted path: ${workspacePath}`);
	viewPlanBtn.style.display = workspacePath ? 'inline-block' : 'none';
	console.log(`[VIEW PLAN DEBUG] Button display set to: ${viewPlanBtn.style.display}`);
}

/**
 * Handle 'activeFileChanged' message - update active file display
 */
export function handleActiveFileChangedMessage(payload) {
	if (payload.filePath) {
		focusFileInfo.textContent = payload.filePath;
		focusFileInfo.title = payload.filePath;
		focusFileInfo.style.display = 'inline';
	} else {
		focusFileInfo.style.display = 'none';
	}
}

/**
 * Handle 'clearMessages' message - clear all messages and show empty state
 */
export function handleClearMessagesMessage(payload) {
	messagesContainer.innerHTML = '';
	const emptyStateDiv = document.createElement('div');
	emptyStateDiv.className = 'empty-state';
	emptyStateDiv.id = 'emptyState';
	emptyStateDiv.innerHTML = `
		<div class="empty-state-icon" aria-hidden="true">💬</div>
		<div class="empty-state-text">
			Start a chat session to begin<br>
			Use the command palette to start the CLI
		</div>
	`;
	messagesContainer.appendChild(emptyStateDiv);
}

/**
 * Handle 'updateSessions' message - update session dropdown
 */
export function handleUpdateSessionsMessage(payload) {
	currentSessionId = payload.currentSessionId;
	sessionSelect.innerHTML = payload.sessions.map(session => 
		`<option value="${session.id}" ${session.id === currentSessionId ? 'selected' : ''}>
			${session.label}
		</option>`
	).join('');
}

/**
 * Handle 'toolStart' message - add or update tool execution display
 */
export function handleToolStartMessage(payload) {
	console.log('[Tool Start] Received payload:', payload);
	console.log('[Tool Start] payload.toolState:', payload.toolState);
	addOrUpdateTool(payload.toolState);
}

/**
 * Handle 'toolUpdate' message - update tool execution display
 */
export function handleToolUpdateMessage(payload) {
	console.log('[Tool Update] Received payload:', payload);
	console.log('[Tool Update] payload.toolState:', payload.toolState);
	addOrUpdateTool(payload.toolState);
}

/**
 * Handle 'diffAvailable' message - add diff button to tool
 */
export function handleDiffAvailableMessage(payload) {
	// Defensive: handle both payload formats
	// Sometimes RPC sends { data: {...} }, sometimes direct payload
	const data = payload.data || payload;
	
	const toolEl = messagesContainer.querySelector(`[data-tool-id="${data.toolCallId}"]`);
	if (toolEl) {
		// Get existing state or create new
		const toolState = toolEl._toolState || {
			toolCallId: data.toolCallId,
			toolName: 'edit',
			status: 'complete'
		};
		
		// Add diff data
		toolState.hasDiff = true;
		toolState.diffData = data;
		toolEl._toolState = toolState;
		
		// Re-render with diff button
		const toolHtml = buildToolHtml(toolState);
		toolEl.innerHTML = toolHtml;
		
		// Attach event listener to diff button
		const diffBtn = toolEl.querySelector('.view-diff-btn');
		if (diffBtn) {
			diffBtn.addEventListener('click', () => {
				// CRITICAL: Use extracted handler that sends FULL data
				handleDiffButtonClick(data, rpc);
			});
		}
	}
}

/**
 * Handle 'usage_info' message - update usage info display
 */
export function handleUsageInfoMessage(payload) {
	// Token usage from session.usage_info
	if (payload.data.currentTokens !== undefined && payload.data.tokenLimit !== undefined) {
		const used = payload.data.currentTokens;
		const limit = payload.data.tokenLimit;
		const usedCompact = formatCompactNumber(used);
		const windowPct = Math.round((used / limit) * 100);
		
		// Update Window percentage
		usageWindow.textContent = `Window: ${windowPct}%`;
		usageWindow.title = `context window usage: ${used.toLocaleString()} / ${limit.toLocaleString()} tokens`;
		
		// Update Used count
		usageUsed.textContent = `Used: ${usedCompact}`;
		usageUsed.title = `tokens used this session: ${used.toLocaleString()}`;
	}
	// Quota percentage from assistant.usage
	if (payload.data.remainingPercentage !== undefined) {
		const pct = Math.round(payload.data.remainingPercentage);
		usageRemaining.textContent = `Remaining: ${pct}%`;
		usageRemaining.title = `remaining requests for account: ${pct}%`;
	}
}

/**
 * Handle 'resetPlanMode' message - force reset plan mode to false
 */
export function handleResetPlanModeMessage(payload) {
	planMode = false;
	updatePlanModeUI();
	swapToRegularControls();
}

/**
 * Handle 'status' message - handle status updates including plan mode
 */
export function handleStatusMessage(payload) {
	const status = payload.data.status;
	console.log('[STATUS EVENT] Received status:', status, 'Full data:', payload.data);
	
	// Handle metrics reset
	if (payload.data.resetMetrics) {
		console.log('[METRICS] Resetting session-level metrics');
		usageWindow.textContent = 'Window: 0%';
		usageWindow.title = 'token usage in current window: 0%';
		usageUsed.textContent = 'Used: 0';
		usageUsed.title = 'tokens used this session: 0';
	}
	
	if (status === 'plan_mode_enabled') {
		console.log('[STATUS EVENT] Enabling plan mode UI');
		planMode = true;
		updatePlanModeUI();
	} else if (status === 'plan_mode_disabled' || status === 'plan_accepted' || status === 'plan_rejected') {
		console.log('[STATUS EVENT] Disabling plan mode UI, reason:', status);
		planMode = false;
		updatePlanModeUI();
		swapToRegularControls();
		
		// Show notification
		if (status === 'plan_accepted') {
			console.log('✅ Plan accepted! Ready to implement.');
		} else if (status === 'plan_rejected') {
			console.log('❌ Plan rejected. Changes discarded.');
		}
	} else if (status === 'thinking') {
		isReasoning = true;
		if (reasoningIndicator) {
			reasoningIndicator.style.display = 'inline';
		}
	} else if (status === 'ready') {
		isReasoning = false;
		if (reasoningIndicator) {
			reasoningIndicator.style.display = 'none';
		}
	} else if (status === 'plan_ready') {
		// Plan is ready for user review - show acceptance controls
		console.log('[Plan Ready] Swapping to acceptance controls');
		swapToAcceptanceControls();
	}
}

/**
 * Handle 'filesSelected' message - add files to pending attachments
 */
export function handleFilesSelectedMessage(payload) {
	console.log('[ATTACH] Received filesSelected, attachments:', payload.attachments.length);
	if (payload.attachments && payload.attachments.length > 0) {
		pendingAttachments.push(...payload.attachments);
		updateAttachmentsPreview();
		updateAttachCount();
	}
}

/**
 * Handle 'init' message - initialize webview with session state
 */
export function handleInitMessage(payload) {
	// Clear existing messages
	messagesContainer.innerHTML = '';
	const emptyStateDiv = document.createElement('div');
	emptyStateDiv.className = 'empty-state';
	emptyStateDiv.id = 'emptyState';
	emptyStateDiv.innerHTML = `
		<div class="empty-state-icon" aria-hidden="true">💬</div>
		<div class="empty-state-text">
			Start a chat session to begin<br>
			Use the command palette to start the CLI
		</div>
	`;
	messagesContainer.appendChild(emptyStateDiv);
	
	// Add messages from init
	if (payload.messages && payload.messages.length > 0) {
		emptyState.classList.add('hidden');
		for (const msg of payload.messages) {
			const role = msg.type || msg.role;
			eventBus.emit('message:add', {
				role: role,
				content: msg.content,
				timestamp: Date.now()
			});
		}
	}
	
	// Set workspace path and show/hide View Plan button
	if (payload.workspacePath) {
		workspacePath = payload.workspacePath;
		viewPlanBtn.style.display = 'inline-block';
	} else {
		workspacePath = null;
		viewPlanBtn.style.display = 'none';
	}
	
	setSessionActive(payload.sessionActive);
}

function setThinking(isThinking) {
	thinking.setAttribute('aria-busy', isThinking ? 'true' : 'false');
	
	if (isThinking) {
		thinking.classList.add('active');
		messagesContainer.scrollTop = messagesContainer.scrollHeight;
		// Change Send button to Stop button
		sendButton.textContent = 'Stop';
		sendButton.setAttribute('aria-label', 'Stop generation');
		sendButton.classList.add('stop-button');
	} else {
		thinking.classList.remove('active');
		// Change Stop button back to Send button
		sendButton.textContent = 'Send';
		sendButton.setAttribute('aria-label', 'Send message');
		sendButton.classList.remove('stop-button');
	}
}

function formatCompactNumber(num) {
	if (num >= 1000000000) {
		return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'b';
	}
	if (num >= 1000000) {
		return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
	}
	if (num >= 1000) {
		return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
	}
	return num.toString();
}

// Handle messages from extension

// ========================================================================
// RPC Message Handlers (Extension → Webview)
// ========================================================================

// Wire up message handlers to RPC client
rpc.onThinking(handleThinkingMessage);
rpc.onSessionStatus(handleSessionStatusMessage);
rpc.onAppendMessage(handleAppendMessageMessage);
rpc.onUserMessage(handleUserMessageMessage);
rpc.onAssistantMessage(handleAssistantMessageMessage);
rpc.onReasoningMessage(handleReasoningMessageMessage);
rpc.onWorkspacePath(handleWorkspacePathMessage);
rpc.onActiveFileChanged(handleActiveFileChangedMessage);
rpc.onClearMessages(handleClearMessagesMessage);
rpc.onUpdateSessions(handleUpdateSessionsMessage);
rpc.onToolStart(handleToolStartMessage);
rpc.onToolUpdate(handleToolUpdateMessage);
rpc.onDiffAvailable(handleDiffAvailableMessage);
rpc.onUsageInfo(handleUsageInfoMessage);
rpc.onResetPlanMode(handleResetPlanModeMessage);
rpc.onStatus(handleStatusMessage);
rpc.onFilesSelected(handleFilesSelectedMessage);
rpc.onInit(handleInitMessage);

// Notify extension that webview is ready
rpc.ready();
