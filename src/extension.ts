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
// `vscodeHostBridge`, not `hostBridge`: the contract and the VS Code implementation
// were split so `sdkSessionManager.ts` can depend on the first without the second.
import { createVSCodeHostBridge } from './extension/vscodeHostBridge';
import { SUBAGENT_PALETTE } from './shared/subagentPalette';
import { forkCurrentSession } from './extension/commands/forkSession';
import { SessionService } from './extension/services/SessionService';
import { SubagentPanelService } from './extension/services/SubagentPanelService';
import { computeInlineDiff, DiffLine } from './extension/services/InlineDiffService';
import { createAnimationTestPanel } from './animationTestPanel';
import { shouldAutoEnablePlanMode } from './extension/utils/planModeUtils';
import { CliBundleService, ResolvedCli } from './extension/services/cliBundleService';
import type { CliCapabilityService } from './extension/services/cliCapabilityService';
import { bootstrapCliBundle } from './extension/services/cliBundleBootstrap';
import { getImportedServers } from './extension/services/vscodeMcpImportService';
import { buildSessionTranscript } from './extension/services/sessionTranscriptBuilder';
import { ChatSessionRegistry } from './extension/session/ChatSessionRegistry';
import { ChatSessionHost } from './extension/session/ChatSessionHost';
import { createChatSessionServices } from './extension/session/chatSessionServices';
import { planSessionStart } from './extension/session/sessionStartPlan';
import { planSessionSwitch, planSessionTransfer } from './extension/session/sessionSwitchPlan';
import { resolveCommandSurface } from './extension/webview/commandSurface';
import { chooseStartupModel } from './extension/session/sessionModel';
import { chooseSessionToResume } from './extension/session/sessionToResume';
import { resolvePairings } from './extension/session/sessionPairing';
import { orderSessionsByPairing } from './extension/session/sessionDropdown';
import { createStartManager } from './extension/session/startManager';
import { recordSessionStart, loadTranscriptInto } from './extension/session/sessionBootstrap';
import { ManagedMCPRegistry } from './extension/services/managedMCPRegistry';
import { MCPConfigurationService } from './extension/services/mcpConfigurationService';
import { CLIPassthroughService } from './extension/services/CLIPassthroughService';

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
/** Set once the CLI bundle resolves; replayed onto every surface built after. */
let resolvedCapability: CliCapabilityService | undefined;
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
		// The host's `{ sessionId, resume }` is threaded through rather than dropped.
		// Discarding it is what made "open or restore the surface for session X"
		// resume whatever `determineSessionToResume` picked by mtime.
		startManager: createStartManager({
			resumeAndStart: (request) => resumeAndStartSession(context, request),
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
			// No detached-reveal fallback: a panel either exists or it does not.
			const surface = new WebviewChatSurface(context.extensionUri, { label: 'Tab' });
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
	// Kept so surfaces built later — every chat tab — get it too. Without this a
	// tab opened before the bundle resolved would keep `null` for the window's life.
	resolvedCapability = capability;
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
	if (resolvedCapability) {
		surface.setCliCapability(resolvedCapability);
	}
	// Asked of *this* surface's session. The MCP server list is a property of the
	// window in the sense that every session sees the same config — but the RPC that
	// answers it belongs to a live CLI session, and reading the module handle asked
	// whichever one started last.
	surface.setMcpListProvider(async () => {
		const host = surface.getSessionHost();
		if (!host?.isLive) {
			throw new Error('No active session for mcp.list');
		}
		return host.listMcpServers();
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
		const host = surface.getSessionHost();
		return host?.isLive ? host.listConfiguredMcpServers() : {};
	});
}

/** Where the CLI keeps a session's files. One definition, several readers. */
function sessionStatePath(sessionId: string): string {
	return path.join(os.homedir(), '.copilot', 'session-state', sessionId);
}

/**
 * Opens plan.md in the editor. Shared by the toolbar button and `plan_ready`.
 *
 * Takes the session whose plan it is. Reading the module handle opened whichever
 * session started last — so with a tab open, the sidebar's *View Plan* button
 * showed the tab's plan.
 */
async function viewPlanFile(host: ChatSessionHost | undefined): Promise<void> {
	const planPath = host?.planFilePath();
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
		await viewPlanFile(surface.getSessionHost());
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
			const sessionPath = sessionStatePath(sessionId);
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
		await handleForkSession(context, surface);
	}));

	// New / switch session, on the surface that asked. Both used to travel as
	// `executeCommand`, arriving at a handler that read the module-level
	// `sessionManager` — so the dropdown and the **+** button in a tab drove the
	// sidebar (defect C). The surface is right here; nothing needs resolving.
	subscriptions.push(surface.onDidRequestNewSession(async () => {
		await handleNewSession(context, surface);
	}));

	subscriptions.push(surface.onDidRequestSwitchSession(async (sessionId: string) => {
		await handleSwitchSession(context, sessionId, surface);
	}));

	// `/btw <question>` — New Tab plus one send. Not a fork: no history travels
	// with it, because the point of a side question is that it is not part of the
	// conversation it came from, and carrying the transcript would spend exactly the
	// context the user was trying to protect.
	subscriptions.push(surface.onDidRequestAskInNewTab(async (prompt: string) => {
		await openNewTab(prompt);
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

/**
 * The file a *New Tab* click should seed, or null.
 *
 * Honours `copilotCLI.includeActiveFile` — a user who turned active-file context
 * off did not ask for it back — and reads the editor directly rather than the
 * window's `activeFilePath`, which is already null when that setting is off and so
 * cannot distinguish "no file open" from "not being shown".
 */
function activeFileToSeed(): string | null {
	if (!vscode.workspace.getConfiguration('copilotCLI').get<boolean>('includeActiveFile', true)) {
		return null;
	}
	const editor = vscode.window.activeTextEditor ?? lastKnownTextEditor;
	const uri = editor?.document.uri;
	if (!uri || (uri.scheme !== 'file' && uri.scheme !== 'untitled')) {
		return null;
	}
	// `startsWith` is not containment: workspace `/repo` and file `/repo2/a.ts` share a prefix, and
	// slicing by length yielded `2/a.ts` — a path to nothing, seeded into a new tab.
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspaceRoot) {
		return uri.fsPath;
	}
	const relative = path.relative(workspaceRoot, uri.fsPath);
	const insideWorkspace = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
	return insideWorkspace ? relative : uri.fsPath;
}

/**
 * Which chat a command-palette entry acts on.
 *
 * The palette is the one origin with no surface attached — every other route
 * carries its identity, because the RPC channel *is* the identity. The rule
 * (§4.2) is never to pick a surface the user did not indicate, so: the focused
 * chat tab if there is one, the only chat there is if there is only one,
 * otherwise nothing and the command says so.
 *
 * The sidebar is promoted when no tab claims focus. VS Code exposes `active` on
 * `WebviewPanel` and nothing equivalent on `WebviewView`, so the sidebar cannot
 * report focus for itself; "no tab has it" is the closest true statement, and it
 * can never hand a palette command a *tab's* session, which is the defect that
 * mattered.
 */
function commandSurface(): WebviewChatSurface | undefined {
	const candidates = sessionRegistry.hostsWithSurfaces()
		.map(host => host.getSurface() as WebviewChatSurface)
		.map(surface => ({ surface, isActive: surface.isActive?.() === true }));

	if (!candidates.some(candidate => candidate.isActive)) {
		const sidebarCandidate = candidates.find(candidate => candidate.surface === sidebarSurface);
		if (sidebarCandidate) {
			sidebarCandidate.isActive = true;
		}
	}
	return resolveCommandSurface(candidates);
}

/**
 * The surface a palette command should act on, or a message explaining why not.
 *
 * Undecidable means two or more chats are open and none has focus. Guessing there
 * is precisely what P3 removes, so the command declines and points at the button
 * in the chat the user means.
 */
function commandSurfaceOrExplain(): WebviewChatSurface | undefined {
	const surface = commandSurface();
	if (!surface) {
		logger.warn('[Command] no chat surface indicated — declining rather than guessing');
		vscode.window.showInformationMessage(
			'More than one Copilot CLI chat is open. Use the controls in the chat you mean.'
		);
	}
	return surface;
}

/**
 * *New Tab* — and the one place that decides what a new tab's session is like.
 *
 * Both entry points come through here, which is the point. When only the command
 * called `chatPanels.openNew()`, a new tab quietly skipped
 * `copilotCLI.startNewSessionInPlanning` while the sidebar's *New Session*
 * honoured it — one setting, two paths, kept in step by nobody. Found live.
 *
 * `prompt` is `/btw`: the same tab plus one send, defined in terms of this rather
 * than reimplementing it, so the two can never drift on anything decided here.
 */
async function openNewTab(prompt?: string): Promise<void> {
	const host = await chatPanels.openNew(activeFileToSeed());

	// A New Tab *is* a new session, so the standing default for new sessions
	// applies. The gesture said "new conversation here" and said nothing about plan
	// mode, so the setting is not being overridden — it is being honoured.
	const config = vscode.workspace.getConfiguration('copilotCLI');
	if (shouldAutoEnablePlanMode(config.get<boolean>('startNewSessionInPlanning'))) {
		logger.info('[New Tab] startNewSessionInPlanning=true, enabling plan mode');
		try {
			// Awaited before the prompt below: the plan session has to exist before
			// anything is sent, or `/btw`'s question races the mode switch and lands
			// on whichever session won.
			await host.enablePlanMode();
		} catch (err: any) {
			logger.error(`[New Tab] Failed to auto-enable plan mode: ${err.message}`);
		}
	}

	const question = prompt?.trim();
	if (!question) {
		// New Tab, or `/btw` with nothing after it — which is the same thing.
		return;
	}

	const surface = host.getSurface() as WebviewChatSurface | undefined;
	if (!surface) {
		logger.warn('[btw] the new tab produced no surface — the question was not sent');
		return;
	}
	surface.addUserMessage(question);
	surface.setThinking(true);
	await host.prompt(question);
}

/** Register all VS Code commands. */
function registerCommands(context: vscode.ExtensionContext): void {
	const commands = [
		vscode.commands.registerCommand('copilot-cli-extension.openChat', () => handleOpenChat(context)),
		// Through `openNewTab`, not straight to the panel service: a new tab is a new
		// session, and what a new session is like is decided in one place.
		vscode.commands.registerCommand('copilot-cli-extension.openChatInTab', () => openNewTab()),
		vscode.commands.registerCommand('copilot-cli-extension.startChat', () => handleStartChat(context)),
		vscode.commands.registerCommand('copilot-cli-extension.newSession', async () => {
			const surface = commandSurfaceOrExplain();
			if (surface) { await handleNewSession(context, surface); }
		}),
		vscode.commands.registerCommand('copilot-cli-extension.switchSession', async (sessionId: string) => {
			const surface = commandSurfaceOrExplain();
			if (surface) { await handleSwitchSession(context, sessionId, surface); }
		}),
		vscode.commands.registerCommand('copilot-cli-extension.stopChat', async () => {
			const surface = commandSurfaceOrExplain();
			if (surface) { await handleStopChat(surface); }
		}),
		vscode.commands.registerCommand('copilot-cli-extension.refreshPanel', () => {
			sidebarSurface.forceRecreate();
			vscode.window.showInformationMessage('Chat panel refreshed');
		}),
		vscode.commands.registerCommand('copilot-cli-extension.viewDiff', (message: any) => handleViewDiff(message)),
		// Not contributed to the palette; kept as commands so a keybinding or another
		// extension can reach them. Each resolves its own target rather than reading
		// a global — the webview's own toggle goes straight to its host and never
		// comes through here (see `registerChatHandlers`).
		vscode.commands.registerCommand('copilot-cli-extension.togglePlanMode', async (enabled: boolean) => {
			const host = commandSurfaceOrExplain()?.getSessionHost();
			if (enabled) { await host?.enablePlanMode(); } else { await host?.disablePlanMode(); }
		}),
		vscode.commands.registerCommand('copilot-cli-extension.acceptPlan', async () => {
			await commandSurfaceOrExplain()?.getSessionHost()?.acceptPlan();
		}),
		vscode.commands.registerCommand('copilot-cli-extension.rejectPlan', async () => {
			await commandSurfaceOrExplain()?.getSessionHost()?.rejectPlan();
		}),
		vscode.commands.registerCommand('copilot-cli-extension.openAnimationTestLight', () => createAnimationTestPanel('light')),
		vscode.commands.registerCommand('copilot-cli-extension.openAnimationTestDark', () => createAnimationTestPanel('dark')),
		// A per-tab action: the sidebar has nothing to move back to. Gated in the
		// palette by `activeWebviewPanelId == 'copilotChatPanel'`, so it is only
		// offered where it means something.
		vscode.commands.registerCommand('copilot-cli-extension.moveChatToSidebar', async () => {
			const surface = commandSurface();
			const sessionId = surface?.getSessionHost()?.sessionId;
			if (!sessionId || surface === sidebarSurface) {
				vscode.window.showInformationMessage('Open a Copilot CLI chat tab to move it back to the sidebar.');
				return;
			}
			sidebarSurface.show();
			await transferSessionToSidebar(context, sessionId, surface);
		}),
		vscode.commands.registerCommand('copilot-cli-extension.forkSession', async () => {
			const surface = commandSurfaceOrExplain();
			if (surface) { await handleForkSession(context, surface); }
		}),
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
): Promise<SDKSessionManager | null> {
	// Whose session this is. Defaulting to the sidebar keeps the command palette
	// and activation paths working; a host asking for itself supplies its own.
	const target = request.host ?? sidebarHost;
	// What is running is now *this host's* session, not the window's. The old
	// argument was the module-level handle, which answers "is anything running
	// here" — the question §2 shows nothing actually wanted.
	const plan = planSessionStart(
		{ ...request, onBehalfOfHost: Boolean(request.host) },
		{ isRunning: () => target.isLive, getSessionId: () => target.sessionId }
	);
	if (plan.reuseRunning) {
		// Nothing started; the caller wants what is already running.
		return null;
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

	// Returned rather than left in the module handle: two starts can be in flight at
	// once on a window reload, and the handle only remembers the last one.
	return await startCLISession(context, resumeLastSession, sessionIdToResume, target);
}

// ── Command Handlers ──────────────────────────────────────────────────────────

async function handleOpenChat(context: vscode.ExtensionContext): Promise<void> {
	sidebarSurface.show();
	await resumeAndStartSession(context);
}

async function handleStartChat(context: vscode.ExtensionContext): Promise<void> {
	sidebarSurface.show();
	if (sidebarHost.isLive) {
		vscode.window.showInformationMessage('Copilot CLI session is already running');
		return;
	}
	await startCLISession(context, true);
	vscode.window.showInformationMessage('Copilot CLI session started!');
}

/**
 * A new conversation on the surface that asked for one.
 *
 * Every line of this used to name the sidebar and stop the module-level manager,
 * so pressing **+** in a chat tab ended the sidebar's session and started the new
 * one there. The surface is a parameter now, and the session it stops is its own.
 */
async function handleNewSession(
	context: vscode.ExtensionContext,
	surface: WebviewChatSurface = sidebarSurface
): Promise<void> {
	const host = surface.getSessionHost() ?? sidebarHost;
	if (host.isLive) {
		await host.stop();
	}
	surface.show();
	surface.clearMessages();
	surface.resetPlanMode();
	// The DOM was cleared and this was not, so the new session inherited the old
	// transcript in memory and the next `sendInit()` rendered it back under the new
	// id (`chat-toolbar-cleanup-and-new-session-reset.md` item 4).
	host.beginNewConversation();
	await startCLISession(context, false, undefined, host);
	updateSessionsList();

	const config = vscode.workspace.getConfiguration('copilotCLI');
	if (shouldAutoEnablePlanMode(config.get<boolean>('startNewSessionInPlanning'))) {
		logger.info('[New Session] startNewSessionInPlanning=true, enabling plan mode');
		try {
			await host.enablePlanMode();
		} catch (err: any) {
			logger.error(`[New Session] Failed to auto-enable plan mode: ${err.message}`);
		}
	}

	vscode.window.showInformationMessage('New Copilot CLI session started!');
}

/**
 * Point a surface at a session — reveal, reattach or resume (P3 §4.5).
 *
 * This used to stop the *global* manager (since Task 7, possibly another
 * surface's) and then build a **second** `SDKSessionManager` resuming the same id:
 * two managers over one session directory. `ChatPanelService.openSession` already
 * consulted the registry first; the rule now lives in one place, `planSessionSwitch`,
 * so the dropdown and the panel service cannot drift apart.
 */
async function handleSwitchSession(
	context: vscode.ExtensionContext,
	sessionId: string,
	surface: WebviewChatSurface = sidebarSurface
): Promise<void> {
	logger.info(`Switch Session: ${sessionId}`);
	const requester = surface.getSessionHost();
	const plan = planSessionSwitch(sessionId, requester, (id) => sessionRegistry.get(id));

	switch (plan.action) {
		case 'already-here':
			logger.info(`[Switch Session] ${sessionId} is already on this surface`);
			return;

		case 'reveal':
			// Never steal: taking the session would blank a live conversation out
			// from under whoever is watching it.
			logger.info(`[Switch Session] ${sessionId} is open on ${plan.host.handle} — revealing it`);
			plan.host.getSurface()?.show();
			vscode.window.showInformationMessage('That session is already open in another chat.');
			return;

		case 'reattach': {
			// Its tab was closed and the host is still alive. Attaching is the whole
			// reconnect — starting anything here is what produced the second manager.
			logger.info(`[Switch Session] reattaching to live host ${plan.host.handle} for ${sessionId}`);
			noteSidebarChoice(context, surface, sessionId);
			releaseCurrentHost(surface);
			// Attaching cancels the wind-down this host was on, which is the whole
			// reconnect: a closed tab's session, picked from the dropdown, comes
			// back rather than being started a second time.
			plan.host.attachSurface(surface);
			surface.setSessionHost(plan.host);
			surface.resetPlanMode();
			surface.sendInit();
			updateSessionsList();
			return;
		}

		case 'resume': {
			noteSidebarChoice(context, surface, sessionId);
			const host = requester ?? sidebarHost;
			if (host.isLive) {
				await host.stop();
			}
			surface.resetPlanMode();
			await startCLISession(context, true, sessionId, host);
			await loadSessionHistory(sessionId, host);

			// The same logged init path the webview's own ready flow uses. This was a
			// third hand-built copy of the payload, posted raw — so a switch replayed
			// the transcript invisibly, and the init shape had three places to be kept
			// in step.
			surface.sendInit();
			updateSessionsList();
			return;
		}
	}
}

/**
 * A session change on the sidebar is the choice worth remembering.
 *
 * Only the sidebar: a tab's choice is already persisted by the panel serializer,
 * and letting a tab write here would make "the sidebar's session" mean "whichever
 * surface last switched", which is the class of bug P3 spent itself removing.
 */
function noteSidebarChoice(
	context: vscode.ExtensionContext,
	surface: WebviewChatSurface,
	sessionId: string | null
): void {
	if (surface === sidebarSurface) {
		recordSidebarSession(context, sessionId);
	}
}

/**
 * Move a session onto the sidebar and close the tab it came from.
 *
 * Not `handleSwitchSession`: that runs the collision rule, which correctly answers *reveal* for a
 * session another surface is showing — so the command revealed the tab it had been asked to close,
 * then disposed it, and the sidebar kept its old session. See `planSessionTransfer`.
 */
async function transferSessionToSidebar(
	context: vscode.ExtensionContext,
	sessionId: string,
	from: WebviewChatSurface
): Promise<void> {
	const plan = planSessionTransfer(sessionId, sidebarHost, (id) => sessionRegistry.get(id));

	if (plan.action === 'already-here') {
		from.dispose();
		return;
	}
	if (plan.action === 'resume') {
		// Nothing live to move — the tab's host is gone. Bring it back on the sidebar.
		logger.warn(`[Move to Sidebar] no live host for ${sessionId}; resuming it instead`);
		await handleSwitchSession(context, sessionId, sidebarSurface);
		from.dispose();
		return;
	}

	// Detach the moving host from the tab *before* the tab is disposed, so its dispose handler
	// cannot wind down the session we are in the middle of rescuing.
	plan.host.detachSurface(from);
	// The sidebar's own conversation loses its surface here, so it winds down like any orphan.
	releaseCurrentHost(sidebarSurface);
	plan.host.attachSurface(sidebarSurface);
	sidebarSurface.setSessionHost(plan.host);
	sidebarHost = plan.host;
	recordSidebarSession(context, sessionId);
	sidebarSurface.resetPlanMode();
	sidebarSurface.sendInit();
	updateSessionsList();
	from.dispose();
	logger.info(`[Move to Sidebar] ${sessionId} moved onto the sidebar from ${plan.host.handle}`);
}

/**
 * The surface is leaving its current host behind.
 *
 * Detached rather than stopped: the conversation it was showing may still be
 * working, and a user who switched away did not ask for it to be killed. What
 * happens to a host with no surface is §4.4's wind-down.
 */
function releaseCurrentHost(surface: WebviewChatSurface): void {
	const outgoing = surface.getSessionHost();
	if (!outgoing) {
		return;
	}
	outgoing.detachSurface(surface);
	// Not stopped — the conversation it was showing may still be working, and a
	// user who switched away did not ask for it to be killed. It winds down at its
	// next idle, and comes straight back if they switch to it again (§4.4).
	outgoing.releaseWhenIdle();
}

async function handleForkSession(
	context: vscode.ExtensionContext,
	surface: WebviewChatSurface = sidebarSurface
): Promise<void> {
	// Thin binder: the decision logic lives in forkCurrentSession, which takes
	// its collaborators explicitly so it can be tested without a vscode mock.
	// Mechanical change only — fork's *behaviour* is Task 10's subject.
	const host = surface.getSessionHost();
	await forkCurrentSession({
		getSessionId: () => (host?.isLive ? host.sessionId : null),
		fork: (_sessionId, opts) => {
			// getSessionId() already returned null if there was no live session, so
			// this is unreachable in practice — but assert it rather than
			// silencing the compiler with a non-null assertion.
			if (!host) { throw new Error('Session manager is not available'); }
			return host.fork(opts);
		},
		// Task 10: the fork opens in a tab and this surface stays on the parent.
		// `openSession` already carries the collision rule, so a fork that somehow
		// already had a surface would be revealed rather than opened twice.
		showFork: (sessionId) => chatPanels.openSession(sessionId),
		nameOf: (sessionId) => {
			try {
				return SessionService.formatSessionLabel(sessionId, sessionStatePath(sessionId));
			} catch {
				// A fork a second old may have nothing on disk to read.
				return null;
			}
		},
		notify: {
			info: (m) => { vscode.window.showInformationMessage(m); },
			warn: (m) => { vscode.window.showWarningMessage(m); },
			error: (m) => { vscode.window.showErrorMessage(m); }
		},
		logger,
		sessionStateDir: path.join(os.homedir(), '.copilot', 'session-state')
	});
}

async function handleStopChat(surface: WebviewChatSurface = sidebarSurface): Promise<void> {
	const host = surface.getSessionHost();
	if (!host?.isLive) {
		vscode.window.showInformationMessage('No active Copilot CLI session');
		return;
	}
	try {
		await host.stop();
		statusBarItem.text = "$(comment-discussion) Copilot CLI";
		statusBarItem.tooltip = "Open Copilot CLI Chat";
		surface.setSessionActive(false);
		surface.addAssistantMessage('Session ended.');
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




/**
 * Where the sidebar's own session choice is written down.
 *
 * `workspaceState`, not global config: it is a fact about this window's chat, not a
 * setting the user manages. Tabs need no equivalent — the panel serializer already
 * persists each panel's session id, which is why this defect was only ever visible
 * in the sidebar.
 */
const SIDEBAR_SESSION_KEY = 'copilotCLI.sidebarSessionId';

/**
 * Remember which session the sidebar is on.
 *
 * CLAUDE.md's *"intentional actions are treated intentionally"*: switching to a
 * session is a gesture, and a gesture that is honoured but not recorded loses to
 * the standing heuristic at the next reload — which is exactly what
 * `getMostRecentSession` was doing.
 */
function recordSidebarSession(context: vscode.ExtensionContext, sessionId: string | null): void {
	if (!sessionId) {
		return;
	}
	void context.workspaceState.update(SIDEBAR_SESSION_KEY, sessionId);
	logger.debug(`[Session] recorded the sidebar's session: ${sessionId}`);
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
	const liveSessionIds = sessionRegistry.liveSessionIds();
	const mostRecent = SessionService.getMostRecentSession(
		sessionStateDir,
		workspaceFolder,
		filterByFolder,
		liveSessionIds
	);

	// The recorded choice first, the mtime heuristic second. Without this, switching
	// to an older session and reading it without sending anything left no trace —
	// reload and you were back on the newer one.
	const sessionId = chooseSessionToResume({
		recorded: context.workspaceState.get<string>(SIDEBAR_SESSION_KEY) ?? null,
		mostRecent,
		// A directory is not a resumable session — but "resumable" is not the test.
		// A work session needs a transcript, or `session.resume` answers "Session
		// not found" (the "Previous session not found" dialog). A plan session does
		// not: restoring it means enablePlanMode(), which creates the plan session
		// when there is none. `isRestorable` knows the difference; requiring a
		// transcript for both is what dropped plan mode when the user entered it
		// and closed VS Code before typing anything.
		isAvailable: (id) =>
			!liveSessionIds.includes(id) &&
			SessionService.isRestorable(sessionStateDir, id)
	});

	if (sessionId) {
		logger.info(
			`Determined session to resume: ${sessionId}` +
			(sessionId === mostRecent ? '' : ' (the recorded choice, not the most recent)')
		);
	} else {
		logger.info('No session to resume');
	}

	return sessionId;
}

async function startCLISession(context: vscode.ExtensionContext, resumeLastSession: boolean = true, specificSessionId?: string, target: ChatSessionHost = sidebarHost): Promise<SDKSessionManager | null> {
	// Deliberately does not decide whether to start. `resumeAndStartSession` already
	// did, from a request carrying `fresh` and `onBehalfOfHost`; re-deciding here
	// from `specificSessionId` alone threw both away, so *New Tab* while the sidebar
	// ran answered "already running", returned, and let the caller attach the new
	// host to the sidebar's manager — one session rendered by two surfaces.
	//
	// Every other caller either guards itself (`handleStartChat`) or stops the
	// running manager first (new session, switch session, the auth retries).
	// The warning that used to be here — "a different session is live and the
	// module-level handle now points at the new one" — described a hazard that no
	// longer exists. Two live sessions in one window is the *design*; what made it
	// dangerous was the single handle, and there isn't one.

	try {
		// Wait for the CLI bundle bootstrap so we never spawn the SDK against
		// the system PATH copilot while a managed/local bundle is still
		// resolving. Bootstrap failures are already logged; on failure
		// resolvedCli stays null and SDKSessionManager falls back to PATH.
		if (cliBundleReady) {
			await cliBundleReady;
		}

		const config = getCLIConfig();

		// §4.6 — a session remembers the model you chose for it, and the read has to
		// happen *here*, before the manager is built. Feeding only the host's state
		// would start the CLI on the configured default while the UI displayed the
		// persisted one. Consulted only for a session we are actually resuming: a new
		// conversation has nothing recorded, which is exactly how `copilotCLI.model`
		// keeps its scope as the default for new sessions.
		if (specificSessionId) {
			config.model = chooseStartupModel({
				persisted: SessionService.readSessionModel(sessionStatePath(specificSessionId)),
				configured: vscode.workspace.getConfiguration('copilotCLI').get<string>('model', ''),
				fallback: DEFAULT_MODEL
			});
		}

		logger.info('Creating CLI Process Manager with config:');
		logger.debug(JSON.stringify(config, null, 2));

		// A local, and now the only handle there is. Two starts can be in flight at
		// once — a restored tab's fresh session and the sidebar's ambient resume —
		// and both used to assign to a module-level `sessionManager`. Reading it back
		// after the await gave whichever finished last, so `onSessionStarted` adopted
		// another session's id onto this target: two hosts claimed one session and a
		// real CLI session was orphaned.
		//
		// No `context` argument: the manager takes a required HostBridge instead, and
		// the bridge below is the only thing that still needs the context.
		const manager = new SDKSessionManager(
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
		wireManagerEvents(context, manager, target);

		logger.info('Starting CLI process...');
		await manager.start();

		onSessionStarted(manager, target, config.model);
		// A new session started in the sidebar is a choice too — otherwise the
		// mtime heuristic could hand the sidebar something else on the next reload,
		// and the conversation you just started would be the one that lost.
		if (target === sidebarHost) {
			recordSidebarSession(context, manager.getSessionId());
		}
		return manager;
	} catch (error) {
		await handleStartupError(error, context, resumeLastSession, specificSessionId, target);
		throw error;
	}
}

/**
 * Wire the window-scoped half of a manager's events. The session's half is the
 * host's — see `ChatSessionHost.attachManager`.
 *
 * Every subscription here is registered **against the owning host**, not against
 * `context.subscriptions`. These are roughly ten handlers per manager, and
 * extension-lifetime storage meant every session switch leaked a set and every tab
 * added one. `context` is no longer a parameter, which is the guard: there is
 * nothing to accidentally push into.
 */
function wireManagerEvents(context: vscode.ExtensionContext, manager: SDKSessionManager, owner: ChatSessionHost): void {
	// Message and streaming events are routed by the owning host, to *its* surface
	// — see `ChatSessionHost.attachManager`. What stays here is window-scoped:
	// the status bar, toasts, the session list, the sub-agent panels.
	//
	// `owner` is required rather than defaulted. Naming `sidebarHost` here sent
	// every session's output to the sidebar regardless of which surface asked for
	// it — the exact defect Task 5 removed from the event handlers, still alive one
	// line above them because attachment had never been parameterised.
	owner.attachManager(manager);

	// Only the window's half of a status change lives here. What the session's
	// surface shows is the host's — see `ChatSessionHost.applyStatus`.
	owner.ownManagerSubscription(manager.onDidChangeStatus(safeHandler('onDidChangeStatus', (statusData) => {
		logger.info(`[CLI Status] ${JSON.stringify(statusData)}`);
		switch (statusData.status) {
			case 'ready':
				if (Date.now() - lastDropdownRefresh > 30_000) {
					updateSessionsList();
				}
				break;
			case 'exited':
			case 'stopped': {
				// The status bar is the *window's*, so it must reflect the window — not whichever
				// session happened to stop. With two conversations open, ending a background tab
				// used to report that the CLI had exited while the other one was still streaming.
				const stillLive = sessionRegistry.liveHosts().filter(h => h !== owner && h.isLive).length;
				if (stillLive > 0) {
					logger.info(`[CLI Status] ${owner.handle} ended; ${stillLive} session(s) still live`);
					break;
				}
				statusBarItem.text = "$(comment-discussion) CLI Exited";
				statusBarItem.tooltip = "Copilot CLI ended";
				vscode.window.showWarningMessage('Copilot CLI session ended');
				break;
			}
			case 'session_expired':
				logger.info(`Session expired, new session created: ${statusData.newSessionId}`);
				vscode.window.showInformationMessage(`Session expired. New session started: ${statusData.newSessionId}`);
				break;
			case 'plan_mode_enabled': {
				// P4's record, written once at plan-session creation.
				//
				// `planSessionId` comes off the event; it is deliberately *not*
				// derived here from the `-plan` suffix. Deriving it would make this
				// a second place that knows the convention, inside the change whose
				// whole purpose is to reduce the count from two to one — and that
				// count is the cost of ever adopting the CLI's native plan mode.
				//
				// Absent on a manager that predates the field, in which case nothing
				// is written and `resolvePairings` falls back to the suffix, exactly
				// as it does for every plan session already on disk.
				//
				// Read through a local widening rather than declared: `StatusData`
				// lives in `sdkSessionManager.ts`, which is Lane A's file, and the
				// field exists on their branch. The cast is what lets this ship now
				// and start working on their merge without either lane editing the
				// other's file; it becomes redundant, and harmless, at that point.
				const planSessionId = (statusData as { planSessionId?: string }).planSessionId;
				if (planSessionId && owner.sessionId) {
					SessionService.writeSessionPairing(sessionStatePath(planSessionId), owner.sessionId);
					logger.info(`[Plan Mode] paired ${planSessionId} → ${owner.sessionId}`);
				}
				// Entering plan mode is a gesture, and an unrecorded gesture loses to
				// the standing choice at the next reload — CLAUDE.md's "intentional
				// actions are treated intentionally". Without this the record keeps
				// naming the work half, startup never sees a plan id, and plan mode
				// silently fails to come back.
				if (planSessionId && owner === sidebarHost) {
					recordSidebarSession(context, planSessionId);
				}
				updateSessionsList();
				break;
			}
			case 'plan_mode_disabled':
				// Symmetric: leaving plan mode puts the work half back on record, so a
				// reload does not drop the user into planning they had finished with.
				if (owner === sidebarHost) {
					recordSidebarSession(context, owner.sessionId);
				}
				updateSessionsList();
				break;
			case 'plan_ready':
				viewPlanFile(owner);
				break;
			case 'session_renamed':
				logger.info(`[Rename Session] Renamed to: "${statusData.name}"`);
				updateSessionsList();
				break;
			case 'model_switched': {
				// The gesture, written down. Without this the next resume reads
				// `copilotCLI.model` and the user's choice silently disappears —
				// row one of CLAUDE.md's "intentional actions" table.
				//
				// Here rather than in `ChatSessionHost.applyStatus` because this is
				// filesystem work: the host records on its own state and tells its own
				// surface, and gains no `fs` dependency.
				const switchedSessionId = owner.sessionId;
				if (switchedSessionId && statusData.model) {
					SessionService.writeSessionModel(sessionStatePath(switchedSessionId), statusData.model);
					logger.info(`[Model Switch] recorded ${statusData.model} for ${switchedSessionId}`);
				}
				break;
			}
		}
	})));

	// Tool and sub-agent traffic reaches the owning session's surface through the
	// host. What remains here is the pop-out panel service, which is window-scoped
	// and buffers across sessions. Both callers colour an agent through the same
	// memoised allocator, so they cannot disagree.
	owner.ownManagerSubscription(manager.onDidStartTool(safeHandler('onDidStartTool', (toolState) => {
		logger.info(`[Tool Start] ${toolState.toolName}`);
		subagentPanels.onTool(toolState);
	})));

	owner.ownManagerSubscription(manager.onDidUpdateTool(safeHandler('onDidUpdateTool', (toolState) => {
		logger.debug(`[Tool Progress] ${toolState.toolName}: ${toolState.progress}`);
	})));

	owner.ownManagerSubscription(manager.onDidCompleteTool(safeHandler('onDidCompleteTool', (toolState) => {
		logger.info(`[Tool Complete] ${toolState.toolName} - ${toolState.status}`);
	})));

	owner.ownManagerSubscription(manager.onDidStartSubagent(safeHandler('onDidStartSubagent', (subagent) => {
		logger.info(`[Subagent Start] ${subagent.agentDisplayName ?? subagent.agentName} (${subagent.agentId})`);
		subagentPanels.onStart({ ...subagent, color: assignSubagentColor(subagent.agentId) });
	})));

	owner.ownManagerSubscription(manager.onDidSubagentMessage(safeHandler('onDidSubagentMessage', (subagent) => {
		subagentPanels.onMessage(subagent);
	})));

	owner.ownManagerSubscription(manager.onDidCompleteSubagent(safeHandler('onDidCompleteSubagent', (subagent) => {
		logger.info(`[Subagent Complete] ${subagent.agentDisplayName ?? subagent.agentName} - ${subagent.status}`);
		subagentPanels.onComplete(subagent);
	})));

	owner.ownManagerSubscription(manager.onDidUpdateMcpServers(safeHandler('onDidUpdateMcpServers', (update) => {
		// The manager no longer writes MCP state into backendState directly; it
		// emits, and the host records it. Keeps the store host-side so the
		// manager can run in its own process.
		const workspaceState = getWorkspaceRuntimeState();
		for (const server of update.servers) {
			workspaceState.setMcpServerTools(server.name, server.tools);
			workspaceState.setMcpServerStatus(server.name, server.status);
		}
	})));

	owner.ownManagerSubscription(manager.onDidChangeFile(safeHandler('onDidChangeFile', (fileChange) => {
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
function onSessionStarted(
	manager: SDKSessionManager,
	target: ChatSessionHost = sidebarHost,
	startedOnModel?: string
): void {
	// manager.getWorkspacePath() returns the SDK session-state dir, not the
	// VS Code workspace.  Use the real workspace folder for image resolution.
	//
	// The model is passed in rather than re-read from config: `startCLISession` may
	// have preferred this session's persisted choice over the configured default,
	// and re-reading here would show the user the setting they did not pick.
	recordSessionStart(target, {
		sessionId: manager.getSessionId(),
		workspacePath: manager.getWorkspacePath() || null,
		model: startedOnModel ?? getCLIConfig().model ?? null
	});

	const surface = target.getSurface();

	statusBarItem.text = "$(debug-start) CLI Running";
	statusBarItem.tooltip = "Copilot CLI is active";
	surface?.setSessionActive(true);

	const vsWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	surface?.setWorkspacePath(vsWorkspacePath);

	// This host's session validates this host's attachments. Reading the module
	// handle meant a tab's file picker was checked against the sidebar's session,
	// whose working directory may differ.
	surface?.setValidateAttachmentsCallback((filePaths: string[]) => target.validateAttachments(filePaths));

	logger.info('CLI process started successfully');
	surface?.addAssistantMessage('Copilot CLI session started! How can I help you?');
	updateSessionsList();
	logger.show();

	// Fetch available models from SDK and send to webview (fire-and-forget)
	target.availableModels().then(models => {
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
	specificSessionId?: string,
	target: ChatSessionHost = sidebarHost
): Promise<void> {
	// Report on the surface that actually failed. Every message below used to go to
	// `sidebarSurface`, so a tab that could not authenticate left its own chat blank and put the
	// error — and the retry button — in an unrelated conversation.
	const surface = (target.getSurface() as WebviewChatSurface | undefined) ?? sidebarSurface;
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
		await handleExpiredTokenError(context, enhancedError.envVarSource, surface, target);
	} else {
		await handleNoAuthError(context, resumeLastSession, specificSessionId, surface, target);
	}
}

/** Auth Scenario 2: Environment variable set but invalid/expired. */
async function handleExpiredTokenError(
	context: vscode.ExtensionContext,
	envVarSource: string,
	surface: WebviewChatSurface = sidebarSurface,
	target: ChatSessionHost = sidebarHost
): Promise<void> {
	surface.addAssistantMessage(
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
		surface.addAssistantMessage(`Terminal opened. Update your \`${envVarSource}\` or unset it, then restart VS Code.`);
	} else if (action === 'Start New Session') {
		await startCLISession(context, false, undefined, target);
	}
}

/** Auth Scenario 1: No auth environment variable, need OAuth login. */
async function handleNoAuthError(
	context: vscode.ExtensionContext,
	resumeLastSession: boolean,
	specificSessionId?: string,
	surface: WebviewChatSurface = sidebarSurface,
	target: ChatSessionHost = sidebarHost
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

		surface.addAssistantMessage(
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
			await startCLISession(context, false, undefined, target);
		}
	} else if (action === 'Retry') {
		await startCLISession(context, resumeLastSession, specificSessionId, target);
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

		// P4 — a plan half sits next to the conversation it belongs to, and says so.
		//
		// Sorted by mtime alone, the two land wherever their timestamps put them:
		// 38% of this workspace's rows were half a conversation presented as a whole
		// one. One resolver, one directory pass, and the only place that still knows
		// what `-plan` means.
		const pairing = resolvePairings(sessionStateDir, sessions.map(session => session.id));
		const sessionList = orderSessionsByPairing(
			sessions.map((session) => ({
				id: session.id,
				mtime: session.mtime,
				label: SessionService.formatSessionLabel(session.id, path.join(sessionStateDir, session.id))
			})),
			pairing
		);

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
	// Render it now, rather than trusting whoever loaded it to init afterwards.
	//
	// Reading `events.jsonl` is async, and the webview can post `ready` the moment `attach()` sets
	// its HTML — so a restored tab could init against an empty transcript and then have the real one
	// arrive with nothing left to draw it. The `onDidBecomeReady` handler does send a second init,
	// but only *after* `ensureStarted()` resolves, so a session that fails to start leaves a blank
	// surface holding a perfectly good transcript.
	//
	// Harmless before `ready`: the webview has nothing to receive it and the ready handler sends the
	// current state again.
	target.getSurface()?.sendInit();
	const toolCount = messages.filter(m => m.kind === 'tool').length;
	logger.info(
		`Loaded ${messages.length} messages (${toolCount} tool calls) from ${sessionId} into ${target.handle}`
	);
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
	// Through the registry, which reaches *every* manager. This used to dispose one
	// module-level handle — the last-started session — so every other host's CLI
	// leaked. Already true on a session switch; one worse per tab.
	//
	// Reaches pending hosts too: a session that never started still owns
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
