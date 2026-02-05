import * as vscode from 'vscode';
import { Logger } from './logger';
import { getBackendState } from './backendState';

export class ChatPanelProvider {
	private static panel: vscode.WebviewPanel | undefined;
	private static logger: Logger;
	private static messageHandlers: Set<(data: {text: string; attachments?: Array<{type: 'file'; path: string; displayName?: string}>}) => void> = new Set();
	private static abortHandlers: Set<() => void> = new Set();
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
			this.logger.info('[DIAGNOSTIC] Chat panel already exists, REVEALING (not creating)');
			const backendState = getBackendState();
			this.logger.info(`[DIAGNOSTIC] BackendState on reveal: ${backendState.getMessages().length} messages, sessionId=${backendState.getSessionId()}`);
			ChatPanelProvider.panel.reveal(column);
			return;
		}

		// Otherwise, create a new panel
		this.logger.info('[DIAGNOSTIC] CREATING NEW chat panel (first time)');
		const backendState = getBackendState();
		this.logger.info(`[DIAGNOSTIC] BackendState on create: ${backendState.getMessages().length} messages, sessionId=${backendState.getSessionId()}`);
		ChatPanelProvider.panel = vscode.window.createWebviewPanel(
			'copilotCLIChat',
			'Copilot CLI',
			column,
			{
				enableScripts: true,
				localResourceRoots: [
					extensionUri,
					vscode.Uri.file('/') // Allow access to entire filesystem for image attachments
				],
				retainContextWhenHidden: true
			}
		);

		// Handle panel disposal (X button)
		ChatPanelProvider.panel.onDidDispose(() => {
			this.logger.info('='.repeat(60));
			this.logger.info('[DIAGNOSTIC] ========== PANEL DISPOSED (X BUTTON) ==========');
			const backendState = getBackendState();
			this.logger.info(`[DIAGNOSTIC] BackendState at disposal: ${backendState.getMessages().length} messages`);
			this.logger.info(`[DIAGNOSTIC] Session ID at disposal: ${backendState.getSessionId()}`);
			this.logger.info(`[DIAGNOSTIC] Session active at disposal: ${backendState.isSessionActive()}`);
			this.logger.info('[DIAGNOSTIC] Panel will be set to undefined');
			this.logger.info('='.repeat(60));
			ChatPanelProvider.panel = undefined;
		});

		// CRITICAL FIX: Register message handler BEFORE setting HTML
		// This ensures we catch the 'ready' message that fires immediately when HTML loads
		ChatPanelProvider.panel.webview.onDidReceiveMessage(data => {
			this.logger.debug(`[Webview Message] ${data.type}`);
			switch (data.type) {
				case 'sendMessage':
					// Prevent duplicate sends (same message within 1 second)
					const now = Date.now();
					if (ChatPanelProvider.lastSentMessage === data.text && 
					    now - ChatPanelProvider.lastSentTime < 1000) {
						this.logger.warn(`Ignoring duplicate message send: ${data.text.substring(0, 50)}...`);
						return;
					}
					ChatPanelProvider.lastSentMessage = data.text;
					ChatPanelProvider.lastSentTime = now;
					
					this.logger.info(`User sent message: ${data.text.substring(0, 100)}...`);
					if (data.attachments && data.attachments.length > 0) {
						this.logger.info(`  with ${data.attachments.length} attachment(s)`);
					}
					this.messageHandlers.forEach(handler => handler({
						text: data.text,
						attachments: data.attachments
					}));
					break;
				case 'pickFiles':
					this.logger.info('File picker requested from UI');
					this.handleFilePicker();
					break;
				case 'abortMessage':
					this.logger.info('Abort requested from UI');
					this.abortHandlers.forEach(handler => handler());
					break;
				case 'ready':
					this.logger.info('Webview is ready');
					
					// Get full state from backend and send to webview
					// History should already be loaded by this point
					const backendState = getBackendState();
					const fullState = backendState.getFullState();
					
					// DIAGNOSTIC: Log BackendState contents
					this.logger.info(`[DIAGNOSTIC] BackendState when ready: ${fullState.messages.length} messages, sessionId=${fullState.sessionId}, sessionActive=${fullState.sessionActive}`);
					if (fullState.messages.length > 0) {
						this.logger.info(`[DIAGNOSTIC] First message: ${JSON.stringify(fullState.messages[0]).substring(0, 100)}`);
						this.logger.info(`[DIAGNOSTIC] Last message: ${JSON.stringify(fullState.messages[fullState.messages.length - 1]).substring(0, 100)}`);
					} else {
						this.logger.warn(`[DIAGNOSTIC] BackendState is EMPTY when webview ready - history not loaded!`);
					}
					
					ChatPanelProvider.postMessage({ 
						type: 'init', 
						sessionId: fullState.sessionId,
						sessionActive: fullState.sessionActive,
						messages: fullState.messages,
						planModeStatus: fullState.planModeStatus,
						workspacePath: fullState.workspacePath,
						activeFilePath: fullState.activeFilePath
					});
					
					this.logger.info(`[DIAGNOSTIC] Sent init message to webview with ${fullState.messages.length} messages`);
					this.logger.info(`[DIAGNOSTIC] Firing ${this.onViewOpenedHandlers.size} onViewOpened handlers`);
					this.onViewOpenedHandlers.forEach(handler => handler());
					break;
				case 'switchSession':
					this.logger.info(`[DIAGNOSTIC] Switch session requested from dropdown: ${data.sessionId}`);
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
				case 'togglePlanMode':
					this.logger.info(`Plan mode toggle requested: ${data.enabled}`);
					vscode.commands.executeCommand('copilot-cli-extension.togglePlanMode', data.enabled);
					break;
				case 'acceptPlan':
					this.logger.info('Accept plan requested from UI');
					vscode.commands.executeCommand('copilot-cli-extension.acceptPlan');
					break;
				case 'rejectPlan':
					this.logger.info('Reject plan requested from UI');
					vscode.commands.executeCommand('copilot-cli-extension.rejectPlan');
					break;
			}
		});

		// NOW set HTML - webview will load and send 'ready' which we can now catch
		ChatPanelProvider.panel.webview.html = ChatPanelProvider.getHtmlForWebview(ChatPanelProvider.panel.webview);

		this.logger.info('✅ Chat panel created');
	}

	public static postMessage(message: any) {
		if (ChatPanelProvider.panel) {
			ChatPanelProvider.panel.webview.postMessage(message);
		}
	}

	public static addUserMessage(text: string, attachments?: Array<{displayName: string; webviewUri?: string}>, storeInBackend: boolean = true) {
		// Store in backend state
		if (storeInBackend) {
			const backendState = getBackendState();
			backendState.addMessage({
				role: 'user',
				type: 'user',
				content: text,
				timestamp: Date.now()
			});
		}
		
		// Send to webview with attachments
		ChatPanelProvider.postMessage({ 
			type: 'userMessage', 
			text,
			attachments 
		});
	}

	public static addAssistantMessage(text: string, storeInBackend: boolean = true) {
		// Store in backend state
		if (storeInBackend) {
			const backendState = getBackendState();
			backendState.addMessage({
				role: 'assistant',
				type: 'assistant',
				content: text,
				timestamp: Date.now()
			});
		}
		
		// Send to webview
		ChatPanelProvider.postMessage({ type: 'assistantMessage', text });
	}

	public static addReasoningMessage(text: string, storeInBackend: boolean = true) {
		// Store in backend state
		if (storeInBackend) {
			const backendState = getBackendState();
			backendState.addMessage({
				role: 'assistant',
				type: 'reasoning',
				content: text,
				timestamp: Date.now()
			});
		}
		
		// Send to webview
		ChatPanelProvider.postMessage({ type: 'reasoningMessage', text });
	}

	public static addToolExecution(toolState: any, storeInBackend: boolean = true) {
		// Store in backend state
		if (storeInBackend) {
			const backendState = getBackendState();
			backendState.addMessage({
				role: 'assistant',
				type: 'tool',
				content: toolState.description || toolState.name || 'Tool execution',
				toolName: toolState.name,
				status: 'running',
				timestamp: Date.now()
			});
		}
		
		// Send to webview
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
	
	public static resetPlanMode() {
		ChatPanelProvider.postMessage({ type: 'resetPlanMode' });
	}

	public static updateSessions(sessions: Array<{id: string, label: string}>, currentSessionId: string | null) {
		this.logger?.info(`[DIAGNOSTIC] Updating session dropdown: ${sessions.length} sessions, currentSessionId=${currentSessionId}`);
		if (sessions.length > 0) {
			this.logger?.info(`[DIAGNOSTIC] First session in list: ${sessions[0].id} (${sessions[0].label})`);
			const selectedIndex = sessions.findIndex(s => s.id === currentSessionId);
			this.logger?.info(`[DIAGNOSTIC] Selected session index: ${selectedIndex} (${selectedIndex >= 0 ? sessions[selectedIndex].id : 'NOT FOUND'})`);
		}
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

	public static updateActiveFile(filePath: string | null) {
		ChatPanelProvider.postMessage({ type: 'activeFileChanged', filePath });
	}

	public static onUserMessage(handler: (data: {text: string; attachments?: Array<{type: 'file'; path: string; displayName?: string}>}) => void) {
		// Clear any existing handlers to prevent duplicates if extension re-activates
		if (ChatPanelProvider.messageHandlers.size > 0) {
			this.logger?.warn(`Clearing ${ChatPanelProvider.messageHandlers.size} existing message handlers`);
			ChatPanelProvider.messageHandlers.clear();
		}
		ChatPanelProvider.messageHandlers.add(handler);
		this.logger?.info(`Message handler registered (total: ${ChatPanelProvider.messageHandlers.size})`);
	}
	
	private static async handleFilePicker() {
		const options: vscode.OpenDialogOptions = {
			canSelectMany: true,
			openLabel: 'Select Images',
			filters: {
				'Images': ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']
			}
		};
		
		const fileUris = await vscode.window.showOpenDialog(options);
		if (fileUris && fileUris.length > 0) {
			this.logger.info(`[ATTACH] User selected ${fileUris.length} file(s)`);
			
			// Convert to webview URIs - VS Code serves them securely, no size limit
			const attachments = fileUris.map(uri => {
				this.logger.info(`[ATTACH] Processing file: ${uri.fsPath}`);
				
				// Convert to webview URI - works for any size image
				const webviewUri = this.panel?.webview.asWebviewUri(uri);
				
				this.logger.info(`[ATTACH] File: ${uri.fsPath}`);
				this.logger.info(`[ATTACH]   Webview URI: ${webviewUri?.toString()}`);
				
				return {
					type: 'file' as const,
					path: uri.fsPath,
					displayName: uri.fsPath.split(/[/\\]/).pop() || 'unknown',
					webviewUri: webviewUri?.toString() || ''
				};
			});
			
			this.logger.info(`[ATTACH] Sending ${attachments.length} attachments to webview`);
			ChatPanelProvider.postMessage({
				type: 'filesSelected',
				attachments
			});
		} else {
			this.logger.info('File picker cancelled');
		}
	}

	public static onAbort(handler: () => void) {
		// Clear any existing handlers to prevent duplicates if extension re-activates
		if (ChatPanelProvider.abortHandlers.size > 0) {
			this.logger?.warn(`Clearing ${ChatPanelProvider.abortHandlers.size} existing abort handlers`);
			ChatPanelProvider.abortHandlers.clear();
		}
		ChatPanelProvider.abortHandlers.add(handler);
		this.logger?.info(`Abort handler registered (total: ${ChatPanelProvider.abortHandlers.size})`);
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
		// Recreate with fresh HTML and reset plan mode
		ChatPanelProvider.createOrShow(extensionUri);
		ChatPanelProvider.resetPlanMode();
	}

	private static getHtmlForWebview(webview: vscode.Webview) {
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; img-src ${webview.cspSource} data:;">
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
		
		/* Message attachments */
		.message-attachments {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-top: 12px;
			padding-top: 12px;
			border-top: 1px solid var(--vscode-panel-border);
		}
		
		.message-attachment {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 4px;
			max-width: 150px;
		}
		
		.message-attachment-image {
			max-width: 150px;
			max-height: 150px;
			border-radius: 4px;
			border: 1px solid var(--vscode-panel-border);
		}
		
		.message-attachment-name {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			text-align: center;
			word-break: break-all;
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

		.tool-group {
			padding: 8px 12px;
			margin: 8px 0;
			background: var(--vscode-editorWidget-background);
			border-radius: 4px;
			border-left: 3px solid var(--vscode-charts-blue);
			max-width: 600px;
		}

		.tool-group-container {
			max-height: 200px;
			overflow: hidden;
			transition: max-height 0.3s ease;
		}

		.tool-group-container.expanded {
			max-height: none;
		}

		.tool-group-toggle {
			text-align: center;
			padding: 8px;
			margin-top: 8px;
			cursor: pointer;
			color: var(--vscode-textLink-foreground);
			font-size: 0.9em;
			border-top: 1px solid var(--vscode-widget-border);
			user-select: none;
		}

		.tool-group-toggle:hover {
			background: var(--vscode-list-hoverBackground);
			text-decoration: underline;
		}

		.tool-execution {
			padding: 6px 0;
			border-bottom: 1px solid var(--vscode-widget-border);
		}

		.tool-message .tool-execution {
			padding: 0;
			border-bottom: none;
		}

		.tool-group .tool-execution {
			padding: 6px 0;
			border-bottom: 1px solid var(--vscode-widget-border);
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

		.top-controls-row {
			display: flex;
			gap: 12px;
			align-items: flex-start;
			width: 100%;
			order: -1;
		}

		.focus-file-group {
			display: inline-flex;
			gap: 6px;
			align-items: center;
			flex: 1;
			min-width: 0;
		}

		.focus-file-title {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
		}

		.focus-file-info {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.planning-header-spacer {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 100px;
			flex-shrink: 0;
		}

		.plan-mode-title-top {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			text-align: center;
			white-space: nowrap;
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
		
		/* Attachment UI Styles */
		.attach-btn {
			position: relative;
			padding: 6px;
			min-width: 36px;
			background-color: transparent;
			border: 1px solid var(--vscode-input-border);
			display: flex;
			align-items: center;
			justify-content: center;
		}
		
		.attach-btn:hover {
			background-color: var(--vscode-list-hoverBackground);
		}
		
		.attach-count {
			position: absolute;
			top: -4px;
			right: -4px;
			background-color: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			border-radius: 10px;
			padding: 2px 6px;
			font-size: 10px;
			font-weight: bold;
			min-width: 18px;
			text-align: center;
		}
		
		.attachments-preview {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			padding: 8px 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
			background-color: var(--vscode-editor-background);
		}
		
		.attachment-item {
			position: relative;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 4px;
			padding: 8px;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			background-color: var(--vscode-input-background);
			max-width: 120px;
		}
		
		.attachment-thumbnail {
			width: 80px;
			height: 80px;
			object-fit: cover;
			border-radius: 2px;
		}
		
		.attachment-name {
			font-size: 11px;
			text-align: center;
			word-break: break-all;
			max-width: 100px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		
		.attachment-remove {
			position: absolute;
			top: 4px;
			right: 4px;
			background-color: var(--vscode-errorForeground);
			color: white;
			border: none;
			border-radius: 50%;
			width: 20px;
			height: 20px;
			padding: 0;
			cursor: pointer;
			font-size: 14px;
			line-height: 1;
			display: flex;
			align-items: center;
			justify-content: center;
		}
		
		.attachment-remove:hover {
			opacity: 0.8;
		}

		button.stop-button {
			background-color: var(--vscode-errorForeground);
			color: var(--vscode-button-foreground);
		}

		button.stop-button:hover {
			background-color: var(--vscode-errorForeground);
			opacity: 0.9;
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
			flex-wrap: wrap;
			gap: 12px;
			padding: 8px 12px;
			align-items: center;
			justify-content: flex-end;
			border-top: 1px solid var(--vscode-panel-border);
			background: var(--vscode-editor-background);
		}
		
		.acceptance-controls {
			display: none;
			gap: 12px;
			padding: 8px 12px;
			align-items: center;
			justify-content: flex-end;
			border-top: 1px solid var(--vscode-panel-border);
			background: var(--vscode-editor-background);
			min-height: 52px;
		}
		
		.acceptance-controls.active {
			display: flex;
		}
		
		.acceptance-title {
			font-size: 13px;
			font-weight: 600;
			color: var(--vscode-foreground);
		}
		
		.acceptance-input {
			flex: 1;
			background-color: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			padding: 6px 10px;
			border-radius: 3px;
			font-family: var(--vscode-font-family);
			font-size: 12px;
		}
		
		.acceptance-input::placeholder {
			color: var(--vscode-input-placeholderForeground);
			font-style: italic;
		}
		
		.acceptance-input:focus {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}
		
		.acceptance-btn {
			padding: 6px 12px;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			border-radius: 3px;
			cursor: pointer;
			font-size: 12px;
			font-weight: 600;
			white-space: nowrap;
		}
		
		.acceptance-btn:hover {
			background: var(--vscode-button-hoverBackground);
		}
		
		.acceptance-btn.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: 1px solid var(--vscode-button-border);
		}
		
		.acceptance-btn.secondary:hover {
			background: var(--vscode-button-secondaryHoverBackground);
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
			padding: 6px 8px;
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: 1px solid var(--vscode-button-border);
			border-radius: 2px;
			cursor: pointer;
			font-size: 18px;
		}

		.plan-btn:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}

		.plan-mode-group {
			display: inline-flex;
		}

		.plan-mode-controls {
			display: inline-flex;
			gap: 4px;
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

		.usage-info {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
		}
		
		.usage-group {
			position: relative;
			display: inline-flex;
			padding-top: 12px;
		}
		
		.usage-title {
			position: absolute;
			top: 0;
			left: 0;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			text-align: left;
			padding-left: 4px;
		}
		
		.reasoning-toggle {
			display: flex;
			align-items: center;
			gap: 6px;
			cursor: pointer;
			font-size: 12px;
			user-select: none;
			padding-top: 12px;
		}
		
		.reasoning-indicator {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			font-style: italic;
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
				<div class="top-controls-row">
					<div class="focus-file-group">
						<div class="focus-file-title">Active File:</div>
						<span class="focus-file-info" id="focusFileInfo" aria-live="polite"></span>
					</div>
					<span style="flex: 1;"></span>
					<div class="planning-header-spacer">
						<div class="plan-mode-title-top">Planning</div>
					</div>
				</div>
				<div class="usage-group">
					<span class="usage-info">
						<span id="usageWindow" title="context window usage percentage">Window: 0%</span>
						<span> | </span>
						<span id="usageUsed" title="tokens used this session">Used: 0</span>
						<span> | </span>
						<span id="usageRemaining" title="remaining requests for account">Remaining: --</span>
					</span>
				</div>
				<span id="reasoningIndicator" class="reasoning-indicator" style="display: none; margin-left: 8px;">
					🧠 <span id="reasoningText">Reasoning...</span>
				</span>
				<span style="flex: 1;"></span>
				<label class="reasoning-toggle">
					<input type="checkbox" id="showReasoningCheckbox" />
					<span>Show Reasoning</span>
				</label>
				<span class="control-separator">|</span>
				<div class="plan-mode-group">
					<div id="planModeControls" class="plan-mode-controls">
					<button id="enterPlanModeBtn" class="plan-btn primary" title="Enter planning mode to analyze and design">📝</button>
					<button id="acceptPlanBtn" class="plan-btn accept" title="Accept the plan and return to work mode" style="display: none;">✅</button>
					<button id="rejectPlanBtn" class="plan-btn reject" title="Reject the plan and discard changes" style="display: none;">❌</button>
					<button id="viewPlanBtn" class="plan-btn" title="View Plan" aria-label="View plan.md file" style="display: none;">📋</button>
					</div>
				</div>
			</div>
			<div class="acceptance-controls" id="acceptanceControls" role="region" aria-label="Plan acceptance controls">
				<span class="acceptance-title" id="acceptanceTitle">Accept this plan?</span>
				<input 
					type="text" 
					class="acceptance-input" 
					id="acceptanceInput" 
					placeholder="Tell copilot what to do instead"
					aria-label="Alternative instructions for the plan"
					aria-describedby="acceptanceTitle"
				/>
				<button class="acceptance-btn secondary" id="keepPlanningBtn" aria-label="Keep planning without accepting">No, Keep Planning</button>
				<button class="acceptance-btn" id="acceptAndWorkBtn" aria-label="Accept plan and switch to work mode">Accept and change to work mode</button>
			</div>
			<!-- Attachment preview area -->
			<div class="attachments-preview" id="attachmentsPreview" style="display: none;"></div>
			
			<div class="input-wrapper">
				<button id="attachButton" class="attach-btn" aria-label="Attach images" title="Attach images">
					<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
						<path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a3.5 3.5 0 1 1-7 0V5a.5.5 0 0 1 1 0v7a2.5 2.5 0 0 0 5 0V3a1.5 1.5 0 1 0-3 0v9a.5.5 0 0 0 1 0V5a.5.5 0 0 1 1 0v7a1.5 1.5 0 1 1-3 0V3z"/>
					</svg>
					<span class="attach-count" id="attachCount" style="display: none;"></span>
				</button>
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

		// Plan mode button handlers
		enterPlanModeBtn.addEventListener('click', () => {
			console.log('[Plan Mode] Entering plan mode');
			planMode = true;
			vscode.postMessage({
				type: 'togglePlanMode',
				enabled: true
			});
			updatePlanModeUI();
		});
		
		acceptPlanBtn.addEventListener('click', () => {
			console.log('[Plan Mode] Accepting plan');
			vscode.postMessage({
				type: 'acceptPlan'
			});
		});
		
		rejectPlanBtn.addEventListener('click', () => {
			console.log('[Plan Mode] Rejecting plan');
			vscode.postMessage({
				type: 'rejectPlan'
			});
		});
		
		// Acceptance control handlers
		acceptAndWorkBtn.addEventListener('click', () => {
			console.log('[Acceptance] Accept and work');
			vscode.postMessage({
				type: 'acceptPlan'
			});
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
					vscode.postMessage({
						type: 'sendMessage',
						value: instructions
					});
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
				vscode.postMessage({ type: 'abortMessage' });
			} else {
				// Send message
				sendMessage();
			}
		});
		
		// Attach button click handler
		attachButton.addEventListener('click', () => {
			vscode.postMessage({ type: 'pickFiles' });
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
			vscode.postMessage({
				type: 'sendMessage',
				text: text,
				attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined
			});

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
				const imgSrc = att.webviewUri || 'data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'80\\' height=\\'80\\'%3E%3Crect fill=\\'%23ccc\\' width=\\'80\\' height=\\'80\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\' dy=\\'.3em\\' fill=\\'%23666\\' font-size=\\'12\\'%3EImage%3C/text%3E%3C/svg%3E';
				
				return \`
					<div class="attachment-item">
						<button class="attachment-remove" onclick="removeAttachment(\${index})" title="Remove">&times;</button>
						<img class="attachment-thumbnail" src="\${imgSrc}" alt="\${att.displayName}" />
						<div class="attachment-name" title="\${att.displayName}">\${att.displayName}</div>
					</div>
				\`;
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
				
				// Build attachments HTML if present
				let attachmentsHtml = '';
				if (attachments && attachments.length > 0) {
					attachmentsHtml = '<div class="message-attachments">' + 
						attachments.map(att => \`
							<div class="message-attachment">
								\${att.webviewUri ? \`<img src="\${att.webviewUri}" alt="\${att.displayName}" class="message-attachment-image" />\` : ''}
								<div class="message-attachment-name">📎 \${att.displayName}</div>
							</div>
						\`).join('') +
						'</div>';
				}
				
				messageDiv.innerHTML = \`
					<div class="message-header">\${role === 'user' ? 'You' : 'Assistant'}</div>
					<div class="message-content">\${content}</div>
					\${attachmentsHtml}
				\`;
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
				
				toggle.textContent = toolGroupExpanded ? 'Contract' : \`Expand (\${displayCount} more)\`;
				toggle.addEventListener('click', () => {
					toolGroupExpanded = !toolGroupExpanded;
					if (toolGroupExpanded) {
						container.classList.add('expanded');
						toggle.textContent = 'Contract';
					} else {
						container.classList.remove('expanded');
						const hiddenCount = element.querySelectorAll('.tool-execution').length - Math.floor(200 / 70);
						toggle.textContent = \`Expand (\${Math.max(1, hiddenCount)} more)\`;
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
						vscode.postMessage({
							type: 'viewDiff',
							value: toolState.diffData || {}
						});
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

		function escapeHtml(text) {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
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
					emptyStateDiv.innerHTML = \`
						<div class="empty-state-icon" aria-hidden="true">💬</div>
						<div class="empty-state-text">
							Start a chat session to begin<br>
							Use the command palette to start the CLI
						</div>
					\`;
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
					emptyStateDiv.innerHTML = \`
						<div class="empty-state-icon" aria-hidden="true">💬</div>
						<div class="empty-state-text">
							Start a chat session to begin<br>
							Use the command palette to start the CLI
						</div>
					\`;
					messagesContainer.appendChild(emptyStateDiv);
					break;
				}
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
						usageWindow.textContent = \`Window: \${windowPct}%\`;
						usageWindow.title = \`context window usage: \${used.toLocaleString()} / \${limit.toLocaleString()} tokens\`;
						
						// Update Used count
						usageUsed.textContent = \`Used: \${usedCompact}\`;
						usageUsed.title = \`tokens used this session: \${used.toLocaleString()}\`;
					}
					if (message.data.remainingPercentage !== undefined) {
						// Quota percentage from assistant.usage
						const pct = Math.round(message.data.remainingPercentage);
						usageRemaining.textContent = \`Remaining: \${pct}%\`;
						usageRemaining.title = \`remaining requests for account: \${pct}%\`;
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
