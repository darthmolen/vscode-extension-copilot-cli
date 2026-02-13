import * as vscode from 'vscode';
import { Logger } from './logger';
import { getBackendState } from './backendState';
import { ExtensionRpcRouter } from './extension/rpc';
import { DisposableStore } from './utilities/disposable';

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'copilot-cli.chatView';

	private readonly _disposables = new DisposableStore();
	private _view: vscode.WebviewView | undefined;
	private readonly logger: Logger;
	private readonly extensionUri: vscode.Uri;
	private rpcRouter: ExtensionRpcRouter | undefined;
	private isSessionActive: boolean = false;
	private currentWorkspacePath: string | undefined;
	private lastSentMessage: string | undefined;
	private lastSentTime: number = 0;
	private validateAttachmentsCallback: ((filePaths: string[]) => Promise<{ valid: boolean; error?: string }>) | undefined;

	// Event emitters to replace Set<Function> handlers
	private readonly _onDidReceiveUserMessage = this._reg(new vscode.EventEmitter<{text: string; attachments?: Array<{type: 'file'; path: string; displayName?: string}>}>());
	private readonly _onDidRequestAbort = this._reg(new vscode.EventEmitter<void>());
	private readonly _onDidRequestViewPlan = this._reg(new vscode.EventEmitter<void>());
	private readonly _onDidBecomeReady = this._reg(new vscode.EventEmitter<void>());

	// Public events
	readonly onDidReceiveUserMessage = this._onDidReceiveUserMessage.event;
	readonly onDidRequestAbort = this._onDidRequestAbort.event;
	readonly onDidRequestViewPlan = this._onDidRequestViewPlan.event;
	readonly onDidBecomeReady = this._onDidBecomeReady.event;

	constructor(extensionUri: vscode.Uri) {
		this.extensionUri = extensionUri;
		this.logger = Logger.getInstance();
	}

	private _reg<T extends vscode.Disposable>(disposable: T): T {
		return this._disposables.add(disposable);
	}

	/**
	 * Called by VS Code when the sidebar view needs to be rendered.
	 * Replaces the old createOrShow() — VS Code owns the view lifecycle.
	 */
	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;

		const webview = webviewView.webview;
		webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this.extensionUri,
				...(vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri)
			]
		};

		// Listen for visibility changes (replaces onDidChangeViewState)
		this._reg(webviewView.onDidChangeVisibility(() => {
			const visible = webviewView.visible;
			this.logger.debug(`[Visibility] Sidebar ${visible ? 'shown' : 'hidden'}`);
		}));

		// Handle view disposal (VS Code closes the sidebar)
		webviewView.onDidDispose(() => {
			this.logger.info('[Sidebar] View disposed by VS Code');
			this._view = undefined;
			this.rpcRouter = undefined;
		});

		// Setup RPC router and handlers
		this._setupRpcHandlers(webview);

		// Set HTML — webview loads and sends 'ready' which RPC handlers catch
		webview.html = this._getHtmlForWebview(webview);

		this.logger.info('Sidebar chat view resolved');
	}

	/**
	 * Focus the sidebar view programmatically.
	 * Replaces panel.reveal() for commands like openChat.
	 */
	public show(): void {
		vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
	}

	/**
	 * Check if the view is ready to receive messages.
	 */
	public isViewReady(): boolean {
		return this._view !== undefined && this.rpcRouter !== undefined;
	}

	/**
	 * Extract RPC handler setup into its own method.
	 * Called once when the view is first resolved.
	 */
	private _setupRpcHandlers(webview: vscode.Webview): void {
		this.rpcRouter = new ExtensionRpcRouter(webview);

		this._reg(this.rpcRouter.onReady(() => {
			this.logger.info('Webview is ready');

			const backendState = getBackendState();
			const fullState = backendState.getFullState();

			this.logger.info(`[Init] Sending ${fullState.messages.length} messages to webview`);

			this.rpcRouter!.sendInit({
				sessionId: fullState.sessionId,
				sessionActive: fullState.sessionActive,
				messages: fullState.messages as any,
				planModeStatus: fullState.planModeStatus,
				workspacePath: fullState.workspacePath,
				activeFilePath: fullState.activeFilePath
			});

			this._onDidBecomeReady.fire();
		}));

		this._reg(this.rpcRouter.onSendMessage((payload) => {
			// Prevent duplicate sends (same message within 1 second)
			const now = Date.now();
			if (this.lastSentMessage === payload.text &&
			    now - this.lastSentTime < 1000) {
				this.logger.warn(`Ignoring duplicate message send: ${payload.text.substring(0, 50)}...`);
				return;
			}
			this.lastSentMessage = payload.text;
			this.lastSentTime = now;

			this.logger.info(`User sent message: ${payload.text.substring(0, 100)}...`);
			if (payload.attachments && payload.attachments.length > 0) {
				this.logger.info(`  with ${payload.attachments.length} attachment(s)`);
			}
			this._onDidReceiveUserMessage.fire({
				text: payload.text,
				attachments: payload.attachments
			});
		}));

		this._reg(this.rpcRouter.onPickFiles(() => {
			this.logger.info('File picker requested from UI');
			this._handleFilePicker();
		}));

		this._reg(this.rpcRouter.onAbortMessage(() => {
			this.logger.info('Abort requested from UI');
			this._onDidRequestAbort.fire();
		}));

		this._reg(this.rpcRouter.onSwitchSession((payload) => {
			this.logger.info(`Switch session requested: ${payload.sessionId}`);
			vscode.commands.executeCommand('copilot-cli-extension.switchSession', payload.sessionId);
		}));

		this._reg(this.rpcRouter.onNewSession(() => {
			this.logger.info('New session requested from UI');
			vscode.commands.executeCommand('copilot-cli-extension.newSession');
		}));

		this._reg(this.rpcRouter.onViewPlan(() => {
			this.logger.info('View plan requested from UI');
			this._onDidRequestViewPlan.fire();
		}));

		this._reg(this.rpcRouter.onViewDiff((payload) => {
			this.logger.info(`View diff requested from UI: ${JSON.stringify(payload)}`);
			vscode.commands.executeCommand('copilot-cli-extension.viewDiff', payload);
		}));

		this._reg(this.rpcRouter.onTogglePlanMode((payload) => {
			this.logger.info(`Plan mode toggle requested: ${payload.enabled}`);
			vscode.commands.executeCommand('copilot-cli-extension.togglePlanMode', payload.enabled);
		}));

		this._reg(this.rpcRouter.onAcceptPlan(() => {
			this.logger.info('Accept plan requested from UI');
			vscode.commands.executeCommand('copilot-cli-extension.acceptPlan');
		}));

		this._reg(this.rpcRouter.onRejectPlan(() => {
			this.logger.info('Reject plan requested from UI');
			vscode.commands.executeCommand('copilot-cli-extension.rejectPlan');
		}));

		// Start listening for messages from webview
		this.rpcRouter.listen();
	}

	public postMessage(message: any) {
		if (this._view) {
			this._view.webview.postMessage(message);
		}
	}

	public addUserMessage(text: string, attachments?: Array<{displayName: string; webviewUri?: string}>, storeInBackend: boolean = true) {
		if (storeInBackend) {
			const backendState = getBackendState();
			backendState.addMessage({
				role: 'user',
				type: 'user',
				content: text,
				timestamp: Date.now()
			});
		}
		this.rpcRouter?.addUserMessage(text, attachments as any);
	}

	public addAssistantMessage(text: string, storeInBackend: boolean = true) {
		if (storeInBackend) {
			const backendState = getBackendState();
			backendState.addMessage({
				role: 'assistant',
				type: 'assistant',
				content: text,
				timestamp: Date.now()
			});
		}
		this.rpcRouter?.addAssistantMessage(text);
	}

	public addReasoningMessage(text: string, storeInBackend: boolean = true) {
		if (storeInBackend) {
			const backendState = getBackendState();
			backendState.addMessage({
				role: 'assistant',
				type: 'reasoning',
				content: text,
				timestamp: Date.now()
			});
		}
		this.rpcRouter?.addReasoningMessage(text);
	}

	public addToolExecution(toolState: any, storeInBackend: boolean = true) {
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
		this.rpcRouter?.toolStart(toolState);
	}

	public updateToolExecution(toolState: any) {
		this.rpcRouter?.toolUpdate(toolState);
	}

	public notifyDiffAvailable(data: any) {
		this.rpcRouter?.sendDiffAvailable(data);
	}

	public appendToLastMessage(text: string) {
		this.rpcRouter?.appendMessage(text);
	}

	public setSessionActive(active: boolean) {
		this.isSessionActive = active;
		this.rpcRouter?.setSessionActive(active);
	}

	public setThinking(isThinking: boolean) {
		this.rpcRouter?.setThinking(isThinking);
	}

	public clearMessages() {
		this.rpcRouter?.clearMessages();
	}

	public resetPlanMode() {
		this.rpcRouter?.resetPlanMode();
	}

	public updateSessions(sessions: Array<{id: string, label: string}>, currentSessionId: string | null) {
		this.logger?.info(`Updating session dropdown: ${sessions.length} sessions, current=${currentSessionId}`);
		this.rpcRouter?.updateSessions(sessions as any, currentSessionId);
	}

	public setWorkspacePath(workspacePath: string | undefined) {
		this.currentWorkspacePath = workspacePath;
		this.rpcRouter?.setWorkspacePath(workspacePath || null);
	}

	public updateActiveFile(filePath: string | null) {
		this.rpcRouter?.setActiveFile(filePath);
	}

	private async _handleFilePicker() {
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

			if (this.validateAttachmentsCallback) {
				const filePaths = fileUris.map(uri => uri.fsPath);
				const validationResult = await this.validateAttachmentsCallback(filePaths);
				if (!validationResult.valid) {
					this.logger.warn(`[ATTACH] Validation failed: ${validationResult.error}`);
					vscode.window.showErrorMessage(validationResult.error || 'Invalid attachment');
					return;
				}
			} else {
				this.logger.warn('[ATTACH] No validation callback registered; blocking attachment');
				vscode.window.showErrorMessage('File attachments are not ready yet. Please try again in a moment.');
				return;
			}

			const attachments = fileUris.map(uri => {
				const webviewUri = this._view?.webview.asWebviewUri(uri);
				return {
					type: 'file' as const,
					path: uri.fsPath,
					displayName: uri.fsPath.split(/[/\\]/).pop() || 'unknown',
					webviewUri: webviewUri?.toString() || ''
				};
			});

			this.logger.info(`[ATTACH] Sending ${attachments.length} attachments to webview`);
			this.postMessage({
				type: 'filesSelected',
				attachments
			});
		} else {
			this.logger.info('File picker cancelled');
		}
	}

	public setValidateAttachmentsCallback(callback: (filePaths: string[]) => Promise<{ valid: boolean; error?: string }>) {
		this.validateAttachmentsCallback = callback;
		this.logger?.info('Attachment validation callback registered');
	}

	/**
	 * Force refresh the webview content.
	 * For sidebar views, we can't dispose/recreate — just reset the HTML.
	 */
	public forceRecreate() {
		if (this._view) {
			this._view.webview.html = this._getHtmlForWebview(this._view.webview);
			this.resetPlanMode();
		}
	}

	public dispose(): void {
		this._disposables.dispose();
		this.rpcRouter = undefined;
		// Don't dispose _view — VS Code owns the sidebar view lifecycle
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const nonce = getNonce();

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
