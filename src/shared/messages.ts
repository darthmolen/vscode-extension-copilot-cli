/**
 * Shared message type definitions for RPC layer
 * These define the contract between extension and webview
 */

import {
	Session,
	Message,
	Attachment,
	ToolState,
	PlanModeStatus,
	DiffData,
	InitState,
	UsageInfo
} from './models';

/**
 * Base message interface
 */
export interface BaseMessage {
	type: string;
	timestamp?: number;
}

// ============================================================================
// Webview → Extension Messages
// ============================================================================

/**
 * Union of all webview message type strings
 */
export type WebviewMessageType =
	| 'sendMessage'
	| 'abortMessage'
	| 'ready'
	| 'switchSession'
	| 'newSession'
	| 'viewPlan'
	| 'viewDiff'
	| 'togglePlanMode'
	| 'acceptPlan'
	| 'rejectPlan'
	| 'pickFiles';

/**
 * Send user message to agent
 */
export interface SendMessagePayload extends BaseMessage {
	type: 'sendMessage';
	text: string;
	attachments?: Attachment[];
}

/**
 * Abort current agent stream
 */
export interface AbortMessagePayload extends BaseMessage {
	type: 'abortMessage';
}

/**
 * Webview initialized and ready
 */
export interface ReadyPayload extends BaseMessage {
	type: 'ready';
}

/**
 * Switch to different session
 */
export interface SwitchSessionPayload extends BaseMessage {
	type: 'switchSession';
	sessionId: string;
}

/**
 * Create new session
 */
export interface NewSessionPayload extends BaseMessage {
	type: 'newSession';
}

/**
 * Open plan file in editor
 */
export interface ViewPlanPayload extends BaseMessage {
	type: 'viewPlan';
}

/**
 * Show diff view
 */
export interface ViewDiffPayload extends BaseMessage {
	type: 'viewDiff';
	data: DiffData;
}

/**
 * Toggle plan mode on/off
 */
export interface TogglePlanModePayload extends BaseMessage {
	type: 'togglePlanMode';
	enabled: boolean;
}

/**
 * User accepted plan
 */
export interface AcceptPlanPayload extends BaseMessage {
	type: 'acceptPlan';
}

/**
 * User rejected plan
 */
export interface RejectPlanPayload extends BaseMessage {
	type: 'rejectPlan';
}

/**
 * Open file picker for attachments
 */
export interface PickFilesPayload extends BaseMessage {
	type: 'pickFiles';
}

/**
 * Union of all webview → extension messages
 */
export type WebviewMessage =
	| SendMessagePayload
	| AbortMessagePayload
	| ReadyPayload
	| SwitchSessionPayload
	| NewSessionPayload
	| ViewPlanPayload
	| ViewDiffPayload
	| TogglePlanModePayload
	| AcceptPlanPayload
	| RejectPlanPayload
	| PickFilesPayload;

// ============================================================================
// Extension → Webview Messages
// ============================================================================

/**
 * Union of all extension message type strings
 */
export type ExtensionMessageType =
	| 'init'
	| 'userMessage'
	| 'assistantMessage'
	| 'reasoningMessage'
	| 'toolStart'
	| 'toolUpdate'
	| 'streamChunk'
	| 'streamEnd'
	| 'clearMessages'
	| 'sessionStatus'
	| 'updateSessions'
	| 'thinking'
	| 'resetPlanMode'
	| 'workspacePath'
	| 'activeFileChanged'
	| 'diffAvailable'
	| 'appendMessage'
	| 'attachmentValidation'
	| 'status'
	| 'usage_info';

/**
 * Initialize webview with full state
 */
export interface InitPayload extends BaseMessage {
	type: 'init';
	sessionId: string | null;
	sessionActive: boolean;
	messages: Message[];
	planModeStatus: PlanModeStatus | null;
	workspacePath: string | null;
	activeFilePath: string | null;
}

/**
 * Add user message to chat
 */
export interface UserMessagePayload extends BaseMessage {
	type: 'userMessage';
	text: string;
	attachments?: Attachment[];
}

/**
 * Add assistant message to chat
 */
export interface AssistantMessagePayload extends BaseMessage {
	type: 'assistantMessage';
	text: string;
}

/**
 * Add reasoning message to chat
 */
export interface ReasoningMessagePayload extends BaseMessage {
	type: 'reasoningMessage';
	text: string;
}

/**
 * Tool execution started
 */
export interface ToolStartPayload extends BaseMessage {
	type: 'toolStart';
	toolState: ToolState;
}

/**
 * Tool execution progress update
 */
export interface ToolUpdatePayload extends BaseMessage {
	type: 'toolUpdate';
	toolState: ToolState;
}

/**
 * Stream chunk of assistant response
 */
export interface StreamChunkPayload extends BaseMessage {
	type: 'streamChunk';
	chunk: string;
}

/**
 * Stream completed
 */
export interface StreamEndPayload extends BaseMessage {
	type: 'streamEnd';
}

/**
 * Clear all messages
 */
export interface ClearMessagesPayload extends BaseMessage {
	type: 'clearMessages';
}

/**
 * Update session status
 */
export interface SessionStatusPayload extends BaseMessage {
	type: 'sessionStatus';
	active: boolean;
}

/**
 * Update session list
 */
export interface UpdateSessionsPayload extends BaseMessage {
	type: 'updateSessions';
	sessions: Session[];
	currentSessionId: string | null;
}

/**
 * Agent is thinking
 */
export interface ThinkingPayload extends BaseMessage {
	type: 'thinking';
	isThinking: boolean;
}

/**
 * Reset plan mode UI
 */
export interface ResetPlanModePayload extends BaseMessage {
	type: 'resetPlanMode';
}

/**
 * Update workspace path
 */
export interface WorkspacePathPayload extends BaseMessage {
	type: 'workspacePath';
	path: string | null;
}

/**
 * Active file changed
 */
export interface ActiveFileChangedPayload extends BaseMessage {
	type: 'activeFileChanged';
	filePath: string | null;
}

/**
 * Diff is available
 * 
 * Sent when a tool execution creates file snapshots for comparison.
 * Webview uses toolCallId to find the tool element and add a diff button.
 */
export interface DiffAvailablePayload extends BaseMessage {
	type: 'diffAvailable';
	toolCallId: string;
	beforeUri: string;
	afterUri: string;
	title: string;
	diffLines?: Array<{ type: 'add' | 'remove' | 'context'; text: string }>;
	diffTruncated?: boolean;
	diffTotalLines?: number;
}

/**
 * Append to last message
 */
export interface AppendMessagePayload extends BaseMessage {
	type: 'appendMessage';
	text: string;
}

/**
 * Attachment validation result
 */
export interface AttachmentValidationPayload extends BaseMessage {
	type: 'attachmentValidation';
	valid: boolean;
	error: string | null;
}

/**
 * General status update
 */
export interface StatusPayload extends BaseMessage {
	type: 'status';
	message: string;
}

/**
 * Usage information
 */
export interface UsageInfoPayload extends BaseMessage {
	type: 'usage_info';
	usage: UsageInfo;
}

/**
 * Union of all extension → webview messages
 */
export type ExtensionMessage =
	| InitPayload
	| UserMessagePayload
	| AssistantMessagePayload
	| ReasoningMessagePayload
	| ToolStartPayload
	| ToolUpdatePayload
	| StreamChunkPayload
	| StreamEndPayload
	| ClearMessagesPayload
	| SessionStatusPayload
	| UpdateSessionsPayload
	| ThinkingPayload
	| ResetPlanModePayload
	| WorkspacePathPayload
	| ActiveFileChangedPayload
	| DiffAvailablePayload
	| AppendMessagePayload
	| AttachmentValidationPayload
	| StatusPayload
	| UsageInfoPayload;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for webview messages
 */
export function isWebviewMessage(message: any): message is WebviewMessage {
	if (!message || typeof message !== 'object' || !message.type) {
		return false;
	}
	
	const validTypes: WebviewMessageType[] = [
		'sendMessage',
		'abortMessage',
		'ready',
		'switchSession',
		'newSession',
		'viewPlan',
		'viewDiff',
		'togglePlanMode',
		'acceptPlan',
		'rejectPlan',
		'pickFiles'
	];
	
	return validTypes.includes(message.type as WebviewMessageType);
}

/**
 * Type guard for extension messages
 */
export function isExtensionMessage(message: any): message is ExtensionMessage {
	if (!message || typeof message !== 'object' || !message.type) {
		return false;
	}
	
	const validTypes: ExtensionMessageType[] = [
		'init',
		'userMessage',
		'assistantMessage',
		'reasoningMessage',
		'toolStart',
		'toolUpdate',
		'streamChunk',
		'streamEnd',
		'clearMessages',
		'sessionStatus',
		'updateSessions',
		'thinking',
		'resetPlanMode',
		'workspacePath',
		'activeFileChanged',
		'diffAvailable',
		'appendMessage',
		'attachmentValidation',
		'status',
		'usage_info'
	];
	
	return validTypes.includes(message.type as ExtensionMessageType);
}
