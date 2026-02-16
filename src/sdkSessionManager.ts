import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import { SessionService } from './extension/services/SessionService';
import * as os from 'os';
import { ModelCapabilitiesService } from './extension/services/modelCapabilitiesService';
import { PlanModeToolsService } from './extension/services/planModeToolsService';
import { MessageEnhancementService } from './extension/services/messageEnhancementService';
import { FileSnapshotService } from './extension/services/fileSnapshotService';
import { MCPConfigurationService } from './extension/services/mcpConfigurationService';
import { DisposableStore, MutableDisposable, toDisposable } from './utilities/disposable';
import { BufferedEmitter } from './utilities/bufferedEmitter';
import { 
    classifySessionError, 
    checkAuthEnvVars, 
    ErrorType, 
    attemptSessionResumeWithRetry,
    showSessionRecoveryDialog 
} from './authUtils';

// Dynamic import for SDK (ESM module)
let CopilotClient: any;
let CopilotSession: any;
let defineTool: any;

async function loadSDK() {
    if (!CopilotClient) {
        const sdk = await import('@github/copilot-sdk');
        CopilotClient = sdk.CopilotClient;
        CopilotSession = sdk.CopilotSession;
        defineTool = sdk.defineTool;
    }
}

export interface CLIConfig {
    allowAll?: boolean;
    yolo?: boolean;
    allowAllTools?: boolean;
    allowAllPaths?: boolean;
    allowAllUrls?: boolean;
    allowTools?: string[];
    denyTools?: string[];
    allowUrls?: string[];
    denyUrls?: string[];
    addDirs?: string[];
    agent?: string;
    model?: string;
    planModel?: string;
    noAskUser?: boolean;
}

export interface ToolExecutionState {
    toolCallId: string;
    toolName: string;
    arguments?: unknown;
    status: 'pending' | 'running' | 'complete' | 'failed';
    startTime: number;
    endTime?: number;
    result?: string;
    error?: { message: string; code?: string };
    progress?: string;
    intent?: string;  // Intent from the message containing this tool call
}

export interface StatusData {
    status: 'thinking' | 'ready' | 'exited' | 'stopped' | 'aborted' | 'session_expired' | 
            'plan_mode_enabled' | 'plan_mode_disabled' | 'plan_accepted' | 'plan_rejected' | 
            'plan_ready' | 'reset_metrics' | 'session_resume_failed' | 'authentication_required';
    turnId?: string;
    sessionId?: string;  // For session ready
    newSessionId?: string;  // For session_expired
    reason?: string;  // For session_resume_failed
    resetMetrics?: boolean;  // For reset_metrics
    summary?: string | null;  // For plan_ready
}

export interface FileChangeData {
    path: string;
    type: 'created' | 'modified' | 'deleted';
}

export interface DiffData {
    toolCallId: string;
    beforeUri: string;
    afterUri: string;
    title?: string;
}

export interface UsageData {
    remainingPercentage?: number;
    currentTokens?: number;
    tokenLimit?: number;
    messagesLength?: number;
}

type SessionMode = 'work' | 'plan';

export class SDKSessionManager implements vscode.Disposable {
    private client: any | null = null;
    private session: any | null = null;
    private sessionId: string | null = null;
    
    // Disposables management
    private readonly _disposables = new DisposableStore();
    private readonly _sessionSub = this._reg(new MutableDisposable<vscode.Disposable>());
    
    // Granular event emitters (created once, survive session switches)
    private readonly _onDidReceiveOutput = this._reg(new BufferedEmitter<string>());
    readonly onDidReceiveOutput = this._onDidReceiveOutput.event;
    
    private readonly _onDidReceiveReasoning = this._reg(new BufferedEmitter<string>());
    readonly onDidReceiveReasoning = this._onDidReceiveReasoning.event;
    
    private readonly _onDidReceiveError = this._reg(new BufferedEmitter<string>());
    readonly onDidReceiveError = this._onDidReceiveError.event;
    
    private readonly _onDidChangeStatus = this._reg(new BufferedEmitter<StatusData>());
    readonly onDidChangeStatus = this._onDidChangeStatus.event;
    
    private readonly _onDidStartTool = this._reg(new BufferedEmitter<ToolExecutionState>());
    readonly onDidStartTool = this._onDidStartTool.event;
    
    private readonly _onDidUpdateTool = this._reg(new BufferedEmitter<ToolExecutionState>());
    readonly onDidUpdateTool = this._onDidUpdateTool.event;
    
    private readonly _onDidCompleteTool = this._reg(new BufferedEmitter<ToolExecutionState>());
    readonly onDidCompleteTool = this._onDidCompleteTool.event;
    
    private readonly _onDidChangeFile = this._reg(new BufferedEmitter<FileChangeData>());
    readonly onDidChangeFile = this._onDidChangeFile.event;
    
    private readonly _onDidProduceDiff = this._reg(new BufferedEmitter<DiffData>());
    readonly onDidProduceDiff = this._onDidProduceDiff.event;
    
    private readonly _onDidUpdateUsage = this._reg(new BufferedEmitter<UsageData>());
    readonly onDidUpdateUsage = this._onDidUpdateUsage.event;
    
    private logger: Logger;
    private workingDirectory: string;
    private resumeSession: boolean;
    private toolExecutions: Map<string, ToolExecutionState> = new Map();
    private sdkLoaded: boolean = false;
    private lastMessageIntent: string | undefined;  // Store intent from report_intent tool calls
    
    // Plan mode: dual session support
    private currentMode: SessionMode = 'work';
    private workSession: any | null = null;
    private planSession: any | null = null;
    private workSessionId: string | null = null;
    private planModeSnapshot: string | null = null;
    
    // Services
    private modelCapabilitiesService: ModelCapabilitiesService;
    private currentModelId: string | null = null;
    private planModeToolsService: PlanModeToolsService | null = null;
    private messageEnhancementService: MessageEnhancementService;
    private fileSnapshotService: FileSnapshotService;
    private mcpConfigurationService: MCPConfigurationService;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly config: CLIConfig = {},
        resumeLastSession: boolean = true,
        specificSessionId?: string
    ) {
        this.logger = Logger.getInstance();
        this.workingDirectory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        this.logger.info(`Working directory set to: ${this.workingDirectory}`);
        this.resumeSession = resumeLastSession;
        
        // Initialize services
        this.modelCapabilitiesService = new ModelCapabilitiesService();
        this.messageEnhancementService = new MessageEnhancementService();
        this.fileSnapshotService = new FileSnapshotService();
        this.mcpConfigurationService = new MCPConfigurationService(this.workingDirectory);
        
        // If specific session ID provided, use it
        if (specificSessionId) {
            this.sessionId = specificSessionId;
            this.logger.info(`Using specific session: ${this.sessionId}`);
        }
        // Otherwise, if resuming, load the last session ID
        else if (this.resumeSession) {
            this.loadLastSessionId();
        }
    }
    
    private _reg<T extends vscode.Disposable>(d: T): T {
        this._disposables.add(d);
        return d;
    }

    private loadLastSessionId(): void {
        try {
            const filterByFolder = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('filterSessionsByFolder', true);
            const sessionStateDir = path.join(os.homedir(), '.copilot', 'session-state');
            const sessionId = SessionService.getMostRecentSession(sessionStateDir, this.workingDirectory, filterByFolder);
            
            if (sessionId) {
                this.sessionId = sessionId;
                this.logger.info(`Will resume session: ${this.sessionId} (folder filtering: ${filterByFolder})`);
            } else {
                this.logger.info('No previous sessions found, will start new session');
            }
        } catch (error) {
            this.logger.error('Failed to load last session ID', error instanceof Error ? error : undefined);
        }
    }

    /**
     * Attempt to resume a session with retry logic and user recovery dialog
     * 
     * Uses circuit breaker pattern with exponential backoff:
     * - Retries up to 3 times for retriable errors
     * - Shows user dialog if all retries fail
     * - Skips retries for session_expired and authentication errors
     * 
     * @param sessionId - The session ID to resume
     * @param resumeOptions - Options to pass to resumeSession()
     * @returns The resumed session, or a new session if recovery chose that path
     */
    private async attemptSessionResumeWithUserRecovery(
        sessionId: string,
        resumeOptions: any
    ): Promise<any> {
        // Wrap the SDK's resumeSession in a function
        const resumeFn = () => this.client.resumeSession(sessionId, resumeOptions);
        
        // Retry loop for user-driven recovery
        while (true) {
            try {
                // Attempt resume with retry logic
                return await attemptSessionResumeWithRetry(
                    sessionId,
                    resumeFn,
                    this.logger
                );
            } catch (error) {
                // All retries failed - classify error and show user dialog
                const errorType = classifySessionError(error as Error);
                
                this.logger.warn(`[Resume] All retries exhausted, showing user dialog (error type: ${errorType})`);
                
                const userChoice = await showSessionRecoveryDialog(
                    vscode,
                    sessionId,
                    errorType,
                    3, // Max attempts reached
                    error as Error
                );
                
                if (userChoice === 'retry') {
                    // User wants to try again - loop will perform another retry cycle
                    this.logger.info('[Resume] User chose "Try Again", retrying...');
                    continue; // Loop back to retry
                } else {
                    // User wants new session - throw to trigger creation
                    this.logger.info('[Resume] User chose "Start New Session"');
                    throw error;
                }
            }
        }
    }

    public async start(): Promise<void> {
        this.logger.info('Starting SDK Session Manager...');
        
        try {
            // Load SDK dynamically
            if (!this.sdkLoaded) {
                await loadSDK();
                this.sdkLoaded = true;
            }

            // Create CopilotClient
            const cliPath = vscode.workspace.getConfiguration('copilotCLI').get<string>('cliPath');
            const yolo = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('yolo', false);
            
            this.client = new CopilotClient({
                logLevel: 'info',
                ...(cliPath ? { cliPath } : {}),
                ...(yolo ? { cliArgs: ['--yolo'] } : {}),
                cwd: this.workingDirectory,
                autoStart: true,
            });

            this.logger.info('CopilotClient created, initializing session...');
            
            // Initialize model capabilities service with the client
            await this.modelCapabilitiesService.initialize(this.client);

            // Create or resume session
            const mcpServers = this.getEnabledMCPServers();
            const hasMcpServers = Object.keys(mcpServers).length > 0;
            
            this.logger.info(`MCP Servers to configure: ${hasMcpServers ? JSON.stringify(Object.keys(mcpServers)) : 'none'}`);
            if (hasMcpServers) {
                this.logger.debug(`MCP Server details: ${JSON.stringify(mcpServers, null, 2)}`);
            }
            
            // Track whether we created a new session (vs resumed)
            let sessionWasCreatedNew = false;
            
            if (this.sessionId) {
                this.logger.info(`Attempting to resume session: ${this.sessionId}`);
                try {
                    // Use retry logic with user recovery dialog
                    this.session = await this.attemptSessionResumeWithUserRecovery(
                        this.sessionId,
                        {
                            tools: this.getCustomTools(),
                            hooks: this.getSessionHooks(),
                            ...(hasMcpServers ? { mcpServers } : {}),
                        }
                    );
                    this.logger.info('Successfully resumed session');
                } catch (error) {
                    // Session could not be resumed - classify the error
                    const errorType = classifySessionError(error as Error);
                    
                    // Handle authentication errors differently - fail fast, don't create new session
                    if (errorType === 'authentication') {
                        this.logger.error('Authentication failure - cannot resume or create session. User needs to run: gh auth login');
                        this._onDidChangeStatus.fire({ status: 'authentication_required' as any });
                        throw error; // Propagate auth errors - user must fix
                    }
                    
                    // For other errors, create new session
                    this.logger.warn(`Failed to resume session ${this.sessionId} (error type: ${errorType}), creating new session`);
                    this.sessionId = null;
                    sessionWasCreatedNew = true;
                    this.session = await this.client.createSession({
                        model: this.config.model || undefined,
                        tools: this.getCustomTools(),
                        hooks: this.getSessionHooks(),
                        ...(hasMcpServers ? { mcpServers } : {}),
                    });
                    this.sessionId = this.session.sessionId;

                    // Notify user with appropriate status
                    const status = errorType === 'session_expired' ? 'session_expired' : 'session_resume_failed';
                    this._onDidChangeStatus.fire({ 
                        status: status as any, 
                        newSessionId: this.sessionId || undefined,
                        reason: errorType as any
                    });
                }
            } else {
                this.logger.info('Creating new session');
                sessionWasCreatedNew = true;
                this.session = await this.client.createSession({
                    model: this.config.model || undefined,
                    tools: this.getCustomTools(),
                    hooks: this.getSessionHooks(),
                    ...(hasMcpServers ? { mcpServers } : {}),
                });
                this.sessionId = this.session.sessionId;
            }

            this.logger.info(`Session active: ${this.sessionId}`);
            
            // Initialize work session tracking (always starts in work mode)
            this.workSession = this.session;
            this.workSessionId = this.sessionId;
            this.currentMode = 'work';
            
            // Reset session-level metrics for new sessions
            if (sessionWasCreatedNew) {
                this.logger.info('[Metrics] Resetting session-level metrics for new session');
                this._onDidChangeStatus.fire({ status: 'reset_metrics', resetMetrics: true });
            }

            // Set up event listeners
            this.setActiveSession(this.session);
            
            // Fetch model capabilities for vision support
            await this.updateModelCapabilities();

            this._onDidChangeStatus.fire({ 
                status: 'ready', 
                sessionId: this.sessionId || undefined
            });

        } catch (error) {
            this.logger.error('Failed to start SDK session', error instanceof Error ? error : undefined);
            
            // Classify the error for better error handling
            if (error instanceof Error) {
                const errorType = classifySessionError(error);
                const envCheck = checkAuthEnvVars();
                
                // Log classification results
                this.logger.info(`[Auth Detection] Classified as ${errorType} error`);
                if (envCheck.hasEnvVar) {
                    this.logger.info(`[Auth Detection] Found ${envCheck.source} environment variable`);
                } else {
                    this.logger.info('[Auth Detection] No authentication environment variables found');
                }
                
                this.logger.error(`[Auth Detection] Error type: ${errorType}, Has env var: ${envCheck.hasEnvVar}${envCheck.source ? ` (${envCheck.source})` : ''}`);
                
                // Create enhanced error with classification info
                const enhancedError: any = error;
                enhancedError.errorType = errorType;
                enhancedError.hasEnvVar = envCheck.hasEnvVar;
                enhancedError.envVarSource = envCheck.source;
                
                throw enhancedError;
            }
            
            throw error;
        }
    }

    /**
     * Set the active session and wire up event handlers.
     * Consolidates session assignment + event wiring to prevent leaks.
     */
    private setActiveSession(session: any): void {
        this.session = session;
        this.setupSessionEventHandlers();
    }

    private setupSessionEventHandlers(): void {
        if (!this.session) { return; }
        this._sessionSub.value = toDisposable(
            this.session.on((event: any) => this._handleSDKEvent(event))
        );
    }

    private _handleSDKEvent(event: any): void {
        try {
        this.logger.debug(`[SDK Event] ${event.type}: ${JSON.stringify(event.data)}`);

        switch (event.type) {
            case 'assistant.message':
                // Extract intent from report_intent tool if present
                if (event.data.toolRequests && Array.isArray(event.data.toolRequests)) {
                    const reportIntentTool = event.data.toolRequests.find((t: any) => t.name === 'report_intent');
                    if (reportIntentTool && reportIntentTool.arguments?.intent) {
                        this.lastMessageIntent = reportIntentTool.arguments.intent;
                    }

                    // Pre-capture snapshots for edit/create tools BEFORE execution starts.
                    // assistant.message arrives before tool.execution_start, giving us a
                    // reliable window to read the original file content.
                    for (const toolReq of event.data.toolRequests) {
                        if ((toolReq.name === 'edit' || toolReq.name === 'create') && toolReq.arguments?.path) {
                            this.fileSnapshotService.captureByPath(toolReq.name, toolReq.arguments.path);
                        }
                    }
                }
                
                // Only fire output message if there's actual content
                if (event.data.content && event.data.content.trim().length > 0) {
                    this._onDidReceiveOutput.fire(event.data.content);
                }
                break;

            case 'assistant.reasoning':
                this._onDidReceiveReasoning.fire(event.data.content);
                break;

            case 'assistant.message_delta':
                // Streaming message chunks (optional - can enable for real-time streaming)
                break;

            case 'tool.execution_start':
                this.handleToolStart(event);
                break;

            case 'tool.execution_progress':
                this.handleToolProgress(event);
                break;

            case 'tool.execution_complete':
                this.handleToolComplete(event);
                break;

            case 'session.error':
                this._onDidReceiveError.fire(event.data.message);
                break;

            case 'session.start':
            case 'session.resume':
            case 'session.idle':
                this.logger.info(`Session ${event.type}: ${JSON.stringify(event.data)}`);
                break;
            
            case 'assistant.turn_start':
                this.logger.debug(`Assistant turn ${event.data.turnId} started`);
                this._onDidChangeStatus.fire({ status: 'thinking', turnId: event.data.turnId });
                break;
            
            case 'assistant.turn_end':
                this.logger.debug(`Assistant turn ${event.data.turnId} ended`);
                this._onDidChangeStatus.fire({ status: 'ready', turnId: event.data.turnId });
                break;
            
            case 'session.usage_info':
                this.logger.debug(`Token usage: ${event.data.currentTokens}/${event.data.tokenLimit}`);
                this._onDidUpdateUsage.fire({
                    currentTokens: event.data.currentTokens,
                    tokenLimit: event.data.tokenLimit,
                    messagesLength: event.data.messagesLength
                });
                break;
        
            case 'assistant.usage':
                // Request quota information
                if (event.data.quotaSnapshots) {
                    let quota = event.data.quotaSnapshots.premium_interactions;
                    let quotaType = 'premium_interactions';
                    
                    if (!quota) {
                        const quotaKeys = Object.keys(event.data.quotaSnapshots);
                        for (const key of quotaKeys) {
                            const q = event.data.quotaSnapshots[key];
                            if (!q.isUnlimitedEntitlement) {
                                quota = q;
                                quotaType = key;
                                break;
                            }
                        }
                    }
                    
                    if (quota && !quota.isUnlimitedEntitlement) {
                        this.logger.debug(`Quota (${quotaType}): ${quota.remainingPercentage}% remaining`);
                        this._onDidUpdateUsage.fire({ remainingPercentage: quota.remainingPercentage });
                    }
                }
                break;

            default:
                this.logger.debug(`Unhandled event type: ${event.type}`);
        }
        } catch (error) {
            this.logger.error(`[SDK Event] Error handling event "${event?.type}": ${error instanceof Error ? error.message : error}`);
        }
    }

    private handleToolStart(event: any): void {
        try {
            const eventTime = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
            const data = event.data;

            this.logger.info(`[Tool Start] tool=${data.toolName} mode=${this.currentMode} session=${this.sessionId?.substring(0, 8)}`);

            const state: ToolExecutionState = {
                toolCallId: data.toolCallId,
                toolName: data.toolName,
                arguments: data.arguments,
                status: 'running',
                startTime: eventTime,
                intent: this.lastMessageIntent,  // Attach the intent from report_intent
            };

            // Clear intent after first use to prevent it sticking to all subsequent tools
            this.lastMessageIntent = undefined;

            this.toolExecutions.set(data.toolCallId, state);

            // Phase 2: correlate pre-hook snapshot (captured by path) to toolCallId
            if (data.toolName === 'edit' || data.toolName === 'create') {
                const filePath = data.arguments?.path;
                if (filePath) {
                    this.fileSnapshotService.correlateToToolCallId(filePath, data.toolCallId);

                    // Fallback: if onPreToolUse hook didn't fire (e.g. resumed session
                    // originally created without hooks), capture snapshot now.
                    // This has a race condition (file may already be modified), but it's
                    // better than no diff at all.
                    if (!this.fileSnapshotService.getSnapshot(data.toolCallId)) {
                        this.logger.warn(`[FileSnapshot] Hook did not fire for ${data.toolName} — using fallback capture (race possible)`);
                        this.fileSnapshotService.captureByPath(data.toolName, filePath);
                        this.fileSnapshotService.correlateToToolCallId(filePath, data.toolCallId);
                    }
                }
            }

            this._onDidStartTool.fire(state);
        } catch (error) {
            this.logger.error(`[SDK Event] Error in handleToolStart: ${error instanceof Error ? error.message : error}`);
        }
    }

    private handleToolProgress(event: any): void {
        try {
            const data = event.data;
            const state = this.toolExecutions.get(data.toolCallId);
            if (state) {
                state.progress = data.progressMessage;

                this._onDidUpdateTool.fire(state);
            }
        } catch (error) {
            this.logger.error(`[SDK Event] Error in handleToolProgress: ${error instanceof Error ? error.message : error}`);
        }
    }

    private handleToolComplete(event: any): void {
        try {
            const eventTime = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
            const data = event.data;
            const state = this.toolExecutions.get(data.toolCallId);
            if (state) {
                state.status = data.success ? 'complete' : 'failed';
                state.endTime = eventTime;
                state.result = data.result?.content;
                state.error = data.error ? { message: data.error.message, code: data.error.code } : undefined;

                this._onDidCompleteTool.fire(state);

                // Check if this was a file operation
                if (state.toolName === 'edit' || state.toolName === 'create') {
                    this._onDidChangeFile.fire({
                        path: (state.arguments as any)?.path || '',
                        type: state.toolName === 'create' ? 'created' : 'modified'
                    });

                    // If we have a snapshot and operation succeeded, fire diff_available
                    const snapshot = this.fileSnapshotService.getSnapshot(data.toolCallId);
                    if (snapshot && data.success) {
                        const fileName = path.basename(snapshot.originalPath);
                        this._onDidProduceDiff.fire({
                            toolCallId: data.toolCallId,
                            beforeUri: snapshot.tempFilePath,
                            afterUri: snapshot.originalPath,
                            title: `${fileName} (Before ↔ After)`
                        });
                    }
                }
            }
        } catch (error) {
            this.logger.error(`[SDK Event] Error in handleToolComplete: ${error instanceof Error ? error.message : error}`);
        }
    }
    
    
    public cleanupDiffSnapshot(toolCallId: string): void {
        this.fileSnapshotService.cleanupSnapshot(toolCallId);
    }

    /**
     * Provide a callback for custom tools to emit diff events.
     * Avoids circular dependencies by using a single-function interface.
     */
    public getDiffEmitCallback(): (diffData: DiffData) => void {
        return (diffData: DiffData) => {
            this.logger.info(`[Custom Tool Diff] ${diffData.title}`);
            this._onDidProduceDiff.fire(diffData);
        };
    }

    /**
     * Expose FileSnapshotService for extension handlers (e.g., temp cleanup).
     */
    public getFileSnapshotService(): FileSnapshotService {
        return this.fileSnapshotService;
    }

    /**
     * Build the SDK hooks config for session creation/resume.
     * Uses onPreToolUse to capture file snapshots BEFORE tool execution,
     * fixing the race condition where snapshots were captured too late.
     */
    private getSessionHooks(): { onPreToolUse: (input: any, invocation: any) => { permissionDecision: string } } {
        return {
            onPreToolUse: (input: any, _invocation: any) => {
                this.logger.info(`[Hook] onPreToolUse fired: tool=${input.toolName}`);
                if (input.toolName === 'edit' || input.toolName === 'create') {
                    const filePath = (input.toolArgs as any)?.path;
                    if (filePath && !this.fileSnapshotService.getPendingByPath(filePath)) {
                        this.fileSnapshotService.captureByPath(input.toolName, filePath);
                    }
                }
                return { permissionDecision: 'allow' };
            }
        };
    }

    private getCustomTools(): any[] {
        // Plan mode: return tools from PlanModeToolsService
        if (this.currentMode === 'plan') {
            if (!this.planModeToolsService) {
                this.logger.error('[Plan Mode] PlanModeToolsService not initialized!');
                return [];
            }
            return this.planModeToolsService.getTools();
        }
        
        // Work mode: no custom tools (for now)
        return [];
    }
    
    private getEnabledMCPServers(): Record<string, any> {
        const mcpConfig = vscode.workspace.getConfiguration('copilotCLI')
            .get<Record<string, any>>('mcpServers', {});
        return this.mcpConfigurationService.getEnabledMCPServers(mcpConfig);
    }

    public async sendMessage(message: string, attachments?: Array<{type: 'file'; path: string; displayName?: string}>, isRetry: boolean = false): Promise<void> {
        if (!this.session) {
            throw new Error('Session not initialized. Call start() first.');
        }

        this.logger.info(`[sendMessage] mode=${this.currentMode} sessionId=${this.sessionId?.substring(0, 8)} isRetry=${isRetry}`);
        this.logger.info(`Sending message: ${message.substring(0, 100)}...`);
        if (attachments && attachments.length > 0) {
            this.logger.info(`[Attachments] Sending ${attachments.length} attachment(s):`);
            attachments.forEach((att, idx) => {
                this.logger.info(`[Attachments]   ${idx + 1}. ${att.displayName || path.basename(att.path)} (${att.path})`);
            });
            
            // Validate attachments before sending
            const validation = await this.validateAttachments(attachments.map(a => a.path));
            if (!validation.valid) {
                const errorMsg = validation.error || 'Attachment validation failed';
                this.logger.error(`[Attachments] Validation failed: ${errorMsg}`);
                
                // Fire error event to UI
                this._onDidReceiveError.fire(errorMsg);
                
                throw new Error(errorMsg);
            }
        }
        
        // Enhance message with active file context and process @file references
        const enhancedMessage = await this.messageEnhancementService.enhanceMessageWithContext(message);
        
        this.logger.info(`[SDK Call] About to call session.sendAndWait with prompt (first 200 chars): ${enhancedMessage.substring(0, 200)}`);
        
        try {
            // Send message with or without attachments
            const sendOptions: any = { prompt: enhancedMessage };
            if (attachments && attachments.length > 0) {
                sendOptions.attachments = attachments;
            }
            
            await this.session.sendAndWait(sendOptions);
            this.logger.info('Message sent and completed successfully');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // Check if this is a session.idle timeout error
            if (errorMessage.includes('Timeout') && errorMessage.includes('session.idle')) {
                // This is expected for long-running commands - just log it
                this.logger.info(`Session idle timeout (command likely completed): ${errorMessage}`);
                return; // Don't throw or emit error
            }
            
            // Check for session not found / expired errors
            if (errorMessage.includes('does not exist') || 
                errorMessage.includes('Session not found') ||
                errorMessage.includes('session has been deleted') ||
                errorMessage.includes('session is invalid')) {
                
                this.logger.warn('Session appears to have timed out or expired during message sending');
                
                // Get the session ID that failed
                const failedSessionId = this.sessionId;
                
                if (!failedSessionId) {
                    this.logger.error('No session ID available to resume');
                    throw error;
                }
                
                // Preserve current mode before attempting recovery
                const wasPlanMode = this.currentMode === 'plan';
                
                // Destroy the stale session object
                if (this.session) {
                    try {
                        await this.session.destroy();
                    } catch (e) {
                        // Ignore errors destroying expired session
                        this.logger.debug('Error destroying expired session (expected)');
                    }
                    this.session = null;
                }
                
                // Attempt to resume with retry logic and user recovery dialog
                try {
                    const mcpServers = this.getEnabledMCPServers();
                    const hasMcpServers = Object.keys(mcpServers).length > 0;
                    
                    const resumeOptions = {
                        tools: this.getCustomTools(),
                        hooks: this.getSessionHooks(),
                        ...(wasPlanMode ? {
                            availableTools: [
                                'plan_bash_explore',
                                'task_agent_type_explore',
                                'edit_plan_file',
                                'create_plan_file',
                                'update_work_plan',
                                'present_plan',
                                'view',
                                'grep',
                                'glob',
                                'web_fetch',
                                'fetch_copilot_cli_documentation',
                                'report_intent'
                            ]
                        } : {}),
                        ...(hasMcpServers ? { mcpServers } : {}),
                    };
                    
                    this.logger.info(`[Timeout Recovery] Attempting to resume timed-out session ${failedSessionId.substring(0, 8)}...`);
                    this.session = await this.attemptSessionResumeWithUserRecovery(
                        failedSessionId,
                        resumeOptions
                    );
                    
                    // Successfully resumed!
                    this.logger.info(`[Timeout Recovery] ✅ Session resumed successfully`);
                    
                    // Restore session tracking
                    if (wasPlanMode) {
                        this.planSession = this.session;
                        this.sessionId = failedSessionId;
                        this.currentMode = 'plan';
                    } else {
                        this.workSession = this.session;
                        this.sessionId = this.session.sessionId;
                        this.workSessionId = this.sessionId;
                        this.currentMode = 'work';
                    }
                    
                    // Re-setup event handlers for resumed session
                    this.setupSessionEventHandlers();
                    
                    // Retry the original message send
                    this.logger.info('[Timeout Recovery] Retrying original message send...');
                    await this.sendMessage(message, attachments, true); // isRetry=true to avoid infinite loop
                    this.logger.info('[Timeout Recovery] Message sent successfully after resume');
                    return; // Success!
                    
                } catch (resumeError) {
                    // Resume failed (even after retries and user dialog)
                    // Fall through to create new session below
                    const resumeErrorMsg = resumeError instanceof Error ? resumeError.message : String(resumeError);
                    this.logger.warn('[Timeout Recovery] Resume failed, creating new session: ' + resumeErrorMsg);
                }
                
                // If we get here, resume failed - create new session
                const mcpServers = this.getEnabledMCPServers();
                const hasMcpServers = Object.keys(mcpServers).length > 0;
                
                if (wasPlanMode) {
                    // Recreate plan session with restricted tools
                    this.logger.info('Recreating plan mode session...');
                    const planSessionId = `${this.workSessionId}-plan`;
                    
                    this.session = await this.client.createSession({
                        sessionId: planSessionId,
                        model: this.config.planModel || this.config.model || undefined,
                        tools: this.getCustomTools(),
                        hooks: this.getSessionHooks(),
                        availableTools: [
                            'plan_bash_explore',
                            'task_agent_type_explore',
                            'edit_plan_file',
                            'create_plan_file',
                            'update_work_plan',
                            'present_plan',
                            'view',
                            'grep',
                            'glob',
                            'web_fetch',
                            'fetch_copilot_cli_documentation',
                            'report_intent'
                        ],
                        ...(hasMcpServers ? { mcpServers } : {}),
                    });
                    this.planSession = this.session;
                    this.sessionId = planSessionId;
                    // currentMode stays 'plan'
                } else {
                    // Recreate work session with full tools
                    this.logger.info('Recreating work mode session...');
                    
                    this.session = await this.client.createSession({
                        model: this.config.model || undefined,
                        tools: this.getCustomTools(),
                        hooks: this.getSessionHooks(),
                        ...(hasMcpServers ? { mcpServers } : {}),
                    });
                    this.sessionId = this.session.sessionId;

                    // Update work session tracking
                    this.workSession = this.session;
                    this.workSessionId = this.sessionId;
                    this.currentMode = 'work';
                }
                
                // Re-setup event handlers for new session
                this.setActiveSession(this.session);
                
                // Fetch model capabilities for new session
                await this.updateModelCapabilities();
                
                this.logger.info(`Session recreated: ${this.sessionId}`);
                
                // Notify UI about new session
                this._onDidChangeStatus.fire({ status: 'session_expired', newSessionId: this.sessionId || undefined });
                
                // Retry the message once (use flag to prevent infinite loop)
                if (!isRetry) {
                    return this.sendMessage(message, attachments, true);
                } else {
                    throw new Error('Session recreation failed on retry');
                }
            }
            
            // For other errors, log and emit
            this.logger.error('Failed to send message', error instanceof Error ? error : undefined);
            
            // Fire error event to UI
            this._onDidReceiveError.fire(errorMessage);
            
            throw error;
        }
    }

    /**
     * Enhances the user message with active file context and processes @file references
     */

    public async abortMessage(): Promise<void> {
        if (!this.session) {
            throw new Error('Session not initialized. Call start() first.');
        }

        this.logger.info('Aborting current message...');
        
        try {
            await this.session.abort();
            this.logger.info('Message aborted successfully');
            
            // Fire status event to UI
            this._onDidChangeStatus.fire({ status: 'aborted' });
        } catch (error) {
            this.logger.error('Failed to abort message', error instanceof Error ? error : undefined);
            throw error;
        }
    }

    public isRunning(): boolean {
        return this.session !== null;
    }

    public async stop(): Promise<void> {
        this.logger.info('Stopping SDK session manager...');
        
        // MutableDisposable will handle cleanup automatically
        this._sessionSub.value = undefined;
        
        if (this.session) {
            try {
                await this.session.destroy();
            } catch (error) {
                this.logger.error('Error destroying session', error instanceof Error ? error : undefined);
            }
            this.session = null;
        }

        if (this.client) {
            try {
                await this.client.stop();
            } catch (error) {
                this.logger.error('Error stopping client', error instanceof Error ? error : undefined);
            }
            this.client = null;
        }

        this.sessionId = null;
        this.toolExecutions.clear();
        
        // Cleanup all file snapshots via service
        this.fileSnapshotService.cleanupAllSnapshots();

        this._onDidChangeStatus.fire({ status: 'stopped' });
    }

    public async restart(): Promise<void> {
        await this.stop();
        await this.start();
    }

    public getSessionId(): string | null {
        return this.sessionId;
    }
    
    public getCurrentMode(): SessionMode {
        return this.currentMode;
    }
    
    /**
     * Enable plan mode: Create a plan session that can only update the work plan
     * The plan session has ONE tool: update_work_plan
     * All other tools are disabled (read-only mode)
     */
    public async enablePlanMode(): Promise<void> {
        this.logger.info('═══════════════════════════════════════════════════════════');
        this.logger.info('🎯 PLAN MODE SETUP - START');
        this.logger.info('═══════════════════════════════════════════════════════════');
        
        if (this.currentMode === 'plan') {
            this.logger.warn('[Plan Mode] Already in plan mode - aborting');
            return;
        }
        
        if (!this.client) {
            this.logger.error('[Plan Mode] Client not initialized');
            throw new Error('Client not initialized. Call start() first.');
        }
        
        this.logger.info(`[Plan Mode] Step 1/7: Validate preconditions`);
        this.logger.info(`[Plan Mode]   Current mode: ${this.currentMode}`);
        this.logger.info(`[Plan Mode]   Work session ID: ${this.sessionId}`);
        this.logger.info(`[Plan Mode]   Client initialized: ${!!this.client}`);
        
        // Snapshot current plan.md before entering plan mode
        this.logger.info(`[Plan Mode] Step 2/7: Snapshot existing plan.md`);
        try {
            const homeDir = require('os').homedir();
            const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.sessionId!);
            const planPath = path.join(workSessionPath, 'plan.md');
            
            this.logger.info(`[Plan Mode]   Work session path: ${workSessionPath}`);
            this.logger.info(`[Plan Mode]   Plan path: ${planPath}`);
            this.logger.info(`[Plan Mode]   Session directory exists: ${fs.existsSync(workSessionPath)}`);
            this.logger.info(`[Plan Mode]   Plan.md exists: ${fs.existsSync(planPath)}`);
            
            if (fs.existsSync(planPath)) {
                this.planModeSnapshot = await fs.promises.readFile(planPath, 'utf-8');
                this.logger.info(`[Plan Mode]   ✅ Snapshotted plan.md (${this.planModeSnapshot.length} bytes)`);
            } else {
                this.planModeSnapshot = null;
                this.logger.info(`[Plan Mode]   ℹ️  No existing plan.md to snapshot`);
            }
        } catch (error) {
            this.logger.error('[Plan Mode]   ❌ Failed to snapshot plan.md', error instanceof Error ? error : undefined);
            this.planModeSnapshot = null;
        }
        
        // Store reference to work session
        this.logger.info(`[Plan Mode] Step 3/7: Store work session reference`);
        this.workSession = this.session;
        this.workSessionId = this.sessionId;
        this.logger.info(`[Plan Mode]   Work session stored: ${this.workSessionId}`);
        this.logger.info(`[Plan Mode]   Work session object: ${!!this.workSession}`);
        
        // Create plan session with predictable name
        const planSessionId = `${this.workSessionId}-plan`;
        this.logger.info(`[Plan Mode] Step 4/7: Prepare plan session`);
        this.logger.info(`[Plan Mode]   Plan session ID: ${planSessionId}`);
        
        // Switch to plan mode before getting tools (so getCustomTools returns plan tools)
        this.logger.info(`[Plan Mode] Step 5/7: Initialize PlanModeToolsService and switch mode`);
        const previousMode = this.currentMode;
        
        // Create plan mode tools service
        this.planModeToolsService = new PlanModeToolsService(
            this.workSessionId!,
            this.workingDirectory,
            this._onDidChangeStatus,
            this.fileSnapshotService,
            this.getDiffEmitCallback(),
            this.logger
        );
        await this.planModeToolsService.initialize();
        this.logger.info(`[Plan Mode]   ✅ PlanModeToolsService initialized`);
        
        this.currentMode = 'plan';
        this.logger.info(`[Plan Mode]   Mode changed: ${previousMode} → ${this.currentMode}`);
        
        try {
            this.logger.info(`[Plan Mode] Step 6/7: Configure tools and session`);
            
            const mcpServers = this.getEnabledMCPServers();
            const hasMcpServers = Object.keys(mcpServers).length > 0;
            this.logger.info(`[Plan Mode]   MCP servers: ${hasMcpServers ? Object.keys(mcpServers).join(', ') : 'none'}`);
            
            const customTools = this.getCustomTools();
            
            this.logger.info(`[Plan Mode]   ─────────────────────────────────────────────`);
            this.logger.info(`[Plan Mode]   CUSTOM TOOLS (${customTools.length}) - with unique names:`);
            customTools.forEach(tool => {
                this.logger.info(`[Plan Mode]     ✓ ${tool.name} (restricted)`);
            });
            this.logger.info(`[Plan Mode]   ─────────────────────────────────────────────`);
            this.logger.info(`[Plan Mode]   SDK TOOLS: view, grep, glob, web_fetch, fetch_copilot_cli_documentation`);
            this.logger.info(`[Plan Mode]   Note: Only whitelisted tools are available via availableTools`);
            this.logger.info(`[Plan Mode]   ─────────────────────────────────────────────`);
            this.logger.info(`[Plan Mode]   Model: ${this.config.model || 'default'}`);
            this.logger.info(`[Plan Mode]   MCP Servers: ${hasMcpServers ? Object.keys(mcpServers).join(', ') : 'none'}`);
            
            this.logger.info(`[Plan Mode]   ─────────────────────────────────────────────`);
            this.logger.info(`[Plan Mode]   Creating session with configuration:`);
            this.logger.info(`[Plan Mode]     sessionId: ${planSessionId}`);
            this.logger.info(`[Plan Mode]     model: ${this.config.model || 'default'}`);
            this.logger.info(`[Plan Mode]     tools: [${customTools.map(t => t.name).join(', ')}] (custom)`);
            this.logger.info(`[Plan Mode]     availableTools: [${this.planModeToolsService.getAvailableToolNames().join(', ')}]`);
            this.logger.info(`[Plan Mode]     mcpServers: ${hasMcpServers ? 'enabled' : 'disabled'}`);
            this.logger.info(`[Plan Mode]     systemMessage: mode=append (plan mode instructions)`);
            this.logger.info(`[Plan Mode]   ─────────────────────────────────────────────`);
            
            this.planSession = await this.client.createSession({
                sessionId: planSessionId,
                model: this.config.planModel || this.config.model || undefined,
                tools: customTools,
                hooks: this.getSessionHooks(),
                availableTools: this.planModeToolsService.getAvailableToolNames(),
                systemMessage: {
                    mode: 'append',
                    content: this.planModeToolsService.getSystemPrompt(this.workSessionId!)
                },
                ...(hasMcpServers ? { mcpServers } : {}),
            });
            
            this.logger.info(`[Plan Mode]   ✅ Plan session created successfully`);
            
            this.logger.info(`[Plan Mode] Step 7/7: Activate plan session`);
            this.sessionId = planSessionId;
            this.currentMode = 'plan';
            this.logger.info(`[Plan Mode]   Active session changed to: ${this.sessionId}`);
            
            // Setup event listeners for plan session
            this.logger.info(`[Plan Mode]   Setting up event handlers for plan session`);
            this.setActiveSession(this.planSession);
            this.logger.info(`[Plan Mode]   ✅ Event handlers configured`);
            
            // Notify UI
            this.logger.info(`[Plan Mode]   Emitting plan_mode_enabled status event`);
            this._onDidChangeStatus.fire({ status: 'plan_mode_enabled' });
            this.logger.info(`[Plan Mode]   ✅ Status event emitted`);
            
            // Send visual message to chat
            this.logger.info(`[Plan Mode]   Sending visual message to chat`);
            this._onDidReceiveOutput.fire(
                `🎯 **Entered Plan Mode**\n\n` +
                `You can now analyze the codebase and design solutions without modifying files.\n\n` +
                `**To create/update your plan:**\n` +
                `- Ask me to research and create a plan\n` +
                `- I'll use \`update_work_plan\` to save it to your session workspace\n` +
                `- The plan will be available when you return to work mode\n\n` +
                `**Available tools:**\n` +
                `- \`update_work_plan\` - Save/update your implementation plan (recommended)\n` +
                `- \`edit\` (restricted) - Edit plan.md only\n` +
                `- \`create\` (restricted) - Create plan.md only\n` +
                `- \`view\`, \`grep\`, \`glob\` - Read and search files\n` +
                `- \`bash\` (read-only) - Run safe commands like \`ls\`, \`pwd\`, \`git status\`\n` +
                `- \`task(agent_type="explore")\` - Dispatch exploration tasks\n` +
                `- \`web_fetch\` - Fetch documentation\n\n` +
                `Use **Accept** when ready to implement, or **Reject** to discard changes.`
            );
            
            this.logger.info('═══════════════════════════════════════════════════════════');
            this.logger.info('✅ PLAN MODE SETUP - COMPLETE');
            this.logger.info(`   Work session: ${this.workSessionId}`);
            this.logger.info(`   Plan session: ${planSessionId}`);
            this.logger.info(`   Active mode: ${this.currentMode}`);
            this.logger.info('═══════════════════════════════════════════════════════════');
            
        } catch (error) {
            // If creation failed, revert to work mode
            this.logger.error('═══════════════════════════════════════════════════════════');
            this.logger.error('❌ PLAN MODE SETUP - FAILED');
            this.logger.error('═══════════════════════════════════════════════════════════');
            this.logger.error('[Plan Mode] Error during setup:', error instanceof Error ? error : undefined);
            this.logger.error('[Plan Mode] Reverting to work mode...');
            
            this.currentMode = 'work';
            this.session = this.workSession;
            this.sessionId = this.workSessionId;
            
            this.logger.error(`[Plan Mode] Reverted to work mode (session: ${this.workSessionId})`);
            this.logger.error('═══════════════════════════════════════════════════════════');
            throw error;
        }
    }
    
    /**
     * Disable plan mode: Resume the work session
     * The plan session is destroyed (or kept for reference)
     */
    public async disablePlanMode(): Promise<void> {
        if (this.currentMode !== 'plan') {
            this.logger.warn('Not in plan mode');
            return;
        }
        
        this.logger.info('Disabling plan mode...');
        
        // Cleanup plan mode tools service
        if (this.planModeToolsService) {
            this.planModeToolsService.dispose();
            this.planModeToolsService = null;
            this.logger.info('PlanModeToolsService disposed');
        }
        
        // Destroy plan session (could keep it for reference if desired)
        if (this.planSession) {
            try {
                await this.planSession.destroy();
                this.logger.info('Plan session destroyed');
            } catch (error) {
                this.logger.error('Error destroying plan session', error instanceof Error ? error : undefined);
            }
            this.planSession = null;
        }
        
        // Resume work session
        this.sessionId = this.workSessionId;
        this.currentMode = 'work';
        
        this.logger.info(`✅ Plan mode disabled! Resumed work session: ${this.sessionId}`);
        
        // Re-setup event handlers for work session (they were unsubscribed when plan mode started)
        this.setActiveSession(this.workSession);
        
        // Notify UI
        this.logger.info('[Plan Mode] Emitting plan_mode_disabled status event');
        this._onDidChangeStatus.fire({ status: 'plan_mode_disabled' });
        this.logger.info('[Plan Mode] plan_mode_disabled event emitted');
        
        // Send visual message to chat
        this._onDidReceiveOutput.fire('✅ **Exited Plan Mode**\n\nBack to work mode - ready to implement!');
    }
    
    /**
     * Accept the plan: Keep plan.md changes and exit plan mode
     */
    public async acceptPlan(): Promise<void> {
        if (this.currentMode !== 'plan') {
            this.logger.warn('Not in plan mode - cannot accept plan');
            return;
        }
        
        this.logger.info('[Plan Mode] Accepting plan...');
        
        // Clear snapshot (we're keeping the changes)
        this.planModeSnapshot = null;
        
        // Calculate plan path before exiting plan mode
        const homeDir = require('os').homedir();
        const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId!);
        const planPath = path.join(workSessionPath, 'plan.md');
        
        // Send visual message to chat BEFORE exiting plan mode
        this._onDidReceiveOutput.fire('✅ **Plan Accepted**\n\nPlan changes kept. Exiting plan mode...');
        
        // Exit plan mode
        await this.disablePlanMode();
        
        // Notify UI with accept status
        this.logger.info('[Plan Mode] Emitting plan_accepted status event');
        this._onDidChangeStatus.fire({ status: 'plan_accepted' });
        this.logger.info('[Plan Mode] plan_accepted event emitted');
        
        // Auto-inject context message to start implementation
        this.logger.info('[Plan Mode] Auto-injecting implementation context...');
        await this.sendMessage(
            `I just finished planning and accepted the plan. The plan is located at: ${planPath}\n\n` +
            `Please read the plan file and begin implementation. Review the tasks and start executing them.`,
            undefined, // no attachments
            false      // isRetry
        );
        this.logger.info('[Plan Mode] Implementation context injected');
        
        this.logger.info('[Plan Mode] ✅ Plan accepted!');
    }
    
    /**
     * Reject the plan: Restore plan.md from snapshot and exit plan mode
     */
    public async rejectPlan(): Promise<void> {
        if (this.currentMode !== 'plan') {
            this.logger.warn('Not in plan mode - cannot reject plan');
            return;
        }
        
        this.logger.info('[Plan Mode] Rejecting plan...');
        
        // Restore plan.md from snapshot if it exists
        if (this.planModeSnapshot !== null) {
            try {
                const homeDir = require('os').homedir();
                const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId!);
                const planPath = path.join(workSessionPath, 'plan.md');
                
                await fs.promises.writeFile(planPath, this.planModeSnapshot, 'utf-8');
                this.logger.info('[Plan Mode] Restored plan.md from snapshot');
            } catch (error) {
                this.logger.error('[Plan Mode] Failed to restore plan.md', error instanceof Error ? error : undefined);
            }
        }
        
        // Clear snapshot
        this.planModeSnapshot = null;
        
        // Send visual message to chat BEFORE exiting plan mode
        this._onDidReceiveOutput.fire('❌ **Plan Rejected**\n\nChanges discarded. Exiting plan mode...');
        
        // Exit plan mode
        await this.disablePlanMode();
        
        // Notify UI with reject status
        this.logger.info('[Plan Mode] Emitting plan_rejected status event');
        this._onDidChangeStatus.fire({ status: 'plan_rejected' });
        this.logger.info('[Plan Mode] plan_rejected event emitted');
        
        this.logger.info('[Plan Mode] ❌ Plan rejected - changes discarded');
    }

    public getWorkspacePath(): string | undefined {
        return this.session?.workspacePath;
    }
    
    /**
     * Get the work session's workspace path
     * Always returns the work session path, even when in plan mode
     */
    public getWorkSessionWorkspacePath(): string | undefined {
        if (this.currentMode === 'work') {
            return this.session?.workspacePath;
        } else {
            // In plan mode, return work session's workspace
            return this.workSession?.workspacePath;
        }
    }
    
    /**
     * Get the path to plan.md file in the work session's state directory
     * Returns the full file path to plan.md, or undefined if no work session
     */
    public getPlanFilePath(): string | undefined {
        if (!this.workSessionId) {
            return undefined;
        }
        const homeDir = require('os').homedir();
        const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId);
        return path.join(workSessionPath, 'plan.md');
    }
    
    /**
     * Get the list of available tools for the current plan session
     * Used by tests to verify plan mode restrictions
     * @returns Array of tool names that are whitelisted in plan mode, or undefined if not in plan mode
     */
    public getPlanModeAvailableTools(): string[] | undefined {
        if (this.currentMode !== 'plan') {
            return undefined;
        }
        // Return the same whitelist used in enablePlanMode()
        return [
            'plan_bash_explore',
            'task_agent_type_explore',
            'edit_plan_file',
            'create_plan_file',
            'update_work_plan',
            'present_plan',
            'view',
            'grep',
            'glob',
            'web_fetch',
            'fetch_copilot_cli_documentation',
            'report_intent'
        ];
    }

    public getToolExecutions(): ToolExecutionState[] {
        return Array.from(this.toolExecutions.values());
    }
    
    /**
     * Update model capabilities by logging them for current model
     * Called on session start and model changes
     */
    private async updateModelCapabilities(): Promise<void> {
        try {
            // Get model ID from config or session
            this.currentModelId = this.config.model || 'gpt-5'; // Default model
            
            // Log capabilities using the service
            await this.modelCapabilitiesService.logCapabilities(this.currentModelId);
            
        } catch (error) {
            this.logger.error('[Model Capabilities] Failed to fetch model capabilities', error instanceof Error ? error : undefined);
        }
    }
    
    /**
     * Check if current model supports vision/image attachments
     */
    public async supportsVision(): Promise<boolean> {
        if (!this.currentModelId) {
            return false;
        }
        return this.modelCapabilitiesService.supportsVision(this.currentModelId);
    }
    
    /**
     * Get maximum number of images allowed per message for current model
     */
    public async getMaxImages(): Promise<number> {
        if (!this.currentModelId) {
            return 0;
        }
        return this.modelCapabilitiesService.getMaxImages(this.currentModelId);
    }
    
    /**
     * Get maximum image file size in bytes for current model
     */
    public async getMaxImageSize(): Promise<number> {
        if (!this.currentModelId) {
            return 0;
        }
        return this.modelCapabilitiesService.getMaxImageSize(this.currentModelId);
    }
    
    /**
     * Get supported media types for images
     */
    public async getSupportedMediaTypes(): Promise<string[]> {
        if (!this.currentModelId) {
            return [];
        }
        return this.modelCapabilitiesService.getSupportedMediaTypes(this.currentModelId);
    }
    
    /**
     * Get the model capabilities service (for direct access if needed)
     */
    public getModelCapabilitiesService(): ModelCapabilitiesService {
        return this.modelCapabilitiesService;
    }
    
    /**
     * Validate all attachments (delegates to ModelCapabilitiesService)
     * Returns first validation error encountered
     */
    public async validateAttachments(filePaths: string[]): Promise<{ valid: boolean; error?: string }> {
        if (!this.currentModelId) {
            return { valid: false, error: 'No model selected' };
        }
        return this.modelCapabilitiesService.validateAttachments(this.currentModelId, filePaths);
    }

    public dispose(): void {
        this.stop();
        
        // Dispose all services
        this.messageEnhancementService.dispose();
        this.fileSnapshotService.dispose();
        if (this.planModeToolsService) {
            this.planModeToolsService.dispose();
        }
        
        // Dispose all event emitters and subscriptions
        this._disposables.dispose();
    }
}
