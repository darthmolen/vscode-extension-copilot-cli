/**
 * Shared domain models for extension and webview
 * These types are used for RPC messages and state management
 */

/**
 * Session information
 */
export interface Session {
	id: string;
	name: string;
	timestamp: number;
	workspacePath?: string;
	mode?: 'work' | 'plan';
	planModeEnabled?: boolean;
}

/**
 * Chat message
 */
export interface Message {
	role: 'user' | 'assistant' | 'reasoning' | 'tool';
	type?: 'user' | 'assistant' | 'reasoning';
	content: string;
	timestamp: number;
	attachments?: Attachment[];
}

/**
 * File attachment
 */
export interface Attachment {
	type: 'file';
	path: string;
	displayName?: string;
}

/**
 * Tool execution state
 */
export interface ToolState {
	id: string;
	name: string;
	status: 'running' | 'complete' | 'failed';
	input?: any;
	output?: string;
	error?: string;
}

/**
 * Plan mode status
 */
export interface PlanModeStatus {
	enabled: boolean;
	planSessionId?: string;
}

/**
 * Diff data for showing file differences
 */
export interface DiffData {
	toolCallId?: string;
	beforeUri: string;
	afterUri: string;
	title?: string;
}

/**
 * Initial state sent to webview on init
 */
export interface InitState {
	sessionId: string | null;
	sessionActive: boolean;
	messages: Message[];
	planModeStatus: PlanModeStatus | null;
	workspacePath: string | null;
	activeFilePath: string | null;
	currentModel: string | null;
}

/**
 * Usage information
 */
export interface UsageInfo {
	tokens?: number;
	quota?: number;
}
