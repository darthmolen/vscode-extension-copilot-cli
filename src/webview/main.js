// Import RPC client for type-safe messaging
import { WebviewRpcClient } from '../app/rpc/WebviewRpcClient.js';

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
	showReasoning = e.target.checked;
	// Toggle visibility of existing reasoning messages
	document.querySelectorAll('.message.reasoning').forEach(msg => {
		msg.style.display = showReasoning ? 'block' : 'none';
	});
});

// Session selector change handler
sessionSelect.addEventListener('change', (e) => {
	const selectedSessionId = e.target.value;
	if (selectedSessionId && selectedSessionId !== currentSessionId) {
		rpc.switchSession(selectedSessionId);
	}
});

// New session button handler
newSessionBtn.addEventListener('click', () => {
	rpc.newSession();
});

// View plan button handler
viewPlanBtn.addEventListener('click', () => {
	rpc.viewPlan();
});

// Plan mode button handlers
enterPlanModeBtn.addEventListener('click', () => {
	console.log('[Plan Mode] Entering plan mode');
	planMode = true;
	rpc.togglePlanMode(true);
	updatePlanModeUI();
});

acceptPlanBtn.addEventListener('click', () => {
	console.log('[Plan Mode] Accepting plan');
	rpc.acceptPlan();
});

rejectPlanBtn.addEventListener('click', () => {
	console.log('[Plan Mode] Rejecting plan');
	rpc.rejectPlan();
});

// Acceptance control handlers
acceptAndWorkBtn.addEventListener('click', () => {
	console.log('[Acceptance] Accept and work');
	rpc.acceptPlan();
	swapToRegularControls();
});

keepPlanningBtn.addEventListener('click', () => {
	console.log('[Acceptance] Keep planning');
	swapToRegularControls();
});

acceptanceInput.addEventListener('keydown', (e) => {
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault();
		const instructions = acceptanceInput.value.trim();
		if (instructions) {
			console.log('[Acceptance] Sending alternative instructions:', instructions);
			rpc.sendMessage(instructions);
			acceptanceInput.value = '';
			swapToRegularControls();
		}
	} else if (e.key === 'Escape') {
		swapToRegularControls();
	}
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
	messageInput.style.height = 'auto';
	messageInput.style.height = messageInput.scrollHeight + 'px';
});

// Send message on button click (or abort if thinking)
sendButton.addEventListener('click', () => {
	if (sendButton.classList.contains('stop-button')) {
		// Abort current generation
		rpc.abortMessage();
	} else {
		// Send message
		sendMessage();
	}
});

// Attach button click handler
attachButton.addEventListener('click', () => {
	rpc.pickFiles();
});

// Send message on Enter (Shift+Enter for newline)
// Arrow keys for history navigation
messageInput.addEventListener('keydown', (e) => {
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	} else if (e.key === 'ArrowUp') {
		e.preventDefault();
		navigateHistory('up');
	} else if (e.key === 'ArrowDown') {
		e.preventDefault();
		navigateHistory('down');
	}
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

function escapeHtml(unsafe) {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
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

function addMessage(role, text, attachments) {
	emptyState.classList.add('hidden');
	
	// Close current tool group when user sends a message OR when assistant responds
	if (role === 'user' || role === 'assistant') {
		closeCurrentToolGroup();
	}
	
	const messageDiv = document.createElement('div');
	messageDiv.className = `message ${role}`;
	messageDiv.setAttribute('role', 'article');
	
	// Handle different message types
	if (role === 'reasoning') {
		messageDiv.setAttribute('aria-label', 'Assistant reasoning');
		messageDiv.style.display = showReasoning ? 'block' : 'none';
		messageDiv.innerHTML = `
			<div class="message-header" style="font-style: italic;">Assistant Reasoning</div>
			<div class="message-content" style="font-style: italic;">${escapeHtml(text)}</div>
		`;
	} else {
		messageDiv.setAttribute('aria-label', `${role === 'user' ? 'Your' : 'Assistant'} message`);
		// Use marked for assistant messages, plain text for user
		const content = role === 'assistant' ? marked.parse(text) : escapeHtml(text);
		
		// Build attachments HTML if present
		let attachmentsHtml = '';
		if (attachments && attachments.length > 0) {
			attachmentsHtml = '<div class="message-attachments">' + 
				attachments.map(att => `
					<div class="message-attachment">
						${att.webviewUri ? `<img src="${att.webviewUri}" alt="${att.displayName}" class="message-attachment-image" />` : ''}
						<div class="message-attachment-name">📎 ${att.displayName}</div>
					</div>
				`).join('') +
				'</div>';
		}
		
		messageDiv.innerHTML = `
			<div class="message-header">${role === 'user' ? 'You' : 'Assistant'}</div>
			<div class="message-content">
				${content}
				${attachmentsHtml}
			</div>
		`;
	}
	
	messagesContainer.appendChild(messageDiv);
	messagesContainer.scrollTop = messagesContainer.scrollHeight;
	
	// Announce new message to screen readers
	messageInput.focus();
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
			toolGroupExpanded = !toolGroupExpanded;
			if (toolGroupExpanded) {
				container.classList.add('expanded');
				toggle.textContent = 'Contract';
			} else {
				container.classList.remove('expanded');
				const hiddenCount = element.querySelectorAll('.tool-execution').length - Math.floor(200 / 70);
				toggle.textContent = `Expand (${Math.max(1, hiddenCount)} more)`;
			}
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
window.addEventListener('message', event => {
	const message = event.data;
	
	switch (message.type) {
		case 'init': {
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
			if (message.messages && message.messages.length > 0) {
				for (const msg of message.messages) {
					const role = msg.type || msg.role;
					addMessage(role, msg.content);
				}
			}
			
			setSessionActive(message.sessionActive);
			break;
		}
		case 'filesSelected': {
			// Add selected files to pending attachments
			console.log('[ATTACH] Received filesSelected, attachments:', message.attachments.length);
			if (message.attachments && message.attachments.length > 0) {
				pendingAttachments.push(...message.attachments);
				updateAttachmentsPreview();
				updateAttachCount();
			}
			break;
		}
		case 'userMessage':
			addMessage('user', message.text, message.attachments);
			break;
		case 'assistantMessage':
			addMessage('assistant', message.text);
			setThinking(false);
			break;
		case 'reasoningMessage':
			addMessage('reasoning', message.text);
			break;
		case 'appendMessage':
			appendToLastMessage(message.text);
			break;
		case 'sessionStatus':
			setSessionActive(message.active);
			break;
		case 'thinking':
			setThinking(message.isThinking);
			break;
		case 'clearMessages': {
			// Clear all messages except empty state
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
			break;
		}
		case 'updateSessions':
			// Update session dropdown
			currentSessionId = message.currentSessionId;
			sessionSelect.innerHTML = message.sessions.map(session => 
				`<option value="${session.id}" ${session.id === currentSessionId ? 'selected' : ''}>
					${session.label}
				</option>`
			).join('');
			break;
		case 'workspacePath':
			// Show/hide view plan button based on workspace path availability
			workspacePath = message.workspacePath;
			viewPlanBtn.style.display = workspacePath ? 'inline-block' : 'none';
			break;
		case 'activeFileChanged':
			// Update active file display - just show/hide the filename, label stays
			if (message.filePath) {
				focusFileInfo.textContent = message.filePath;
				focusFileInfo.title = message.filePath;
				focusFileInfo.style.display = 'inline';
			} else {
				focusFileInfo.style.display = 'none';
			}
			break;
		case 'toolStart':
			addOrUpdateTool(message.tool);
			break;
		case 'toolUpdate':
			addOrUpdateTool(message.tool);
			break;
		case 'diffAvailable':
			// Update the tool to show diff button
			const toolEl = messagesContainer.querySelector(`[data-tool-id="${message.data.toolCallId}"]`);
			if (toolEl) {
				// Get existing state or create new
				const toolState = toolEl._toolState || {
					toolCallId: message.data.toolCallId,
					toolName: 'edit',
					status: 'complete'
				};
				
				// Add diff data
				toolState.hasDiff = true;
				toolState.diffData = message.data;
				toolEl._toolState = toolState;
				
				// Re-render with diff button
				const toolHtml = buildToolHtml(toolState);
				toolEl.innerHTML = toolHtml;
				
				// Attach event listener to diff button
				const diffBtn = toolEl.querySelector('.view-diff-btn');
				if (diffBtn) {
					diffBtn.addEventListener('click', () => {
						rpc.viewDiff(message.data);
					});
				}
			}
			break;
		case 'usage_info':
			// Update usage info display
			// This can come from session.usage_info (tokens) or assistant.usage (quota %)
			if (message.data.currentTokens !== undefined && message.data.tokenLimit !== undefined) {
				// Token usage from session.usage_info
				const used = message.data.currentTokens;
				const limit = message.data.tokenLimit;
				const usedCompact = formatCompactNumber(used);
				const windowPct = Math.round((used / limit) * 100);
				
				// Update Window percentage
				usageWindow.textContent = `Window: ${windowPct}%`;
				usageWindow.title = `context window usage: ${used.toLocaleString()} / ${limit.toLocaleString()} tokens`;
				
				// Update Used count
				usageUsed.textContent = `Used: ${usedCompact}`;
				usageUsed.title = `tokens used this session: ${used.toLocaleString()}`;
			}
			if (message.data.remainingPercentage !== undefined) {
				// Quota percentage from assistant.usage
				const pct = Math.round(message.data.remainingPercentage);
				usageRemaining.textContent = `Remaining: ${pct}%`;
				usageRemaining.title = `remaining requests for account: ${pct}%`;
			}
			break;
		case 'resetPlanMode':
			// Force reset plan mode to false
			planMode = false;
			updatePlanModeUI();
			swapToRegularControls();
			break;
		case 'status':
			// Handle status updates including plan mode
			const status = message.data.status;
			console.log('[STATUS EVENT] Received status:', status, 'Full data:', message.data);
			
			// Handle metrics reset
			if (message.data.resetMetrics) {
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
			break;
	}
});

// ========================================================================
// RPC Message Handlers (Extension → Webview)
// ========================================================================

// Forward RPC messages to existing window.addEventListener handler
// This maintains backwards compatibility during migration
function simulateMessageEvent(payload) {
	window.dispatchEvent(new MessageEvent('message', { data: payload }));
}

rpc.onInit((payload) => simulateMessageEvent(payload));
rpc.onUserMessage((payload) => simulateMessageEvent(payload));
rpc.onAssistantMessage((payload) => simulateMessageEvent(payload));
rpc.onReasoningMessage((payload) => simulateMessageEvent(payload));
rpc.onToolStart((payload) => simulateMessageEvent(payload));
rpc.onToolUpdate((payload) => simulateMessageEvent(payload));
rpc.onStreamChunk((payload) => simulateMessageEvent(payload));
rpc.onStreamEnd((payload) => simulateMessageEvent(payload));
rpc.onClearMessages((payload) => simulateMessageEvent(payload));
rpc.onSessionStatus((payload) => simulateMessageEvent(payload));
rpc.onUpdateSessions((payload) => simulateMessageEvent(payload));
rpc.onThinking((payload) => simulateMessageEvent(payload));
rpc.onResetPlanMode((payload) => simulateMessageEvent(payload));
rpc.onWorkspacePath((payload) => simulateMessageEvent(payload));
rpc.onActiveFileChanged((payload) => simulateMessageEvent(payload));
rpc.onDiffAvailable((payload) => simulateMessageEvent(payload));
rpc.onAppendMessage((payload) => simulateMessageEvent(payload));
rpc.onAttachmentValidation((payload) => simulateMessageEvent(payload));
rpc.onStatus((payload) => simulateMessageEvent(payload));
rpc.onUsageInfo((payload) => simulateMessageEvent(payload));

// Notify extension that webview is ready
rpc.ready();
