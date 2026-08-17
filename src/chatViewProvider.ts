import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './logger';
import { getBackendState } from './backendState';
import { ExtensionRpcRouter } from './extension/rpc';
import { registerChatHandlers, ChatHandlerContext } from './extension/rpc/registerChatHandlers';
import { buildChatHtml } from './extension/webview/chatHtml';
import { resolveChatHtmlAssets } from './extension/webview/chatHtmlAssets';
import { DisposableStore } from './utilities/disposable';
import { CodeReviewSlashHandlers } from './extension/services/slashCommands/CodeReviewSlashHandlers';
import { InfoSlashHandlers } from './extension/services/slashCommands/InfoSlashHandlers';
import { NotSupportedSlashHandlers } from './extension/services/slashCommands/NotSupportedSlashHandlers';
import { CompactSlashHandlers } from './extension/services/slashCommands/CompactSlashHandlers';
import { CLIPassthroughService } from './extension/services/CLIPassthroughService';
import { SessionService } from './extension/services/SessionService';
import { CustomAgentsService } from './extension/services/CustomAgentsService';
import { resolveImagePaths } from './extension/utils/resolveImagePaths';
import { ManagedMCPRegistry } from './extension/services/managedMCPRegistry';
import { MCPConfigurationService } from './extension/services/mcpConfigurationService';
import { CliCapabilityService } from './extension/services/cliCapabilityService';
import { ChatSessionHost } from './extension/session/ChatSessionHost';
import { buildMcpServerStatusList, mergeMcpListWithConfig, mergeCopilotConfigList } from './extension/services/mcpStatusBuilder';
import type { McpServerSource, McpServerActionPayload } from './shared/messages';
import {
	validateMcpServerInput,
	addMcpServerToConfig,
	editMcpServerInConfig,
	removeMcpServerFromConfig,
	setMcpServerEnabled,
	preserveEnabledFlag,
	McpServerInput,
} from './extension/services/mcpServerMutations';
import * as fs from 'fs';

declare const __SDK_VERSION__: string | undefined;
declare const __EXTENSION_VERSION__: string | undefined;

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = 'copilot-cli.chatView';

	private readonly _disposables = new DisposableStore();
	private _view: vscode.WebviewView | undefined;
	private readonly logger: Logger;
	private readonly extensionUri: vscode.Uri;
	private rpcRouter: ExtensionRpcRouter | undefined;
	private isSessionActive: boolean = false;
	private currentWorkspacePath: string | undefined;
	/** Duplicate-send suppression, shared by reference with the RPC handlers. */
	private readonly sendDedup = { lastMessage: undefined as string | undefined, lastTime: 0 };
	private validateAttachmentsCallback: ((filePaths: string[]) => Promise<{ valid: boolean; error?: string }>) | undefined;

	/**
	 * The session this surface is showing.
	 *
	 * The slash-command services come from here rather than being fields: they
	 * belong to a conversation, and this surface can be pointed at a different one.
	 */
	private sessionHost?: ChatSessionHost;

	private compactHandlers?: CompactSlashHandlers;
	private customAgentsService: CustomAgentsService = new CustomAgentsService();

	// Event emitters to replace Set<Function> handlers
	private readonly _onDidReceiveUserMessage = this._reg(new vscode.EventEmitter<{text: string; attachments?: Array<{type: 'file'; path: string; displayName?: string}>; agentName?: string}>());
	private readonly _onDidRequestAbort = this._reg(new vscode.EventEmitter<void>());
	private readonly _onDidRequestViewPlan = this._reg(new vscode.EventEmitter<void>());
	private readonly _onDidBecomeReady = this._reg(new vscode.EventEmitter<void>());
	private readonly _onDidRequestSwitchModel = this._reg(new vscode.EventEmitter<string>());
	private readonly _onDidRequestRenameSession = this._reg(new vscode.EventEmitter<string>());
	private readonly _onDidRequestForkSession = this._reg(new vscode.EventEmitter<void>());
	private readonly _onDidRequestCompact = this._reg(new vscode.EventEmitter<void>());
	private readonly _onDidSelectAgent = this._reg(new vscode.EventEmitter<string | null>());
	private readonly _onDidRequestReloadAgents = this._reg(new vscode.EventEmitter<void>());

	// Public events
	readonly onDidReceiveUserMessage = this._onDidReceiveUserMessage.event;
	readonly onDidRequestAbort = this._onDidRequestAbort.event;
	readonly onDidRequestViewPlan = this._onDidRequestViewPlan.event;
	readonly onDidBecomeReady = this._onDidBecomeReady.event;
	readonly onDidRequestSwitchModel = this._onDidRequestSwitchModel.event;
	readonly onDidRequestRenameSession = this._onDidRequestRenameSession.event;
	readonly onDidRequestForkSession = this._onDidRequestForkSession.event;
	readonly onDidRequestCompact = this._onDidRequestCompact.event;
	readonly onDidSelectAgent = this._onDidSelectAgent.event;
	readonly onDidRequestReloadAgents = this._onDidRequestReloadAgents.event;

	private cliCapability: CliCapabilityService | null = null;
	private mcpListProvider: (() => Promise<any[]>) | null = null;
	private importedServersProvider: (() => Record<string, any>) | null = null;
	private mcpConfigListProvider: (() => Promise<Record<string, any>>) | null = null;

	constructor(
		extensionUri: vscode.Uri,
		cliCapability?: CliCapabilityService,
		mcpListProvider?: () => Promise<any[]>
	) {
		this.extensionUri = extensionUri;
		this.logger = Logger.getInstance();
		this.cliCapability = cliCapability ?? null;
		this.mcpListProvider = mcpListProvider ?? null;
	}

	public setCliCapability(capability: CliCapabilityService): void {
		this.cliCapability = capability;
	}

	/**
	 * Point this surface at a session. Must happen before the webview registers
	 * handlers, since the slash-command services are read through the host.
	 */
	public setSessionHost(host: ChatSessionHost): void {
		this.sessionHost = host;
	}

	public getSessionHost(): ChatSessionHost | undefined {
		return this.sessionHost;
	}

	public setMcpListProvider(provider: () => Promise<any[]>): void {
		this.mcpListProvider = provider;
	}

	public setImportedServersProvider(provider: () => Record<string, any>): void {
		this.importedServersProvider = provider;
	}

	public setMcpConfigListProvider(provider: () => Promise<Record<string, any>>): void {
		this.mcpConfigListProvider = provider;
	}

	/**
	 * Read-only fetch of the Copilot CLI's own configured MCP servers. Returns
	 * {} when the capability is unavailable or the RPC fails — the panel simply
	 * omits the Copilot section rather than erroring.
	 */
	private async fetchCopilotConfiguredServers(): Promise<Record<string, any>> {
		if (!this.cliCapability?.supportsMcpConfigRpc() || !this.mcpConfigListProvider) {
			return {};
		}
		try {
			return await this.mcpConfigListProvider();
		} catch (err: any) {
			this.logger.warn(`[MCP] mcp.config.list RPC failed: ${err?.message ?? err}`);
			return {};
		}
	}

	/**
	 * Build the full /mcp panel server list (user + managed + imported + Copilot
	 * config) and push it to the webview. Used by /mcp and to refresh after edits.
	 */
	private async buildAndSendMcpStatus(): Promise<void> {
		try {
			const mcpRegistry = new ManagedMCPRegistry();
			const userConfig = vscode.workspace.getConfiguration('copilotCLI')
				.get<Record<string, any>>('mcpServers', {});
			const managedServers = mcpRegistry.getManagedServers();
			// Display set includes DISABLED user servers (with `enabled` preserved)
			// so they remain visible/re-enableable — unlike the SDK feed, which
			// filters them. See getMCPServersForDisplay vs getEnabledMCPServers.
			const userDisplay = this.sessionHost!.services.mcpConfigService.getMCPServersForDisplay(userConfig);
			const imported = this.importedServersProvider?.() ?? {};
			// Precedence for display: imported < user < managed.
			const allServers = { ...imported, ...userDisplay, ...managedServers };

			// A key is "imported" only when it isn't shadowed by a user or managed entry.
			const sources: Record<string, McpServerSource> = {};
			for (const key of Object.keys(imported)) {
				if (!(key in userDisplay) && !(key in managedServers)) {
					sources[key] = 'imported';
				}
			}

			// Read-only view of the Copilot CLI's own configured servers.
			const copilotServers = await this.fetchCopilotConfiguredServers();

			if (this.cliCapability?.supportsMcpListRpc() && this.mcpListProvider) {
				try {
					const sdkList = await this.mcpListProvider();
					this.logger.debug(`[MCP] Raw SDK list: ${JSON.stringify(sdkList).substring(0, 300)}`);
					const servers = mergeCopilotConfigList(
						mergeMcpListWithConfig(allServers, sdkList, sources),
						copilotServers
					);
					this.logger.info(`[MCP] Sending mcpStatus (live): ${servers.map(s => `${s.name}=${s.status}`).join(', ')}`);
					this.rpcRouter!.sendMcpStatus(servers);
					return;
				} catch (rpcErr: any) {
					this.logger.warn(`[MCP] mcp.list RPC failed, falling back to config view: ${rpcErr.message}`);
				}
			}

			const knownTools = getBackendState().getMcpServerTools();
			const knownStatuses = getBackendState().getMcpServerStatuses();
			const capabilityFlags = {
				supportsMcpStatusEvents: () => this.cliCapability?.supportsMcpStatusEvents() ?? false,
			};

			const servers = mergeCopilotConfigList(
				buildMcpServerStatusList(allServers, knownTools, knownStatuses, capabilityFlags, sources),
				copilotServers
			);

			this.logger.info(`[MCP] Sending mcpStatus: ${servers.map(s => `${s.name}=${s.status}`).join(', ')}`);
			this.rpcRouter!.sendMcpStatus(servers);
		} catch (err: any) {
			this.logger.error(`[MCP] Failed to build server status: ${err.message}`);
			this.rpcRouter!.sendMcpStatus([]);
		}
	}

	/**
	 * Apply an add/edit/remove/setEnabled action to the extension's own
	 * `copilotCLI.mcpServers` setting. This is the ONLY MCP config the extension
	 * writes — managed/imported/Copilot servers are never mutated here.
	 */
	private async handleMcpServerAction(payload: McpServerActionPayload): Promise<void> {
		const { action, config, enabled } = payload;
		// Normalize names once (validation trims internally; the persisted key must
		// match the validated name, not a whitespace-padded raw payload value).
		const name = (payload.name ?? '').trim();
		const originalName = payload.originalName?.trim();
		this.logger.info(`[MCP] server action: ${action} "${name}"`);
		try {
			const cfg = vscode.workspace.getConfiguration('copilotCLI');
			const current = cfg.get<Record<string, any>>('mcpServers', {});
			let next: Record<string, any>;

			if (action === 'add') {
				const existing = Object.keys(current);
				const validation = validateMcpServerInput({ name, ...(config ?? {}) } as McpServerInput, existing);
				if (!validation.valid) {
					this.rpcRouter!.sendMcpServerActionResult({ success: false, action, name, errors: validation.errors });
					return;
				}
				next = addMcpServerToConfig(current, name, config ?? {});
			} else if (action === 'edit') {
				const prevName = originalName ?? name;
				const existing = Object.keys(current).filter(k => k !== prevName);
				const validation = validateMcpServerInput({ name, ...(config ?? {}) } as McpServerInput, existing);
				if (!validation.valid) {
					this.rpcRouter!.sendMcpServerActionResult({ success: false, action, name, errors: validation.errors });
					return;
				}
				// Preserve the prior enabled state (the form has no enabled field, so
				// editing/renaming a disabled server must not silently re-enable it).
				const merged = preserveEnabledFlag(current[prevName], config ?? {});
				// Support rename: drop the old key, then write the new one.
				next = editMcpServerInConfig(removeMcpServerFromConfig(current, prevName), name, merged);
			} else if (action === 'remove') {
				next = removeMcpServerFromConfig(current, name);
			} else { // setEnabled
				next = setMcpServerEnabled(current, name, enabled ?? true);
			}

			await cfg.update('mcpServers', next, vscode.ConfigurationTarget.Global);
			this.rpcRouter!.sendMcpServerActionResult({ success: true, action, name });
			await this.buildAndSendMcpStatus();
		} catch (err: any) {
			this.logger.error(`[MCP] server action failed: ${err?.message ?? err}`);
			this.rpcRouter!.sendMcpServerActionResult({ success: false, action, name, errors: [String(err?.message ?? err)] });
		}
	}

	public getCliCapability(): CliCapabilityService | null {
		return this.cliCapability;
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
				// Full tmpdir needed: pasted images go into random copilot-paste-<uuid> subdirs
				vscode.Uri.file(os.tmpdir()),
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
		registerChatHandlers(this._handlerContext(this.rpcRouter));
		// Start listening for messages from webview
		this.rpcRouter.listen();
	}

	/**
	 * Adapt this view to the surface-agnostic handler contract.
	 *
	 * Getters rather than plain properties throughout: several of these are
	 * assigned after construction (`setCliCapability`, `setWorkspacePath`, the
	 * slash-command services) and handlers run long after registration, so
	 * copying values here would freeze whatever happened to be set at resolve
	 * time.
	 */
	private _handlerContext(rpcRouter: ExtensionRpcRouter): ChatHandlerContext {
		const self = this;
		return {
			rpcRouter,
			reg: <T extends vscode.Disposable>(d: T) => self._reg(d),
			sendDedup: this.sendDedup,
			get logger() { return self.logger; },
			get currentWorkspacePath() { return self.currentWorkspacePath; },
			get customAgentsService() { return self.customAgentsService; },
			// Read from the session that owns them, never assigned. Getters rather
			// than copies because the host is attached after construction and can
			// be replaced when this surface changes session.
			get infoHandlers() { return self.sessionHost?.services.infoHandlers; },
			get codeReviewHandlers() { return self.sessionHost?.services.codeReviewHandlers; },
			get notSupportedHandlers() { return self.sessionHost?.services.notSupportedHandlers; },
			get mcpConfigService() { return self.sessionHost?.services.mcpConfigService; },
			get cliPassthroughService() { return self.sessionHost?.services.cliPassthroughService; },
			get cliCapability() { return self.cliCapability; },
			buildAndSendMcpStatus: () => self.buildAndSendMcpStatus(),
			handleMcpServerAction: (payload) => self.handleMcpServerAction(payload),
			_handleFilePicker: () => self._handleFilePicker(),
			_handlePastedImage: (dataUri, mimeType, fileName) => self._handlePastedImage(dataUri, mimeType, fileName),
			_handleSaveMermaidImage: (svg, source) => self._handleSaveMermaidImage(svg, source),
			_onDidReceiveUserMessage: this._onDidReceiveUserMessage,
			_onDidRequestAbort: this._onDidRequestAbort,
			_onDidRequestViewPlan: this._onDidRequestViewPlan,
			_onDidBecomeReady: this._onDidBecomeReady,
			_onDidRequestSwitchModel: this._onDidRequestSwitchModel,
			_onDidRequestRenameSession: this._onDidRequestRenameSession,
			_onDidRequestForkSession: this._onDidRequestForkSession,
			_onDidRequestCompact: this._onDidRequestCompact,
			_onDidSelectAgent: this._onDidSelectAgent,
			_onDidRequestReloadAgents: this._onDidRequestReloadAgents,
		};
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
				kind: 'user',
				role: 'user',
				content: text,
				timestamp: Date.now()
			});
		}
		this.rpcRouter?.addUserMessage(text, attachments as any);
	}

	public addAssistantMessage(text: string, messageId?: string, storeInBackend: boolean = true) {
		if (storeInBackend) {
			const backendState = getBackendState();
			backendState.addMessage({
				kind: 'assistant',
				role: 'assistant',
				content: text,
				timestamp: Date.now()
			});
		}

		// Resolve relative image paths in markdown to webview URIs
		const resolvedText = this._resolveAssistantImagePaths(text);
		this.rpcRouter?.addAssistantMessage(resolvedText, messageId);
	}

	public addReasoningMessage(text: string, storeInBackend: boolean = true, reasoningId?: string) {
		if (storeInBackend) {
			const backendState = getBackendState();
			backendState.addMessage({
				kind: 'reasoning',
				role: 'reasoning',
				content: text,
				timestamp: Date.now()
			});
		}
		this.rpcRouter?.addReasoningMessage(text, reasoningId);
	}

	/**
	 * Announce a tool starting to the surface.
	 *
	 * It no longer writes a summary of the tool into the transcript. That summary —
	 * `description || name || 'Tool execution'`, frozen at `running` because nothing
	 * ever updated it — was the wall of identical bubbles on replay. The CLI's event
	 * log already records the full lifecycle, and `sessionTranscriptBuilder` reads
	 * it, so a second lossy copy has no reason to exist.
	 */
	public notifyToolStart(toolState: any) {
		this.rpcRouter?.toolStart(toolState);
	}

	public updateToolExecution(toolState: any) {
		this.rpcRouter?.toolUpdate(toolState);
	}

	public startSubagent(subagent: any) {
		this.rpcRouter?.subagentStart(subagent);
	}

	public subagentMessage(subagent: any) {
		this.rpcRouter?.subagentMessage(subagent);
	}

	public completeSubagent(subagent: any) {
		this.rpcRouter?.subagentComplete(subagent);
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

	public sendAvailableModels(models: Array<{ id: string; name: string; multiplier?: number; outputPrice?: number }>) {
		this.rpcRouter?.sendAvailableModels(models);
	}

	public sendTaskComplete(summary?: string) {
		this.rpcRouter?.sendTaskComplete(summary);
	}

	public sendMessageDelta(messageId: string, deltaContent: string): void {
		this.rpcRouter?.sendMessageDelta(messageId, deltaContent);
	}

	public sendReasoningDelta(reasoningId: string, deltaContent: string): void {
		this.rpcRouter?.sendReasoningDelta(reasoningId, deltaContent);
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
		return buildChatHtml(resolveChatHtmlAssets(webview, this.extensionUri));
	}

}
