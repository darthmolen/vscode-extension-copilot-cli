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
/**
 * One entry in a transcript.
 *
 * `kind` is the single discriminant. It replaces the old `role`/`type` pair, which
 * encoded overlapping things — they collided on user/assistant/reasoning and
 * diverged exactly where it mattered, since `tool` and `error` are bubble kinds
 * with no speaker while `system` is a speaker with no bubble kind. Neither field
 * could express a tool call, which is why replay smuggled `type` through `role`
 * (`main.js`) and dropped everything else.
 *
 * `role` survives as a deprecated alias for the v3.13.0 release and is load-bearing
 * while it does: `ToolExecution.js` closes tool groups on `message.role`, in the
 * *live* path. Whoever removes it must fix that check first.
 */
export interface Message {
	kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'error' | 'system';
	/** @deprecated Use `kind`. Retained for the v3.13.0 release — see above. */
	role?: 'user' | 'assistant' | 'reasoning' | 'tool';
	/** @deprecated Use `kind`. */
	type?: 'user' | 'assistant' | 'reasoning';
	content: string;
	timestamp: number;
	attachments?: Attachment[];
	/** Present only when `kind === 'tool'`. The shape `buildToolHtml` reads. */
	tool?: ToolState;
	/** Set when this entry belongs to a sub-agent. */
	agentId?: string;
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
/**
 * Tool execution state, as it crosses the wire.
 *
 * These field names were `id` / `name` / `input` / `output` and described nothing
 * that existed: what the manager emits and what `ToolExecution.buildToolHtml` reads
 * is `toolCallId` / `toolName` / `arguments` / `result`. The declaration went
 * unchecked because `ExtensionRpcRouter.toolStart` takes this type while
 * `chatViewProvider.addToolExecution` passes `any` — so the live path has always
 * carried the shape below, under the wrong names.
 *
 * Kept in step with `ToolExecutionState` in `sdkSessionManager.ts`, which is the
 * emitting side of the same contract.
 */
export interface ToolState {
	toolCallId: string;
	toolName: string;
	status: 'pending' | 'running' | 'complete' | 'failed';
	arguments?: any;
	startTime?: number;
	endTime?: number;
	result?: string;
	/** True when a replayed result was capped — see `sessionTranscriptBuilder`. */
	resultTruncated?: boolean;
	error?: { message: string; code?: string };
	progress?: string;
	intent?: string;
	hasDiff?: boolean;
	agentId?: string;          // set when this tool runs inside a sub-agent (routes to the dock)
	parentToolCallId?: string; // redundant fallback
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
	showReasoning?: boolean;
}

/**
 * Usage information
 */
export interface UsageInfo {
	tokens?: number;
	quota?: number;
}

/**
 * Custom agent definition — mirrors SDK CustomAgentConfig with an additional builtIn flag
 */
export interface CustomAgentDefinition {
	name: string;            // slug, SDK name key
	displayName?: string;
	description?: string;
	prompt: string;
	tools?: string[] | null; // null/undefined = all tools
	model?: string;          // optional model override for this agent
	scope?: 'global' | 'project'; // where the agent was loaded from (display only)
	builtIn?: boolean;       // true = non-deletable
}
