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
	
	// Track viewState changes for loop detection and spam reduction
	private static viewStateChangeCount = 0;
	private static lastViewStateChange = 0;
	private static updateSessionsListDebounceTimer: NodeJS.Timeout | undefined;
	private static readonly UPDATE_SESSIONS_DEBOUNCE_MS = 500; // Wait 500ms before updating
	private static lastActiveState: boolean = false;
	private static lastVisibleState: boolean = true;
	private static lastViewColumn: vscode.ViewColumn | undefined;

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

		// Listen for panel location/visibility changes
		const disposables: vscode.Disposable[] = [];
		ChatPanelProvider.panel.onDidChangeViewState(
			e => {
				// Track for loop detection
				const now = Date.now();
				const timeSinceLastChange = now - ChatPanelProvider.lastViewStateChange;
				ChatPanelProvider.viewStateChangeCount++;
				ChatPanelProvider.lastViewStateChange = now;
				
				// WARN if firing too frequently (potential loop)
				if (timeSinceLastChange < 100) {
					this.logger.warn(`⚠️ [FOCUS LOOP?] viewState changed ${ChatPanelProvider.viewStateChangeCount} times, ${timeSinceLastChange}ms since last`);
				}
				
				// Detect what actually changed
				const activeChanged = ChatPanelProvider.lastActiveState !== e.webviewPanel.active;
				const visibleChanged = ChatPanelProvider.lastVisibleState !== e.webviewPanel.visible;
				const viewColumnChanged = ChatPanelProvider.lastViewColumn !== e.webviewPanel.viewColumn;
				
				// EARLY EXIT: If ONLY active state changed (routine focus change), don't log spam
				if (activeChanged && !visibleChanged && !viewColumnChanged) {
					ChatPanelProvider.lastActiveState = e.webviewPanel.active;
					this.logger.debug(`[Focus] Panel ${e.webviewPanel.active ? 'gained' : 'lost'} focus`);
					return; // Silent at INFO level - no spam!
				}
				
				// Log detailed state at DEBUG level (hidden by default)
				this.logger.debug(`[ViewState] Change #${ChatPanelProvider.viewStateChangeCount}: active=${e.webviewPanel.active}, visible=${e.webviewPanel.visible}, column=${e.webviewPanel.viewColumn}`);
				
				// Log meaningful changes at INFO level (one line per change)
				if (viewColumnChanged) {
					this.logger.info(`[Panel Move] Column ${ChatPanelProvider.lastViewColumn} → ${e.webviewPanel.viewColumn}`);
					ChatPanelProvider.lastViewColumn = e.webviewPanel.viewColumn;
				}
				
				if (visibleChanged) {
					this.logger.info(`[Visibility] Panel ${e.webviewPanel.visible ? 'shown' : 'hidden'}`);
					ChatPanelProvider.lastVisibleState = e.webviewPanel.visible;
				}
				
				// Update active state tracking
				ChatPanelProvider.lastActiveState = e.webviewPanel.active;
				
				// Only update session list if viewColumn changed (panel moved to different workspace)
				if (!viewColumnChanged) {
					this.logger.debug(`[ViewState] Skipping session update - viewColumn unchanged`);
					return;
				}
				
				// Debounce session list updates to prevent spam
				if (ChatPanelProvider.updateSessionsListDebounceTimer) {
					clearTimeout(ChatPanelProvider.updateSessionsListDebounceTimer);
				}
				
				// Schedule new update (only runs if user stops moving panel for 500ms)
				ChatPanelProvider.updateSessionsListDebounceTimer = setTimeout(() => {
					this.logger.info(`[Session Update] Updating session list after panel move`);
					const { updateSessionsList } = require('./extension');
					updateSessionsList();
				}, ChatPanelProvider.UPDATE_SESSIONS_DEBOUNCE_MS);
			},
			null,
			disposables
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
		// Pass complete diff data to webview (toolCallId, beforeUri, afterUri, title)
		// Webview needs toolCallId to find the tool element and add diff button
		ChatPanelProvider.rpcRouter?.sendDiffAvailable(data);
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
	<!-- Component Mount Points - Components render themselves here -->
	<div id="session-toolbar-mount"></div>
	
	<main role="main">
		<div id="messages-mount"></div>
		<div id="acceptance-mount"></div>
		<div id="input-mount"></div>
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
