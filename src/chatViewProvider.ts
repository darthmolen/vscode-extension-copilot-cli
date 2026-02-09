import * as vscode from 'vscode';
import { Logger } from './logger';
import { getBackendState } from './backendState';
import { ExtensionRpcRouter } from './extension/rpc';

export class ChatPanelProvider {
	private static panel: vscode.WebviewPanel | undefined;
	private static logger: Logger;
	private static extensionUri: vscode.Uri;
	private static rpcRouter: ExtensionRpcRouter | undefined;
	private static messageHandlers: Set<(data: {text: string; attachments?: Array<{type: 'file'; path: string; displayName?: string}>}) => void> = new Set();
	private static abortHandlers: Set<() => void> = new Set();
	private static onViewOpenedHandlers: Set<() => void> = new Set();
	private static isSessionActive: boolean = false;
	private static currentWorkspacePath: string | undefined;
	private static viewPlanHandlers: Set<() => void> = new Set();
	private static lastSentMessage: string | undefined;
	private static lastSentTime: number = 0;
	private static validateAttachmentsCallback: ((filePaths: string[]) => Promise<{ valid: boolean; error?: string }>) | undefined;

	public static createOrShow(extensionUri: vscode.Uri) {
		this.logger = Logger.getInstance();
		this.extensionUri = extensionUri;
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
					...(vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri)
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
			ChatPanelProvider.rpcRouter = undefined;
		});

		// Create RPC router for type-safe messaging
		ChatPanelProvider.rpcRouter = new ExtensionRpcRouter(ChatPanelProvider.panel.webview);

		// Register RPC handlers (REPLACES old onDidReceiveMessage switch statement)
		ChatPanelProvider.rpcRouter.onReady(() => {
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
			
			ChatPanelProvider.rpcRouter!.sendInit({
				sessionId: fullState.sessionId,
				sessionActive: fullState.sessionActive,
				messages: fullState.messages as any, // Type compat: backendState.Message vs shared.Message
				planModeStatus: fullState.planModeStatus,
				workspacePath: fullState.workspacePath,
				activeFilePath: fullState.activeFilePath
			});
			
			this.logger.info(`[DIAGNOSTIC] Sent init message to webview with ${fullState.messages.length} messages`);
			this.logger.info(`[DIAGNOSTIC] Firing ${this.onViewOpenedHandlers.size} onViewOpened handlers`);
			this.onViewOpenedHandlers.forEach(handler => handler());
		});

		ChatPanelProvider.rpcRouter.onSendMessage((payload) => {
			// Prevent duplicate sends (same message within 1 second)
			const now = Date.now();
			if (ChatPanelProvider.lastSentMessage === payload.text && 
			    now - ChatPanelProvider.lastSentTime < 1000) {
				this.logger.warn(`Ignoring duplicate message send: ${payload.text.substring(0, 50)}...`);
				return;
			}
			ChatPanelProvider.lastSentMessage = payload.text;
			ChatPanelProvider.lastSentTime = now;
			
			this.logger.info(`User sent message: ${payload.text.substring(0, 100)}...`);
			if (payload.attachments && payload.attachments.length > 0) {
				this.logger.info(`  with ${payload.attachments.length} attachment(s)`);
			}
			this.messageHandlers.forEach(handler => handler({
				text: payload.text,
				attachments: payload.attachments
			}));
		});

		ChatPanelProvider.rpcRouter.onPickFiles(() => {
			this.logger.info('File picker requested from UI');
			this.handleFilePicker();
		});

		ChatPanelProvider.rpcRouter.onAbortMessage(() => {
			this.logger.info('Abort requested from UI');
			this.abortHandlers.forEach(handler => handler());
		});

		ChatPanelProvider.rpcRouter.onSwitchSession((payload) => {
			this.logger.info(`[DIAGNOSTIC] Switch session requested from dropdown: ${payload.sessionId}`);
			vscode.commands.executeCommand('copilot-cli-extension.switchSession', payload.sessionId);
		});

		ChatPanelProvider.rpcRouter.onNewSession(() => {
			this.logger.info('New session requested from UI');
			vscode.commands.executeCommand('copilot-cli-extension.newSession');
		});

		ChatPanelProvider.rpcRouter.onViewPlan(() => {
			this.logger.info('View plan requested from UI');
			this.viewPlanHandlers.forEach(handler => handler());
		});

		ChatPanelProvider.rpcRouter.onViewDiff((payload) => {
			this.logger.info(`View diff requested from UI: ${JSON.stringify(payload)}`);
			vscode.commands.executeCommand('copilot-cli-extension.viewDiff', payload);
		});

		ChatPanelProvider.rpcRouter.onTogglePlanMode((payload) => {
			this.logger.info(`Plan mode toggle requested: ${payload.enabled}`);
			vscode.commands.executeCommand('copilot-cli-extension.togglePlanMode', payload.enabled);
		});

		ChatPanelProvider.rpcRouter.onAcceptPlan(() => {
			this.logger.info('Accept plan requested from UI');
			vscode.commands.executeCommand('copilot-cli-extension.acceptPlan');
		});

		ChatPanelProvider.rpcRouter.onRejectPlan(() => {
			this.logger.info('Reject plan requested from UI');
			vscode.commands.executeCommand('copilot-cli-extension.rejectPlan');
		});

		// Start listening for messages from webview
		ChatPanelProvider.rpcRouter.listen();

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
		ChatPanelProvider.rpcRouter?.addUserMessage(text, attachments as any); // Type compat: different Attachment shapes
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
		ChatPanelProvider.rpcRouter?.addAssistantMessage(text);
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
		ChatPanelProvider.rpcRouter?.addReasoningMessage(text);
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
		ChatPanelProvider.rpcRouter?.toolStart(toolState);
	}

	public static updateToolExecution(toolState: any) {
		ChatPanelProvider.rpcRouter?.toolUpdate(toolState);
	}
	
	public static notifyDiffAvailable(data: any) {
		ChatPanelProvider.rpcRouter?.setDiffAvailable(data.available || false);
	}


	public static appendToLastMessage(text: string) {
		ChatPanelProvider.rpcRouter?.appendMessage(text);
	}

	public static setSessionActive(active: boolean) {
		ChatPanelProvider.isSessionActive = active;
		ChatPanelProvider.rpcRouter?.setSessionActive(active);
	}

	public static setThinking(isThinking: boolean) {
		ChatPanelProvider.rpcRouter?.setThinking(isThinking);
	}

	public static clearMessages() {
		ChatPanelProvider.rpcRouter?.clearMessages();
	}
	
	public static resetPlanMode() {
		ChatPanelProvider.rpcRouter?.resetPlanMode();
	}

	public static updateSessions(sessions: Array<{id: string, label: string}>, currentSessionId: string | null) {
		this.logger?.info(`[DIAGNOSTIC] Updating session dropdown: ${sessions.length} sessions, currentSessionId=${currentSessionId}`);
		if (sessions.length > 0) {
			this.logger?.info(`[DIAGNOSTIC] First session in list: ${sessions[0].id} (${sessions[0].label})`);
			const selectedIndex = sessions.findIndex(s => s.id === currentSessionId);
			this.logger?.info(`[DIAGNOSTIC] Selected session index: ${selectedIndex} (${selectedIndex >= 0 ? sessions[selectedIndex].id : 'NOT FOUND'})`);
		}
		ChatPanelProvider.rpcRouter?.updateSessions(sessions as any, currentSessionId); // Type compat: different Session shapes
	}

	public static setWorkspacePath(workspacePath: string | undefined) {
		ChatPanelProvider.currentWorkspacePath = workspacePath;
		ChatPanelProvider.rpcRouter?.setWorkspacePath(workspacePath || null);
	}

	public static updateActiveFile(filePath: string | null) {
		ChatPanelProvider.rpcRouter?.setActiveFile(filePath);
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
			
			// Validate attachments before processing
			if (this.validateAttachmentsCallback) {
				const filePaths = fileUris.map(uri => uri.fsPath);
				this.logger.info(`[ATTACH] Validating ${filePaths.length} files...`);
				
				const validationResult = await this.validateAttachmentsCallback(filePaths);
				if (!validationResult.valid) {
					this.logger.warn(`[ATTACH] Validation failed: ${validationResult.error}`);
					vscode.window.showErrorMessage(validationResult.error || 'Invalid attachment');
					return;
				}
				
				this.logger.info('[ATTACH] Validation passed ✓');
			} else {
				this.logger.warn('[ATTACH] No validation callback registered; blocking attachment to avoid sending unvalidated files');
				vscode.window.showErrorMessage('File attachments are not ready yet. Please try again in a moment.');
				return;
			}
			
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

	public static setValidateAttachmentsCallback(callback: (filePaths: string[]) => Promise<{ valid: boolean; error?: string }>) {
		ChatPanelProvider.validateAttachmentsCallback = callback;
		this.logger?.info('Attachment validation callback registered');
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

		// Get URIs for external resources
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'styles.css')
		);
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js')
		);

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource} https://cdn.jsdelivr.net; img-src ${webview.cspSource} data:;">
	<title>Copilot CLI Chat</title>
	<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
	<link rel="stylesheet" href="${styleUri}">
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

	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
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
