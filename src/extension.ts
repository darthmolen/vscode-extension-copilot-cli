import * as vscode from 'vscode';
import { CLIProcessManager, CLIConfig } from './cliProcessManager';
import { Logger } from './logger';
import { ChatPanelProvider } from './chatViewProvider';

let cliManager: CLIProcessManager | null = null;
let logger: Logger;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
	logger = Logger.getInstance();
	logger.info('='.repeat(60));
	logger.info('Copilot CLI Extension activating...');
	logger.info(`Extension path: ${context.extensionPath}`);
	logger.info(`VS Code version: ${vscode.version}`);
	
	// Register open chat command
	const openChatCommand = vscode.commands.registerCommand('copilot-cli-extension.openChat', () => {
		logger.info('Open Chat command triggered');
		ChatPanelProvider.createOrShow(context.extensionUri);
		
		// Update sessions list when panel opens
		updateSessionsList();
		
		// Auto-start CLI session when panel opens (based on setting)
		if (!cliManager || !cliManager.isRunning()) {
			const resumeLastSession = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('resumeLastSession', true);
			logger.info(`Auto-starting CLI session (resume=${resumeLastSession})...`);
			startCLISession(context, resumeLastSession).then(() => {
				// Load history if resuming
				if (resumeLastSession && cliManager) {
					const sessionId = cliManager.getSessionId();
					if (sessionId) {
						loadSessionHistory(sessionId);
					}
				}
			});
		}
	});
	
	// Create status bar item that opens the chat
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = "$(comment-discussion) Copilot CLI";
	statusBarItem.tooltip = "Open Copilot CLI Chat";
	statusBarItem.command = 'copilot-cli-extension.openChat';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);
	
	logger.info('Status bar item created');

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
		
		// Clear messages and start fresh session
		ChatPanelProvider.clearMessages();
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
		
		// Clear messages and start session with specific ID
		ChatPanelProvider.clearMessages();
		await startCLISession(context, true, sessionId);
		loadSessionHistory(sessionId);
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

	context.subscriptions.push(openChatCommand, startChatCommand, newSessionCommand, switchSessionCommand, stopChatCommand);
	
	logger.info('✅ Copilot CLI Extension activated successfully');
	logger.info('='.repeat(60));
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
		
		cliManager = new CLIProcessManager(context, config, resumeLastSession, specificSessionId);

		// Handle user messages from webview
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

		// Listen to CLI messages
		cliManager.onMessage((message) => {
			switch (message.type) {
				case 'output':
					logger.debug(`[CLI Output] ${message.data}`);
					ChatPanelProvider.addAssistantMessage(message.data);
					ChatPanelProvider.setThinking(false);
					break;
				case 'error':
					logger.error(`[CLI Error] ${message.data}`);
					ChatPanelProvider.addAssistantMessage(`Error: ${message.data}`);
					ChatPanelProvider.setThinking(false);
					break;
				case 'status':
					logger.info(`[CLI Status] ${JSON.stringify(message.data)}`);
					if (message.data.status === 'exited') {
						statusBarItem.text = "$(comment-discussion) CLI Exited";
						statusBarItem.tooltip = "Copilot CLI ended";
						ChatPanelProvider.setSessionActive(false);
						vscode.window.showWarningMessage('Copilot CLI session ended');
					}
					break;
			}
		});

		logger.info('Starting CLI process...');
		await cliManager.start();
		
		statusBarItem.text = "$(debug-start) CLI Running";
		statusBarItem.tooltip = "Copilot CLI is active";
		ChatPanelProvider.setSessionActive(true);
		
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
	
	return {
		yolo: config.get<boolean>('yolo', false),
		allowAllTools: config.get<boolean>('allowAllTools', false),
		allowAllPaths: config.get<boolean>('allowAllPaths', false),
		allowAllUrls: config.get<boolean>('allowAllUrls', false),
		allowTools: config.get<string[]>('allowTools', []),
		denyTools: config.get<string[]>('denyTools', []),
		allowUrls: config.get<string[]>('allowUrls', []),
		denyUrls: config.get<string[]>('denyUrls', []),
		addDirs: config.get<string[]>('addDirs', []),
		agent: config.get<string>('agent', ''),
		model: config.get<string>('model', ''),
		noAskUser: config.get<boolean>('noAskUser', false)
	};
}

function updateSessionsList() {
	const fs = require('fs');
	const path = require('path');
	const os = require('os');
	
	try {
		const sessionDir = path.join(os.homedir(), '.copilot', 'session-state');
		if (!fs.existsSync(sessionDir)) {
			ChatPanelProvider.updateSessions([], null);
			return;
		}
		
		const sessions = fs.readdirSync(sessionDir)
			.filter((name: string) => {
				const fullPath = path.join(sessionDir, name);
				return fs.statSync(fullPath).isDirectory();
			})
			.map((name: string) => ({
				id: name,
				time: fs.statSync(path.join(sessionDir, name)).mtime.getTime(),
				label: formatSessionLabel(name, path.join(sessionDir, name))
			}))
			.sort((a: any, b: any) => b.time - a.time);
		
		const currentSessionId = cliManager?.getSessionId() || null;
		ChatPanelProvider.updateSessions(
			sessions.map((s: any) => ({ id: s.id, label: s.label })),
			currentSessionId
		);
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

function loadSessionHistory(sessionId: string) {
	const fs = require('fs');
	const path = require('path');
	const os = require('os');
	const readline = require('readline');
	
	try {
		const eventsPath = path.join(os.homedir(), '.copilot', 'session-state', sessionId, 'events.jsonl');
		if (!fs.existsSync(eventsPath)) {
			logger.warn(`No events.jsonl found for session ${sessionId}`);
			return;
		}
		
		logger.info(`Loading session history from ${eventsPath}`);
		const fileStream = fs.createReadStream(eventsPath);
		const rl = readline.createInterface({
			input: fileStream,
			crlfDelay: Infinity
		});
		
		const messages: Array<{role: string, content: string}> = [];
		
		rl.on('line', (line: string) => {
			try {
				const event = JSON.parse(line);
				
				if (event.type === 'user.message' && event.data?.content) {
					messages.push({
						role: 'user',
						content: event.data.content
					});
				} else if (event.type === 'assistant.message' && event.data?.content) {
					// Skip tool requests, just get the text content
					const content = event.data.content;
					if (content && typeof content === 'string') {
						messages.push({
							role: 'assistant',
							content: content
						});
					}
				}
			} catch (e) {
				// Skip malformed lines
			}
		});
		
		rl.on('close', () => {
			logger.info(`Loaded ${messages.length} messages from session history`);
			// Add messages to chat in order
			for (const msg of messages) {
				if (msg.role === 'user') {
					ChatPanelProvider.addUserMessage(msg.content);
				} else {
					ChatPanelProvider.addAssistantMessage(msg.content);
				}
			}
		});
		
	} catch (error) {
		logger.error('Failed to load session history', error instanceof Error ? error : undefined);
	}
}

export function deactivate() {
	logger.info('Deactivating Copilot CLI Extension...');
	if (cliManager) {
		logger.info('Disposing CLI manager...');
		cliManager.dispose();
	}
	logger.info('Extension deactivated');
}
