// Import RPC client for type-safe messaging
import { WebviewRpcClient } from './app/rpc/WebviewRpcClient.js';
// Import EventBus and components
import { EventBus } from './app/state/EventBus.js';
import { MessageDisplay } from './app/components/MessageDisplay/MessageDisplay.js';
import { ToolExecution } from './app/components/ToolExecution/ToolExecution.js';
import { InputArea } from './app/components/InputArea/InputArea.js';
import { SessionToolbar } from './app/components/SessionToolbar/SessionToolbar.js';
import { AcceptanceControls } from './app/components/AcceptanceControls/AcceptanceControls.js';
import { StatusBar } from './app/components/StatusBar/StatusBar.js';
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

let sessionActive = false;
let currentSessionId = null;
let showReasoning = false;
let planMode = false;
let planReady = false;
let workspacePath = null;
let isReasoning = false;

// Create EventBus for component communication
const eventBus = new EventBus();

// Initialize components
const messagesContainer = document.getElementById('messages-mount');
const messageDisplay = new MessageDisplay(messagesContainer, eventBus);
const toolExecution = new ToolExecution(messagesContainer, eventBus);
const inputAreaContainer = document.getElementById('input-mount');
const inputArea = new InputArea(inputAreaContainer, eventBus);

// Initialize SessionToolbar component
const sessionToolbarContainer = document.getElementById('session-toolbar-mount');
const sessionToolbar = new SessionToolbar(sessionToolbarContainer);

// Initialize AcceptanceControls component
const acceptanceControlsContainer = document.getElementById('acceptance-mount');
const acceptanceControls = new AcceptanceControls(acceptanceControlsContainer);

// StatusBar component REMOVED - functionality moved to InputArea
// const statusBarContainer = document.querySelector('.status-bar, .input-controls') || document.createElement('div');
// const statusBar = new StatusBar(statusBarContainer);

// ============================================================================
// Component Event Wiring
// ============================================================================

// SessionToolbar events
sessionToolbar.on('switchSession', (sessionId) => {
	currentSessionId = handleSessionChange(sessionId, currentSessionId, rpc);
});

sessionToolbar.on('newSession', () => {
	handleNewSession(rpc);
});

sessionToolbar.on('viewPlan', () => {
	handleViewPlan(rpc);
});

sessionToolbar.on('togglePlanMode', () => {
	planMode = handleEnterPlanMode(rpc, updatePlanModeUI);
});

sessionToolbar.on('acceptPlan', () => {
	handleAcceptPlan(rpc);
});

sessionToolbar.on('rejectPlan', () => {
	handleRejectPlan(rpc);
});

// AcceptanceControls events
acceptanceControls.on('accept', (value) => {
	handleAcceptAndWork(rpc, () => {
		acceptanceControls.hide();
		acceptanceControls.clear();
	});
});

acceptanceControls.on('reject', (value) => {
	handleKeepPlanning(() => {
		acceptanceControls.hide();
		acceptanceControls.clear();
	});
});

acceptanceControls.on('swap', () => {
	// Swap logic - emit to RPC if needed
	console.log('[Swap] Swap original/modified requested');
});

// StatusBar events (commented out - StatusBar doesn't have reasoning toggle yet)
// statusBar.on('reasoningToggle', (checked) => {
// 	showReasoning = handleReasoningToggle(checked, messagesContainer);
// 	eventBus.emit('reasoning:toggle', checked);
// });

// Listen for viewDiff events from ToolExecution component
eventBus.on('viewDiff', (diffData) => {
	rpc.viewDiff(diffData);
});

// Listen for plan mode events from InputArea component
eventBus.on('enterPlanMode', () => {
	console.log('[Plan Mode] Enter plan mode from InputArea');
	planMode = handleEnterPlanMode(rpc, updatePlanModeUI);
});

eventBus.on('acceptPlan', () => {
	console.log('[Plan Mode] Accept plan from InputArea');
	handleAcceptPlan(rpc);
});

eventBus.on('rejectPlan', () => {
	console.log('[Plan Mode] Reject plan from InputArea');
	handleRejectPlan(rpc);
});

eventBus.on('exitPlanMode', () => {
	console.log('[Plan Mode] Exit plan mode (silent)');
	// Silent exit - just toggle plan mode off, no message sent
	rpc.togglePlanMode();
});

// Listen for new slash command events
eventBus.on('showPlanContent', () => {
	console.log('[Slash Command] Show plan content (/review)');
	rpc.showPlanContent();
});

eventBus.on('openDiffView', (args) => {
	console.log('[Slash Command] Open diff view (/diff)', args);
	if (args && args.length >= 2) {
		rpc.openDiffView(args[0], args[1]);
	} else {
		console.error('[Slash Command] /diff requires two file arguments');
	}
});

eventBus.on('showMcpConfig', () => {
	console.log('[Slash Command] Show MCP config (/mcp)');
	rpc.showMcpConfig();
});

eventBus.on('showUsageMetrics', () => {
	console.log('[Slash Command] Show usage metrics (/usage)');
	rpc.showUsageMetrics();
});

eventBus.on('showHelp', (args) => {
	console.log('[Slash Command] Show help (/help)', args);
	const command = args && args.length > 0 ? args[0] : undefined;
	rpc.showHelp(command);
});

eventBus.on('showNotSupported', (args) => {
	console.log('[Slash Command] Not supported command', args);
	const command = args && args.length > 0 ? args.join(' ') : 'unknown';
	rpc.showNotSupported(command);
});

eventBus.on('openInCLI', (args) => {
	console.log('[Slash Command] Open in CLI (passthrough)', args);
	const command = args && args.length > 0 ? `/${args.join(' ')}` : '';
	rpc.openInCLI(command);
});

// Listen for input:sendMessage events from InputArea component
eventBus.on('input:sendMessage', (data) => {
	console.log('[SEND] sendMessage event from InputArea:', data.text.substring(0, 50));
	rpc.sendMessage(data.text, data.attachments.length > 0 ? data.attachments : undefined);
});

// Listen for input:abort events from InputArea component
eventBus.on('input:abort', () => {
	console.log('[ABORT] Aborting current generation');
	rpc.abortMessage();
});

// Listen for input:attachFiles events from InputArea component
eventBus.on('input:attachFiles', () => {
	console.log('[ATTACH] Attach files requested');
	rpc.pickFiles();
});

// Listen for viewDiff events from ToolExecution component (duplicate removed)

// UI update functions (now using components)
function updatePlanModeUI() {
	console.log('[updatePlanModeUI] Called with planMode =', planMode);
	sessionToolbar.setPlanMode(planMode);
	inputArea.setPlanMode(planMode, planReady);
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
	
	const statusText = active ? 'Connected to Copilot CLI' : 'Disconnected';
	statusIndicator.setAttribute('aria-label', statusText);
	
	if (active) {
		statusIndicator.classList.add('active');
	} else {
		statusIndicator.classList.remove('active');
	}

	// Emit event for InputArea component
	eventBus.emit('session:active', active);
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
	// MessageDisplay handles empty state via EventBus
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
	// MessageDisplay handles empty state via EventBus
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
	// MessageDisplay handles empty state via EventBus
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
	sessionToolbar.setPlanFileExists(workspacePath);
	console.log(`[VIEW PLAN DEBUG] SessionToolbar plan file state set: ${!!workspacePath}`);
}

/**
 * Handle 'activeFileChanged' message - update active file display
 */
export function handleActiveFileChangedMessage(payload) {
	// Delegate to InputArea component
	inputArea.updateFocusFile(payload.filePath);
}

/**
 * Handle 'clearMessages' message - clear all messages and show empty state
 */
export function handleClearMessagesMessage(payload) {
	// Delegate to MessageDisplay component
	messageDisplay.clear();
}

/**
 * Handle 'updateSessions' message - update session dropdown
 */
export function handleUpdateSessionsMessage(payload) {
	currentSessionId = payload.currentSessionId;
	sessionToolbar.updateSessions(payload.sessions, currentSessionId);
}

/**
 * Handle 'toolStart' message - add or update tool execution display
 */
export function handleToolStartMessage(payload) {
	console.log('[Tool Start] Received payload:', payload);
	console.log('[Tool Start] payload.toolState:', payload.toolState);
	eventBus.emit('tool:start', payload.toolState);
}

/**
 * Handle 'toolUpdate' message - update tool execution display
 */
export function handleToolUpdateMessage(payload) {
	console.log('[Tool Update] Received payload:', payload);
	console.log('[Tool Update] payload.toolState:', payload.toolState);
	
	// Emit appropriate event based on status
	if (payload.toolState.status === 'complete' || payload.toolState.status === 'failed') {
		eventBus.emit('tool:complete', payload.toolState);
	} else if (payload.toolState.progress) {
		eventBus.emit('tool:progress', payload.toolState);
	} else {
		eventBus.emit('tool:start', payload.toolState);
	}
}

/**
 * Handle 'diffAvailable' message - notify ToolExecution component
 */
export function handleDiffAvailableMessage(payload) {
	// Defensive: handle both payload formats
	const data = payload.data || payload;

	// Emit event to update existing tool with diff button + inline diff lines
	eventBus.emit('tool:complete', {
		toolCallId: data.toolCallId,
		hasDiff: true,
		diffData: data,
		diffLines: data.diffLines,
		diffTruncated: data.diffTruncated,
		diffTotalLines: data.diffTotalLines
	});
}

/**
 * Handle 'usage_info' message - update usage info display
 */
export function handleUsageInfoMessage(payload) {
	// Token usage from session.usage_info
	if (payload.data.currentTokens !== undefined && payload.data.tokenLimit !== undefined) {
		const used = payload.data.currentTokens;
		const limit = payload.data.tokenLimit;
		const windowPct = Math.round((used / limit) * 100);
		
		// Update metrics via InputArea (which contains StatusBar)
		inputArea.updateUsageWindow(windowPct, used, limit);
		inputArea.updateUsageUsed(used);
	}
	// Quota percentage from assistant.usage
	if (payload.data.remainingPercentage !== undefined) {
		const pct = Math.round(payload.data.remainingPercentage);
		inputArea.updateUsageRemaining(pct);
	}
}

/**
 * Handle 'resetPlanMode' message - force reset plan mode to false
 */
export function handleResetPlanModeMessage(payload) {
	planMode = false;
	updatePlanModeUI();
	acceptanceControls.hide();
	acceptanceControls.clear();
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
		// statusBar.updateUsageWindow(0, 0, 1);
		// statusBar.updateUsageUsed(0);
	}
	
	if (status === 'plan_mode_enabled') {
		console.log('[STATUS EVENT] Enabling plan mode UI');
		planMode = true;
		planReady = false;
		updatePlanModeUI();
		// Show acceptance controls when entering plan mode
		acceptanceControls.show();
	} else if (status === 'plan_mode_disabled' || status === 'plan_accepted' || status === 'plan_rejected') {
		console.log('[STATUS EVENT] Disabling plan mode UI, reason:', status);
		planMode = false;
		planReady = false;
		updatePlanModeUI();
		acceptanceControls.hide();
		acceptanceControls.clear();
		
		// Show notification
		if (status === 'plan_accepted') {
			console.log('✅ Plan accepted! Ready to implement.');
		} else if (status === 'plan_rejected') {
			console.log('❌ Plan rejected. Changes discarded.');
		}
	} else if (status === 'thinking') {
		isReasoning = true;
		// statusBar.showReasoning();
	} else if (status === 'ready') {
		isReasoning = false;
		// statusBar.hideReasoning();
	} else if (status === 'plan_ready') {
		// Plan is ready for user review - show acceptance controls
		console.log('[Plan Ready] Showing acceptance controls');
		planReady = true;
		inputArea.setPlanMode(planMode, true);
		acceptanceControls.show();
		acceptanceControls.focus();
	}
}

/**
 * Handle 'filesSelected' message - add files to pending attachments
 */
export function handleFilesSelectedMessage(payload) {
	console.log('[ATTACH] Received filesSelected, attachments:', payload.attachments.length);
	// Delegate to InputArea component
	inputArea.addAttachments(payload.attachments);
}

/**
 * Handle 'init' message - initialize webview with session state
 */
export function handleInitMessage(payload) {
	// Clear messages via MessageDisplay
	messageDisplay.clear();

	// Add messages from init
	if (payload.messages && payload.messages.length > 0) {
		// MessageDisplay handles hiding empty state via EventBus
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
		sessionToolbar.setPlanFileExists(workspacePath);
	} else {
		workspacePath = null;
		sessionToolbar.setPlanFileExists(null);
	}
	
	setSessionActive(payload.sessionActive);
}

function setThinking(isThinking) {
	thinking.setAttribute('aria-busy', isThinking ? 'true' : 'false');
	
	if (isThinking) {
		thinking.classList.add('active');
		messagesContainer.scrollTop = messagesContainer.scrollHeight;
	} else {
		thinking.classList.remove('active');
	}

	// Emit event for InputArea component to update send/stop button
	eventBus.emit('session:thinking', isThinking);
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

// Notify extension that webview is ready (skip in test mode)
if (typeof window !== 'undefined' && !window.__TESTING__) {
	rpc.ready();
}

// Export instances for testing
export const __testExports = {
	eventBus,
	messageDisplay,
	toolExecution,
	inputArea,
	sessionToolbar,
	acceptanceControls,
	handleStatusMessage,
	handleUsageInfoMessage
};
