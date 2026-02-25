import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './logger';
import { getBackendState } from './backendState';
import { ExtensionRpcRouter } from './extension/rpc';
import { DisposableStore } from './utilities/disposable';
import { CodeReviewSlashHandlers } from './extension/services/slashCommands/CodeReviewSlashHandlers';
import { InfoSlashHandlers } from './extension/services/slashCommands/InfoSlashHandlers';
import { NotSupportedSlashHandlers } from './extension/services/slashCommands/NotSupportedSlashHandlers';
import { CLIPassthroughService } from './extension/services/CLIPassthroughService';
import { SessionService } from './extension/services/SessionService';
import { resolveImagePaths } from './extension/utils/resolveImagePaths';
import * as fs from 'fs';

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

	// Slash command services
	private codeReviewHandlers?: CodeReviewSlashHandlers;
	private infoHandlers?: InfoSlashHandlers;
	private notSupportedHandlers?: NotSupportedSlashHandlers;
	private cliPassthroughService?: CLIPassthroughService;

	// Event emitters to replace Set<Function> handlers
	private readonly _onDidReceiveUserMessage = this._reg(new vscode.EventEmitter<{text: string; attachments?: Array<{type: 'file'; path: string; displayName?: string}>}>());
	private readonly _onDidRequestAbort = this._reg(new vscode.EventEmitter<void>());
	private readonly _onDidRequestViewPlan = this._reg(new vscode.EventEmitter<void>());
	private readonly _onDidBecomeReady = this._reg(new vscode.EventEmitter<void>());
	private readonly _onDidRequestSwitchModel = this._reg(new vscode.EventEmitter<string>());

	// Public events
	readonly onDidReceiveUserMessage = this._onDidReceiveUserMessage.event;
	readonly onDidRequestAbort = this._onDidRequestAbort.event;
	readonly onDidRequestViewPlan = this._onDidRequestViewPlan.event;
	readonly onDidBecomeReady = this._onDidBecomeReady.event;
	readonly onDidRequestSwitchModel = this._onDidRequestSwitchModel.event;

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
				vscode.Uri.file(path.join(os.homedir(), '.copilot')),
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
				activeFilePath: fullState.activeFilePath,
				currentModel: fullState.currentModel
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

		this._reg(this.rpcRouter.onPasteImage((payload) => {
			this.logger.info(`Pasted image received: ${payload.fileName}`);
			this._handlePastedImage(payload.dataUri, payload.mimeType, payload.fileName);
		}));

		this._reg(this.rpcRouter.onSaveMermaidImage(async (payload) => {
			this.logger.info('Save mermaid image requested');
			await this._handleSaveMermaidImage(payload.svgContent, payload.source);
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

		// Initialize slash command services
		// Create sessionService adapter
		const sessionService = {
			getCurrentSession: () => {
				const backendState = getBackendState();
				const sessionId = backendState.getSessionId();
				return sessionId ? { id: sessionId } : null;
			},
			getPlanPath: (sessionId: string) => {
				const sessionStateDir = path.join(os.homedir(), '.copilot', 'session-state');
				return path.join(sessionStateDir, sessionId, 'plan.md');
			}
		};

		this.codeReviewHandlers = new CodeReviewSlashHandlers(sessionService);
		this.infoHandlers = new InfoSlashHandlers(undefined, getBackendState()); // MCP config will be undefined for now
		this.notSupportedHandlers = new NotSupportedSlashHandlers();
		this.cliPassthroughService = new CLIPassthroughService(vscode);

		// Handle slash commands from webview
		this._reg(this.rpcRouter.onShowPlanContent(async () => {
			this.logger.info('Show plan content requested from UI');
			const result = await this.codeReviewHandlers!.handleReview();
			if (result.success && result.content) {
				this.rpcRouter!.addAssistantMessage(result.content);
			} else if (result.error) {
				this.rpcRouter!.addAssistantMessage(`Error: ${result.error}`);
			}
		}));

		this._reg(this.rpcRouter.onOpenDiffView(async (payload) => {
			this.logger.info(`Open diff view requested: ${payload.file1} vs ${payload.file2}`);
			const result = await this.codeReviewHandlers!.handleDiff(payload.file1, payload.file2);
			if (!result.success && result.error) {
				this.rpcRouter!.addAssistantMessage(`Error: ${result.error}`);
			}
		}));

		this._reg(this.rpcRouter.onShowMcpConfig(async () => {
			this.logger.info('Show MCP config requested from UI');
			const result = await this.infoHandlers!.handleMcp();
			if (result.success && result.content) {
				this.rpcRouter!.addAssistantMessage(result.content);
			} else if (result.error) {
				this.rpcRouter!.addAssistantMessage(`Error: ${result.error}`);
			}
		}));

		this._reg(this.rpcRouter.onShowUsageMetrics(async () => {
			this.logger.info('Show usage metrics requested from UI');
			const result = await this.infoHandlers!.handleUsage();
			if (result.success && result.content) {
				this.rpcRouter!.addAssistantMessage(result.content);
			} else if (result.error) {
				this.rpcRouter!.addAssistantMessage(`Error: ${result.error}`);
			}
		}));

		this._reg(this.rpcRouter.onShowHelp(async (payload) => {
			this.logger.info(`Show help requested from UI: ${payload.command || 'all'}`);
			const result = await this.infoHandlers!.handleHelp(payload.command);
			if (result.success && result.content) {
				this.rpcRouter!.addAssistantMessage(result.content);
			} else if (result.error) {
				this.rpcRouter!.addAssistantMessage(`Error: ${result.error}`);
			}
		}));

		this._reg(this.rpcRouter.onShowNotSupported(async (payload) => {
			this.logger.info(`Not supported command: ${payload.command}`);
			const result = await this.notSupportedHandlers!.handleNotSupported(payload.command);
			if (result.success && result.content) {
				this.rpcRouter!.addAssistantMessage(result.content);
			}
		}));

		this._reg(this.rpcRouter.onOpenInCLI(async (payload) => {
			this.logger.info(`Open in CLI requested: ${payload.command}`);
			
			// Get current session ID and workspace path
			const backendState = getBackendState();
			const sessionId = backendState.getSessionId();
			const workspacePath = backendState.getWorkspacePath() || this.currentWorkspacePath || null;

			if (!sessionId) {
				this.rpcRouter!.addAssistantMessage('No active session. Please start a session first.');
				return;
			}

			const result = this.cliPassthroughService!.openCLI(payload.command, sessionId, workspacePath);
			
			if (result.success && result.instruction) {
				this.rpcRouter!.addAssistantMessage(result.instruction);
			} else if (result.error) {
				this.rpcRouter!.addAssistantMessage(`Error: ${result.error}`);
			}
		}));

		this._reg(this.rpcRouter.onSwitchModel((payload) => {
			this.logger.info(`Switch model requested: ${payload.model}`);
			this._onDidRequestSwitchModel.fire(payload.model);
		}));

		this._reg(this.rpcRouter.onOpenFile(async (payload) => {
			this.logger.info(`[OpenFile] ${payload.filePath}`);
			const resolved = path.resolve(payload.filePath);
			const workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
			const sessionStateDir = path.join(os.homedir(), '.copilot', 'session-state');
			const allowed = workspaceFolders.some(ws => resolved.startsWith(ws + path.sep)) ||
				resolved.startsWith(sessionStateDir + path.sep);
			if (!allowed) {
				this.logger.warn(`[OpenFile] Blocked: path outside workspace and session-state`);
				return;
			}
			try {
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (err: any) {
				this.logger.warn(`[OpenFile] Failed: ${err.message}`);
			}
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

		// Resolve relative image paths in markdown to webview URIs
		const resolvedText = this._resolveAssistantImagePaths(text);
		this.rpcRouter?.addAssistantMessage(resolvedText);
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

	public sendModelSwitched(model: string, success: boolean) {
		this.rpcRouter?.sendModelSwitched(model, success);
	}

	public sendCurrentModel(model: string) {
		this.rpcRouter?.sendCurrentModel(model);
	}

	public sendAvailableModels(models: Array<{ id: string; name: string }>) {
		this.rpcRouter?.sendAvailableModels(models);
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

	private async _handlePastedImage(dataUri: string, _mimeType: string, fileName: string) {
		try {
			// Extract base64 data from data URI
			const base64Data = dataUri.split(',')[1];
			if (!base64Data) {
				this.logger.warn('[PASTE] Invalid data URI — no base64 portion');
				return;
			}

			const buffer = Buffer.from(base64Data, 'base64');

			// Write to temp file
			const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-paste-'));
			const tempFilePath = path.join(tempDir, fileName);
			fs.writeFileSync(tempFilePath, buffer);
			this.logger.info(`[PASTE] Wrote temp file: ${tempFilePath} (${buffer.length} bytes)`);

			// Validate via the same callback as file picker
			if (this.validateAttachmentsCallback) {
				const validationResult = await this.validateAttachmentsCallback([tempFilePath]);
				if (!validationResult.valid) {
					this.logger.warn(`[PASTE] Validation failed: ${validationResult.error}`);
					vscode.window.showErrorMessage(validationResult.error || 'Invalid image');
					// Clean up temp file
					try { fs.unlinkSync(tempFilePath); fs.rmdirSync(tempDir); } catch { /* ignore */ }
					return;
				}
			}

			// Create webview URI and send back as filesSelected (reuses existing flow)
			const fileUri = vscode.Uri.file(tempFilePath);
			const webviewUri = this._view?.webview.asWebviewUri(fileUri);
			const attachment = {
				type: 'file' as const,
				path: tempFilePath,
				displayName: fileName,
				webviewUri: webviewUri?.toString() || ''
			};

			// Schedule temp file cleanup after SDK has had time to consume it
			setTimeout(() => {
				try { fs.unlinkSync(tempFilePath); fs.rmdirSync(tempDir); } catch { /* ignore */ }
			}, 30_000);

			this.logger.info(`[PASTE] Sending pasted image attachment to webview`);
			this.postMessage({
				type: 'filesSelected',
				attachments: [attachment]
			});
		} catch (error) {
			this.logger.error('[PASTE] Failed to handle pasted image', error instanceof Error ? error : undefined);
		}
	}

	private async _handleSaveMermaidImage(svgContent: string, source: string) {
		try {
			const options: vscode.SaveDialogOptions = {
				filters: svgContent
					? { 'SVG Image': ['svg'], 'Mermaid Source': ['mmd'] }
					: { 'Mermaid Source': ['mmd'] }
			};
			const workspaceFolderUri = vscode.workspace.workspaceFolders?.[0]?.uri;
			if (workspaceFolderUri) {
				options.defaultUri = vscode.Uri.joinPath(workspaceFolderUri, 'diagram');
			}
			const uri = await vscode.window.showSaveDialog(options);
			if (!uri) {
				this.logger.info('[Mermaid] Save cancelled');
				return;
			}

			const isMmd = uri.fsPath.endsWith('.mmd');
			const content = isMmd ? source : svgContent;
			await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
			vscode.window.showInformationMessage(`Saved mermaid ${isMmd ? 'source' : 'image'} to ${path.basename(uri.fsPath)}`);
			this.logger.info(`[Mermaid] Saved ${isMmd ? 'source' : 'SVG'} to ${uri.fsPath}`);
		} catch (error) {
			this.logger.error('[Mermaid] Failed to save', error instanceof Error ? error : undefined);
			vscode.window.showErrorMessage('Failed to save mermaid diagram');
		}
	}

	private _resolveAssistantImagePaths(text: string): string {
		const backendState = getBackendState();
		const sessionId = backendState.getSessionId();
		if (!sessionId || !this._view?.webview) {
			this.logger?.debug(`[ImageResolve] Skipped: sessionId=${!!sessionId} webview=${!!this._view?.webview}`);
			return text;
		}

		const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId);
		const webview = this._view.webview;

		const additionalDirs: string[] = [];
		if (this.currentWorkspacePath) {
			additionalDirs.push(this.currentWorkspacePath);
		}

		this.logger?.debug(`[ImageResolve] Input: "${text.substring(0, 100)}" sessionDir=${sessionDir} additionalDirs=${JSON.stringify(additionalDirs)}`);

		const result = resolveImagePaths(text, sessionDir, (absolutePath: string) => {
			const exists = fs.existsSync(absolutePath);
			this.logger?.debug(`[ImageResolve] Check: ${absolutePath} exists=${exists}`);
			if (!exists) {
				return null;
			}
			const fileUri = vscode.Uri.file(absolutePath);
			const uri = webview.asWebviewUri(fileUri).toString();
			this.logger?.debug(`[ImageResolve] Resolved: ${uri}`);
			return uri;
		}, additionalDirs);

		if (result !== text) {
			this.logger?.info(`[ImageResolve] Resolved image paths in message`);
			this.logger?.debug(`[ImageResolve] Output: "${result.substring(0, 200)}"`);
		}

		return result;
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
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource} https://cdn.jsdelivr.net; img-src ${webview.cspSource} data:; font-src ${webview.cspSource} data:;">
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
