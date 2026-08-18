import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { SDKSessionManager, CLIConfig, DEFAULT_MODEL } from './sdkSessionManager';
import { Logger } from './logger';
import { ChatViewProvider } from './chatViewProvider';
import { WebviewChatSurface } from './extension/webview/webviewChatSurface';
import { ChatPanelService, CHAT_PANEL_VIEW_TYPE } from './extension/webview/chatPanelService';
import { PanelSlot, chatWebviewResourceRoots } from './extension/webview/chatWebviewSlot';
import { getWorkspaceRuntimeState } from './backendState';
import { createVSCodeHostBridge } from './extension/hostBridge';
import { SUBAGENT_PALETTE } from './shared/subagentPalette';
import { forkCurrentSession } from './extension/commands/forkSession';
import { SessionService } from './extension/services/SessionService';
import { SubagentPanelService } from './extension/services/SubagentPanelService';
import { computeInlineDiff, DiffLine } from './extension/services/InlineDiffService';
import { createAnimationTestPanel } from './animationTestPanel';
import { shouldAutoEnablePlanMode } from './extension/utils/planModeUtils';
import { CliBundleService, ResolvedCli } from './extension/services/cliBundleService';
import { bootstrapCliBundle } from './extension/services/cliBundleBootstrap';
import { getImportedServers } from './extension/services/vscodeMcpImportService';
import { buildSessionTranscript } from './extension/services/sessionTranscriptBuilder';
import { ChatSessionRegistry } from './extension/session/ChatSessionRegistry';
import { ChatSessionHost } from './extension/session/ChatSessionHost';
import { createChatSessionServices } from './extension/session/chatSessionServices';
import { planSessionStart } from './extension/session/sessionStartPlan';
import { createStartManager } from './extension/session/startManager';
import { recordSessionStart, loadTranscriptInto } from './extension/session/sessionBootstrap';
import { ManagedMCPRegistry } from './extension/services/managedMCPRegistry';
import { MCPConfigurationService } from './extension/services/mcpConfigurationService';
import { CLIPassthroughService } from './extension/services/CLIPassthroughService';

let sessionManager: SDKSessionManager | null = null;
let resolvedCli: ResolvedCli | null = null;
let cliBundleReady: Promise<void> | null = null;
let logger: Logger;
let statusBarItem: vscode.StatusBarItem;
let lastKnownTextEditor: vscode.TextEditor | undefined;
let chatProvider: ChatViewProvider;
/**
 * The sidebar's chat surface — the one every command and every session-start path
 * writes to. Held apart from the provider because the provider is now only the
 * VS Code registration; this is the thing a `ChatSessionHost` renders into.
 */
let sidebarSurface: WebviewChatSurface;
/** Opens and restores chat tabs. One per window, built at activation. */
let chatPanels: ChatPanelService;
/** Every chat session live in this window. One entry today; the sidebar's. */
let sessionRegistry: ChatSessionRegistry;
/** The session the sidebar is showing. */
let sidebarHost: ChatSessionHost;
let subagentPanels: SubagentPanelService;
let lastDropdownRefresh = 0;

/** Wraps an event handler with try/catch to prevent one handler error from breaking others. */
function safeHandler<T>(name: string, handler: (data: T) => void): (data: T) => void {
	return (data: T) => {
		try {
			handler(data);
		} catch (error) {
			Logger.getInstance().error(`[Event Handler] Error in ${name}: ${error instanceof Error ? error.message : error}`);
		}
	};
}

const subagentColors = new Map<string, string>();
function assignSubagentColor(agentId: string): string {
	let color = subagentColors.get(agentId);
	if (!color) {
		color = SUBAGENT_PALETTE[subagentColors.size % SUBAGENT_PALETTE.length];
		subagentColors.set(agentId, color);
	}
	return color;
}

/**
 * Read the before/after files and compute the inline diff.
 *
 * Window-scoped filesystem work, injected into each host so the host routes the
 * result to its own surface without doing I/O itself.
 */
function enrichDiffWithInlineLines(diffData: any): any {
	let diffLines: DiffLine[] = [];
	let diffTruncated = false;
	let diffTotalLines = 0;
	try {
		const fs = require('fs');
		const beforeContent = fs.existsSync(diffData.beforeUri) ? fs.readFileSync(diffData.beforeUri, 'utf-8') : '';
		const afterContent = fs.existsSync(diffData.afterUri) ? fs.readFileSync(diffData.afterUri, 'utf-8') : '';
		const inlineDiff = computeInlineDiff(beforeContent, afterContent);
		diffLines = inlineDiff.lines;
		diffTruncated = inlineDiff.truncated;
		diffTotalLines = inlineDiff.totalLines;
	} catch (error) {
		Logger.getInstance().warn(`[Diff] Failed to compute inline diff: ${error instanceof Error ? error.message : error}`);
	}
	return { ...diffData, diffLines, diffTruncated, diffTotalLines };
}

declare const __EXTENSION_VERSION__: string | undefined;
declare const __SDK_VERSION__: string | undefined;

/**
 * Assemble the per-session service factory.
 *
 * The window-scoped collaborators are built once here and closed over, so every
 * session shares them; only the session-scoped handlers are rebuilt per host.
 * This is the construction that used to happen inside handler registration.
 */
function buildChatSessionServicesFactory() {
	const mcpRegistry = new ManagedMCPRegistry();
	const mcpConfigService = new MCPConfigurationService(
		vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
	);
	const cliPassthroughService = new CLIPassthroughService(vscode);

	return createChatSessionServices({
		getMergedMcpServers: () => {
			const userConfig = vscode.workspace.getConfiguration('copilotCLI')
				.get<Record<string, any>>('mcpServers', {});
			return mcpConfigService.getMergedMCPServers(userConfig, mcpRegistry.getManagedServers());
		},
		mcpConfigService,
		cliPassthroughService,
		// Read per call — the capability is set after activation begins.
		getCliCapability: () => sidebarSurface.getCliCapability(),
		versionInfo: {
			extensionVersion: typeof __EXTENSION_VERSION__ !== 'undefined' ? __EXTENSION_VERSION__ ?? 'unknown' : 'unknown',
			sdkVersion: typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ ?? 'unknown' : 'unknown',
		},
		getPlanPath: (sessionId: string) =>
			path.join(os.homedir(), '.copilot', 'session-state', sessionId, 'plan.md')
	});
}

export function activate(context: vscode.ExtensionContext) {
	logger = Logger.getInstance();

	// Create chat provider and register as sidebar webview
	sidebarSurface = new WebviewChatSurface(context.extensionUri, {
		label: 'Sidebar',
		// Focusing the view id is what makes VS Code resolve a sidebar that has
		// never been opened, so this has to work before any slot exists.
		revealWhenDetached: () => vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`)
	});
	context.subscriptions.push(sidebarSurface);
	chatProvider = new ChatViewProvider(sidebarSurface);

	// One registry per window; one host per conversation. The sidebar's host is
	// built now, before the CLI has assigned an id — it adopts one in
	// `onSessionStarted`, and never gets one at all if the CLI fails to start.
	sessionRegistry = new ChatSessionRegistry({
		workspace: getWorkspaceRuntimeState(),
		logger,
		createServices: buildChatSessionServicesFactory(),
		assignSubagentColor,
		enrichDiff: enrichDiffWithInlineLines,
		// The host decides *whether* a session needs starting; this only does it.
		// Guarding on the module-level `sessionManager` cannot survive a second
		// surface — it answers "is any session running in this window", not "is
		// mine".
		// The host's `{ sessionId, resume }` is threaded through rather than dropped.
		// Discarding it is what made "open or restore the surface for session X"
		// resume whatever `determineSessionToResume` picked by mtime.
		startManager: createStartManager({
			resumeAndStart: (request) => resumeAndStartSession(context, request),
			getManager: () => sessionManager,
			logger
		})
	});
	context.subscriptions.push({ dispose: () => sessionRegistry.disposeAll() });
	// No longer shares the facade's `SessionState`. It had to while
	// `ChatViewProvider` recorded messages through `getBackendState()` — a host with
	// its own state would have read an empty transcript while the surface wrote to
	// another. Those call sites are gone, so the sidebar's conversation is now just
	// one host's, the same as any tab's.
	sidebarHost = sessionRegistry.create(null);
	sidebarHost.attachSurface(sidebarSurface);
	sidebarSurface.setSessionHost(sidebarHost);

	// Pop-out panel service — created ONCE per activation (buffers sub-agent traffic, opens
	// editor-tab panels on request). Must not live in wireManagerEvents(), which re-runs per session.
	subagentPanels = new SubagentPanelService(context.globalStorageUri);
	context.subscriptions.push(subagentPanels);

	chatPanels = new ChatPanelService({
		logger,
		registry: sessionRegistry,
		createPanel: (viewType, title, options) => vscode.window.createWebviewPanel(
			viewType, title, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, options
		),
		// A tab's surface is built the same way the sidebar's is, minus the
		// detached-reveal fallback: a panel either exists or it does not.
		createSurface: () => {
			const surface = new WebviewChatSurface(context.extensionUri, {
				label: 'Tab',
				cliCapability: sidebarSurface.getCliCapability() ?? undefined
			});
			applySharedProviders(context, surface);
			return surface;
		},
		makeSlot: (panel) => new PanelSlot(panel),
		resourceRoots: () => chatWebviewResourceRoots(context.extensionUri),
		registerHandlers: (surface) => registerSurfaceHandlers(context, surface as WebviewChatSurface),
		loadTranscript: (sessionId, host) => loadSessionHistory(sessionId, host)
	});

	// Registered in activate(), never inside a command handler: VS Code restores
	// panels *during* activation, before any command could have run.
	context.subscriptions.push(
		vscode.window.registerWebviewPanelSerializer(CHAT_PANEL_VIEW_TYPE, {
			deserializeWebviewPanel: (panel, state) => chatPanels.restore(panel, state)
		})
	);
	context.subscriptions.push(vscode.commands.registerCommand('copilot-cli-extension.openSubagentPanel', (agentId: string) => {
		subagentPanels.open(agentId);
	}));
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			ChatViewProvider.viewType,
			chatProvider,
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	logger.info('Copilot CLI Extension activating...');

	// Track active file changes
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => updateActiveFile(editor))
	);

	// Status bar
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = "$(comment-discussion) Copilot CLI";
	statusBarItem.tooltip = "Open Copilot CLI Chat";
	statusBarItem.command = 'copilot-cli-extension.openChat';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	// Register chat provider event handlers
	context.subscriptions.push(registerSurfaceHandlers(context, sidebarSurface));

	// Register all VS Code commands
	registerCommands(context);

	// Resolve / lazy-install the Copilot CLI in the background. The chat provider
	// renders immediately; once the bundle is ready, capability and the live
	// MCP list provider are wired in. startCLISession() awaits this promise so
	// we never spawn the SDK against the system CLI when a managed bundle is
	// still resolving (which would reintroduce the SDK↔CLI mismatch).
	cliBundleReady = initCliBundle(context).catch((err) => {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error(`[CLI Bundle] Bootstrap failed: ${msg}`);
		void vscode.window.showErrorMessage(`Copilot CLI setup failed: ${msg}`);
	});

	logger.info('Copilot CLI Extension activated successfully');
}

// Injected by esbuild `define` at build time. In tests / non-bundled contexts
// the constant is undefined and CliBundleService falls back to reading
// node_modules/@github/copilot-sdk/package.json.
declare const __SDK_PEER_RANGE__: string | undefined;

async function initCliBundle(context: vscode.ExtensionContext): Promise<void> {
	const sdkPeerRange = typeof __SDK_PEER_RANGE__ !== 'undefined' ? __SDK_PEER_RANGE__ : undefined;
	const bundle = new CliBundleService(
		{ extensionPath: context.extensionPath, globalStorageUri: context.globalStorageUri },
		logger,
		{ sdkPeerRange }
	);
	const { resolved, capability } = await bootstrapCliBundle(bundle, logger, vscode.window);
	resolvedCli = resolved;
	sidebarSurface.setCliCapability(capability);
	applySharedProviders(context, sidebarSurface);
}

/**
 * Window-scoped providers, given to every surface.
 *
 * MCP servers, imported VS Code servers and the configured-server list are
 * properties of the *window*, not of a conversation — every surface shows the same
 * `/mcp` answer. Kept as one function so a new surface cannot be given three of
 * the four by accident; that is precisely the shape that produced three
 * hand-built init payloads here.
 */
function applySharedProviders(context: vscode.ExtensionContext, surface: WebviewChatSurface): void {
	surface.setMcpListProvider(async () => {
		if (!sessionManager || !sessionManager.hasActiveSession()) {
			throw new Error('No active session for mcp.list');
		}
		return sessionManager.listMcpServers();
	});
	surface.setImportedServersProvider(() => {
		const cfg = vscode.workspace.getConfiguration('copilotCLI');
		if (!cfg.get<boolean>('importVSCodeMcpServers', true)) {
			return {};
		}
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
		return getImportedServers(workspaceFolder, context.globalStorageUri.fsPath);
	});
	surface.setMcpConfigListProvider(async () => {
		if (!sessionManager || !sessionManager.hasActiveSession()) {
			return {};
		}
		return sessionManager.listConfiguredMcpServers();
	});
}

/** Opens plan.md in the editor. Shared by toolbar button and plan_ready status. */
async function viewPlanFile(): Promise<void> {
	const planPath = sessionManager?.getPlanFilePath();
	if (!planPath) {
		vscode.window.showWarningMessage('No active session - cannot view plan.md');
		return;
	}

	const fsModule = require('fs');
	if (!fsModule.existsSync(planPath)) {
		vscode.window.showInformationMessage('No plan.md file exists yet. Enter plan mode and create a plan first.');
		return;
	}

	try {
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(planPath));
		await vscode.window.showTextDocument(doc, { preview: false });
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logger.error(`Failed to open plan.md: ${errorMsg}`);
		vscode.window.showErrorMessage(`Could not open plan.md: ${errorMsg}`);
	}
}

/**
 * Wire one surface's events to its own session.
 *
 * Was `registerChatProviderHandlers`, closed over the sidebar. Every line of it
 * was already surface-shaped — it reads `getSessionHost()` for the session — so
 * the only sidebar-specific thing left was the variable it named. A panel calls
 * this too, and disposes the result when its tab closes; the sidebar's live for
 * the window.
 */
function registerSurfaceHandlers(context: vscode.ExtensionContext, surface: WebviewChatSurface): vscode.Disposable {
	const subscriptions: vscode.Disposable[] = [];
	subscriptions.push(surface.onDidReceiveUserMessage(async (data: {text: string; attachments?: Array<{type: 'file'; path: string; displayName?: string}>; agentName?: string}) => {
		logger.info(`Sending user message to CLI: ${data.text.substring(0, 100)}...`);

		const displayAttachments = data.attachments?.map(att => ({
			displayName: att.displayName || att.path.split(/[/\\]/).pop() || 'unknown',
			webviewUri: undefined
		}));

		surface.addUserMessage(data.text, displayAttachments);
		surface.setThinking(true);

		// Goes to *this* surface's session. Reaching for the module-level
		// sessionManager here would send a tab's message to whichever session the
		// window happened to start last.
		const host = surface.getSessionHost();
		if (host?.isLive) {
			await host.prompt(data.text, { attachments: data.attachments, agentName: data.agentName });
		} else {
			surface.addAssistantMessage('Error: CLI session not active. Please start a session first.');
			surface.setThinking(false);
		}
	}));

	subscriptions.push(surface.onDidRequestAbort(() => {
		logger.info('Abort requested by user');
		// Fire-and-forget by design — see ChatSessionHost.cancel().
		surface.getSessionHost()?.cancel();
	}));

	subscriptions.push(surface.onDidRequestViewPlan(async () => {
		await viewPlanFile();
	}));

	subscriptions.push(surface.onDidBecomeReady(async () => {
		// A ready surface asks *its own* host for a running session; the host starts
		// one only if its own is not already live. Calling `resumeAndStartSession`
		// straight from here is what would re-resume a streaming tab, and naming
		// `sidebarHost` here would have started the sidebar's session for a panel.
		await surface.getSessionHost()?.ensureStarted();

		// Re-send init: the first send, from onReady, ran before the transcript was
		// loaded. Same builder and same logged path as that first send — this used
		// to hand-rebuild the payload and post it raw, so it was invisible in the
		// logs and a second place to keep in step with the init shape.
		surface.sendInit();
	}));

	subscriptions.push(surface.onDidRequestSwitchModel(async (model: string) => {
		logger.info(`[Model Switch] Requested: ${model}`);
		try {
			const host = surface.getSessionHost();
			if (host?.isLive) {
				await host.switchModel(model);
			} else {
				logger.warn('[Model Switch] No active session manager');
			}
		} catch (error: any) {
			logger.error(`[Model Switch] Failed: ${error.message}`);
		}
	}));

	subscriptions.push(surface.onDidRequestRenameSession(async (name: string) => {
		logger.info(`[Rename Session] Requested: "${name}"`);
		let sessionName = name;
		if (!sessionName) {
			const input = await vscode.window.showInputBox({
				prompt: 'Enter a name for this session',
				placeHolder: 'Session name...',
				value: ''
			});
			if (input === undefined) {
				return; // User cancelled
			}
			sessionName = input;
		}
		if (!sessionName) {
			return; // Empty name, skip
		}

		// Write session-name.txt proactively — this ensures the session label
		// updates even if the CLI throws "Workspace not found" (issue #1865).
		const sessionId = surface.getSessionHost()?.sessionId;
		if (sessionId) {
			const sessionPath = path.join(os.homedir(), '.copilot', 'session-state', sessionId);
			try {
				SessionService.writeSessionName(sessionPath, sessionName);
				logger.info(`[Rename Session] Wrote session-name.txt: "${sessionName}"`);
			} catch (writeErr: any) {
				logger.warn(`[Rename Session] Could not write session-name.txt: ${writeErr.message}`);
			}
		}

		try {
			const host = surface.getSessionHost();
			if (host?.isLive) {
				await host.rename(sessionName);
			} else {
				logger.warn('[Rename Session] No live session for this surface');
			}
		} catch (error: any) {
			// CLI may throw "Workspace not found" on resumed sessions (github/copilot-cli#1865).
			// The session-name.txt written above ensures the label still updates.
			logger.warn(`[Rename Session] CLI rename failed (session-name.txt fallback applied): ${error.message}`);
		}
	}));

	subscriptions.push(surface.onDidRequestForkSession(async () => {
		await handleForkSession(context);
	}));

	subscriptions.push(surface.onDidRequestCompact(async () => {
		logger.info('[Compact] Compact requested');
		const host = surface.getSessionHost();
		if (!host?.isLive) {
			surface.addAssistantMessage('⚠ No active session — start a session first.');
			return;
		}
		try {
			const result = await host.compact();
			if (!result) {
				surface.addAssistantMessage('✓ Compaction complete.');
			} else {
				const { tokensRemoved, messagesRemoved } = result as any;
				const parts: string[] = [];
				if (typeof tokensRemoved === 'number') { parts.push(`freed ${tokensRemoved.toLocaleString()} tokens`); }
				if (typeof messagesRemoved === 'number') { parts.push(`removed ${messagesRemoved} messages`); }
				const summary = parts.length > 0 ? parts.join(', ') : 'context compacted';
				surface.addAssistantMessage(`✓ Compaction complete — ${summary}.`);
			}
		} catch (error: any) {
			surface.addAssistantMessage(`⚠ Compaction failed: ${error.message}`);
		}
	}));

	subscriptions.push(surface.onDidSelectAgent(async (agentName: string | null) => {
		try {
			await surface.getSessionHost()?.selectAgent(agentName);
		} catch (e: any) {
			logger.warn(`[Agent] SDK select/deselect failed: ${e.message}`);
		}
	}));

	subscriptions.push(surface.onDidRequestReloadAgents(async () => {
		await surface.getSessionHost()?.reloadAgents();
	}));

	return vscode.Disposable.from(...subscriptions);
}

/** Register all VS Code commands. */
function registerCommands(context: vscode.ExtensionContext): void {
	const commands = [
		vscode.commands.registerCommand('copilot-cli-extension.openChat', () => handleOpenChat(context)),
		vscode.commands.registerCommand('copilot-cli-extension.openChatInTab', () => chatPanels.openNew()),
		vscode.commands.registerCommand('copilot-cli-extension.startChat', () => handleStartChat(context)),
		vscode.commands.registerCommand('copilot-cli-extension.newSession', () => handleNewSession(context)),
		vscode.commands.registerCommand('copilot-cli-extension.switchSession', (sessionId: string) => handleSwitchSession(context, sessionId)),
		vscode.commands.registerCommand('copilot-cli-extension.stopChat', () => handleStopChat()),
		vscode.commands.registerCommand('copilot-cli-extension.refreshPanel', () => {
			sidebarSurface.forceRecreate();
			vscode.window.showInformationMessage('Chat panel refreshed');
		}),
		vscode.commands.registerCommand('copilot-cli-extension.viewDiff', (message: any) => handleViewDiff(message)),
		vscode.commands.registerCommand('copilot-cli-extension.togglePlanMode', (enabled: boolean) => handleTogglePlanMode(enabled)),
		vscode.commands.registerCommand('copilot-cli-extension.acceptPlan', () => handleAcceptPlan()),
		vscode.commands.registerCommand('copilot-cli-extension.rejectPlan', () => handleRejectPlan()),
		vscode.commands.registerCommand('copilot-cli-extension.openAnimationTestLight', () => createAnimationTestPanel('light')),
		vscode.commands.registerCommand('copilot-cli-extension.openAnimationTestDark', () => createAnimationTestPanel('dark')),
		vscode.commands.registerCommand('copilot-cli-extension.forkSession', () => handleForkSession(context)),
	];
	context.subscriptions.push(...commands);
}

// ── Session Resume ───────────────────────────────────────────────────────────

/**
 * Shared logic: determine session to resume, load history, start CLI.
 *
 * `request.sessionId` is a *stated intent* — a surface asking for the session it
 * already belongs to (a restored tab, a host resuming). It bypasses both the
 * `resumeLastSession` setting and the most-recent-by-mtime heuristic, because
 * neither of those is an answer to "bring back session X".
 */
async function resumeAndStartSession(
	context: vscode.ExtensionContext,
	request: { sessionId?: string | null; fresh?: boolean; host?: ChatSessionHost } = {}
): Promise<void> {
	// Whose session this is. Defaulting to the sidebar keeps the command palette
	// and activation paths working; a host asking for itself supplies its own.
	const target = request.host ?? sidebarHost;
	const plan = planSessionStart(request, sessionManager);
	if (plan.reuseRunning) {
		return;
	}

	// A fresh session resumes nothing, so the flag the manager reads must say so.
	const resumeLastSession = plan.fresh
		? false
		: plan.consultAmbient
			? vscode.workspace.getConfiguration('copilotCLI').get<boolean>('resumeLastSession', true)
			: true;
	let sessionIdToResume = plan.requestedSessionId;

	if (plan.consultAmbient && resumeLastSession) {
		const sessionId = await determineSessionToResume(context);
		if (sessionId) {
			sessionIdToResume = sessionId;
		}
	}

	if (sessionIdToResume) {
		await loadSessionHistory(sessionIdToResume, target);
	}

	updateActiveFile(vscode.window.activeTextEditor);
	updateSessionsList();

	await startCLISession(context, resumeLastSession, sessionIdToResume, target);
}

// ── Command Handlers ──────────────────────────────────────────────────────────

async function handleOpenChat(context: vscode.ExtensionContext): Promise<void> {
	sidebarSurface.show();
	await resumeAndStartSession(context);
}

async function handleStartChat(context: vscode.ExtensionContext): Promise<void> {
	sidebarSurface.show();
	if (sessionManager && sessionManager.isRunning()) {
		vscode.window.showInformationMessage('Copilot CLI session is already running');
		return;
	}
	await startCLISession(context, true);
	vscode.window.showInformationMessage('Copilot CLI session started!');
}

async function handleNewSession(context: vscode.ExtensionContext): Promise<void> {
	if (sessionManager && sessionManager.isRunning()) {
		await sessionManager.stop();
		sessionManager = null;
	}
	sidebarSurface.show();
	sidebarSurface.clearMessages();
	sidebarSurface.resetPlanMode();
	await startCLISession(context, false);
	updateSessionsList();

	const config = vscode.workspace.getConfiguration('copilotCLI');
	if (shouldAutoEnablePlanMode(config.get<boolean>('startNewSessionInPlanning'))) {
		logger.info('[New Session] startNewSessionInPlanning=true, enabling plan mode');
		try {
			await sessionManager!.enablePlanMode();
		} catch (err: any) {
			logger.error(`[New Session] Failed to auto-enable plan mode: ${err.message}`);
		}
	}

	vscode.window.showInformationMessage('New Copilot CLI session started!');
}

async function handleSwitchSession(context: vscode.ExtensionContext, sessionId: string): Promise<void> {
	logger.info(`Switch Session: ${sessionId}`);
	if (sessionManager && sessionManager.isRunning()) {
		await sessionManager.stop();
		sessionManager = null;
	}
	sidebarSurface.resetPlanMode();
	await startCLISession(context, true, sessionId);
	await loadSessionHistory(sessionId);

	// The same logged init path the webview's own ready flow uses. This was a
	// third hand-built copy of the payload, posted raw — so a switch replayed the
	// transcript invisibly, and the init shape had three places to be kept in step.
	sidebarSurface.sendInit();
	updateSessionsList();
}

async function handleForkSession(context: vscode.ExtensionContext): Promise<void> {
	// Thin binder: the decision logic lives in forkCurrentSession, which takes
	// its collaborators explicitly so it can be tested without a vscode mock.
	const manager = sessionManager;
	await forkCurrentSession({
		getSessionId: () => manager?.getSessionId() ?? null,
		fork: (sessionId, opts) => {
			// getSessionId() already returned null if the manager was gone, so
			// this is unreachable in practice — but assert it rather than
			// silencing the compiler with a non-null assertion.
			if (!manager) { throw new Error('Session manager is not available'); }
			return manager.forkSession(sessionId, opts);
		},
		switchTo: (sessionId) => handleSwitchSession(context, sessionId),
		notify: {
			info: (m) => { vscode.window.showInformationMessage(m); },
			warn: (m) => { vscode.window.showWarningMessage(m); },
			error: (m) => { vscode.window.showErrorMessage(m); }
		},
		logger,
		sessionStateDir: path.join(os.homedir(), '.copilot', 'session-state')
	});
}

async function handleStopChat(): Promise<void> {
	if (!sessionManager || !sessionManager.isRunning()) {
		vscode.window.showInformationMessage('No active Copilot CLI session');
		return;
	}
	try {
		await sessionManager.stop();
		sessionManager = null;
		statusBarItem.text = "$(comment-discussion) Copilot CLI";
		statusBarItem.tooltip = "Open Copilot CLI Chat";
		sidebarSurface.setSessionActive(false);
		sidebarSurface.addAssistantMessage('Session ended.');
		vscode.window.showInformationMessage('Copilot CLI session stopped');
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error(`Failed to stop CLI: ${errorMessage}`);
		vscode.window.showErrorMessage(`Failed to stop Copilot CLI: ${errorMessage}`);
	}
}

async function handleViewDiff(message: any): Promise<void> {
	try {
		const diffData = message.data || message;
		const beforeUri = vscode.Uri.file(diffData.beforeUri);
		const afterUri = vscode.Uri.file(diffData.afterUri);
		const title = diffData.title || 'File Diff';

		const fsModule = require('fs');
		if (!fsModule.existsSync(beforeUri.fsPath)) {
			vscode.window.showErrorMessage('Cannot open diff: Before file not found');
			return;
		}
		if (!fsModule.existsSync(afterUri.fsPath)) {
			vscode.window.showErrorMessage(`Cannot open diff: After file not found at ${afterUri.fsPath}`);
			return;
		}

		await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, title);
	} catch (error) {
		logger.error(`Failed to open diff: ${error instanceof Error ? error.message : String(error)}`);
		vscode.window.showErrorMessage(`Failed to open diff: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function handleTogglePlanMode(enabled: boolean): Promise<void> {
	if (!sessionManager || !sessionManager.isRunning()) {
		vscode.window.showWarningMessage('No active Copilot CLI session');
		return;
	}
	try {
		if (enabled) {
			await sessionManager.enablePlanMode();
		} else {
			await sessionManager.disablePlanMode();
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error(`Failed to toggle plan mode: ${errorMessage}`);
		vscode.window.showErrorMessage(`Failed to toggle plan mode: ${errorMessage}`);
	}
}

async function handleAcceptPlan(): Promise<void> {
	if (!sessionManager || !sessionManager.isRunning()) {
		vscode.window.showWarningMessage('No active Copilot CLI session');
		return;
	}
	try {
		await sessionManager.acceptPlan();
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logger.error(`Failed to accept plan: ${errorMsg}`);
		vscode.window.showErrorMessage(`Failed to accept plan: ${errorMsg}`);
	}
}

async function handleRejectPlan(): Promise<void> {
	if (!sessionManager || !sessionManager.isRunning()) {
		vscode.window.showWarningMessage('No active Copilot CLI session');
		return;
	}
	try {
		await sessionManager.rejectPlan();
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logger.error(`Failed to reject plan: ${errorMsg}`);
		vscode.window.showErrorMessage(`Failed to reject plan: ${errorMsg}`);
	}
}

async function determineSessionToResume(context: vscode.ExtensionContext): Promise<string | null> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		logger.info('No workspace folder, cannot determine session');
		return null;
	}

	const workspaceFolder = workspaceFolders[0].uri.fsPath;
	const filterByFolder = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('filterSessionsByFolder', true);
	const sessionStateDir = path.join(os.homedir(), '.copilot', 'session-state');

	// Sessions this window already has a surface for are not candidates — they are
	// already resumed. Without this, restoring a chat tab on reload and then asking
	// for "the last session" hands the sidebar the tab's own session, because it was
	// the last one written to.
	const sessionId = SessionService.getMostRecentSession(
		sessionStateDir,
		workspaceFolder,
		filterByFolder,
		sessionRegistry.liveSessionIds()
	);
	if (sessionId) {
		logger.info(`Determined session to resume: ${sessionId}`);
	} else {
		logger.info('No session to resume');
	}

	return sessionId;
}

async function startCLISession(context: vscode.ExtensionContext, resumeLastSession: boolean = true, specificSessionId?: string, target: ChatSessionHost = sidebarHost): Promise<void> {
	const plan = planSessionStart({ sessionId: specificSessionId }, sessionManager);
	if (plan.reuseRunning) {
		logger.warn('CLI session already running');
		return;
	}
	if (sessionManager && sessionManager.isRunning()) {
		// A *different* session is live in this window. Its events keep routing to
		// its own host (Task 5), so it does not go silent — but the module-level
		// handle moves to the new manager, which is the cross-session flaw Task 8
		// closes by giving each host its own. Say so rather than let it look normal.
		logger.warn(
			`Starting session ${specificSessionId} while ${sessionManager.getSessionId()} is still live — ` +
			`the module-level manager handle now points at the new one`
		);
	}

	try {
		// Wait for the CLI bundle bootstrap so we never spawn the SDK against
		// the system PATH copilot while a managed/local bundle is still
		// resolving. Bootstrap failures are already logged; on failure
		// resolvedCli stays null and SDKSessionManager falls back to PATH.
		if (cliBundleReady) {
			await cliBundleReady;
		}

		const config = getCLIConfig();
		logger.info('Creating CLI Process Manager with config:');
		logger.debug(JSON.stringify(config, null, 2));

		sessionManager = new SDKSessionManager(
			context,
			config,
			resumeLastSession,
			specificSessionId,
			resolvedCli?.cliPath,
			// The host owns session state, so it supplies the sticky-agent accessor
			// rather than the bridge reaching into the backendState singleton.
			createVSCodeHostBridge(context, {
				getActiveAgent: () => target.state.getActiveAgent()
			})
		);
		wireManagerEvents(context, sessionManager);

		logger.info('Starting CLI process...');
		await sessionManager.start();

		onSessionStarted(sessionManager, target);
	} catch (error) {
		await handleStartupError(error, context, resumeLastSession, specificSessionId);
		throw error;
	}
}

/** Wire all 10 granular event subscriptions from the SDK manager to the UI. */
function wireManagerEvents(context: vscode.ExtensionContext, manager: SDKSessionManager): void {
	// Message and streaming events are routed by the owning host, to *its* surface
	// — see `ChatSessionHost.attachManager`. What stays here is window-scoped:
	// the status bar, toasts, the session list, the sub-agent panels.
	sidebarHost.attachManager(manager);

	// Only the window's half of a status change lives here. What the session's
	// surface shows is the host's — see `ChatSessionHost.applyStatus`.
	context.subscriptions.push(manager.onDidChangeStatus(safeHandler('onDidChangeStatus', (statusData) => {
		logger.info(`[CLI Status] ${JSON.stringify(statusData)}`);
		switch (statusData.status) {
			case 'ready':
				if (Date.now() - lastDropdownRefresh > 30_000) {
					updateSessionsList();
				}
				break;
			case 'exited':
			case 'stopped':
				statusBarItem.text = "$(comment-discussion) CLI Exited";
				statusBarItem.tooltip = "Copilot CLI ended";
				vscode.window.showWarningMessage('Copilot CLI session ended');
				break;
			case 'session_expired':
				logger.info(`Session expired, new session created: ${statusData.newSessionId}`);
				vscode.window.showInformationMessage(`Session expired. New session started: ${statusData.newSessionId}`);
				break;
			case 'plan_mode_enabled':
			case 'plan_mode_disabled':
				updateSessionsList();
				break;
			case 'plan_ready':
				viewPlanFile();
				break;
			case 'session_renamed':
				logger.info(`[Rename Session] Renamed to: "${statusData.name}"`);
				updateSessionsList();
				break;
		}
	})));

	// Tool and sub-agent traffic reaches the owning session's surface through the
	// host. What remains here is the pop-out panel service, which is window-scoped
	// and buffers across sessions. Both callers colour an agent through the same
	// memoised allocator, so they cannot disagree.
	context.subscriptions.push(manager.onDidStartTool(safeHandler('onDidStartTool', (toolState) => {
		logger.info(`[Tool Start] ${toolState.toolName}`);
		subagentPanels.onTool(toolState);
	})));

	context.subscriptions.push(manager.onDidUpdateTool(safeHandler('onDidUpdateTool', (toolState) => {
		logger.debug(`[Tool Progress] ${toolState.toolName}: ${toolState.progress}`);
	})));

	context.subscriptions.push(manager.onDidCompleteTool(safeHandler('onDidCompleteTool', (toolState) => {
		logger.info(`[Tool Complete] ${toolState.toolName} - ${toolState.status}`);
	})));

	context.subscriptions.push(manager.onDidStartSubagent(safeHandler('onDidStartSubagent', (subagent) => {
		logger.info(`[Subagent Start] ${subagent.agentDisplayName ?? subagent.agentName} (${subagent.agentId})`);
		subagentPanels.onStart({ ...subagent, color: assignSubagentColor(subagent.agentId) });
	})));

	context.subscriptions.push(manager.onDidSubagentMessage(safeHandler('onDidSubagentMessage', (subagent) => {
		subagentPanels.onMessage(subagent);
	})));

	context.subscriptions.push(manager.onDidCompleteSubagent(safeHandler('onDidCompleteSubagent', (subagent) => {
		logger.info(`[Subagent Complete] ${subagent.agentDisplayName ?? subagent.agentName} - ${subagent.status}`);
		subagentPanels.onComplete(subagent);
	})));

	context.subscriptions.push(manager.onDidUpdateMcpServers(safeHandler('onDidUpdateMcpServers', (update) => {
		// The manager no longer writes MCP state into backendState directly; it
		// emits, and the host records it. Keeps the store host-side so the
		// manager can run in its own process.
		const workspaceState = getWorkspaceRuntimeState();
		for (const server of update.servers) {
			workspaceState.setMcpServerTools(server.name, server.tools);
			workspaceState.setMcpServerStatus(server.name, server.status);
		}
	})));

	context.subscriptions.push(manager.onDidChangeFile(safeHandler('onDidChangeFile', (fileChange) => {
		logger.info(`[File Change] ${fileChange.path} (${fileChange.type})`);
	})));
}

/**
 * Post-start setup: update state, UI, and session dropdown.
 *
 * Everything conversation-shaped goes to `target` and everything it renders goes
 * to `target`'s surface. It used to go to the `BackendState` singleton and the
 * module-level `chatProvider`, so starting any session marked the sidebar's
 * conversation active, adopted the new id onto `sidebarHost`, and greeted the
 * sidebar — whichever surface had actually asked for the session.
 */
function onSessionStarted(manager: SDKSessionManager, target: ChatSessionHost = sidebarHost): void {
	// manager.getWorkspacePath() returns the SDK session-state dir, not the
	// VS Code workspace.  Use the real workspace folder for image resolution.
	recordSessionStart(target, {
		sessionId: manager.getSessionId(),
		workspacePath: manager.getWorkspacePath() || null,
		model: getCLIConfig().model || null
	});

	const surface = target.getSurface();

	statusBarItem.text = "$(debug-start) CLI Running";
	statusBarItem.tooltip = "Copilot CLI is active";
	surface?.setSessionActive(true);

	const vsWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	surface?.setWorkspacePath(vsWorkspacePath);

	surface?.setValidateAttachmentsCallback(async (filePaths: string[]) => {
		if (!sessionManager) {
			return { valid: false, error: 'Session not active' };
		}
		return await sessionManager.validateAttachments(filePaths);
	});

	logger.info('CLI process started successfully');
	surface?.addAssistantMessage('Copilot CLI session started! How can I help you?');
	updateSessionsList();
	logger.show();

	// Fetch available models from SDK and send to webview (fire-and-forget)
	sessionManager?.getAvailableModels().then(models => {
		if (models.length > 0) {
			surface?.sendAvailableModels(models);
		}
	}).catch(err => {
		logger.warn(`[Models] Failed to fetch available models: ${err}`);
	});
}

/** Handle startup errors: auth errors get special dialog flow, others get generic message. */
async function handleStartupError(
	error: unknown,
	context: vscode.ExtensionContext,
	resumeLastSession: boolean,
	specificSessionId?: string
): Promise<void> {
	const errorMessage = error instanceof Error ? error.message : String(error);
	logger.error(`Failed to start CLI: ${errorMessage}`, error instanceof Error ? error : undefined);

	const enhancedError: any = error;

	if (enhancedError.errorType !== 'authentication') {
		statusBarItem.text = "$(error) CLI Failed";
		statusBarItem.tooltip = `Failed: ${errorMessage}`;
		vscode.window.showErrorMessage(`Failed to start Copilot CLI: ${errorMessage}`);
		return;
	}

	statusBarItem.text = "$(warning) Not Authenticated";
	statusBarItem.tooltip = "Copilot CLI authentication required";

	if (enhancedError.hasEnvVar) {
		await handleExpiredTokenError(context, enhancedError.envVarSource);
	} else {
		await handleNoAuthError(context, resumeLastSession, specificSessionId);
	}
}

/** Auth Scenario 2: Environment variable set but invalid/expired. */
async function handleExpiredTokenError(context: vscode.ExtensionContext, envVarSource: string): Promise<void> {
	sidebarSurface.addAssistantMessage(
		`🔐 **Authentication Failed**\n\n` +
		`Your \`${envVarSource}\` environment variable appears to be invalid or expired.\n\n` +
		`**To fix this:**\n` +
		`1. Update your token with a valid Personal Access Token\n` +
		`2. Or unset the environment variable to use interactive login\n` +
		`3. Then restart VS Code and try again\n\n` +
		`Use the buttons below for more help.`
	);

	const action = await vscode.window.showErrorMessage(
		`Authentication failed. Your ${envVarSource} appears to be invalid or expired.`,
		{ modal: false },
		'Show Instructions',
		'Open Terminal',
		'Start New Session'
	);

	if (action === 'Show Instructions') {
		vscode.env.openExternal(vscode.Uri.parse('https://docs.github.com/en/copilot/managing-copilot/configure-personal-settings/installing-github-copilot-in-the-cli'));
	} else if (action === 'Open Terminal') {
		const terminal = vscode.window.createTerminal('Copilot Auth');
		terminal.show();
		sidebarSurface.addAssistantMessage(`Terminal opened. Update your \`${envVarSource}\` or unset it, then restart VS Code.`);
	} else if (action === 'Start New Session') {
		await startCLISession(context, false, undefined);
	}
}

/** Auth Scenario 1: No auth environment variable, need OAuth login. */
async function handleNoAuthError(
	context: vscode.ExtensionContext,
	resumeLastSession: boolean,
	specificSessionId?: string
): Promise<void> {
	const ssoSlug = vscode.workspace.getConfiguration('copilotCLI').get<string>('ghSsoEnterpriseSlug', '');

	const action = await vscode.window.showErrorMessage(
		'Copilot CLI not authenticated. Authenticate to continue.',
		{ modal: false },
		'Authenticate Now',
		'Retry'
	);

	if (action === 'Authenticate Now') {
		const terminal = vscode.window.createTerminal('Copilot Auth');
		if (ssoSlug) {
			terminal.sendText(`copilot login --host https://github.com/enterprises/${ssoSlug}/sso`);
		} else {
			terminal.sendText('copilot login');
		}
		terminal.show();

		sidebarSurface.addAssistantMessage(
			'🔐 **Authentication Required**\n\n' +
			'A terminal has been opened with the `copilot login` command. Please:\n\n' +
			'1. Complete the device code flow in your browser\n' +
			'2. After successful authentication, use the **"Start New Session"** button (+ icon) at the top of this panel\n\n' +
			'_Or close this panel and reopen it with Ctrl+Shift+P → "Copilot CLI: Open Chat"_'
		);

		const retryAction = await vscode.window.showInformationMessage(
			'Complete authentication in the terminal, then start a new session',
			{ modal: false },
			'Start New Session'
		);
		if (retryAction === 'Start New Session') {
			await startCLISession(context, false, undefined);
		}
	} else if (action === 'Retry') {
		await startCLISession(context, resumeLastSession, specificSessionId);
	}
}

function getCLIConfig(): CLIConfig {
	const config = vscode.workspace.getConfiguration('copilotCLI');
	const yolo = config.get<boolean>('yolo', false);
	
	return {
		yolo: yolo,
		// YOLO mode overrides all allow* settings to true
		allowAllTools: yolo || config.get<boolean>('allowAllTools', false),
		allowAllPaths: yolo || config.get<boolean>('allowAllPaths', false),
		allowAllUrls: yolo || config.get<boolean>('allowAllUrls', false),
		allowTools: config.get<string[]>('allowTools', []),
		denyTools: config.get<string[]>('denyTools', []),
		allowUrls: config.get<string[]>('allowUrls', []),
		denyUrls: config.get<string[]>('denyUrls', []),
		addDirs: config.get<string[]>('addDirs', []),
		agent: config.get<string>('agent', ''),
		// Empty (unset) resolves to 'auto' so Copilot's server-side router picks the
		// best model per turn. planModel stays empty to inherit the work model.
		model: config.get<string>('model', '') || DEFAULT_MODEL,
		planModel: config.get<string>('planModel', ''),
		noAskUser: config.get<boolean>('noAskUser', false),
		streaming: config.get<boolean>('streaming', true)
	};
}

function updateSessionsList() {
	lastDropdownRefresh = Date.now();
	try {
		const config = vscode.workspace.getConfiguration('copilotCLI');
		const filterByFolder = config.get<boolean>('filterSessionsByFolder', true);
		const workspaceFolders = vscode.workspace.workspaceFolders;
		const workspaceFolder = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : null;
		const sessionStateDir = path.join(os.homedir(), '.copilot', 'session-state');

		let sessions = SessionService.getAllSessions(sessionStateDir);
		logger.debug(`Found ${sessions.length} total sessions`);

		if (filterByFolder && workspaceFolder) {
			sessions = SessionService.filterSessionsByFolder(sessions, workspaceFolder);
			logger.debug(`Filtered to ${sessions.length} for workspace: ${workspaceFolder}`);
		}

		// Add any live session not yet on disk (a new session has no events.jsonl).
		// Every host's, not just the window manager's: with N surfaces, asking one
		// manager for "the" current session leaves the tab you are looking at out of
		// your own dropdown.
		for (const liveId of sessionRegistry.liveSessionIds()) {
			if (!sessions.find(s => s.id === liveId)) {
				sessions.unshift({ id: liveId, mtime: Date.now() });
			}
		}

		if (sessions.length === 0) {
			getWorkspaceRuntimeState().setSessions([]);
			return;
		}

		const sortedSessions = sessions.sort((a, b) => b.mtime - a.mtime);
		const sessionList = sortedSessions.map((session) => ({
			id: session.id,
			label: SessionService.formatSessionLabel(session.id, path.join(sessionStateDir, session.id))
		}));

		// Written, not pushed. Every surface subscribes and pairs this list with its
		// own host's session id, so a tab's dropdown highlights the tab's session.
		getWorkspaceRuntimeState().setSessions(sessionList);
	} catch (error) {
		logger.error('Failed to update sessions list', error instanceof Error ? error : undefined);
	}
}

/**
 * Rebuild a session's transcript from its event log.
 *
 * One projection, so the transcript is the same however you arrived at it. This
 * previously read only `user.message` and `assistant.message`, dropping every tool
 * call, while the webview's own re-init path read a separate in-memory summary that
 * rendered each tool as "Tool execution" — one session, two histories.
 */
async function loadSessionHistory(sessionId: string, target: ChatSessionHost = sidebarHost): Promise<void> {
	const eventsPath = path.join(os.homedir(), '.copilot', 'session-state', sessionId, 'events.jsonl');
	const messages = await buildSessionTranscript(eventsPath);

	loadTranscriptInto(target, messages);
	const toolCount = messages.filter(m => m.kind === 'tool').length;
	logger.info(`Loaded ${messages.length} messages (${toolCount} tool calls) from session history`);
}

function updateActiveFile(editor: vscode.TextEditor | undefined) {
	// Filter out non-file editors (output channels, debug console, etc.)
	if (editor && editor.document.uri.scheme !== 'file' && editor.document.uri.scheme !== 'untitled') {
		editor = undefined;
	}

	// If editor is defined, update last known editor
	if (editor) {
		lastKnownTextEditor = editor;
	}
	
	// If editor is undefined, only clear if there are no visible text editors
	if (!editor) {
		if (vscode.window.visibleTextEditors.length === 0) {
			// All files are closed, clear active file
			getWorkspaceRuntimeState().setActiveFilePath(null);
			lastKnownTextEditor = undefined;
		}
		// Otherwise, keep the last known active file (focus moved to webview)
		return;
	}
	
	const includeActiveFile = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('includeActiveFile', true);
	if (!includeActiveFile) {
		getWorkspaceRuntimeState().setActiveFilePath(null);
		return;
	}
	
	const workspaceFolders = vscode.workspace.workspaceFolders;
	let relativePath = editor.document.uri.fsPath;
	
	// Try to make it relative to workspace
	if (workspaceFolders && workspaceFolders.length > 0) {
		const workspaceRoot = workspaceFolders[0].uri.fsPath;
		if (relativePath.startsWith(workspaceRoot)) {
			relativePath = relativePath.substring(workspaceRoot.length + 1);
		}
	}
	
	getWorkspaceRuntimeState().setActiveFilePath(relativePath);
}

export function deactivate() {
	logger.info('Deactivating Copilot CLI Extension...');
	if (sessionManager) {
		logger.info('Disposing CLI manager...');
		sessionManager.dispose();
	}
	// Reaches pending hosts too — a session that never started still owns
	// subscriptions, and is unreachable by id.
	sessionRegistry?.disposeAll();
	logger.info('Extension deactivated');
}

// Export for testing
export { SDKSessionManager } from './sdkSessionManager';
export { BackendState, getBackendState } from './backendState';
export { updateSessionsList }; // Exported for testing
export { ExtensionRpcRouter } from './extension/rpc';
export { Logger } from './logger';
