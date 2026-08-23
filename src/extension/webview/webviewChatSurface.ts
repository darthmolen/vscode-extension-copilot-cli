import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '../../logger';
import { ExtensionRpcRouter } from '../rpc';
import { registerChatHandlers, ChatHandlerContext } from '../rpc/registerChatHandlers';
import { buildChatHtml } from './chatHtml';
import { resolveChatHtmlAssets } from './chatHtmlAssets';
import { ChatWebviewSlot, chatWebviewResourceRoots } from './chatWebviewSlot';
import { DisposableStore } from '../../utilities/disposable';
import { CodeReviewSlashHandlers } from '../services/slashCommands/CodeReviewSlashHandlers';
import { InfoSlashHandlers } from '../services/slashCommands/InfoSlashHandlers';
import { NotSupportedSlashHandlers } from '../services/slashCommands/NotSupportedSlashHandlers';
import { CompactSlashHandlers } from '../services/slashCommands/CompactSlashHandlers';
import { CLIPassthroughService } from '../services/CLIPassthroughService';
import { SessionService } from '../services/SessionService';
import { CustomAgentsService } from '../services/CustomAgentsService';
import { resolveImagePaths } from '../utils/resolveImagePaths';
import { ManagedMCPRegistry } from '../services/managedMCPRegistry';
import { MCPConfigurationService } from '../services/mcpConfigurationService';
import { CliCapabilityService } from '../services/cliCapabilityService';
import { ChatSessionHost } from '../session/ChatSessionHost';
import type { WorkspaceStateChange } from '../../backendState';
import { buildMcpServerStatusList, mergeMcpListWithConfig, mergeCopilotConfigList } from '../services/mcpStatusBuilder';
import type { McpServerSource, McpServerActionPayload } from '../../shared/messages';
import {
	validateMcpServerInput,
	addMcpServerToConfig,
	editMcpServerInConfig,
	removeMcpServerFromConfig,
	setMcpServerEnabled,
	preserveEnabledFlag,
	McpServerInput,
} from '../services/mcpServerMutations';
import * as fs from 'fs';

declare const __SDK_VERSION__: string | undefined;
declare const __EXTENSION_VERSION__: string | undefined;

/**
 * One chat surface: a webview, its RPC router, and the session it is showing.
 *
 * This was `ChatViewProvider`, which was both the sidebar's VS Code registration
 * and the whole chat UI. Task 7 needs N of the second and exactly one of the
 * first, so they came apart: `ChatViewProvider` keeps `resolveWebviewView` and
 * hands the view here as a `ChatWebviewSlot`, and a panel hands over a `PanelSlot`
 * instead. Nothing below this line knows which it has.
 *
 * The alternative was a second surface class for panels. It was rejected on
 * measurement: in ~600 lines the old provider touched its VS Code object four
 * times, always on `.webview`, whose type is identical for a view and a panel.
 * The difference is four members, not a class — and a second class would owe the
 * 15-method `ChatSurface` contract that hosts write to, kept in step by hand.
 */
export class WebviewChatSurface implements vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	/**
	 * Everything bound to the *current* slot — its visibility and dispose handlers, its RPC router
	 * and that router's ~34 handlers.
	 *
	 * Separate from `_disposables`, which lives as long as the surface does. The sidebar re-attaches
	 * every time VS Code hides and re-resolves its view — 11 times in one measured session — so
	 * anything slot-shaped in the lifetime store accumulates a full set per attach and is never
	 * released until the surface itself dies.
	 */
	private slotScope?: DisposableStore;
	private slot: ChatWebviewSlot | undefined;
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
	/**
	 * New / switch session, as this surface's own signals.
	 *
	 * They used to leave here as `executeCommand('…newSession')`, which lands on a
	 * handler that reads the module-level `sessionManager` — so pressing **+** in a
	 * tab started a new session in the *sidebar*. Every other gesture on this
	 * surface already travels as an event carrying its own identity; these two were
	 * the exception, and defect C is what the exception cost.
	 */
	private readonly _onDidRequestNewSession = this._reg(new vscode.EventEmitter<void>());
	private readonly _onDidRequestAskInNewTab = this._reg(new vscode.EventEmitter<string>());
	private readonly _onDidRequestSwitchSession = this._reg(new vscode.EventEmitter<string>());
	private readonly _onDidRequestCompact = this._reg(new vscode.EventEmitter<void>());
	private readonly _onDidSelectAgent = this._reg(new vscode.EventEmitter<string | null>());
	private readonly _onDidRequestReloadAgents = this._reg(new vscode.EventEmitter<void>());
	/** This surface's handle on its window's state. Disposed with the surface. */
	private windowStateSubscription?: { dispose(): void };
	/**
	 * A file this surface was opened *on*, which the window's active file does not
	 * override.
	 *
	 * CLAUDE.md's "intentional actions are treated intentionally", third clause:
	 * an intent binds only the thing the gesture was about. *New Tab* while looking
	 * at `foo.ts` says "ask about foo.ts here". It does not say "start including
	 * active files everywhere", and it is never a licence to rewrite
	 * `copilotCLI.includeActiveFile`.
	 *
	 * It has to stop following the window, or the seed evaporates the moment the
	 * user clicks into another file to check something — which is most of what
	 * happens next.
	 */
	private pinnedActiveFile: string | null = null;

	// Public events
	readonly onDidReceiveUserMessage = this._onDidReceiveUserMessage.event;
	readonly onDidRequestAbort = this._onDidRequestAbort.event;
	readonly onDidRequestViewPlan = this._onDidRequestViewPlan.event;
	readonly onDidBecomeReady = this._onDidBecomeReady.event;
	readonly onDidRequestSwitchModel = this._onDidRequestSwitchModel.event;
	readonly onDidRequestRenameSession = this._onDidRequestRenameSession.event;
	readonly onDidRequestForkSession = this._onDidRequestForkSession.event;
	readonly onDidRequestNewSession = this._onDidRequestNewSession.event;
	readonly onDidRequestAskInNewTab = this._onDidRequestAskInNewTab.event;
	readonly onDidRequestSwitchSession = this._onDidRequestSwitchSession.event;
	readonly onDidRequestCompact = this._onDidRequestCompact.event;
	readonly onDidSelectAgent = this._onDidSelectAgent.event;
	readonly onDidRequestReloadAgents = this._onDidRequestReloadAgents.event;

	private cliCapability: CliCapabilityService | null = null;
	private mcpListProvider: (() => Promise<any[]>) | null = null;
	private importedServersProvider: (() => Record<string, any>) | null = null;
	private mcpConfigListProvider: (() => Promise<Record<string, any>>) | null = null;

	/**
	 * How this surface names itself in the log. With N of them, "Sidebar shown" and
	 * "Chat surface attached" stop being traceable to one container.
	 */
	private readonly label: string;

	/**
	 * How to show this surface when it has no slot yet.
	 *
	 * The sidebar needs it. `show()` used to run the view's `.focus` command
	 * unconditionally, which is what *makes* VS Code resolve a view that has never
	 * been opened; routing it through the slot alone would have made "Open Chat"
	 * silently do nothing whenever the container was closed. A panel has no such
	 * state — it exists or it does not.
	 */
	private readonly revealWhenDetached?: () => void;

	constructor(
		extensionUri: vscode.Uri,
		options: {
			cliCapability?: CliCapabilityService;
			mcpListProvider?: () => Promise<any[]>;
			label?: string;
			revealWhenDetached?: () => void;
		} = {}
	) {
		this.extensionUri = extensionUri;
		this.logger = Logger.getInstance();
		this.cliCapability = options.cliCapability ?? null;
		this.mcpListProvider = options.mcpListProvider ?? null;
		this.label = options.label ?? 'Sidebar';
		this.revealWhenDetached = options.revealWhenDetached;
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

		// Replaced, not added to. A surface can be aimed at another conversation,
		// and a second subscription would render every window update twice.
		this.windowStateSubscription?.dispose();
		this.windowStateSubscription = host.workspace.onDidChange(change => this.onWindowStateChanged(change));
	}

	/**
	 * Window state moved; render the part of it this surface shows.
	 *
	 * Subscribing beats being pushed at: `updateActiveFile` and `updateSessionsList`
	 * wrote straight to the sidebar, which with N surfaces becomes a fan-out loop
	 * repeated at every call site until one of them quietly isn't.
	 */
	private onWindowStateChanged(change: WorkspaceStateChange): void {
		switch (change) {
			case 'activeFile':
				// A pinned file is this surface's answer and the window does not get
				// a vote. Every other surface keeps following the editor.
				if (this.pinnedActiveFile === null) {
					this.updateActiveFile(this.sessionHost?.workspace.getActiveFilePath() ?? null);
				}
				break;
			case 'sessions':
				this.sendSessions();
				break;
			case 'workspacePath':
				// Only ever read as part of the init payload; nothing to re-render.
				break;
		}
	}

	/**
	 * The window's session list, paired with *this* surface's current session.
	 *
	 * The list is window state and identical everywhere; which one is current is
	 * not. Combining them here rather than at the writer is what stops a tab's
	 * dropdown highlighting the sidebar's conversation — the old call site ended
	 * with `sessionManager?.getSessionId()`, the window's session, for everyone.
	 */
	public sendSessions(): void {
		const host = this.sessionHost;
		if (!host) {
			return;
		}
		this.updateSessions(host.workspace.getSessions(), host.sessionId);
	}

	/** Whether this chat currently has the user's attention. See `commandSurface.ts`. */
	public isActive(): boolean {
		return this.slot?.isActive === true;
	}

	public getSessionHost(): ChatSessionHost | undefined {
		return this.sessionHost;
	}

	/**
	 * Send this surface's whole state to its webview.
	 *
	 * The single init path. There used to be two — one here via `sendInit`, and one
	 * in `extension.ts` that hand-rebuilt the same payload and posted it raw. The
	 * second was unlogged, so a smoke test showed "Sending 0 messages" while 157
	 * were in fact replayed through the other, and every change to the init shape
	 * had to be made twice.
	 */
	public sendInit(): void {
		if (!this.sessionHost) {
			this.logger.warn('[Init] No session host attached — nothing to render');
			return;
		}
		const fullState = this.sessionHost.getFullState();
		// Labelled by surface: with a sidebar and N tabs, an unlabelled init line
		// cannot be attributed, and attribution is the whole question when two
		// surfaces start at once.
		this.logger.info(
			`[${this.label}] [Init] Sending ${fullState.messages.length} messages for ` +
			`${fullState.sessionId ?? '(no session yet)'}`
		);
		this.rpcRouter?.sendInit({
			sessionId: fullState.sessionId,
			sessionActive: fullState.sessionActive,
			messages: fullState.messages as any,
			planModeStatus: fullState.planModeStatus,
			workspacePath: fullState.workspacePath,
			activeFilePath: this.pinnedActiveFile ?? fullState.activeFilePath,
			currentModel: fullState.currentModel,
			showReasoning: vscode.workspace.getConfiguration('copilotCLI').get<boolean>('showReasoning', false)
		});
		// The dropdown is not part of the init payload, so a freshly attached
		// surface would otherwise show an empty session list until the next change.
		this.sendSessions();
	}

	/**
	 * Show this file here, whatever the editor moves on to. `null` unpins.
	 *
	 * See `pinnedActiveFile`. Rendered at once so *New Tab* on a file shows that
	 * file before the user types anything.
	 */
	public pinActiveFile(filePath: string | null): void {
		this.pinnedActiveFile = filePath;
		this.updateActiveFile(filePath ?? this.sessionHost?.workspace.getActiveFilePath() ?? null);
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

			// Window state, not session state — every surface sees the same servers.
			const knownTools = this.sessionHost!.workspace.getMcpServerTools();
			const knownStatuses = this.sessionHost!.workspace.getMcpServerStatuses();
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
	 * Give this surface something to render into.
	 *
	 * Called once per container: by `ChatViewProvider` when VS Code resolves the
	 * sidebar view, and by `ChatPanelService` when a tab is opened or restored. A
	 * sidebar slot may arrive more than once over a window's life — VS Code
	 * re-resolves the view after its container has been hidden — so this replaces
	 * rather than accumulates.
	 *
	 * `localResourceRoots` is set here, from the one shared list, for both kinds of
	 * slot. `SubagentPanelService` shows what the alternative costs: it sets
	 * `enableScripts` and nothing else, which is exactly why it cannot load
	 * `dist/webview` assets.
	 */
	public attach(slot: ChatWebviewSlot): void {
		// Whatever was bound to the previous slot goes now. Its webview is gone, its router writes
		// into nothing, and — the part that actually bit — its dispose handler is still armed.
		this.slotScope?.dispose();
		const scope = new DisposableStore();
		this.slotScope = scope;

		this.slot = slot;

		const webview = slot.webview;
		webview.options = {
			enableScripts: true,
			localResourceRoots: chatWebviewResourceRoots(this.extensionUri)
		};

		scope.add(slot.onDidChangeVisibility(() => {
			this.logger.debug(`[Visibility] ${this.label} ${slot.isVisible ? 'shown' : 'hidden'}`);
		}));

		scope.add(slot.onDidDispose(() => {
			// A closed panel is gone; a hidden sidebar view comes back through
			// another `attach`. Either way this router is dead — it is bound to a
			// webview that no longer exists.
			//
			// Guarded on identity, for the same reason `detachSurface` is: a slot that has already
			// been replaced must not be able to null its successor on the way out. Without this a
			// stale dispose decapitated the live surface — the host kept recording and routing,
			// `addAssistantMessage` still ran and still logged, and every `postMessage` landed on
			// `undefined`.
			if (this.slot !== slot) {
				this.logger.debug(`[${this.label}] stale slot disposed — the live one is untouched`);
				return;
			}
			this.logger.info(`[${this.label}] Slot disposed${slot.closingEndsSurface ? '' : ' — VS Code will re-resolve it'}`);
			this.slot = undefined;
			this.rpcRouter = undefined;
		}));

		this._setupRpcHandlers(webview, scope);

		// Set HTML — webview loads and sends 'ready' which RPC handlers catch
		webview.html = this._getHtmlForWebview(webview);

		this.logger.info(`[${this.label}] Chat surface attached`);
	}

	/** Bring this surface to the front, resolving its container if need be. */
	public show(preserveFocus?: boolean): void {
		if (this.slot) {
			this.slot.reveal(preserveFocus);
			return;
		}
		this.revealWhenDetached?.();
	}

	/**
	 * Check if the view is ready to receive messages.
	 */
	public isViewReady(): boolean {
		return this.slot !== undefined && this.rpcRouter !== undefined;
	}

	/**
	 * Extract RPC handler setup into its own method.
	 * Called once when the view is first resolved.
	 */
	private _setupRpcHandlers(webview: vscode.Webview, scope: DisposableStore): void {
		const router = new ExtensionRpcRouter(webview);
		this.rpcRouter = router;
		// Registered into the slot's scope, not the surface's: `registerChatHandlers` wires ~34
		// handlers, and a re-attach used to add another full set that nothing ever released.
		registerChatHandlers(this._handlerContext(router, scope));
		// The router itself has no `dispose`; what has to be released is its subscription to the
		// webview's messages, which `listen()` hands back. Dropped when the slot is replaced, so a
		// dead webview's queue cannot still be routed.
		scope.add(router.listen());
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
	private _handlerContext(rpcRouter: ExtensionRpcRouter, scope: DisposableStore): ChatHandlerContext {
		const self = this;
		return {
			rpcRouter,
			// The slot's scope, not the surface's. These handlers belong to one webview and must go
			// when it does; `_reg` would keep every re-attach's set alive for the surface's life.
			reg: <T extends vscode.Disposable>(d: T) => scope.add(d),
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
			get sessionHost() { return self.sessionHost; },
			get cliCapability() { return self.cliCapability; },
			sendInit: () => self.sendInit(),
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
			_onDidRequestNewSession: this._onDidRequestNewSession,
			_onDidRequestAskInNewTab: this._onDidRequestAskInNewTab,
			_onDidRequestSwitchSession: this._onDidRequestSwitchSession,
			_onDidRequestCompact: this._onDidRequestCompact,
			_onDidSelectAgent: this._onDidSelectAgent,
			_onDidRequestReloadAgents: this._onDidRequestReloadAgents,
		};
	}

	public postMessage(message: any) {
		this.slot?.webview.postMessage(message);
	}

	public addUserMessage(text: string, attachments?: Array<{displayName: string; webviewUri?: string}>, storeInBackend: boolean = true) {
		if (storeInBackend) {
			this.sessionHost?.state.addMessage({
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
			this.sessionHost?.state.addMessage({
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
			this.sessionHost?.state.addMessage({
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
		this.logger?.info(`[${this.label}] Session dropdown: ${sessions.length} sessions, current=${currentSessionId ?? '(none yet)'}`);
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
				const webviewUri = this.slot?.webview.asWebviewUri(uri);
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
			const webviewUri = this.slot?.webview.asWebviewUri(fileUri);
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
		// This surface's session, so a panel resolves images out of its own
		// `~/.copilot/session-state/<id>` rather than the sidebar's.
		const sessionId = this.sessionHost?.sessionId ?? null;
		if (!sessionId || !this.slot?.webview) {
			this.logger?.debug(`[ImageResolve] Skipped: sessionId=${!!sessionId} webview=${!!this.slot?.webview}`);
			return text;
		}

		const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId);
		const webview = this.slot.webview;

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
	 * Force refresh the webview content by resetting its HTML.
	 *
	 * Safe on a panel. On a *view* VS Code may re-resolve instead, which would
	 * arrive as a second `attach` — harmless, since attach replaces. Task 8 makes
	 * this palette-only.
	 */
	public forceRecreate() {
		const webview = this.slot?.webview;
		if (webview) {
			webview.html = this._getHtmlForWebview(webview);
			this.resetPlanMode();
		}
	}

	public dispose(): void {
		this.windowStateSubscription?.dispose();
		this.windowStateSubscription = undefined;
		this._disposables.dispose();
		this.rpcRouter = undefined;
		// The slot is not disposed here. VS Code owns the sidebar view's lifetime,
		// and a panel's owner is whoever created it — disposing from this side would
		// be a surface tearing down its own container.
		this.slot = undefined;
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		return buildChatHtml(resolveChatHtmlAssets(webview, this.extensionUri));
	}

}
