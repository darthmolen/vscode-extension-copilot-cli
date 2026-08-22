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
import { Logger } from '../../logger';
import { CustomAgentsService } from '../services/CustomAgentsService';
import { InfoSlashHandlers } from '../services/slashCommands/InfoSlashHandlers';
import { CodeReviewSlashHandlers } from '../services/slashCommands/CodeReviewSlashHandlers';
import { NotSupportedSlashHandlers } from '../services/slashCommands/NotSupportedSlashHandlers';
import { MCPConfigurationService } from '../services/mcpConfigurationService';
import { CLIPassthroughService } from '../services/CLIPassthroughService';
import type { ChatSessionHost } from '../session/ChatSessionHost';
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
    /**
     * Owned by the session, not by registration. `readonly` is the guard: these
     * were assignable only so this module could build them mid-registration, which
     * is exactly how a second surface would have clobbered the first's.
     */
    readonly infoHandlers?: InfoSlashHandlers;
    readonly codeReviewHandlers?: CodeReviewSlashHandlers;
    readonly notSupportedHandlers?: NotSupportedSlashHandlers;
    readonly mcpConfigService?: MCPConfigurationService;
    readonly cliPassthroughService?: CLIPassthroughService;
    /**
     * The session this surface is showing. A getter, not a value: the host is
     * attached after construction and replaced when the surface changes session,
     * and handlers run long after registration.
     */
    readonly sessionHost?: ChatSessionHost;
    cliCapability: CliCapabilityService | null;

    /** Send the surface's full state to its webview. The only init path. */
    sendInit(): void;
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
    _onDidRequestNewSession: vscode.EventEmitter<void>;
    _onDidRequestAskInNewTab: vscode.EventEmitter<string>;
    _onDidRequestSwitchSession: vscode.EventEmitter<string>;
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

			// One init path, shared with the re-send after the transcript loads.
			ctx.sendInit();

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

		// Fired, not commanded. `executeCommand` reaches a handler that has no idea
		// which surface asked, so the dropdown in a tab switched the sidebar's
		// session (P3 §4.2). As an event it arrives at `registerSurfaceHandlers`
		// closed over this surface, and the target host is right there.
		ctx.reg(ctx.rpcRouter.onSwitchSession((payload) => {
			ctx.logger.info(`Switch session requested: ${payload.sessionId}`);
			ctx._onDidRequestSwitchSession.fire(payload.sessionId);
		}));

		ctx.reg(ctx.rpcRouter.onNewSession(() => {
			ctx.logger.info('New session requested from UI');
			ctx._onDidRequestNewSession.fire();
		}));

		ctx.reg(ctx.rpcRouter.onAskInNewTab((payload) => {
			ctx.logger.info(`[btw] side question requested: ${payload.prompt.substring(0, 60)}`);
			ctx._onDidRequestAskInNewTab.fire(payload.prompt);
		}));

		ctx.reg(ctx.rpcRouter.onViewPlan(() => {
			ctx.logger.info('View plan requested from UI');
			ctx._onDidRequestViewPlan.fire();
		}));

		ctx.reg(ctx.rpcRouter.onViewDiff((payload) => {
			ctx.logger.info(`View diff requested from UI: ${JSON.stringify(payload)}`);
			vscode.commands.executeCommand('copilot-cli-extension.viewDiff', payload);
		}));

		// Straight to this surface's host, not through `executeCommand`.
		//
		// The signal arrives here with its identity intact — one router per surface,
		// closed over one host — and the command indirection threw that away on the
		// next line, landing on the module-level `sessionManager`: "whichever session
		// started last". Typing `/plan` in a tab toggled the sidebar. The fix is to
		// stop discarding what we already have, not to add a resolver that
		// reconstructs it (P3 §4.2).
		ctx.reg(ctx.rpcRouter.onTogglePlanMode(async (payload) => {
			ctx.logger.info(`Plan mode toggle requested: ${payload.enabled}`);
			if (payload.enabled) {
				await ctx.sessionHost?.enablePlanMode();
			} else {
				await ctx.sessionHost?.disablePlanMode();
			}
		}));

		ctx.reg(ctx.rpcRouter.onSubagentPopout((payload) => {
			vscode.commands.executeCommand('copilot-cli-extension.openSubagentPanel', payload.agentId);
		}));

		ctx.reg(ctx.rpcRouter.onAcceptPlan(async () => {
			ctx.logger.info('Accept plan requested from UI');
			await ctx.sessionHost?.acceptPlan();
		}));

		ctx.reg(ctx.rpcRouter.onRejectPlan(async () => {
			ctx.logger.info('Reject plan requested from UI');
			await ctx.sessionHost?.rejectPlan();
		}));

		// The slash-command services are *not* built here. They belong to the
		// session, are built once by `createChatSessionServices`, and reach this
		// module through the context — registering a second surface used to rebuild
		// them and overwrite the first surface's.

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
			
			// This surface's session, not the window's most recent one.
			const sessionId = ctx.sessionHost?.sessionId ?? null;
			const workspacePath = ctx.sessionHost?.workspace.getWorkspacePath() || ctx.currentWorkspacePath || null;

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
			// The sticky agent belongs to a conversation, so it is recorded on the
			// host — two surfaces can hold two different agents at once.
			const state = ctx.sessionHost?.state;
			const agentName = payload.name.trim();
			ctx.logger.info(`[selectAgent] ${agentName || '(clear)'}`);
			if (!agentName) {
				state?.setActiveAgent(null);
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
			state?.setActiveAgent(agentName);
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
