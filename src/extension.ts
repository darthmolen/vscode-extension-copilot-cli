import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { SDKSessionManager, CLIConfig } from './sdkSessionManager';
import { Logger } from './logger';
import { ChatViewProvider } from './chatViewProvider';
import { getBackendState, BackendState } from './backendState';
import { SessionService } from './extension/services/SessionService';

let cliManager: SDKSessionManager | null = null;
let logger: Logger;
let statusBarItem: vscode.StatusBarItem;
let backendState: BackendState;
let lastKnownTextEditor: vscode.TextEditor | undefined;
let chatProvider: ChatViewProvider;

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

export function activate(context: vscode.ExtensionContext) {
	logger = Logger.getInstance();
	backendState = getBackendState();

	// Create chat provider and register as sidebar webview
	chatProvider = new ChatViewProvider(context.extensionUri);
	context.subscriptions.push(chatProvider);
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
	registerChatProviderHandlers(context);

	// Register all VS Code commands
	registerCommands(context);

	logger.info('Copilot CLI Extension activated successfully');
}

/** Register chatProvider event handlers (message, abort, view plan, ready). */
function registerChatProviderHandlers(context: vscode.ExtensionContext): void {
	context.subscriptions.push(chatProvider.onDidReceiveUserMessage(async (data: {text: string; attachments?: Array<{type: 'file'; path: string; displayName?: string}>}) => {
		logger.info(`Sending user message to CLI: ${data.text.substring(0, 100)}...`);

		const displayAttachments = data.attachments?.map(att => ({
			displayName: att.displayName || att.path.split(/[/\\]/).pop() || 'unknown',
			webviewUri: undefined
		}));

		chatProvider.addUserMessage(data.text, displayAttachments);
		chatProvider.setThinking(true);

		if (cliManager && cliManager.isRunning()) {
			cliManager.sendMessage(data.text, data.attachments);
		} else {
			chatProvider.addAssistantMessage('Error: CLI session not active. Please start a session first.');
			chatProvider.setThinking(false);
		}
	}));

	context.subscriptions.push(chatProvider.onDidRequestAbort(async () => {
		logger.info('Abort requested by user');
		if (cliManager && cliManager.isRunning()) {
			try {
				await cliManager.abortMessage();
			} catch (error) {
				logger.error(`Failed to abort: ${error instanceof Error ? error.message : String(error)}`);
				vscode.window.showErrorMessage('Failed to abort message');
			}
		}
	}));

	context.subscriptions.push(chatProvider.onDidRequestViewPlan(async () => {
		const planPath = cliManager?.getPlanFilePath();
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
	}));

	context.subscriptions.push(chatProvider.onDidBecomeReady(async () => {
		// Auto-resume CLI session when webview becomes ready (e.g., after Developer Reload)
		await resumeAndStartSession(context);

		// Re-send init — the first send (from onReady) was empty because backendState wasn't populated yet
		const fullState = backendState.getFullState();
		chatProvider.postMessage({
			type: 'init',
			sessionId: fullState.sessionId,
			sessionActive: fullState.sessionActive,
			messages: fullState.messages,
			planModeStatus: fullState.planModeStatus,
			workspacePath: fullState.workspacePath,
			activeFilePath: fullState.activeFilePath
		});
	}));
}

/** Register all VS Code commands. */
function registerCommands(context: vscode.ExtensionContext): void {
	const commands = [
		vscode.commands.registerCommand('copilot-cli-extension.openChat', () => handleOpenChat(context)),
		vscode.commands.registerCommand('copilot-cli-extension.startChat', () => handleStartChat(context)),
		vscode.commands.registerCommand('copilot-cli-extension.newSession', () => handleNewSession(context)),
		vscode.commands.registerCommand('copilot-cli-extension.switchSession', (sessionId: string) => handleSwitchSession(context, sessionId)),
		vscode.commands.registerCommand('copilot-cli-extension.stopChat', () => handleStopChat()),
		vscode.commands.registerCommand('copilot-cli-extension.refreshPanel', () => {
			chatProvider.forceRecreate();
			vscode.window.showInformationMessage('Chat panel refreshed');
		}),
		vscode.commands.registerCommand('copilot-cli-extension.viewDiff', (message: any) => handleViewDiff(message)),
		vscode.commands.registerCommand('copilot-cli-extension.togglePlanMode', (enabled: boolean) => handleTogglePlanMode(enabled)),
		vscode.commands.registerCommand('copilot-cli-extension.acceptPlan', () => handleAcceptPlan()),
		vscode.commands.registerCommand('copilot-cli-extension.rejectPlan', () => handleRejectPlan()),
	];
	context.subscriptions.push(...commands);
}

// ── Session Resume ───────────────────────────────────────────────────────────

/** Shared logic: determine session to resume, load history, start CLI. */
async function resumeAndStartSession(context: vscode.ExtensionContext): Promise<void> {
	if (cliManager && cliManager.isRunning()) {
		return;
	}

	const resumeLastSession = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('resumeLastSession', true);
	let sessionIdToResume: string | undefined;

	if (resumeLastSession) {
		const sessionId = await determineSessionToResume(context);
		if (sessionId) {
			await loadSessionHistory(sessionId);
			sessionIdToResume = sessionId;
		}
	}

	updateActiveFile(vscode.window.activeTextEditor);
	updateSessionsList();

	await startCLISession(context, resumeLastSession, sessionIdToResume);
}

// ── Command Handlers ──────────────────────────────────────────────────────────

async function handleOpenChat(context: vscode.ExtensionContext): Promise<void> {
	chatProvider.show();
	await resumeAndStartSession(context);
}

async function handleStartChat(context: vscode.ExtensionContext): Promise<void> {
	chatProvider.show();
	if (cliManager && cliManager.isRunning()) {
		vscode.window.showInformationMessage('Copilot CLI session is already running');
		return;
	}
	await startCLISession(context, true);
	vscode.window.showInformationMessage('Copilot CLI session started!');
}

async function handleNewSession(context: vscode.ExtensionContext): Promise<void> {
	if (cliManager && cliManager.isRunning()) {
		await cliManager.stop();
		cliManager = null;
	}
	chatProvider.show();
	chatProvider.clearMessages();
	chatProvider.resetPlanMode();
	await startCLISession(context, false);
	updateSessionsList();
	vscode.window.showInformationMessage('New Copilot CLI session started!');
}

async function handleSwitchSession(context: vscode.ExtensionContext, sessionId: string): Promise<void> {
	logger.info(`Switch Session: ${sessionId}`);
	if (cliManager && cliManager.isRunning()) {
		await cliManager.stop();
		cliManager = null;
	}
	chatProvider.resetPlanMode();
	await startCLISession(context, true, sessionId);
	await loadSessionHistory(sessionId);

	const fullState = backendState.getFullState();
	chatProvider.postMessage({
		type: 'init',
		sessionId: fullState.sessionId,
		sessionActive: fullState.sessionActive,
		messages: fullState.messages,
		planModeStatus: fullState.planModeStatus,
		workspacePath: fullState.workspacePath,
		activeFilePath: fullState.activeFilePath
	});
	updateSessionsList();
}

async function handleStopChat(): Promise<void> {
	if (!cliManager || !cliManager.isRunning()) {
		vscode.window.showInformationMessage('No active Copilot CLI session');
		return;
	}
	try {
		await cliManager.stop();
		cliManager = null;
		statusBarItem.text = "$(comment-discussion) Copilot CLI";
		statusBarItem.tooltip = "Open Copilot CLI Chat";
		chatProvider.setSessionActive(false);
		chatProvider.addAssistantMessage('Session ended.');
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
	if (!cliManager || !cliManager.isRunning()) {
		vscode.window.showWarningMessage('No active Copilot CLI session');
		return;
	}
	try {
		if (enabled) {
			await cliManager.enablePlanMode();
		} else {
			await cliManager.disablePlanMode();
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error(`Failed to toggle plan mode: ${errorMessage}`);
		vscode.window.showErrorMessage(`Failed to toggle plan mode: ${errorMessage}`);
	}
}

async function handleAcceptPlan(): Promise<void> {
	if (!cliManager || !cliManager.isRunning()) {
		vscode.window.showWarningMessage('No active Copilot CLI session');
		return;
	}
	try {
		await cliManager.acceptPlan();
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		logger.error(`Failed to accept plan: ${errorMsg}`);
		vscode.window.showErrorMessage(`Failed to accept plan: ${errorMsg}`);
	}
}

async function handleRejectPlan(): Promise<void> {
	if (!cliManager || !cliManager.isRunning()) {
		vscode.window.showWarningMessage('No active Copilot CLI session');
		return;
	}
	try {
		await cliManager.rejectPlan();
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

	const sessionId = SessionService.getMostRecentSession(sessionStateDir, workspaceFolder, filterByFolder);
	if (sessionId) {
		logger.info(`Determined session to resume: ${sessionId}`);
	} else {
		logger.info('No session to resume');
	}

	return sessionId;
}

async function startCLISession(context: vscode.ExtensionContext, resumeLastSession: boolean = true, specificSessionId?: string): Promise<void> {
	if (cliManager && cliManager.isRunning()) {
		logger.warn('CLI session already running');
		return;
	}

	try {
		const config = getCLIConfig();
		logger.info('Creating CLI Process Manager with config:');
		logger.debug(JSON.stringify(config, null, 2));

		cliManager = new SDKSessionManager(context, config, resumeLastSession, specificSessionId);
		wireManagerEvents(context, cliManager);

		logger.info('Starting CLI process...');
		await cliManager.start();

		onSessionStarted(cliManager);
	} catch (error) {
		await handleStartupError(error, context, resumeLastSession, specificSessionId);
		throw error;
	}
}

/** Wire all 10 granular event subscriptions from the SDK manager to the UI. */
function wireManagerEvents(context: vscode.ExtensionContext, manager: SDKSessionManager): void {
	context.subscriptions.push(manager.onDidReceiveOutput(safeHandler('onDidReceiveOutput', (content) => {
		logger.debug(`[CLI Output] ${content}`);
		chatProvider.addAssistantMessage(content);
		chatProvider.setThinking(false);
	})));

	context.subscriptions.push(manager.onDidReceiveReasoning(safeHandler('onDidReceiveReasoning', (content) => {
		logger.debug(`[Assistant Reasoning] ${content.substring(0, 100)}...`);
		chatProvider.addReasoningMessage(content);
	})));

	context.subscriptions.push(manager.onDidReceiveError(safeHandler('onDidReceiveError', (errorMsg) => {
		logger.error(`[CLI Error] ${errorMsg}`);
		chatProvider.addAssistantMessage(`Error: ${errorMsg}`);
		chatProvider.setThinking(false);
	})));

	context.subscriptions.push(manager.onDidChangeStatus(safeHandler('onDidChangeStatus', (statusData) => {
		logger.info(`[CLI Status] ${JSON.stringify(statusData)}`);
		switch (statusData.status) {
			case 'thinking':
				chatProvider.setThinking(true);
				break;
			case 'ready':
				break;
			case 'exited':
			case 'stopped':
				backendState.setSessionActive(false);
				statusBarItem.text = "$(comment-discussion) CLI Exited";
				statusBarItem.tooltip = "Copilot CLI ended";
				chatProvider.setSessionActive(false);
				vscode.window.showWarningMessage('Copilot CLI session ended');
				break;
			case 'aborted':
				chatProvider.addAssistantMessage('_Generation stopped by user._');
				chatProvider.setThinking(false);
				break;
			case 'session_expired':
				logger.info(`Session expired, new session created: ${statusData.newSessionId}`);
				backendState.setSessionId(statusData.newSessionId || '');
				vscode.window.showInformationMessage(`Session expired. New session started: ${statusData.newSessionId}`);
				break;
			case 'plan_mode_enabled':
			case 'plan_mode_disabled':
			case 'plan_accepted':
			case 'plan_rejected':
			case 'plan_ready':
			case 'reset_metrics':
				chatProvider.postMessage({ type: 'status', data: statusData });
				break;
		}
	})));

	context.subscriptions.push(manager.onDidStartTool(safeHandler('onDidStartTool', (toolState) => {
		logger.info(`[Tool Start] ${toolState.toolName}`);
		chatProvider.addToolExecution(toolState);
	})));

	context.subscriptions.push(manager.onDidUpdateTool(safeHandler('onDidUpdateTool', (toolState) => {
		logger.debug(`[Tool Progress] ${toolState.toolName}: ${toolState.progress}`);
		chatProvider.updateToolExecution(toolState);
	})));

	context.subscriptions.push(manager.onDidCompleteTool(safeHandler('onDidCompleteTool', (toolState) => {
		logger.info(`[Tool Complete] ${toolState.toolName} - ${toolState.status}`);
		chatProvider.updateToolExecution(toolState);
	})));

	context.subscriptions.push(manager.onDidChangeFile(safeHandler('onDidChangeFile', (fileChange) => {
		logger.info(`[File Change] ${fileChange.path} (${fileChange.type})`);
	})));

	context.subscriptions.push(manager.onDidProduceDiff(safeHandler('onDidProduceDiff', (diffData) => {
		logger.info(`[Diff Available] ${JSON.stringify(diffData)}`);
		chatProvider.notifyDiffAvailable(diffData);
	})));

	context.subscriptions.push(manager.onDidUpdateUsage(safeHandler('onDidUpdateUsage', (usageData) => {
		logger.debug(`[Usage Info] ${usageData.currentTokens}/${usageData.tokenLimit}`);
		chatProvider.postMessage({ type: 'usage_info', data: usageData });
	})));
}

/** Post-start setup: update state, UI, and session dropdown. */
function onSessionStarted(manager: SDKSessionManager): void {
	const sessionId = manager.getSessionId();
	backendState.setSessionId(sessionId);
	backendState.setSessionActive(true);

	statusBarItem.text = "$(debug-start) CLI Running";
	statusBarItem.tooltip = "Copilot CLI is active";
	chatProvider.setSessionActive(true);

	const workspacePath = manager.getWorkspacePath();
	backendState.setWorkspacePath(workspacePath || null);
	chatProvider.setWorkspacePath(workspacePath);

	chatProvider.setValidateAttachmentsCallback(async (filePaths: string[]) => {
		if (!cliManager) {
			return { valid: false, error: 'Session not active' };
		}
		return await cliManager.validateAttachments(filePaths);
	});

	logger.info('CLI process started successfully');
	chatProvider.addAssistantMessage('Copilot CLI session started! How can I help you?');
	updateSessionsList();
	logger.show();
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
	chatProvider.addAssistantMessage(
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
		chatProvider.addAssistantMessage(`Terminal opened. Update your \`${envVarSource}\` or unset it, then restart VS Code.`);
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

		chatProvider.addAssistantMessage(
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
		model: config.get<string>('model', ''),
		planModel: config.get<string>('planModel', ''),
		noAskUser: config.get<boolean>('noAskUser', false)
	};
}

function updateSessionsList() {
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

		// Add current session if not yet in list (new session without events.jsonl)
		const currentSessionId = cliManager?.getSessionId() || null;
		if (currentSessionId && !sessions.find(s => s.id === currentSessionId)) {
			sessions.unshift({ id: currentSessionId, mtime: Date.now() });
		}

		if (sessions.length === 0) {
			chatProvider.updateSessions([], null);
			return;
		}

		const sortedSessions = sessions.sort((a, b) => b.mtime - a.mtime);
		const sessionList = sortedSessions.map((session) => ({
			id: session.id,
			label: SessionService.formatSessionLabel(session.id, path.join(sessionStateDir, session.id))
		}));

		chatProvider.updateSessions(sessionList, currentSessionId);
	} catch (error) {
		logger.error('Failed to update sessions list', error instanceof Error ? error : undefined);
	}
}

async function loadSessionHistory(sessionId: string): Promise<void> {
	const eventsPath = path.join(os.homedir(), '.copilot', 'session-state', sessionId, 'events.jsonl');
	const messages = await SessionService.loadSessionHistory(eventsPath);

	backendState.clearMessages();
	for (const msg of messages) {
		backendState.addMessage({
			role: msg.role,
			type: msg.role === 'user' ? 'user' : 'assistant',
			content: msg.content,
			timestamp: msg.timestamp
		});
	}
	logger.info(`Loaded ${messages.length} messages from session history`);
}

function updateActiveFile(editor: vscode.TextEditor | undefined) {
	// If editor is defined, update last known editor
	if (editor) {
		lastKnownTextEditor = editor;
	}
	
	// If editor is undefined, only clear if there are no visible text editors
	if (!editor) {
		if (vscode.window.visibleTextEditors.length === 0) {
			// All files are closed, clear active file
			backendState.setActiveFilePath(null);
			chatProvider.updateActiveFile(null);
			lastKnownTextEditor = undefined;
		}
		// Otherwise, keep the last known active file (focus moved to webview)
		return;
	}
	
	const includeActiveFile = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('includeActiveFile', true);
	if (!includeActiveFile) {
		backendState.setActiveFilePath(null);
		chatProvider.updateActiveFile(null);
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
	
	backendState.setActiveFilePath(relativePath);
	chatProvider.updateActiveFile(relativePath);
}

export function deactivate() {
	logger.info('Deactivating Copilot CLI Extension...');
	if (cliManager) {
		logger.info('Disposing CLI manager...');
		cliManager.dispose();
	}
	logger.info('Extension deactivated');
}

// Export for testing
export { SDKSessionManager } from './sdkSessionManager';
export { BackendState, getBackendState } from './backendState';
export { updateSessionsList }; // Exported for testing
export { ExtensionRpcRouter } from './extension/rpc';
export { Logger } from './logger';
