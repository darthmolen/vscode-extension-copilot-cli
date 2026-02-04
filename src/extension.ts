import * as vscode from 'vscode';
import { SDKSessionManager, CLIConfig } from './sdkSessionManager';
import { Logger } from './logger';
import { ChatPanelProvider } from './chatViewProvider';
import { getBackendState, BackendState } from './backendState';
import { getAllSessions, filterSessionsByFolder } from './sessionUtils';

let cliManager: SDKSessionManager | null = null;
let logger: Logger;
let statusBarItem: vscode.StatusBarItem;
let backendState: BackendState;
let lastKnownTextEditor: vscode.TextEditor | undefined;

export function activate(context: vscode.ExtensionContext) {
	logger = Logger.getInstance();
	backendState = getBackendState();
	
	logger.info('='.repeat(60));
	logger.info('Copilot CLI Extension activating...');
	logger.info(`Extension path: ${context.extensionPath}`);
	logger.info(`VS Code version: ${vscode.version}`);
	
	// Track active file changes
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			updateActiveFile(editor);
		})
	);
	
	// Register open chat command
	const openChatCommand = vscode.commands.registerCommand('copilot-cli-extension.openChat', async () => {
		logger.info('='.repeat(60));
		logger.info('[DIAGNOSTIC] Open Chat command triggered');
		logger.info(`[DIAGNOSTIC] CLI running: ${cliManager?.isRunning() || false}`);
		logger.info(`[DIAGNOSTIC] BackendState before createOrShow: ${backendState.getMessages().length} messages`);
		
		ChatPanelProvider.createOrShow(context.extensionUri);
		
		// Update active file when panel opens
		updateActiveFile(vscode.window.activeTextEditor);
		
		// Update sessions list when panel opens
		updateSessionsList();
		
		// Auto-start CLI session when panel opens (based on setting)
		if (!cliManager || !cliManager.isRunning()) {
			const resumeLastSession = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('resumeLastSession', true);
			logger.info(`[DIAGNOSTIC] Auto-starting CLI session (resume=${resumeLastSession})...`);
			
			// NEW: Determine session ID and load history BEFORE starting CLI
			let sessionIdToResume: string | undefined = undefined;
			if (resumeLastSession) {
				const sessionId = await determineSessionToResume(context);
				if (sessionId) {
					logger.info(`[DIAGNOSTIC] Pre-loading history for session: ${sessionId}`);
					await loadSessionHistory(sessionId);
					logger.info(`[DIAGNOSTIC] After loadSessionHistory: BackendState has ${backendState.getMessages().length} messages`);
					sessionIdToResume = sessionId; // CRITICAL: Pass this to CLI manager!
				} else {
					logger.info(`[DIAGNOSTIC] No session to resume found`);
				}
			}
			
			await startCLISession(context, resumeLastSession, sessionIdToResume);
		} else {
			logger.info(`[DIAGNOSTIC] CLI already running, NOT loading history or starting new session`);
			logger.info(`[DIAGNOSTIC] Current session: ${cliManager.getSessionId()}`);
		}
		logger.info('='.repeat(60));
	});
	
	// Create status bar item that opens the chat
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = "$(comment-discussion) Copilot CLI";
	statusBarItem.tooltip = "Open Copilot CLI Chat";
	statusBarItem.command = 'copilot-cli-extension.openChat';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);
	
	logger.info('Status bar item created');

	// Register message handler ONCE in activate, not in startCLISession
	ChatPanelProvider.onUserMessage(async (text: string) => {
		logger.info(`Sending user message to CLI: ${text}`);
		ChatPanelProvider.addUserMessage(text);
		ChatPanelProvider.setThinking(true);
		
		if (cliManager && cliManager.isRunning()) {
			cliManager.sendMessage(text);
		} else {
			logger.error('Cannot send message: CLI not running');
			ChatPanelProvider.addAssistantMessage('Error: CLI session not active. Please start a session first.');
			ChatPanelProvider.setThinking(false);
		}
	});

	// Register abort handler ONCE in activate
	ChatPanelProvider.onAbort(async () => {
		logger.info('Abort requested by user');
		
		if (cliManager && cliManager.isRunning()) {
			try {
				await cliManager.abortMessage();
				logger.info('Message aborted successfully');
			} catch (error) {
				logger.error(`Failed to abort: ${error instanceof Error ? error.message : String(error)}`);
				vscode.window.showErrorMessage('Failed to abort message');
			}
		} else {
			logger.warn('Cannot abort: CLI not running');
		}
	});

	// Register view plan handler ONCE in activate
	ChatPanelProvider.onViewPlan(() => {
		// Always use work session workspace path, even when in plan mode
		const workspacePath = cliManager?.getWorkSessionWorkspacePath();
		if (workspacePath) {
			const planPath = vscode.Uri.file(`${workspacePath}/plan.md`);
			vscode.workspace.openTextDocument(planPath).then(doc => {
				vscode.window.showTextDocument(doc, { preview: false });
			}, error => {
				logger.error(`Failed to open plan.md: ${error.message}`);
				vscode.window.showErrorMessage(`Could not open plan.md: ${error.message}`);
			});
		} else {
			vscode.window.showWarningMessage('No plan.md available for this session');
		}
	});

	logger.info('Message and view plan handlers registered');

	// Register start chat command (for command palette)
	const startChatCommand = vscode.commands.registerCommand('copilot-cli-extension.startChat', async () => {
		logger.info('Start Chat command triggered');
		
		// Open the panel first
		ChatPanelProvider.createOrShow(context.extensionUri);
		
		if (cliManager && cliManager.isRunning()) {
			vscode.window.showInformationMessage('Copilot CLI session is already running');
			return;
		}

		await startCLISession(context, true); // Resume last session
		vscode.window.showInformationMessage('Copilot CLI session started!');
	});

	// Register new session command
	const newSessionCommand = vscode.commands.registerCommand('copilot-cli-extension.newSession', async () => {
		logger.info('New Session command triggered');
		
		// Stop existing session if any
		if (cliManager && cliManager.isRunning()) {
			logger.info('Stopping existing session before starting new one...');
			await cliManager.stop();
			cliManager = null;
		}
		
		// Open the panel
		ChatPanelProvider.createOrShow(context.extensionUri);
		
		// Clear messages and reset plan mode state
		ChatPanelProvider.clearMessages();
		ChatPanelProvider.resetPlanMode();
		await startCLISession(context, false); // false = new session
		updateSessionsList();
		vscode.window.showInformationMessage('New Copilot CLI session started!');
	});

	// Register switch session command
	const switchSessionCommand = vscode.commands.registerCommand('copilot-cli-extension.switchSession', async (sessionId: string) => {
		logger.info(`Switch Session command triggered: ${sessionId}`);
		
		// Stop existing session if any
		if (cliManager && cliManager.isRunning()) {
			logger.info('Stopping existing session before switching...');
			await cliManager.stop();
			cliManager = null;
		}
		
		// Clear messages and reset plan mode state
		ChatPanelProvider.resetPlanMode();
		await startCLISession(context, true, sessionId);
		await loadSessionHistory(sessionId);
		
		// Send init message with full state
		const fullState = backendState.getFullState();
		ChatPanelProvider.postMessage({
			type: 'init',
			sessionId: fullState.sessionId,
			sessionActive: fullState.sessionActive,
			messages: fullState.messages,
			planModeStatus: fullState.planModeStatus,
			workspacePath: fullState.workspacePath,
			activeFilePath: fullState.activeFilePath
		});
		
		updateSessionsList();
	});

	// Register stop chat command
	const stopChatCommand = vscode.commands.registerCommand('copilot-cli-extension.stopChat', async () => {
		logger.info('Stop Chat command triggered');
		
		if (!cliManager || !cliManager.isRunning()) {
			logger.warn('No active CLI session to stop');
			vscode.window.showInformationMessage('No active Copilot CLI session');
			return;
		}

		try {
			logger.info('Stopping CLI process...');
			await cliManager.stop();
			cliManager = null;
			
			statusBarItem.text = "$(comment-discussion) Copilot CLI";
			statusBarItem.tooltip = "Open Copilot CLI Chat";
			ChatPanelProvider.setSessionActive(false);
			ChatPanelProvider.addAssistantMessage('Session ended.');
			
			logger.info('✅ CLI process stopped successfully');
			vscode.window.showInformationMessage('Copilot CLI session stopped');
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`❌ Failed to stop CLI: ${errorMessage}`, error instanceof Error ? error : undefined);
			vscode.window.showErrorMessage(`Failed to stop Copilot CLI: ${errorMessage}`);
		}
	});

	const refreshPanelCommand = vscode.commands.registerCommand('copilot-cli-extension.refreshPanel', () => {
		logger.info('Refresh Panel command triggered - forcing recreation');
		ChatPanelProvider.forceRecreate(context.extensionUri);
		vscode.window.showInformationMessage('Chat panel refreshed');
	});
	
	const viewDiffCommand = vscode.commands.registerCommand('copilot-cli-extension.viewDiff', async (message: any) => {
		logger.info(`View diff command triggered: ${JSON.stringify(message)}`);
		
		try {
			// Extract the actual diff data from the message wrapper
			const diffData = message.value || message;
			const beforeUri = vscode.Uri.file(diffData.beforeUri);
			const afterUri = vscode.Uri.file(diffData.afterUri);
			const title = diffData.title || 'File Diff';
			
			logger.info(`Opening diff: ${beforeUri.fsPath} vs ${afterUri.fsPath}`);
			
			// Check if files exist
			const fs = require('fs');
			if (!fs.existsSync(beforeUri.fsPath)) {
				logger.error(`Before file does not exist: ${beforeUri.fsPath}`);
				vscode.window.showErrorMessage(`Cannot open diff: Before file not found`);
				return;
			}
			if (!fs.existsSync(afterUri.fsPath)) {
				logger.error(`After file does not exist: ${afterUri.fsPath}`);
				vscode.window.showErrorMessage(`Cannot open diff: After file not found at ${afterUri.fsPath}`);
				return;
			}
			
			logger.info(`Both files exist, executing vscode.diff command`);
			await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, title);
			logger.info(`Diff command executed successfully`);
			
			// Note: We don't cleanup the snapshot immediately because VS Code's diff viewer
			// loads files asynchronously. If we delete too soon, the diff will show as empty.
			// Snapshots are cleaned up when the session ends.
		} catch (error) {
			logger.error(`Failed to open diff: ${error instanceof Error ? error.message : String(error)}`);
			vscode.window.showErrorMessage(`Failed to open diff: ${error instanceof Error ? error.message : String(error)}`);
		}
	});
	
	const togglePlanModeCommand = vscode.commands.registerCommand('copilot-cli-extension.togglePlanMode', async (enabled: boolean) => {
		logger.info(`Toggle Plan Mode command triggered: ${enabled}`);
		
		if (!cliManager || !cliManager.isRunning()) {
			vscode.window.showWarningMessage('No active Copilot CLI session');
			return;
		}
		
		try {
			if (enabled) {
				await cliManager.enablePlanMode();
				vscode.window.showInformationMessage('🎯 Plan Mode enabled! You can now analyze and design without modifying files.');
			} else {
				await cliManager.disablePlanMode();
				vscode.window.showInformationMessage('✅ Plan Mode disabled! Back to work mode - you can now implement the plan.');
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error(`Failed to toggle plan mode: ${errorMessage}`, error instanceof Error ? error : undefined);
			vscode.window.showErrorMessage(`Failed to toggle plan mode: ${errorMessage}`);
		}
	});
	
	const acceptPlanCommand = vscode.commands.registerCommand('copilot-cli-extension.acceptPlan', async () => {
		logger.info('Accept Plan command triggered');
		
		if (!cliManager || !cliManager.isRunning()) {
			vscode.window.showWarningMessage('No active Copilot CLI session');
			return;
		}
		
		try {
			await cliManager.acceptPlan();
			vscode.window.showInformationMessage('✅ Plan accepted! Ready to implement.');
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error(`Failed to accept plan: ${errorMsg}`);
			vscode.window.showErrorMessage(`Failed to accept plan: ${errorMsg}`);
		}
	});
	
	const rejectPlanCommand = vscode.commands.registerCommand('copilot-cli-extension.rejectPlan', async () => {
		logger.info('Reject Plan command triggered');
		
		if (!cliManager || !cliManager.isRunning()) {
			vscode.window.showWarningMessage('No active Copilot CLI session');
			return;
		}
		
		try {
			await cliManager.rejectPlan();
			vscode.window.showInformationMessage('❌ Plan rejected. Changes discarded.');
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error(`Failed to reject plan: ${errorMsg}`);
			vscode.window.showErrorMessage(`Failed to reject plan: ${errorMsg}`);
		}
	});

	context.subscriptions.push(openChatCommand, startChatCommand, newSessionCommand, switchSessionCommand, stopChatCommand, refreshPanelCommand, viewDiffCommand, togglePlanModeCommand, acceptPlanCommand, rejectPlanCommand);
	
	logger.info('✅ Copilot CLI Extension activated successfully');
	logger.info('='.repeat(60));
}

async function determineSessionToResume(context: vscode.ExtensionContext): Promise<string | null> {
	const { getMostRecentSession } = require('./sessionUtils');
	
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		logger.info('No workspace folder, cannot determine session');
		return null;
	}
	
	const workspaceFolder = workspaceFolders[0].uri.fsPath;
	const filterByFolder = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('filterSessionsByFolder', true);
	
	const sessionId = getMostRecentSession(workspaceFolder, filterByFolder);
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

		// Listen to CLI messages
		cliManager.onMessage((message) => {
			switch (message.type) {
				case 'output':
					logger.debug(`[CLI Output] ${message.data}`);
					ChatPanelProvider.addAssistantMessage(message.data);
					ChatPanelProvider.setThinking(false);
					break;
				case 'reasoning':
					logger.debug(`[Assistant Reasoning] ${message.data.substring(0, 100)}...`);
					ChatPanelProvider.addReasoningMessage(message.data);
					break;
				case 'error':
					logger.error(`[CLI Error] ${message.data}`);
					ChatPanelProvider.addAssistantMessage(`Error: ${message.data}`);
					ChatPanelProvider.setThinking(false);
					break;
				case 'status':
					logger.info(`[CLI Status] ${JSON.stringify(message.data)}`);
					if (message.data.status === 'exited' || message.data.status === 'stopped') {
						backendState.setSessionActive(false);
						statusBarItem.text = "$(comment-discussion) CLI Exited";
						statusBarItem.tooltip = "Copilot CLI ended";
						ChatPanelProvider.setSessionActive(false);
						vscode.window.showWarningMessage('Copilot CLI session ended');
					} else if (message.data.status === 'aborted') {
						// Message was aborted by user
						ChatPanelProvider.addAssistantMessage('_Generation stopped by user._');
						ChatPanelProvider.setThinking(false);
					} else if (message.data.status === 'session_expired') {
						// Old session expired, new one created
						logger.info(`Session expired, new session created: ${message.data.newSessionId}`);
						
						// Update backend state with new session
						backendState.setSessionId(message.data.newSessionId);
						backendState.setSessionActive(true);
						
						// Set session active to turn indicator green
						ChatPanelProvider.setSessionActive(true);
						
						// Add a clear visual separator showing the session boundary
						ChatPanelProvider.addAssistantMessage('---\n\n⚠️ **Previous session expired after inactivity**\n\nThe conversation above is from an expired session and cannot be continued. A new session has been started below.\n\n---');
						ChatPanelProvider.addAssistantMessage('New session started! How can I help you?');
						updateSessionsList();
					} else if (message.data.status === 'thinking') {
						// Assistant is thinking/generating response
						ChatPanelProvider.setThinking(true);
					} else if (message.data.status === 'ready') {
						// Assistant finished turn (might have more coming though)
						// Don't turn off thinking here - wait for actual message
					} else if (
						message.data.status === 'plan_mode_enabled' ||
						message.data.status === 'plan_mode_disabled' ||
						message.data.status === 'plan_accepted' ||
						message.data.status === 'plan_rejected'
					) {
						// Forward plan mode status to webview for button updates
						ChatPanelProvider.postMessage({ type: 'status', data: message.data });
					}
					break;
				case 'tool_start':
					logger.info(`[Tool Start] ${message.data.toolName}`);
					ChatPanelProvider.addToolExecution(message.data);
					break;
				case 'tool_progress':
					logger.debug(`[Tool Progress] ${message.data.toolName}: ${message.data.progress}`);
					ChatPanelProvider.updateToolExecution(message.data);
					break;
				case 'tool_complete':
					logger.info(`[Tool Complete] ${message.data.toolName} - ${message.data.status}`);
					ChatPanelProvider.updateToolExecution(message.data);
					break;
				case 'file_change':
					logger.info(`[File Change] ${JSON.stringify(message.data)}`);
					break;
				case 'diff_available':
					logger.info(`[Diff Available] ${JSON.stringify(message.data)}`);
					ChatPanelProvider.notifyDiffAvailable(message.data);
					break;
				case 'usage_info':
					logger.debug(`[Usage Info] ${message.data.currentTokens}/${message.data.tokenLimit}`);
					ChatPanelProvider.postMessage({ type: 'usage_info', data: message.data });
					break;
			}
		});

		logger.info('Starting CLI process...');
		await cliManager.start();
		
		// Update backend state
		const sessionId = cliManager.getSessionId();
		backendState.setSessionId(sessionId);
		backendState.setSessionActive(true);
		
		statusBarItem.text = "$(debug-start) CLI Running";
		statusBarItem.tooltip = "Copilot CLI is active";
		ChatPanelProvider.setSessionActive(true);
		
		// Send workspace path to UI
		const workspacePath = cliManager.getWorkspacePath();
		backendState.setWorkspacePath(workspacePath || null);
		ChatPanelProvider.setWorkspacePath(workspacePath);
		
		logger.info('✅ CLI process started successfully');
		ChatPanelProvider.addAssistantMessage('Copilot CLI session started! How can I help you?');
		
		// Show the output channel so user can see logs
		logger.show();
		
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error(`❌ Failed to start CLI: ${errorMessage}`, error instanceof Error ? error : undefined);
		statusBarItem.text = "$(error) CLI Failed";
		statusBarItem.tooltip = `Failed: ${errorMessage}`;
		vscode.window.showErrorMessage(`Failed to start Copilot CLI: ${errorMessage}`);
		throw error;
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
	const fs = require('fs');
	const path = require('path');
	const os = require('os');
	
	try {
		// Get configuration
		const config = vscode.workspace.getConfiguration('copilotCLI');
		const filterByFolder = config.get<boolean>('filterSessionsByFolder', false);
		const workspaceFolders = vscode.workspace.workspaceFolders;
		const workspaceFolder = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : null;
		
		// Use sessionUtils to get all sessions with metadata
		let sessions = getAllSessions();
		
		logger.debug(`Found ${sessions.length} total sessions`);
		
		// Apply workspace filtering if enabled and workspace is open
		if (filterByFolder && workspaceFolder) {
			const beforeCount = sessions.length;
			sessions = filterSessionsByFolder(sessions, workspaceFolder);
			logger.debug(`Filtered ${beforeCount} sessions to ${sessions.length} for workspace: ${workspaceFolder}`);
		} else {
			logger.debug(`Session filtering disabled or no workspace open (filterByFolder: ${filterByFolder}, workspace: ${workspaceFolder})`);
		}
		
		// Get current session ID
		const currentSessionId = cliManager?.getSessionId() || null;
		
		// If current session exists but isn't in the list yet (new session without events.jsonl),
		// add it to the front of the list
		if (currentSessionId && !sessions.find(s => s.id === currentSessionId)) {
			logger.info(`Current session ${currentSessionId} not in list yet, adding it`);
			sessions.unshift({
				id: currentSessionId,
				mtime: Date.now() // Most recent
			});
		}
		
		// If no sessions found, send empty list
		if (sessions.length === 0) {
			ChatPanelProvider.updateSessions([], null);
			return;
		}
		
		// Sort by modification time (most recent first)
		const sortedSessions = sessions.sort((a, b) => b.mtime - a.mtime);
		
		// Format labels and prepare for UI
		const sessionList = sortedSessions.map((session) => ({
			id: session.id,
			label: formatSessionLabel(session.id, path.join(os.homedir(), '.copilot', 'session-state', session.id))
		}));
		
		ChatPanelProvider.updateSessions(sessionList, currentSessionId);
	} catch (error) {
		logger.error('Failed to update sessions list', error instanceof Error ? error : undefined);
	}
}

function formatSessionLabel(sessionId: string, sessionPath: string): string {
	const fs = require('fs');
	const path = require('path');
	
	// Try to read plan.md to get a better label
	try {
		const planPath = path.join(sessionPath, 'plan.md');
		if (fs.existsSync(planPath)) {
			const planContent = fs.readFileSync(planPath, 'utf-8');
			const lines = planContent.split('\n');
			// Look for first heading
			for (const line of lines) {
				if (line.startsWith('# ')) {
					return line.substring(2).trim().substring(0, 40);
				}
			}
		}
	} catch (error) {
		// Ignore errors reading plan
	}
	
	// Fallback to short session ID
	return sessionId.substring(0, 8);
}

function loadSessionHistory(sessionId: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const fs = require('fs');
		const path = require('path');
		const os = require('os');
		const readline = require('readline');
		
		try {
			const eventsPath = path.join(os.homedir(), '.copilot', 'session-state', sessionId, 'events.jsonl');
			if (!fs.existsSync(eventsPath)) {
				logger.warn(`No events.jsonl found for session ${sessionId}`);
				resolve();
				return;
			}
			
			logger.info(`Loading session history from ${eventsPath}`);
			const fileStream = fs.createReadStream(eventsPath);
			const rl = readline.createInterface({
				input: fileStream,
				crlfDelay: Infinity
			});
			
			const messages: Array<{role: 'user' | 'assistant', content: string, timestamp?: number}> = [];
			
			rl.on('line', (line: string) => {
				try {
					const event = JSON.parse(line);
					
					if (event.type === 'user.message' && event.data?.content) {
						messages.push({
							role: 'user',
							content: event.data.content,
							timestamp: event.timestamp
						});
					} else if (event.type === 'assistant.message' && event.data?.content) {
						// Skip tool requests, just get the text content
						const content = event.data.content;
						if (content && typeof content === 'string') {
							messages.push({
								role: 'assistant',
								content: content,
								timestamp: event.timestamp
							});
						}
					}
				} catch (e) {
					// Skip malformed lines
				}
			});
			
			rl.on('close', () => {
				logger.info(`[DIAGNOSTIC] Loaded ${messages.length} messages from session history file`);
				
				// Load messages into BackendState only - webview will get them via init message
				logger.info(`[DIAGNOSTIC] Clearing BackendState before loading history...`);
				backendState.clearMessages(); // Clear any existing messages
				logger.info(`[DIAGNOSTIC] Adding ${messages.length} messages to BackendState...`);
				for (const msg of messages) {
					backendState.addMessage({
						role: msg.role,
						type: msg.role === 'user' ? 'user' : 'assistant',
						content: msg.content,
						timestamp: msg.timestamp
					});
				}
				logger.info(`[DIAGNOSTIC] BackendState now has ${backendState.getMessages().length} messages`);
				logger.info(`[DIAGNOSTIC] ✅ History loaded into BackendState (will be sent to webview via init)`);
				resolve();
			});
			
			rl.on('error', (error: Error) => {
				logger.error('Failed to load session history', error);
				reject(error);
			});
			
		} catch (error) {
			logger.error('Failed to load session history', error instanceof Error ? error : undefined);
			reject(error);
		}
	});
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
			ChatPanelProvider.updateActiveFile(null);
			lastKnownTextEditor = undefined;
		}
		// Otherwise, keep the last known active file (focus moved to webview)
		return;
	}
	
	const includeActiveFile = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('includeActiveFile', true);
	if (!includeActiveFile) {
		backendState.setActiveFilePath(null);
		ChatPanelProvider.updateActiveFile(null);
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
	ChatPanelProvider.updateActiveFile(relativePath);
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
