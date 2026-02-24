/**
 * Extension RPC Router
 * 
 * Provides type-safe message passing from extension to webview.
 * Handles routing of incoming webview messages to registered handlers.
 */

import * as vscode from 'vscode';
import {
	ExtensionMessage,
	WebviewMessage,
	WebviewMessageType,
	InitPayload,
	UserMessagePayload,
	AssistantMessagePayload,
	ReasoningMessagePayload,
	ToolStartPayload,
	ToolUpdatePayload,
	StreamChunkPayload,
	StreamEndPayload,
	ClearMessagesPayload,
	SessionStatusPayload,
	UpdateSessionsPayload,
	ThinkingPayload,
	ResetPlanModePayload,
	WorkspacePathPayload,
	ActiveFileChangedPayload,
	DiffAvailablePayload,
	AppendMessagePayload,
	AttachmentValidationPayload,
	StatusPayload,
	UsageInfoPayload,
	SendMessagePayload,
	AbortMessagePayload,
	ReadyPayload,
	SwitchSessionPayload,
	NewSessionPayload,
	ViewPlanPayload,
	ViewDiffPayload,
	TogglePlanModePayload,
	AcceptPlanPayload,
	RejectPlanPayload,
	PickFilesPayload,
	ShowPlanContentPayload,
	OpenDiffViewPayload,
	ShowMcpConfigPayload,
	ShowUsageMetricsPayload,
	ShowHelpPayload,
	ShowNotSupportedPayload,
	OpenInCLIPayload,
	OpenFilePayload,
	PasteImagePayload,
	SaveMermaidImagePayload,
	Session,
	Attachment,
	ToolState,
	InitState,
	UsageInfo
} from '../../shared';

/**
 * Type for message handlers
 */
type MessageHandler<T> = (payload: T) => void | Promise<void>;

/**
 * Disposable subscription
 */
interface Disposable {
	dispose(): void;
}

/**
 * Extension RPC Router
 * 
 * Manages type-safe bidirectional communication between extension and webview.
 */
export class ExtensionRpcRouter {
	private handlers = new Map<WebviewMessageType, MessageHandler<any>>();
	
	// Message tracking for debugging
	private incomingMessageCount = 0;
	private outgoingMessageCount = 0;
	private messageCountByType = new Map<string, number>();
	private lastReportedAt = 0;
	private readonly REPORT_INTERVAL = 100; // Log every 100 messages
	
	constructor(
		private webview: vscode.Webview
	) {}
	
	// ========================================================================
	// Send Methods (Extension → Webview)
	// ========================================================================
	
	/**
	 * Initialize webview with full state
	 */
	sendInit(state: InitState): void {
		const message: InitPayload = {
			type: 'init',
			...state
		};
		this.send(message);
	}
	
	/**
	 * Add user message to chat
	 */
	addUserMessage(text: string, attachments?: Attachment[]): void {
		const message: UserMessagePayload = {
			type: 'userMessage',
			text,
			attachments
		};
		this.send(message);
	}
	
	/**
	 * Add assistant message to chat
	 */
	addAssistantMessage(text: string): void {
		const message: AssistantMessagePayload = {
			type: 'assistantMessage',
			text
		};
		this.send(message);
	}
	
	/**
	 * Add reasoning message to chat
	 */
	addReasoningMessage(text: string): void {
		const message: ReasoningMessagePayload = {
			type: 'reasoningMessage',
			text
		};
		this.send(message);
	}
	
	/**
	 * Tool execution started
	 */
	toolStart(toolState: ToolState): void {
		const message: ToolStartPayload = {
			type: 'toolStart',
			toolState
		};
		this.send(message);
	}
	
	/**
	 * Tool execution progress
	 */
	toolUpdate(toolState: ToolState): void {
		const message: ToolUpdatePayload = {
			type: 'toolUpdate',
			toolState
		};
		this.send(message);
	}
	
	/**
	 * Stream chunk of assistant response
	 */
	streamChunk(chunk: string): void {
		const message: StreamChunkPayload = {
			type: 'streamChunk',
			chunk
		};
		this.send(message);
	}
	
	/**
	 * Stream completed
	 */
	streamEnd(): void {
		const message: StreamEndPayload = {
			type: 'streamEnd'
		};
		this.send(message);
	}
	
	/**
	 * Clear all messages
	 */
	clearMessages(): void {
		const message: ClearMessagesPayload = {
			type: 'clearMessages'
		};
		this.send(message);
	}
	
	/**
	 * Update session status
	 */
	setSessionActive(active: boolean): void {
		const message: SessionStatusPayload = {
			type: 'sessionStatus',
			active
		};
		this.send(message);
	}
	
	/**
	 * Update session list
	 */
	updateSessions(sessions: Session[], currentSessionId: string | null): void {
		const message: UpdateSessionsPayload = {
			type: 'updateSessions',
			sessions,
			currentSessionId
		};
		this.send(message);
	}
	
	/**
	 * Agent is thinking
	 */
	setThinking(isThinking: boolean): void {
		const message: ThinkingPayload = {
			type: 'thinking',
			isThinking
		};
		this.send(message);
	}
	
	/**
	 * Reset plan mode UI
	 */
	resetPlanMode(): void {
		const message: ResetPlanModePayload = {
			type: 'resetPlanMode'
		};
		this.send(message);
	}
	
	/**
	 * Update workspace path
	 */
	setWorkspacePath(path: string | null): void {
		const message: WorkspacePathPayload = {
			type: 'workspacePath',
			path
		};
		this.send(message);
	}
	
	/**
	 * Active file changed
	 */
	setActiveFile(filePath: string | null): void {
		const message: ActiveFileChangedPayload = {
			type: 'activeFileChanged',
			filePath
		};
		this.send(message);
	}
	
	/**
	 * Send diff available data to webview
	 * 
	 * Forwards complete diff information including tool ID and file paths.
	 * Webview uses toolCallId to locate the tool element and add diff button.
	 */
	sendDiffAvailable(diffData: { toolCallId: string; beforeUri: string; afterUri: string; title: string; diffLines?: Array<{ type: 'add' | 'remove' | 'context'; text: string }>; diffTruncated?: boolean; diffTotalLines?: number }): void {
		const message: DiffAvailablePayload = {
			type: 'diffAvailable',
			toolCallId: diffData.toolCallId,
			beforeUri: diffData.beforeUri,
			afterUri: diffData.afterUri,
			title: diffData.title,
			diffLines: diffData.diffLines,
			diffTruncated: diffData.diffTruncated,
			diffTotalLines: diffData.diffTotalLines
		};
		this.send(message);
	}
	
	/**
	 * Append to last message
	 */
	appendMessage(text: string): void {
		const message: AppendMessagePayload = {
			type: 'appendMessage',
			text
		};
		this.send(message);
	}
	
	/**
	 * Attachment validation result
	 */
	attachmentValidation(valid: boolean, error: string | null): void {
		const message: AttachmentValidationPayload = {
			type: 'attachmentValidation',
			valid,
			error
		};
		this.send(message);
	}
	
	/**
	 * General status update
	 */
	setStatus(statusMessage: string): void {
		const message: StatusPayload = {
			type: 'status',
			message: statusMessage
		};
		this.send(message);
	}
	
	/**
	 * Usage information
	 */
	setUsageInfo(usage: UsageInfo): void {
		const message: UsageInfoPayload = {
			type: 'usage_info',
			usage
		};
		this.send(message);
	}
	
	// ========================================================================
	// Receive Handlers (Webview → Extension)
	// ========================================================================
	
	/**
	 * Register handler for sendMessage
	 */
	onSendMessage(handler: MessageHandler<SendMessagePayload>): Disposable {
		return this.registerHandler('sendMessage', handler);
	}
	
	/**
	 * Register handler for abortMessage
	 */
	onAbortMessage(handler: MessageHandler<AbortMessagePayload>): Disposable {
		return this.registerHandler('abortMessage', handler);
	}
	
	/**
	 * Register handler for ready
	 */
	onReady(handler: MessageHandler<ReadyPayload>): Disposable {
		return this.registerHandler('ready', handler);
	}
	
	/**
	 * Register handler for switchSession
	 */
	onSwitchSession(handler: MessageHandler<SwitchSessionPayload>): Disposable {
		return this.registerHandler('switchSession', handler);
	}
	
	/**
	 * Register handler for newSession
	 */
	onNewSession(handler: MessageHandler<NewSessionPayload>): Disposable {
		return this.registerHandler('newSession', handler);
	}
	
	/**
	 * Register handler for viewPlan
	 */
	onViewPlan(handler: MessageHandler<ViewPlanPayload>): Disposable {
		return this.registerHandler('viewPlan', handler);
	}
	
	/**
	 * Register handler for viewDiff
	 */
	onViewDiff(handler: MessageHandler<ViewDiffPayload>): Disposable {
		return this.registerHandler('viewDiff', handler);
	}
	
	/**
	 * Register handler for togglePlanMode
	 */
	onTogglePlanMode(handler: MessageHandler<TogglePlanModePayload>): Disposable {
		return this.registerHandler('togglePlanMode', handler);
	}
	
	/**
	 * Register handler for acceptPlan
	 */
	onAcceptPlan(handler: MessageHandler<AcceptPlanPayload>): Disposable {
		return this.registerHandler('acceptPlan', handler);
	}
	
	/**
	 * Register handler for rejectPlan
	 */
	onRejectPlan(handler: MessageHandler<RejectPlanPayload>): Disposable {
		return this.registerHandler('rejectPlan', handler);
	}
	
	/**
	 * Register handler for pickFiles
	 */
	onPickFiles(handler: MessageHandler<PickFilesPayload>): Disposable {
		return this.registerHandler('pickFiles', handler);
	}
	
	/**
	 * Register handler for pasteImage
	 */
	onPasteImage(handler: MessageHandler<PasteImagePayload>): Disposable {
		return this.registerHandler('pasteImage', handler);
	}

	/**
	 * Register handler for saveMermaidImage
	 */
	onSaveMermaidImage(handler: MessageHandler<SaveMermaidImagePayload>): Disposable {
		return this.registerHandler('saveMermaidImage', handler);
	}

	/**
	 * Register handler for showPlanContent
	 */
	onShowPlanContent(handler: MessageHandler<ShowPlanContentPayload>): Disposable {
		return this.registerHandler('showPlanContent', handler);
	}
	
	/**
	 * Register handler for openDiffView
	 */
	onOpenDiffView(handler: MessageHandler<OpenDiffViewPayload>): Disposable {
		return this.registerHandler('openDiffView', handler);
	}
	
	/**
	 * Register handler for showMcpConfig
	 */
	onShowMcpConfig(handler: MessageHandler<ShowMcpConfigPayload>): Disposable {
		return this.registerHandler('showMcpConfig', handler);
	}
	
	/**
	 * Register handler for showUsageMetrics
	 */
	onShowUsageMetrics(handler: MessageHandler<ShowUsageMetricsPayload>): Disposable {
		return this.registerHandler('showUsageMetrics', handler);
	}
	
	/**
	 * Register handler for showHelp
	 */
	onShowHelp(handler: MessageHandler<ShowHelpPayload>): Disposable {
		return this.registerHandler('showHelp', handler);
	}
	
	/**
	 * Register handler for showNotSupported
	 */
	onShowNotSupported(handler: MessageHandler<ShowNotSupportedPayload>): Disposable {
		return this.registerHandler('showNotSupported', handler);
	}
	
	/**
	 * Register handler for openInCLI
	 */
	onOpenInCLI(handler: MessageHandler<OpenInCLIPayload>): Disposable {
		return this.registerHandler('openInCLI', handler);
	}

	/**
	 * Register handler for openFile
	 */
	onOpenFile(handler: MessageHandler<OpenFilePayload>): Disposable {
		return this.registerHandler('openFile', handler);
	}
	
	// ========================================================================
	// Message Routing
	// ========================================================================
	
	/**
	 * Route incoming webview message to registered handler
	 */
	route(message: WebviewMessage): void {
		// Track incoming messages
		this.incomingMessageCount++;
		this.trackMessageType(`IN:${message.type}`);
		
		// Report periodically
		if (this.incomingMessageCount % this.REPORT_INTERVAL === 0) {
			this.reportMessageStats('INCOMING');
		}
		
		const handler = this.handlers.get(message.type as WebviewMessageType);
		
		if (handler) {
			try {
				handler(message);
			} catch (error) {
				console.error(`Error in handler for ${message.type}:`, error);
			}
		} else {
			console.warn(`No handler registered for message type: ${message.type}`);
		}
	}
	
	/**
	 * Set up webview message listener
	 * Call this once to start routing messages
	 */
	listen(): Disposable {
		return this.webview.onDidReceiveMessage((message: WebviewMessage) => {
			this.route(message);
		});
	}
	
	// ========================================================================
	// Private Methods
	// ========================================================================
	
	/**
	 * Send message to webview
	 */
	private send(message: ExtensionMessage): void {
		// Track outgoing messages
		this.outgoingMessageCount++;
		this.trackMessageType(`OUT:${message.type}`);
		
		// Report periodically
		if (this.outgoingMessageCount % this.REPORT_INTERVAL === 0) {
			this.reportMessageStats('OUTGOING');
		}
		
		this.webview.postMessage(message);
	}
	
	/**
	 * Register a message handler
	 */
	private registerHandler<T extends WebviewMessage>(
		type: WebviewMessageType,
		handler: MessageHandler<T>
	): Disposable {
		// Only allow one handler per type (last one wins)
		this.handlers.set(type, handler as MessageHandler<any>);
		
		return {
			dispose: () => {
				if (this.handlers.get(type) === handler) {
					this.handlers.delete(type);
				}
			}
		};
	}
	
	/**
	 * Track message type count
	 */
	private trackMessageType(type: string): void {
		const count = this.messageCountByType.get(type) || 0;
		this.messageCountByType.set(type, count + 1);
	}
	
	/**
	 * Report message statistics
	 */
	private reportMessageStats(direction: 'INCOMING' | 'OUTGOING'): void {
		const now = Date.now();
		const timeSinceLastReport = now - this.lastReportedAt;
		
		console.log('='.repeat(80));
		console.log(`[MESSAGE DEBUG] ${direction} Message Stats`);
		console.log(`Total incoming: ${this.incomingMessageCount}`);
		console.log(`Total outgoing: ${this.outgoingMessageCount}`);
		console.log(`Time since last report: ${timeSinceLastReport}ms`);
		console.log('Breakdown by type:');
		
		// Sort by count descending
		const sortedTypes = Array.from(this.messageCountByType.entries())
			.sort((a, b) => b[1] - a[1]);
		
		for (const [type, count] of sortedTypes) {
			console.log(`  ${type}: ${count}`);
		}
		
		console.log('='.repeat(80));
		this.lastReportedAt = now;
	}
	
	/**
	 * Get current message statistics (useful for manual inspection)
	 */
	public getMessageStats(): { incoming: number; outgoing: number; byType: Map<string, number> } {
		return {
			incoming: this.incomingMessageCount,
			outgoing: this.outgoingMessageCount,
			byType: new Map(this.messageCountByType)
		};
	}
}
