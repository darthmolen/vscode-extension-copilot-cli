import * as vscode from 'vscode';
import { Logger } from './logger';

export class ChatPanelProvider {
	private static panel: vscode.WebviewPanel | undefined;
	private static logger: Logger;
	private static messageHandlers: Set<(message: string) => void> = new Set();
	private static onViewOpenedHandlers: Set<() => void> = new Set();
	private static isSessionActive: boolean = false;
	private static currentWorkspacePath: string | undefined;
	private static viewPlanHandlers: Set<() => void> = new Set();
	private static lastSentMessage: string | undefined;
	private static lastSentTime: number = 0;

	public static createOrShow(extensionUri: vscode.Uri) {
		this.logger = Logger.getInstance();
		const column = vscode.ViewColumn.Two; // Open in second column (right side)

		// If we already have a panel, show it
		if (ChatPanelProvider.panel) {
			ChatPanelProvider.panel.reveal(column);
			return;
		}

		// Otherwise, create a new panel
		ChatPanelProvider.panel = vscode.window.createWebviewPanel(
			'copilotCLIChat',
			'Copilot CLI',
			column,
			{
				enableScripts: true,
				localResourceRoots: [extensionUri],
				retainContextWhenHidden: true
			}
		);

		ChatPanelProvider.panel.webview.html = ChatPanelProvider.getHtmlForWebview(ChatPanelProvider.panel.webview);

		// Handle messages from the webview
		ChatPanelProvider.panel.webview.onDidReceiveMessage(data => {
			this.logger.debug(`[Webview Message] ${data.type}`);
			switch (data.type) {
				case 'sendMessage':
					// Prevent duplicate sends (same message within 1 second)
					const now = Date.now();
					if (ChatPanelProvider.lastSentMessage === data.value && 
					    now - ChatPanelProvider.lastSentTime < 1000) {
						this.logger.warn(`Ignoring duplicate message send: ${data.value.substring(0, 50)}...`);
						return;
					}
					ChatPanelProvider.lastSentMessage = data.value;
					ChatPanelProvider.lastSentTime = now;
					
					this.logger.info(`User sent message: ${data.value}`);
					this.messageHandlers.forEach(handler => handler(data.value));
					break;
				case 'ready':
					this.logger.info('Webview is ready');
					ChatPanelProvider.postMessage({ type: 'init', sessionActive: ChatPanelProvider.isSessionActive });
					this.onViewOpenedHandlers.forEach(handler => handler());
					break;
				case 'switchSession':
					this.logger.info(`Switch session requested: ${data.sessionId}`);
					vscode.commands.executeCommand('copilot-cli-extension.switchSession', data.sessionId);
					break;
				case 'newSession':
					this.logger.info('New session requested from UI');
					vscode.commands.executeCommand('copilot-cli-extension.newSession');
					break;
				case 'viewPlan':
					this.logger.info('View plan requested from UI');
					this.viewPlanHandlers.forEach(handler => handler());
					break;
				case 'viewDiff':
					this.logger.info(`View diff requested from UI: ${JSON.stringify(data)}`);
					vscode.commands.executeCommand('copilot-cli-extension.viewDiff', data);
					break;
			}
		});

		// Reset when the panel is closed
		ChatPanelProvider.panel.onDidDispose(() => {
			ChatPanelProvider.panel = undefined;
		});

		this.logger.info('✅ Chat panel created');
	}

	public static postMessage(message: any) {
		if (ChatPanelProvider.panel) {
			ChatPanelProvider.panel.webview.postMessage(message);
		}
	}

	public static addUserMessage(text: string) {
		ChatPanelProvider.postMessage({ type: 'userMessage', text });
	}

	public static addAssistantMessage(text: string) {
		ChatPanelProvider.postMessage({ type: 'assistantMessage', text });
	}

	public static addReasoningMessage(text: string) {
		ChatPanelProvider.postMessage({ type: 'reasoningMessage', text });
	}

	public static addToolExecution(toolState: any) {
		ChatPanelProvider.postMessage({ type: 'toolStart', tool: toolState });
	}

	public static updateToolExecution(toolState: any) {
		ChatPanelProvider.postMessage({ type: 'toolUpdate', tool: toolState });
	}
	
	public static notifyDiffAvailable(data: any) {
		ChatPanelProvider.postMessage({ type: 'diffAvailable', data });
	}


	public static appendToLastMessage(text: string) {
		ChatPanelProvider.postMessage({ type: 'appendMessage', text });
	}

	public static setSessionActive(active: boolean) {
		ChatPanelProvider.isSessionActive = active;
		ChatPanelProvider.postMessage({ type: 'sessionStatus', active });
	}

	public static setThinking(isThinking: boolean) {
		ChatPanelProvider.postMessage({ type: 'thinking', isThinking });
	}

	public static clearMessages() {
		ChatPanelProvider.postMessage({ type: 'clearMessages' });
	}

	public static updateSessions(sessions: Array<{id: string, label: string}>, currentSessionId: string | null) {
		ChatPanelProvider.postMessage({ 
			type: 'updateSessions', 
			sessions,
			currentSessionId 
		});
	}

	public static setWorkspacePath(workspacePath: string | undefined) {
		ChatPanelProvider.currentWorkspacePath = workspacePath;
		ChatPanelProvider.postMessage({ type: 'workspacePath', workspacePath });
	}

	public static onUserMessage(handler: (message: string) => void) {
		// Clear any existing handlers to prevent duplicates if extension re-activates
		if (ChatPanelProvider.messageHandlers.size > 0) {
			this.logger?.warn(`Clearing ${ChatPanelProvider.messageHandlers.size} existing message handlers`);
			ChatPanelProvider.messageHandlers.clear();
		}
		ChatPanelProvider.messageHandlers.add(handler);
		this.logger?.info(`Message handler registered (total: ${ChatPanelProvider.messageHandlers.size})`);
	}

	public static onViewOpened(handler: () => void) {
		ChatPanelProvider.onViewOpenedHandlers.add(handler);
	}

	public static onViewPlan(handler: () => void) {
		ChatPanelProvider.viewPlanHandlers.add(handler);
	}

	public static forceRecreate(extensionUri: vscode.Uri) {
		// Dispose existing panel if it exists
		if (ChatPanelProvider.panel) {
			ChatPanelProvider.panel.dispose();
			ChatPanelProvider.panel = undefined;
		}
		// Recreate with fresh HTML
		ChatPanelProvider.createOrShow(extensionUri);
	}

	private static getHtmlForWebview(webview: vscode.Webview) {
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net;">
	<title>Copilot CLI Chat</title>
	<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
	<style>
		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}

		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background-color: var(--vscode-sideBar-background);
			display: flex;
			flex-direction: column;
			height: 100vh;
			overflow: hidden;
		}

		.header {
			padding: 12px 16px;
			border-bottom: 1px solid var(--vscode-panel-border);
			background-color: var(--vscode-sideBarSectionHeader-background);
			display: flex;
			align-items: center;
			gap: 12px;
		}

		.header h2 {
			font-size: 13px;
			font-weight: 600;
			flex: 1;
		}

		.session-selector {
			display: flex;
			align-items: center;
			gap: 6px;
			font-size: 11px;
		}

		.session-selector label {
			color: var(--vscode-descriptionForeground);
		}

		.session-selector select {
			background-color: var(--vscode-dropdown-background);
			color: var(--vscode-dropdown-foreground);
			border: 1px solid var(--vscode-dropdown-border);
			padding: 2px 6px;
			border-radius: 2px;
			font-size: 11px;
			cursor: pointer;
			min-width: 120px;
		}

		.session-selector select:focus {
			outline: 1px solid var(--vscode-focusBorder);
		}

		.new-session-btn {
			background-color: transparent;
			color: var(--vscode-foreground);
			border: 1px solid var(--vscode-dropdown-border);
			padding: 2px 6px;
			border-radius: 2px;
			cursor: pointer;
			font-size: 14px;
			line-height: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 24px;
			height: 20px;
		}

		.new-session-btn:hover {
			background-color: var(--vscode-toolbar-hoverBackground);
		}

		.new-session-btn:active {
			background-color: var(--vscode-toolbar-activeBackground);
		}

		.status-indicator {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background-color: var(--vscode-testing-iconFailed);
		}

		.status-indicator.active {
			background-color: var(--vscode-testing-iconPassed);
		}

		main {
			flex: 1;
			display: flex;
			flex-direction: column;
			overflow: hidden;
			min-height: 0;
		}

		.messages {
			flex: 1;
			overflow-y: auto;
			padding: 16px;
			display: flex;
			flex-direction: column;
			gap: 16px;
		}

		.message {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.message-header {
			font-size: 11px;
			font-weight: 600;
			opacity: 0.8;
			text-transform: uppercase;
		}

		.message.user .message-header {
			color: var(--vscode-terminal-ansiBlue);
		}

		.message.assistant .message-header {
			color: var(--vscode-terminal-ansiGreen);
		}

		.message-content {
			padding: 10px 12px;
			border-radius: 6px;
			background-color: var(--vscode-editor-background);
			border: 1px solid var(--vscode-panel-border);
			line-height: 1.6;
		}
		
		/* Markdown styling */
		.message-content pre {
			background-color: var(--vscode-textCodeBlock-background);
			padding: 8px 12px;
			border-radius: 4px;
			overflow-x: auto;
			margin: 8px 0;
		}
		
		.message-content code {
			background-color: var(--vscode-textCodeBlock-background);
			padding: 2px 4px;
			border-radius: 3px;
			font-family: var(--vscode-editor-font-family);
			font-size: 0.9em;
		}
		
		.message-content pre code {
			background: none;
			padding: 0;
		}
		
		.message-content p {
			margin: 8px 0;
		}
		
		.message-content p:first-child {
			margin-top: 0;
		}
		
		.message-content p:last-child {
			margin-bottom: 0;
		}
		
		.message-content ul, .message-content ol {
			margin: 8px 0;
			padding-left: 24px;
		}
		
		.message-content li {
			margin: 4px 0;
		}
		
		.message-content h1, .message-content h2, .message-content h3 {
			margin: 12px 0 8px 0;
			font-weight: 600;
		}
		
		.message-content h1 { font-size: 1.4em; }
		.message-content h2 { font-size: 1.2em; }
		.message-content h3 { font-size: 1.1em; }
		
		.message-content blockquote {
			border-left: 3px solid var(--vscode-textBlockQuote-border);
			background: var(--vscode-textBlockQuote-background);
			padding: 8px 12px;
			margin: 8px 0;
		}
		
		.message-content a {
			color: var(--vscode-textLink-foreground);
			text-decoration: none;
		}
		
		.message-content a:hover {
			text-decoration: underline;
		}
		
		.message-content hr {
			border: none;
			border-top: 1px solid var(--vscode-panel-border);
			margin: 16px 0;
		}
		
		.message-content strong {
			font-weight: 600;
		}
		
		.message-content em {
			font-style: italic;
		}

		.message.user .message-content {
			border-left: 3px solid var(--vscode-terminal-ansiBlue);
		}

		.message.assistant .message-content {
			border-left: 3px solid var(--vscode-terminal-ansiGreen);
		}

		.tool-executions {
			margin-top: 12px;
			padding: 8px 12px;
			background: var(--vscode-editorWidget-background);
			border-radius: 4px;
			font-size: 0.9em;
			max-width: 600px;
			border: 1px solid var(--vscode-editorWidget-border);
		}

		.tool-executions-header {
			font-size: 0.85em;
			color: var(--vscode-descriptionForeground);
			margin-bottom: 6px;
			font-weight: 500;
		}

		.tool-message {
			padding: 8px 12px;
			margin: 8px 0;
			background: var(--vscode-editorWidget-background);
			border-radius: 4px;
			border-left: 3px solid var(--vscode-charts-blue);
			max-width: 600px;
		}

		.tool-execution {
			padding: 6px 0;
			border-bottom: 1px solid var(--vscode-widget-border);
		}

		.tool-message .tool-execution {
			padding: 0;
			border-bottom: none;
		}

		.tool-execution:last-child {
			border-bottom: none;
			padding-bottom: 0;
		}

		.tool-header {
			display: flex;
			align-items: center;
			gap: 6px;
			font-size: 0.95em;
			flex-wrap: wrap;
		}

		.tool-icon {
			font-size: 14px;
			flex-shrink: 0;
		}

		.tool-name {
			font-weight: 500;
			color: var(--vscode-foreground);
			font-family: var(--vscode-editor-font-family);
		}
		
		.view-diff-btn {
			margin-left: auto;
			padding: 4px 10px;
			height: auto;
			font-size: 11px;
			background-color: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: 1px solid var(--vscode-button-border);
		}
		
		.view-diff-btn:hover {
			background-color: var(--vscode-button-secondaryHoverBackground);
		}

		.tool-intent {
			flex: 1;
			color: var(--vscode-descriptionForeground);
			font-size: 0.85em;
			font-style: italic;
			padding: 0 8px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.tool-duration {
			margin-left: auto;
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
			white-space: nowrap;
		}

		.tool-progress {
			margin-top: 4px;
			padding-left: 20px;
			color: var(--vscode-descriptionForeground);
			font-size: 0.85em;
			font-style: italic;
		}

		.tool-args-preview {
			margin-top: 4px;
			padding-left: 20px;
			color: var(--vscode-textPreformat-foreground);
			font-size: 0.85em;
			font-family: var(--vscode-editor-font-family);
			background: var(--vscode-textCodeBlock-background);
			padding: 4px 8px;
			border-radius: 3px;
			overflow-x: auto;
		}

		.tool-details {
			margin-top: 8px;
			border-top: 1px solid var(--vscode-panel-border);
			padding-top: 8px;
		}

		.tool-details summary {
			cursor: pointer;
			padding: 4px 8px;
			color: var(--vscode-textLink-foreground);
			font-size: 0.85em;
			user-select: none;
		}

		.tool-details summary:hover {
			color: var(--vscode-textLink-activeForeground);
		}

		.tool-details-content {
			margin-top: 8px;
			padding: 8px;
			background: var(--vscode-textCodeBlock-background);
			border-radius: 3px;
		}

		.tool-detail-section {
			margin-bottom: 12px;
		}

		.tool-detail-section:last-child {
			margin-bottom: 0;
		}

		.tool-detail-section strong {
			display: block;
			margin-bottom: 4px;
			color: var(--vscode-foreground);
			font-size: 0.9em;
		}

		.tool-detail-section pre {
			margin: 0;
			padding: 8px;
			background: var(--vscode-editor-background);
			border-radius: 3px;
			overflow-x: auto;
			font-size: 0.85em;
			font-family: var(--vscode-editor-font-family);
			white-space: pre-wrap;
			word-wrap: break-word;
		}

		.tool-detail-section.error {
			border-left: 3px solid var(--vscode-errorForeground);
			padding-left: 8px;
		}

		.tool-detail-section.error strong {
			color: var(--vscode-errorForeground);
		}


		.thinking {
			display: none;
			padding: 10px 12px;
			font-style: italic;
			opacity: 0.7;
			font-size: 12px;
		}

		.thinking.active {
			display: block;
		}

		.input-container {
			padding: 12px 16px;
			border-top: 1px solid var(--vscode-panel-border);
			background-color: var(--vscode-sideBar-background);
		}

		.input-wrapper {
			display: flex;
			gap: 8px;
			align-items: flex-end;
		}

		#messageInput {
			flex: 1;
			background-color: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			padding: 8px 12px;
			border-radius: 4px;
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			resize: vertical;
			min-height: 36px;
			max-height: 200px;
		}

		#messageInput:focus {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}

		#messageInput::placeholder {
			color: var(--vscode-input-placeholderForeground);
		}

		button {
			background-color: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 8px 16px;
			border-radius: 4px;
			cursor: pointer;
			font-size: 12px;
			font-weight: 600;
			height: 36px;
		}

		button:hover {
			background-color: var(--vscode-button-hoverBackground);
		}

		button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}

		.empty-state {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 12px;
			padding: 32px;
			text-align: center;
			opacity: 0.6;
		}

		.empty-state-icon {
			font-size: 48px;
		}

		.empty-state-text {
			font-size: 13px;
		}

		.hidden {
			display: none !important;
		}

		.input-controls {
			display: flex;
			gap: 12px;
			padding: 8px 12px;
			align-items: center;
			justify-content: flex-end;
			border-top: 1px solid var(--vscode-panel-border);
			background: var(--vscode-editor-background);
		}
		
		.controls-group {
			display: flex;
			gap: 12px;
			align-items: center;
		}
		
		.control-separator {
			color: var(--vscode-panel-border);
			font-size: 14px;
		}

		.plan-btn {
			padding: 4px 12px;
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: 1px solid var(--vscode-button-border);
			border-radius: 2px;
			cursor: pointer;
			font-size: 12px;
		}

		.plan-btn:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}

		.plan-mode-toggle {
			display: flex;
			align-items: center;
			gap: 6px;
			cursor: pointer;
			font-size: 12px;
			user-select: none;
		}

		.reasoning-toggle {
			display: flex;
			align-items: center;
			gap: 6px;
			cursor: pointer;
			font-size: 12px;
			user-select: none;
		}

		.plan-mode-toggle input[type="checkbox"] {
			cursor: pointer;
		}

		/* Scrollbar styling */
		::-webkit-scrollbar {
			width: 10px;
		}

		::-webkit-scrollbar-track {
			background: var(--vscode-scrollbarSlider-background);
		}

		::-webkit-scrollbar-thumb {
			background: var(--vscode-scrollbarSlider-hoverBackground);
			border-radius: 5px;
		}

		::-webkit-scrollbar-thumb:hover {
			background: var(--vscode-scrollbarSlider-activeBackground);
		}
	</style>
</head>
<body>
	<div class="header" role="banner">
		<div class="status-indicator" id="statusIndicator" role="status" aria-live="polite" aria-label="Connection status"></div>
		<h2>Copilot CLI</h2>
		<div class="session-selector">
			<label for="sessionSelect">Session:</label>
			<select id="sessionSelect" aria-label="Select session">
				<option value="">No session</option>
			</select>
			<button id="newSessionBtn" class="new-session-btn" title="New Session" aria-label="Create new session">+</button>
		</div>
	</div>

	<main role="main">
		<div class="messages" id="messages" role="log" aria-live="polite" aria-label="Chat messages">
			<div class="empty-state" id="emptyState">
				<div class="empty-state-icon" aria-hidden="true">💬</div>
				<div class="empty-state-text">
					Start a chat session to begin<br>
					Use the command palette to start the CLI
				</div>
			</div>
		</div>

		<div class="thinking" id="thinking" role="status" aria-live="polite">Thinking...</div>

		<div class="input-container">
			<div class="input-controls">
				<label class="reasoning-toggle">
					<input type="checkbox" id="showReasoningCheckbox" />
					<span>Show Reasoning</span>
				</label>
				<span class="control-separator">|</span>
				<label class="plan-mode-toggle" title="When enabled, all messages are prefixed with [[PLAN]]">
					<input type="checkbox" id="planModeCheckbox" />
					<span>Plan Mode</span>
				</label>
				<button id="viewPlanBtn" class="plan-btn" title="View Plan" aria-label="View plan.md file" style="display: none;">📋 View Plan</button>
			</div>
			<div class="input-wrapper">
				<textarea 
					id="messageInput" 
					placeholder="Type a message..."
					rows="1"
					disabled
					aria-label="Message input"
					aria-describedby="inputHelp"
				></textarea>
				<button id="sendButton" disabled aria-label="Send message">Send</button>
			</div>
			<span id="inputHelp" style="display:none;">Type your message and press Enter or click Send</span>
		</div>
	</main>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
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
		const planModeCheckbox = document.getElementById('planModeCheckbox');

		let sessionActive = false;
		let currentSessionId = null;
		let showReasoning = false;
		let planMode = false;
		let workspacePath = null;

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
				vscode.postMessage({
					type: 'switchSession',
					sessionId: selectedSessionId
				});
			}
		});

		// New session button handler
		newSessionBtn.addEventListener('click', () => {
			vscode.postMessage({
				type: 'newSession'
			});
		});

		// View plan button handler
		viewPlanBtn.addEventListener('click', () => {
			vscode.postMessage({
				type: 'viewPlan'
			});
		});

		// Plan mode checkbox handler
		planModeCheckbox.addEventListener('change', (e) => {
			planMode = e.target.checked;
		});

		// Auto-resize textarea
		messageInput.addEventListener('input', () => {
			messageInput.style.height = 'auto';
			messageInput.style.height = messageInput.scrollHeight + 'px';
		});

		// Send message on button click
		sendButton.addEventListener('click', sendMessage);

		// Send message on Enter (Shift+Enter for newline)
		messageInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				sendMessage();
			}
		});

		function sendMessage() {
			const text = messageInput.value.trim();
			if (!text || !sessionActive) return;

			console.log('[SEND] sendMessage() called, text:', text.substring(0, 50));

			// Add [[PLAN]] prefix if plan mode is enabled
			const messageToSend = planMode ? '[[PLAN]] ' + text : text;

			console.log('[SEND] Posting message to extension:', messageToSend.substring(0, 50));
			vscode.postMessage({
				type: 'sendMessage',
				value: messageToSend
			});

			messageInput.value = '';
			messageInput.style.height = 'auto';
		}

		function addMessage(role, text) {
			emptyState.classList.add('hidden');
			
			const messageDiv = document.createElement('div');
			messageDiv.className = \`message \${role}\`;
			messageDiv.setAttribute('role', 'article');
			
			// Handle different message types
			if (role === 'reasoning') {
				messageDiv.setAttribute('aria-label', 'Assistant reasoning');
				messageDiv.style.display = showReasoning ? 'block' : 'none';
				messageDiv.innerHTML = \`
					<div class="message-header" style="font-style: italic;">Assistant Reasoning</div>
					<div class="message-content" style="font-style: italic;">\${escapeHtml(text)}</div>
				\`;
			} else {
				messageDiv.setAttribute('aria-label', \`\${role === 'user' ? 'Your' : 'Assistant'} message\`);
				// Use marked for assistant messages, plain text for user
				const content = role === 'assistant' ? marked.parse(text) : escapeHtml(text);
				messageDiv.innerHTML = \`
					<div class="message-header">\${role === 'user' ? 'You' : 'Assistant'}</div>
					<div class="message-content">\${content}</div>
				\`;
			}
			
			messagesContainer.appendChild(messageDiv);
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
			
			// Announce new message to screen readers
			messageInput.focus();
		}

		function addOrUpdateTool(toolState) {
			// Check if this tool already exists anywhere in the DOM
			let toolDiv = messagesContainer.querySelector(\`[data-tool-id="\${toolState.toolCallId}"]\`);
			
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
						vscode.postMessage({
							type: 'viewDiff',
							value: toolState.diffData || {}
						});
					});
				}
			} else {
				// Create a new standalone tool execution message
				const toolMessage = document.createElement('div');
				toolMessage.className = 'message tool-message';
				const toolExecution = document.createElement('div');
				toolExecution.className = 'tool-execution';
				toolExecution.setAttribute('data-tool-id', toolState.toolCallId);
				toolExecution.innerHTML = toolHtml;
				toolExecution._toolState = toolState;
				toolMessage.appendChild(toolExecution);
				messagesContainer.appendChild(toolMessage);
			}
			
			// Scroll to show new tool
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}

		function buildToolHtml(toolState) {
			const statusIcon = toolState.status === 'complete' ? '✅' : 
			                    toolState.status === 'failed' ? '❌' : 
			                    toolState.status === 'running' ? '⏳' : '⏸️';
			
			const duration = toolState.endTime ? 
				\`\${((toolState.endTime - toolState.startTime) / 1000).toFixed(2)}s\` : '';
			
			const argsPreview = formatArgumentsPreview(toolState.toolName, toolState.arguments);
			const hasDetails = toolState.arguments || toolState.result || toolState.error;
			
			let html = \`
				<div class="tool-header">
					<span class="tool-icon">\${statusIcon}</span>
					<span class="tool-name">\${escapeHtml(toolState.toolName)}</span>
					\${toolState.intent ? \`<span class="tool-intent">\${escapeHtml(toolState.intent)}</span>\` : ''}
					\${duration ? \`<span class="tool-duration">\${duration}</span>\` : ''}
					\${toolState.hasDiff ? \`<button class="view-diff-btn" data-tool-id="\${toolState.toolCallId}">📄 View Diff</button>\` : ''}
				</div>
			\`;
			
			if (argsPreview) {
				html += \`<div class="tool-args-preview">\${escapeHtml(argsPreview)}</div>\`;
			}
			
			if (toolState.progress) {
				html += \`<div class="tool-progress">\${escapeHtml(toolState.progress)}</div>\`;
			}
			
			if (hasDetails) {
				const detailsId = 'details-' + toolState.toolCallId;
				html += \`
					<details class="tool-details">
						<summary>Show Details</summary>
						<div class="tool-details-content">
				\`;
				
				if (toolState.arguments) {
					html += \`
						<div class="tool-detail-section">
							<strong>Arguments:</strong>
							<pre>\${escapeHtml(JSON.stringify(toolState.arguments, null, 2))}</pre>
						</div>
					\`;
				}
				
				if (toolState.result) {
					html += \`
						<div class="tool-detail-section">
							<strong>Result:</strong>
							<pre>\${escapeHtml(toolState.result)}</pre>
						</div>
					\`;
				}
				
				if (toolState.error) {
					html += \`
						<div class="tool-detail-section error">
							<strong>Error:</strong>
							<pre>\${escapeHtml(toolState.error.message)}</pre>
							\${toolState.error.code ? \`<div>Code: \${escapeHtml(toolState.error.code)}</div>\` : ''}
						</div>
					\`;
				}
				
				html += \`
						</div>
					</details>
				\`;
			}
			
			return html;
		}

		function formatArgumentsPreview(toolName, args) {
			if (!args) return null;
			
			try {
				// Format based on tool type
				if (toolName === 'bash' || toolName.startsWith('shell')) {
					return \`$ \${args.command || JSON.stringify(args)}\`;
				} else if (toolName === 'grep') {
					return \`pattern: "\${args.pattern}"\${args.path ? \` in \${args.path}\` : ''}\`;
				} else if (toolName === 'edit' || toolName === 'create') {
					return \`\${args.path || 'unknown file'}\`;
				} else if (toolName === 'view') {
					return \`\${args.path || 'unknown path'}\`;
				} else if (toolName === 'web_fetch') {
					return \`\${args.url || JSON.stringify(args)}\`;
				} else if (toolName === 'glob') {
					return \`pattern: "\${args.pattern}"\`;
				} else {
					// Generic preview - show first property or count
					const keys = Object.keys(args);
					if (keys.length === 0) return null;
					if (keys.length === 1) return \`\${keys[0]}: \${JSON.stringify(args[keys[0]])}\`;
					return \`\${keys.length} parameters\`;
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
			} else {
				thinking.classList.remove('active');
			}
		}

		function escapeHtml(text) {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		}

		// Handle messages from extension
		window.addEventListener('message', event => {
			const message = event.data;
			
			switch (message.type) {
				case 'init':
					setSessionActive(message.sessionActive);
					break;
				case 'userMessage':
					addMessage('user', message.text);
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
				case 'clearMessages':
					// Clear all messages except empty state
					messagesContainer.innerHTML = '';
					const emptyStateDiv = document.createElement('div');
					emptyStateDiv.className = 'empty-state';
					emptyStateDiv.id = 'emptyState';
					emptyStateDiv.innerHTML = \`
						<div class="empty-state-icon" aria-hidden="true">💬</div>
						<div class="empty-state-text">
							Start a chat session to begin<br>
							Use the command palette to start the CLI
						</div>
					\`;
					messagesContainer.appendChild(emptyStateDiv);
					break;
				case 'updateSessions':
					// Update session dropdown
					currentSessionId = message.currentSessionId;
					sessionSelect.innerHTML = message.sessions.map(session => 
						\`<option value="\${session.id}" \${session.id === currentSessionId ? 'selected' : ''}>
							\${session.label}
						</option>\`
					).join('');
					break;
				case 'workspacePath':
					// Show/hide view plan button based on workspace path availability
					workspacePath = message.workspacePath;
					viewPlanBtn.style.display = workspacePath ? 'inline-block' : 'none';
					break;
				case 'toolStart':
					addOrUpdateTool(message.tool);
					break;
				case 'toolUpdate':
					addOrUpdateTool(message.tool);
					break;
				case 'diffAvailable':
					// Update the tool to show diff button
					const toolEl = messagesContainer.querySelector(\`[data-tool-id="\${message.data.toolCallId}"]\`);
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
								vscode.postMessage({
									type: 'viewDiff',
									value: message.data
								});
							});
						}
					}
					break;
			}
		});

		// Notify extension that webview is ready
		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
