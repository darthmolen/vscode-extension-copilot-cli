import * as vscode from 'vscode';
import { CLIProcessManager, CLIConfig } from './cliProcessManager';

let cliManager: CLIProcessManager | null = null;

export function activate(context: vscode.ExtensionContext) {
	console.log('Copilot CLI Extension is now active!');

	// Register start chat command
	const startChatCommand = vscode.commands.registerCommand('copilot-cli-extension.startChat', async () => {
		if (cliManager && cliManager.isRunning()) {
			vscode.window.showInformationMessage('Copilot CLI session is already running');
			return;
		}

		try {
			const config = getCLIConfig();
			cliManager = new CLIProcessManager(context, config);

			// Listen to CLI messages
			cliManager.onMessage((message) => {
				switch (message.type) {
					case 'output':
						console.log('[CLI Output]:', message.data);
						break;
					case 'error':
						console.error('[CLI Error]:', message.data);
						break;
					case 'status':
						console.log('[CLI Status]:', message.data);
						if (message.data.status === 'exited') {
							vscode.window.showWarningMessage('Copilot CLI session ended');
						}
						break;
				}
			});

			await cliManager.start();
			vscode.window.showInformationMessage('Copilot CLI session started!');
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to start Copilot CLI: ${errorMessage}`);
		}
	});

	// Register stop chat command
	const stopChatCommand = vscode.commands.registerCommand('copilot-cli-extension.stopChat', async () => {
		if (!cliManager || !cliManager.isRunning()) {
			vscode.window.showInformationMessage('No active Copilot CLI session');
			return;
		}

		try {
			await cliManager.stop();
			cliManager = null;
			vscode.window.showInformationMessage('Copilot CLI session stopped');
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to stop Copilot CLI: ${errorMessage}`);
		}
	});

	context.subscriptions.push(startChatCommand, stopChatCommand);
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

export function deactivate() {
	if (cliManager) {
		cliManager.dispose();
	}
}
