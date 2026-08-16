/**
 * Registration of every webview→extension RPC handler for a chat surface.
 *
 * This was `ChatViewProvider._setupRpcHandlers` — 313 lines and ~80 handler
 * registrations locked inside the sidebar view. The editor-tab surface needs
 * the identical set, and `ExtensionRpcRouter.registerHandler` is last-one-wins
 * per message type, so surfaces must never share a router. Each surface builds
 * its own router and calls this once.
 *
 * The context is an explicit interface rather than the provider itself. That is
 * the point of the extraction: it makes the 27-member dependency surface
 * visible, which is what lets v3.13.0 Task 4/5 re-point these handlers at a
 * `ChatSessionHost` instead of a view without re-reading 300 lines to discover
 * what they touch.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ExtensionRpcRouter } from './ExtensionRpcRouter';
import { getBackendState } from '../../backendState';
import { ManagedMCPRegistry } from '../services/managedMCPRegistry';
import { Logger } from '../../logger';
import { CustomAgentsService } from '../services/CustomAgentsService';
import { InfoSlashHandlers } from '../services/slashCommands/InfoSlashHandlers';
import { CodeReviewSlashHandlers } from '../services/slashCommands/CodeReviewSlashHandlers';
import { NotSupportedSlashHandlers } from '../services/slashCommands/NotSupportedSlashHandlers';
import { MCPConfigurationService } from '../services/mcpConfigurationService';
import { CLIPassthroughService } from '../services/CLIPassthroughService';
import { CliCapabilityService } from '../services/cliCapabilityService';
import type { McpServerActionPayload } from '../../shared/messages';

// Injected by esbuild's `define` (see esbuild.js). Declared here as well as in
// chatViewProvider.ts because the /version handler moved with the rest.
declare const __SDK_VERSION__: string | undefined;
declare const __EXTENSION_VERSION__: string | undefined;

/**
 * Duplicate-send suppression state.
 *
 * Held as one mutable object rather than two fields so the handlers can update
 * it through the context without the surface exposing setters.
 */
export interface SendDedupState {
    lastMessage: string | undefined;
    lastTime: number;
}

/** Everything the handlers reach for. Implemented by the owning chat surface. */
export interface ChatHandlerContext {
    rpcRouter: ExtensionRpcRouter;
    /** Registers a disposable against the surface's lifetime. */
    reg<T extends vscode.Disposable>(disposable: T): T;
    logger: Logger;

    sendDedup: SendDedupState;
    currentWorkspacePath: string | undefined;

    customAgentsService: CustomAgentsService;
    infoHandlers?: InfoSlashHandlers;
    codeReviewHandlers?: CodeReviewSlashHandlers;
    notSupportedHandlers?: NotSupportedSlashHandlers;
    mcpConfigService?: MCPConfigurationService;
    cliPassthroughService?: CLIPassthroughService;
    cliCapability: CliCapabilityService | null;

    buildAndSendMcpStatus(): Promise<void>;
    handleMcpServerAction(payload: McpServerActionPayload): Promise<void>;
    _handleFilePicker(): Promise<void>;
    _handlePastedImage(dataUri: string, mimeType: string, fileName: string): Promise<void>;
    _handleSaveMermaidImage(svgContent: string, source: string): Promise<void>;

    _onDidReceiveUserMessage: vscode.EventEmitter<{ text: string; attachments?: Array<{ type: 'file'; path: string; displayName?: string }>; agentName?: string }>;
    _onDidRequestAbort: vscode.EventEmitter<void>;
    _onDidRequestViewPlan: vscode.EventEmitter<void>;
    _onDidBecomeReady: vscode.EventEmitter<void>;
    _onDidRequestSwitchModel: vscode.EventEmitter<string>;
    _onDidRequestRenameSession: vscode.EventEmitter<string>;
    _onDidRequestForkSession: vscode.EventEmitter<void>;
    _onDidRequestCompact: vscode.EventEmitter<void>;
    _onDidSelectAgent: vscode.EventEmitter<string | null>;
    _onDidRequestReloadAgents: vscode.EventEmitter<void>;
}

/**
 * Wire every handler for one surface. Call once per router, after construction
 * and before `listen()`.
 */
export function registerChatHandlers(ctx: ChatHandlerContext): void {

		ctx.reg(ctx.rpcRouter.onReady(() => {
			ctx.logger.info('Webview is ready');

			const backendState = getBackendState();
			const fullState = backendState.getFullState();

			ctx.logger.info(`[Init] Sending ${fullState.messages.length} messages to webview`);

			ctx.rpcRouter!.sendInit({
				sessionId: fullState.sessionId,
				sessionActive: fullState.sessionActive,
				messages: fullState.messages as any,
				planModeStatus: fullState.planModeStatus,
				workspacePath: fullState.workspacePath,
				activeFilePath: fullState.activeFilePath,
				currentModel: fullState.currentModel,
				showReasoning: vscode.workspace.getConfiguration('copilotCLI').get<boolean>('showReasoning', false)
			});

			ctx._onDidBecomeReady.fire();
		}));

		ctx.reg(ctx.rpcRouter.onSendMessage((payload) => {
			// Prevent duplicate sends (same message within 1 second)
			const now = Date.now();
			if (ctx.sendDedup.lastMessage === payload.text &&
			    now - ctx.sendDedup.lastTime < 1000) {
				ctx.logger.warn(`Ignoring duplicate message send: ${payload.text.substring(0, 50)}...`);
				return;
			}
			ctx.sendDedup.lastMessage = payload.text;
			ctx.sendDedup.lastTime = now;

			ctx.logger.info(`User sent message: ${payload.text.substring(0, 100)}...`);
			if (payload.attachments && payload.attachments.length > 0) {
				ctx.logger.info(`  with ${payload.attachments.length} attachment(s)`);
			}
			ctx._onDidReceiveUserMessage.fire({
				text: payload.text,
				attachments: payload.attachments,
				agentName: payload.agentName
			});
		}));

		ctx.reg(ctx.rpcRouter.onPickFiles(() => {
			ctx.logger.info('File picker requested from UI');
			ctx._handleFilePicker();
		}));

		ctx.reg(ctx.rpcRouter.onPasteImage((payload) => {
			ctx.logger.info(`Pasted image received: ${payload.fileName}`);
			ctx._handlePastedImage(payload.dataUri, payload.mimeType, payload.fileName);
		}));

		ctx.reg(ctx.rpcRouter.onSaveMermaidImage(async (payload) => {
			ctx.logger.info('Save mermaid image requested');
			await ctx._handleSaveMermaidImage(payload.svgContent, payload.source);
		}));

		ctx.reg(ctx.rpcRouter.onAbortMessage(() => {
			ctx.logger.info('Abort requested from UI');
			ctx._onDidRequestAbort.fire();
		}));

		ctx.reg(ctx.rpcRouter.onSwitchSession((payload) => {
			ctx.logger.info(`Switch session requested: ${payload.sessionId}`);
			vscode.commands.executeCommand('copilot-cli-extension.switchSession', payload.sessionId);
		}));

		ctx.reg(ctx.rpcRouter.onNewSession(() => {
			ctx.logger.info('New session requested from UI');
			vscode.commands.executeCommand('copilot-cli-extension.newSession');
		}));

		ctx.reg(ctx.rpcRouter.onViewPlan(() => {
			ctx.logger.info('View plan requested from UI');
			ctx._onDidRequestViewPlan.fire();
		}));

		ctx.reg(ctx.rpcRouter.onViewDiff((payload) => {
			ctx.logger.info(`View diff requested from UI: ${JSON.stringify(payload)}`);
			vscode.commands.executeCommand('copilot-cli-extension.viewDiff', payload);
		}));

		ctx.reg(ctx.rpcRouter.onTogglePlanMode((payload) => {
			ctx.logger.info(`Plan mode toggle requested: ${payload.enabled}`);
			vscode.commands.executeCommand('copilot-cli-extension.togglePlanMode', payload.enabled);
		}));

		ctx.reg(ctx.rpcRouter.onSubagentPopout((payload) => {
			vscode.commands.executeCommand('copilot-cli-extension.openSubagentPanel', payload.agentId);
		}));

		ctx.reg(ctx.rpcRouter.onAcceptPlan(() => {
			ctx.logger.info('Accept plan requested from UI');
			vscode.commands.executeCommand('copilot-cli-extension.acceptPlan');
		}));

		ctx.reg(ctx.rpcRouter.onRejectPlan(() => {
			ctx.logger.info('Reject plan requested from UI');
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

		ctx.codeReviewHandlers = new CodeReviewSlashHandlers(sessionService);
		const mcpRegistry = new ManagedMCPRegistry();
		ctx.mcpConfigService = new MCPConfigurationService(
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
		);
		ctx.infoHandlers = new InfoSlashHandlers(
			() => {
				const userConfig = vscode.workspace.getConfiguration('copilotCLI')
					.get<Record<string, any>>('mcpServers', {});
				return ctx.mcpConfigService!.getMergedMCPServers(userConfig, mcpRegistry.getManagedServers());
			},
			getBackendState(),
			() => ctx.cliCapability,
			{
				extensionVersion: typeof __EXTENSION_VERSION__ !== 'undefined' ? __EXTENSION_VERSION__ : 'unknown',
				sdkVersion: typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : 'unknown',
			}
		);
		ctx.notSupportedHandlers = new NotSupportedSlashHandlers();
		ctx.cliPassthroughService = new CLIPassthroughService(vscode);

		// Handle slash commands from webview
		ctx.reg(ctx.rpcRouter.onShowPlanContent(async () => {
			ctx.logger.info('Show plan content requested from UI');
			const result = await ctx.codeReviewHandlers!.handleReview();
			if (result.success && result.content) {
				ctx.rpcRouter!.addAssistantMessage(result.content);
			} else if (result.error) {
				ctx.rpcRouter!.addAssistantMessage(`Error: ${result.error}`);
			}
		}));

		ctx.reg(ctx.rpcRouter.onOpenDiffView(async (payload) => {
			ctx.logger.info(`Open diff view requested: ${payload.file1} vs ${payload.file2}`);
			const result = await ctx.codeReviewHandlers!.handleDiff(payload.file1, payload.file2);
			if (!result.success && result.error) {
				ctx.rpcRouter!.addAssistantMessage(`Error: ${result.error}`);
			}
		}));

		ctx.reg(ctx.rpcRouter.onShowMcpConfig(async () => {
			ctx.logger.info('[MCP] /mcp command received — building server status');
			await ctx.buildAndSendMcpStatus();
		}));

		ctx.reg(ctx.rpcRouter.onMcpServerAction(async (payload) => {
			await ctx.handleMcpServerAction(payload);
		}));

		ctx.reg(ctx.rpcRouter.onShowUsageMetrics(async () => {
			ctx.logger.info('Show usage metrics requested from UI');
			const result = await ctx.infoHandlers!.handleUsage();
			if (result.success && result.content) {
				ctx.rpcRouter!.addAssistantMessage(result.content);
			} else if (result.error) {
				ctx.rpcRouter!.addAssistantMessage(`Error: ${result.error}`);
			}
		}));

		ctx.reg(ctx.rpcRouter.onShowHelp(async (payload) => {
			ctx.logger.info(`Show help requested from UI: ${payload.command || 'all'}`);
			const result = await ctx.infoHandlers!.handleHelp(payload.command);
			if (result.success && result.content) {
				ctx.rpcRouter!.addAssistantMessage(result.content);
			} else if (result.error) {
				ctx.rpcRouter!.addAssistantMessage(`Error: ${result.error}`);
			}
		}));

		ctx.reg(ctx.rpcRouter.onShowVersionInfo(async () => {
			ctx.logger.info('Show version info requested from UI');
			const result = await ctx.infoHandlers!.handleVersion();
			if (result.success && result.content) {
				ctx.rpcRouter!.addAssistantMessage(result.content);
			} else if (result.error) {
				ctx.rpcRouter!.addAssistantMessage(`Error: ${result.error}`);
			}
		}));

		ctx.reg(ctx.rpcRouter.onShowNotSupported(async (payload) => {
			ctx.logger.info(`Not supported command: ${payload.command}`);
			const result = await ctx.notSupportedHandlers!.handleNotSupported(payload.command);
			if (result.success && result.content) {
				ctx.rpcRouter!.addAssistantMessage(result.content);
			}
		}));

		ctx.reg(ctx.rpcRouter.onOpenInCLI(async (payload) => {
			ctx.logger.info(`Open in CLI requested: ${payload.command}`);
			
			// Get current session ID and workspace path
			const backendState = getBackendState();
			const sessionId = backendState.getSessionId();
			const workspacePath = backendState.getWorkspacePath() || ctx.currentWorkspacePath || null;

			if (!sessionId) {
				ctx.rpcRouter!.addAssistantMessage('No active session. Please start a session first.');
				return;
			}

			const result = ctx.cliPassthroughService!.openCLI(payload.command, sessionId, workspacePath);
			
			if (result.success && result.instruction) {
				ctx.rpcRouter!.addAssistantMessage(result.instruction);
			} else if (result.error) {
				ctx.rpcRouter!.addAssistantMessage(`Error: ${result.error}`);
			}
		}));

		ctx.reg(ctx.rpcRouter.onSwitchModel((payload) => {
			ctx.logger.info(`Switch model requested: ${payload.model}`);
			ctx._onDidRequestSwitchModel.fire(payload.model);
		}));

		ctx.reg(ctx.rpcRouter.onRenameSession((payload) => {
			ctx.logger.info(`Rename session requested: "${payload.name}"`);
			ctx._onDidRequestRenameSession.fire(payload.name);
		}));

		ctx.reg(ctx.rpcRouter.onForkSession(() => {
			ctx.logger.info('[Fork] Fork session requested from UI');
			ctx._onDidRequestForkSession.fire();
		}));

		ctx.reg(ctx.rpcRouter.onCompact(() => {
			ctx.logger.info('[Compact] Compact requested from UI');
			ctx._onDidRequestCompact.fire();
		}));

		ctx.reg(ctx.rpcRouter.onGetCustomAgents(async () => {
			ctx.rpcRouter!.sendCustomAgentsChanged(ctx.customAgentsService.getAll());
		}));

		ctx.reg(ctx.rpcRouter.onSaveCustomAgent(async (payload) => {
			try {
				await ctx.customAgentsService.save(payload.agent);
				ctx.rpcRouter!.sendCustomAgentsChanged(ctx.customAgentsService.getAll());
			} catch (e: any) {
				ctx.rpcRouter!.setStatus(`Failed to save agent: ${e.message}`);
			}
		}));

		ctx.reg(ctx.rpcRouter.onDeleteCustomAgent(async (payload) => {
			try {
				await ctx.customAgentsService.delete(payload.name);
				ctx.rpcRouter!.sendCustomAgentsChanged(ctx.customAgentsService.getAll());
			} catch (e: any) {
				ctx.rpcRouter!.setStatus(`Failed to delete agent: ${e.message}`);
			}
		}));

		ctx.reg(ctx.rpcRouter.onSelectAgent(async (payload) => {
			const state = getBackendState();
			const agentName = payload.name.trim();
			ctx.logger.info(`[selectAgent] ${agentName || '(clear)'}`);
			if (!agentName) {
				state.setActiveAgent(null);
				ctx.rpcRouter!.sendActiveAgentChanged(null);
				ctx._onDidSelectAgent.fire(null);
				return;
			}
			const all = ctx.customAgentsService.getAll();
			const agent = all.find(a => a.name === agentName);
			if (!agent) {
				ctx.rpcRouter!.setStatus(`Unknown agent: ${agentName}. Available: ${all.map(a => a.name).join(', ')}`);
				return;
			}
			state.setActiveAgent(agentName);
			ctx.rpcRouter!.sendActiveAgentChanged(agent);
			ctx._onDidSelectAgent.fire(agentName);
		}));

		ctx.reg(ctx.rpcRouter.onAgentsPanelClosed(async () => {
			ctx._onDidRequestReloadAgents.fire();
		}));

		ctx.reg(ctx.rpcRouter.onOpenFile(async (payload) => {
			ctx.logger.info(`[OpenFile] ${payload.filePath}`);
			const resolved = path.resolve(payload.filePath);
			const workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
			const sessionStateDir = path.join(os.homedir(), '.copilot', 'session-state');
			const allowed = workspaceFolders.some(ws => resolved.startsWith(ws + path.sep)) ||
				resolved.startsWith(sessionStateDir + path.sep);
			if (!allowed) {
				ctx.logger.warn(`[OpenFile] Blocked: path outside workspace and session-state`);
				return;
			}
			try {
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
				await vscode.window.showTextDocument(doc, { preview: true });
			} catch (err: any) {
				ctx.logger.warn(`[OpenFile] Failed: ${err.message}`);
			}
		}));

}
