import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import { getMostRecentSession } from './sessionUtils';
import { ModelCapabilitiesService } from './modelCapabilitiesService';
import { PlanModeToolsService } from './planModeToolsService';
import { MessageEnhancementService } from './messageEnhancementService';
import { FileSnapshotService } from './fileSnapshotService';
import { MCPConfigurationService } from './mcpConfigurationService';
import { classifySessionError, checkAuthEnvVars, ErrorType } from './authUtils';

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

export interface CLIMessage {
    type: 'output' | 'error' | 'status' | 'file_change' | 'tool_start' | 'tool_complete' | 'tool_progress' | 'reasoning' | 'diff_available' | 'usage_info';
    data: any;
    timestamp: number;
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

type SessionMode = 'work' | 'plan';

export class SDKSessionManager {
    private client: any | null = null;
    private session: any | null = null;
    private sessionId: string | null = null;
    private readonly onMessageEmitter = new vscode.EventEmitter<CLIMessage>();
    public readonly onMessage = this.onMessageEmitter.event;
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
    
    // Event handler cleanup
    private sessionUnsubscribe: (() => void) | null = null;
    
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

    private loadLastSessionId(): void {
        try {
            const filterByFolder = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('filterSessionsByFolder', true);
            const sessionId = getMostRecentSession(this.workingDirectory, filterByFolder);
            
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
            
            // Track whether we're resuming an existing session
            const isResuming = !!this.sessionId;
            let sessionWasCreatedNew = false;
            
            if (this.sessionId) {
                this.logger.info(`Attempting to resume session: ${this.sessionId}`);
                try {
                    this.session = await this.client.resumeSession(this.sessionId, {
                        tools: this.getCustomTools(),
                        ...(hasMcpServers ? { mcpServers } : {}),
                    });
                    this.logger.info('Successfully resumed session');
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    // If session not found (expired/invalid), create a new one
                    if (errorMessage.toLowerCase().includes('session not found') || 
                        errorMessage.toLowerCase().includes('not found') ||
                        errorMessage.toLowerCase().includes('invalid session')) {
                        this.logger.warn(`Session ${this.sessionId} not found (likely expired), creating new session`);
                        this.sessionId = null;
                        sessionWasCreatedNew = true;
                        this.session = await this.client.createSession({
                            model: this.config.model || undefined,
                            tools: this.getCustomTools(),
                            ...(hasMcpServers ? { mcpServers } : {}),
                        });
                        this.sessionId = this.session.sessionId;
                        
                        // Notify user that a new session was created
                        this.onMessageEmitter.fire({
                            type: 'status',
                            data: { status: 'session_expired', newSessionId: this.sessionId },
                            timestamp: Date.now()
                        });
                    } else {
                        // Some other error, rethrow
                        throw error;
                    }
                }
            } else {
                this.logger.info('Creating new session');
                sessionWasCreatedNew = true;
                this.session = await this.client.createSession({
                    model: this.config.model || undefined,
                    tools: this.getCustomTools(),
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
                this.onMessageEmitter.fire({
                    type: 'status',
                    data: { resetMetrics: true },
                    timestamp: Date.now()
                });
            }

            // Set up event listeners
            this.setupSessionEventHandlers();
            
            // Fetch model capabilities for vision support
            await this.updateModelCapabilities();

            this.onMessageEmitter.fire({
                type: 'status',
                data: { status: 'ready', sessionId: this.sessionId },
                timestamp: Date.now()
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

    private setupSessionEventHandlers(): void {
        if (!this.session) {return;}

        // Clean up previous event handler if it exists
        if (this.sessionUnsubscribe) {
            this.sessionUnsubscribe();
            this.sessionUnsubscribe = null;
        }

        // Register new event handler and store unsubscribe function
        this.sessionUnsubscribe = this.session.on((event: any) => {
            this.logger.debug(`[SDK Event] ${event.type}: ${JSON.stringify(event.data)}`);

            switch (event.type) {
                case 'assistant.message':
                    // Extract intent from report_intent tool if present
                    if (event.data.toolRequests && Array.isArray(event.data.toolRequests)) {
                        const reportIntentTool = event.data.toolRequests.find((t: any) => t.name === 'report_intent');
                        if (reportIntentTool && reportIntentTool.arguments?.intent) {
                            this.lastMessageIntent = reportIntentTool.arguments.intent;
                        }
                    }
                    
                    // Only fire output message if there's actual content
                    if (event.data.content && event.data.content.trim().length > 0) {
                        this.onMessageEmitter.fire({
                            type: 'output',
                            data: event.data.content,
                            timestamp: Date.now()
                        });
                    }
                    break;

                case 'assistant.reasoning':
                    // Extended thinking/reasoning from the model
                    this.onMessageEmitter.fire({
                        type: 'reasoning',
                        data: event.data.content,
                        timestamp: Date.now()
                    });
                    break;

                case 'assistant.message_delta':
                    // Streaming message chunks (optional - can enable for real-time streaming)
                    // For now, we'll just wait for the final message
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
                    this.onMessageEmitter.fire({
                        type: 'error',
                        data: event.data.message,
                        timestamp: Date.now()
                    });
                    break;

                case 'session.start':
                case 'session.resume':
                case 'session.idle':
                    this.logger.info(`Session ${event.type}: ${JSON.stringify(event.data)}`);
                    break;
                
                case 'assistant.turn_start':
                    // Assistant is starting to think/respond
                    this.logger.debug(`Assistant turn ${event.data.turnId} started`);
                    this.onMessageEmitter.fire({
                        type: 'status',
                        data: { status: 'thinking', turnId: event.data.turnId },
                        timestamp: Date.now()
                    });
                    break;
                
                case 'assistant.turn_end':
                    // Assistant finished this turn
                    this.logger.debug(`Assistant turn ${event.data.turnId} ended`);
                    this.onMessageEmitter.fire({
                        type: 'status',
                        data: { status: 'ready', turnId: event.data.turnId },
                        timestamp: Date.now()
                    });
                    break;
                
                case 'session.usage_info':
                    // Token usage information
                    this.logger.debug(`Token usage: ${event.data.currentTokens}/${event.data.tokenLimit}`);
                    this.onMessageEmitter.fire({
                        type: 'usage_info',
                        data: {
                            currentTokens: event.data.currentTokens,
                            tokenLimit: event.data.tokenLimit,
                            messagesLength: event.data.messagesLength
                        },
                        timestamp: Date.now()
                    });
                    break;
                
                case 'assistant.usage':
                    // Request quota information
                    if (event.data.quotaSnapshots) {
                        // Prefer premium_interactions quota (the actual limited one)
                        let quota = event.data.quotaSnapshots.premium_interactions;
                        let quotaType = 'premium_interactions';
                        
                        // Fallback: find first non-unlimited quota
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
                        
                        // Only display if we found a limited quota
                        if (quota && !quota.isUnlimitedEntitlement) {
                            this.logger.debug(`Quota (${quotaType}): ${quota.remainingPercentage}% remaining`);
                            this.onMessageEmitter.fire({
                                type: 'usage_info',
                                data: {
                                    remainingPercentage: quota.remainingPercentage
                                },
                                timestamp: Date.now()
                            });
                        } else {
                            this.logger.debug('All quotas unlimited, skipping quota display');
                        }
                    }
                    break;

                default:
                    // Log other events for debugging
                    this.logger.debug(`Unhandled event type: ${event.type}`);
            }
        });
    }

    private handleToolStart(event: any): void {
        const eventTime = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
        const data = event.data;
        
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
        
        // Capture file snapshot for edit/create tools
        this.fileSnapshotService.captureFileSnapshot(data.toolCallId, data.toolName, data.arguments);
        
        this.onMessageEmitter.fire({
            type: 'tool_start',
            data: state,
            timestamp: eventTime
        });
    }

    private handleToolProgress(event: any): void {
        const data = event.data;
        const state = this.toolExecutions.get(data.toolCallId);
        if (state) {
            state.progress = data.progressMessage;
            
            this.onMessageEmitter.fire({
                type: 'tool_progress',
                data: state,
                timestamp: Date.now()
            });
        }
    }

    private handleToolComplete(event: any): void {
        const eventTime = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
        const data = event.data;
        const state = this.toolExecutions.get(data.toolCallId);
        if (state) {
            state.status = data.success ? 'complete' : 'failed';
            state.endTime = eventTime;
            state.result = data.result?.content;
            state.error = data.error ? { message: data.error.message, code: data.error.code } : undefined;
            
            this.onMessageEmitter.fire({
                type: 'tool_complete',
                data: state,
                timestamp: eventTime
            });

            // Check if this was a file operation
            if (state.toolName === 'edit' || state.toolName === 'create') {
                this.onMessageEmitter.fire({
                    type: 'file_change',
                    data: {
                        toolCallId: data.toolCallId,
                        toolName: state.toolName,
                        arguments: state.arguments,
                    },
                    timestamp: Date.now()
                });
                
                // If we have a snapshot and operation succeeded, fire diff_available
                const snapshot = this.fileSnapshotService.getSnapshot(data.toolCallId);
                if (snapshot && data.success) {
                    const fileName = path.basename(snapshot.originalPath);
                    this.onMessageEmitter.fire({
                        type: 'diff_available',
                        data: {
                            toolCallId: data.toolCallId,
                            beforeUri: snapshot.tempFilePath,
                            afterUri: snapshot.originalPath,
                            title: `${fileName} (Before ↔ After)`
                        },
                        timestamp: Date.now()
                    });
                }
            }
        }
    }
    
    
    public cleanupDiffSnapshot(toolCallId: string): void {
        this.fileSnapshotService.cleanupSnapshot(toolCallId);
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
                this.onMessageEmitter.fire({
                    type: 'error',
                    data: errorMsg,
                    timestamp: Date.now()
                });
                
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
                
                this.logger.warn('Session no longer exists, recreating...');
                
                // Preserve current mode before destroying session
                const wasPlanMode = this.currentMode === 'plan';
                
                // Destroy old session and create a new one (but keep the client alive)
                if (this.session) {
                    try {
                        await this.session.destroy();
                    } catch (e) {
                        // Ignore errors destroying expired session
                        this.logger.debug('Error destroying expired session (expected)');
                    }
                    this.session = null;
                }
                
                // Create new session with same client
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
                        ...(hasMcpServers ? { mcpServers } : {}),
                    });
                    this.sessionId = this.session.sessionId;
                    
                    // Update work session tracking
                    this.workSession = this.session;
                    this.workSessionId = this.sessionId;
                    this.currentMode = 'work';
                }
                
                // Re-setup event handlers for new session
                this.setupSessionEventHandlers();
                
                // Fetch model capabilities for new session
                await this.updateModelCapabilities();
                
                this.logger.info(`Session recreated: ${this.sessionId}`);
                
                // Notify UI about new session
                this.onMessageEmitter.fire({
                    type: 'status',
                    data: { status: 'session_expired', newSessionId: this.sessionId },
                    timestamp: Date.now()
                });
                
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
            this.onMessageEmitter.fire({
                type: 'error',
                data: errorMessage,
                timestamp: Date.now()
            });
            
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
            this.onMessageEmitter.fire({
                type: 'status',
                data: { status: 'aborted' },
                timestamp: Date.now()
            });
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
        
        // Clean up event handler
        if (this.sessionUnsubscribe) {
            this.sessionUnsubscribe();
            this.sessionUnsubscribe = null;
        }
        
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

        this.onMessageEmitter.fire({
            type: 'status',
            data: { status: 'stopped' },
            timestamp: Date.now()
        });
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
            this.onMessageEmitter,
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
            this.logger.info(`[Plan Mode]     availableTools: [plan_bash_explore, task_agent_type_explore, edit_plan_file, create_plan_file, update_work_plan, present_plan, view, grep, glob, web_fetch, fetch_copilot_cli_documentation]`);
            this.logger.info(`[Plan Mode]     mcpServers: ${hasMcpServers ? 'enabled' : 'disabled'}`);
            this.logger.info(`[Plan Mode]     systemMessage: mode=append (plan mode instructions)`);
            this.logger.info(`[Plan Mode]   ─────────────────────────────────────────────`);
            
            this.planSession = await this.client.createSession({
                sessionId: planSessionId,
                model: this.config.planModel || this.config.model || undefined,
                tools: customTools,
                availableTools: [
                    // Custom restricted tools (6)
                    'plan_bash_explore',           // restricted bash for read-only commands
                    'task_agent_type_explore',     // restricted task for exploration only
                    'edit_plan_file',              // edit ONLY plan.md
                    'create_plan_file',            // create ONLY plan.md
                    'update_work_plan',            // update plan content
                    'present_plan',                // present plan to user for acceptance
                    // Safe SDK tools (5)
                    'view',                        // read files
                    'grep',                        // search content
                    'glob',                        // find files
                    'web_fetch',                   // fetch URLs
                    'fetch_copilot_cli_documentation', // get CLI docs
                    'report_intent'                // report intent to UI
                ],
                systemMessage: {
                    mode: 'append',
                    content: `

---
🎯 **YOU ARE IN PLAN MODE** 🎯
---

Your role is to PLAN, not to implement. You have the following capabilities:

**YOUR PLAN LOCATION:**
Your plan is stored at: \`${path.join(require('os').homedir(), '.copilot', 'session-state', this.workSessionId!)}/plan.md\`
This is your dedicated workspace for planning.

**AVAILABLE TOOLS IN PLAN MODE (11 total):**

*Plan Management Tools:*
- \`update_work_plan\` - **PRIMARY TOOL** for creating/updating your implementation plan
- \`present_plan\` - **REQUIRED AFTER PLANNING** to present the plan to the user for review
- \`create_plan_file\` - Create plan.md if it doesn't exist (restricted to plan.md only)
- \`edit_plan_file\` - Edit plan.md (restricted to plan.md only)

*Exploration Tools:*
- \`view\` - Read file contents
- \`grep\` - Search in files
- \`glob\` - Find files by pattern
- \`plan_bash_explore\` - Execute read-only shell commands (git status, ls, cat, etc.)
- \`task_agent_type_explore\` - Dispatch exploration sub-agents (agent_type="explore" only)

*Documentation Tools:*
- \`web_fetch\` - Fetch web pages and documentation
- \`fetch_copilot_cli_documentation\` - Get Copilot CLI documentation

**CRITICAL: HOW TO CREATE YOUR PLAN**
You MUST use ONLY these tools to create/update your plan:

1. **update_work_plan** (PREFERRED) - Use this to create or update your plan:
   \`\`\`
   update_work_plan({ content: "# Plan\\n\\n## Problem...\\n\\n## Tasks\\n- [ ] Task 1" })
   \`\`\`

2. **present_plan** (REQUIRED) - After finalizing your plan, call this to present it to the user:
   \`\`\`
   present_plan({ summary: "Plan for implementing feature X" })
   \`\`\`
   This notifies the user that the plan is ready for review and acceptance.

3. **create_plan_file** (FALLBACK) - Only if update_work_plan fails, use create_plan_file with the exact path:
   \`\`\`
   create_plan_file({ 
     path: "${path.join(require('os').homedir(), '.copilot', 'session-state', this.workSessionId!)}/plan.md",
     file_text: "# Plan\\n\\n## Problem..."
   })
   \`\`\`

**WORKFLOW:**
1. Explore and analyze the codebase
2. Create/update your plan using \`update_work_plan\`
3. When the plan is complete and ready for user review, call \`present_plan\`
4. The user will then review and either accept, request changes, or provide new instructions

❌ DO NOT try to create files in /tmp or anywhere else
❌ DO NOT use bash to create the plan
✅ ALWAYS use update_work_plan to create/update the plan
✅ ALWAYS call present_plan when the plan is ready for review

**WHAT YOU CAN DO:**
- Analyze the codebase and understand requirements (use view, grep, glob tools)
- Ask questions to clarify the task (use ask_user if available)
- Research and explore the code structure (use task_agent_type_explore with agent_type="explore")
- Fetch documentation and web resources (use web_fetch)
- Run read-only commands to understand the environment (git status, ls, cat, etc. via plan_bash_explore)
- Design solutions and consider alternatives
- **Create and update implementation plans using update_work_plan**
- Document your thinking and reasoning

**WHAT YOU CANNOT DO:**
- You CANNOT use edit or other file modification tools (except for plan.md via update_work_plan/create)
- You CANNOT execute write commands (no npm install, git commit, rm, mv, etc.)
- You CANNOT make changes to the codebase
- You are in READ-ONLY mode for code

**BASH COMMAND RESTRICTIONS (ENFORCED):**
The bash tool is restricted to read-only commands. Attempts to run write commands will be automatically blocked.

Allowed commands:
- git status, git log, git branch, git diff, git show
- ls, cat, head, tail, wc, find, grep, tree, pwd
- npm list, pip list, go list
- which, whereis, ps, env, echo, date, uname

Blocked commands (will be rejected):
- git commit, git push, git checkout, git merge
- rm, mv, cp, touch, mkdir
- npm install, npm run, make, build commands
- sudo, chmod, chown

Your plan should include:
1. **Problem Statement**: Clear description of what needs to be done
2. **Approach**: Proposed solution and why it's the best approach
3. **Tasks**: Step-by-step implementation tasks with checkboxes [ ]
4. **Technical Considerations**: Important details, risks, dependencies
5. **Testing Strategy**: How to verify the implementation works

When the user is satisfied with the plan, they will toggle back to WORK MODE to implement it.
Remember: Your job is to think deeply and plan thoroughly, not to code!
`
                },
                ...(hasMcpServers ? { mcpServers } : {}),
            });
            
            this.logger.info(`[Plan Mode]   ✅ Plan session created successfully`);
            
            this.logger.info(`[Plan Mode] Step 7/7: Activate plan session`);
            this.session = this.planSession;
            this.sessionId = planSessionId;
            this.logger.info(`[Plan Mode]   Active session changed to: ${this.sessionId}`);
            
            // Setup event listeners for plan session
            this.logger.info(`[Plan Mode]   Setting up event handlers for plan session`);
            this.setupSessionEventHandlers();
            this.logger.info(`[Plan Mode]   ✅ Event handlers configured`);
            
            // Notify UI
            this.logger.info(`[Plan Mode]   Emitting plan_mode_enabled status event`);
            this.onMessageEmitter.fire({
                type: 'status',
                data: { 
                    status: 'plan_mode_enabled',
                    planSessionId: planSessionId,
                    workSessionId: this.workSessionId
                },
                timestamp: Date.now()
            });
            this.logger.info(`[Plan Mode]   ✅ Status event emitted`);
            
            // Send visual message to chat
            this.logger.info(`[Plan Mode]   Sending visual message to chat`);
            this.onMessageEmitter.fire({
                type: 'output',
                data: `🎯 **Entered Plan Mode**

You can now analyze the codebase and design solutions without modifying files.

**To create/update your plan:**
- Ask me to research and create a plan
- I'll use \`update_work_plan\` to save it to your session workspace
- The plan will be available when you return to work mode

**Available tools:**
- \`update_work_plan\` - Save/update your implementation plan (recommended)
- \`edit\` (restricted) - Edit plan.md only
- \`create\` (restricted) - Create plan.md only
- \`view\`, \`grep\`, \`glob\` - Read and search files
- \`bash\` (read-only) - Run safe commands like \`ls\`, \`pwd\`, \`git status\`
- \`task(agent_type="explore")\` - Dispatch exploration tasks
- \`web_fetch\` - Fetch documentation

Use **Accept** when ready to implement, or **Reject** to discard changes.`,
                timestamp: Date.now()
            });
            
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
        this.session = this.workSession;
        this.sessionId = this.workSessionId;
        this.currentMode = 'work';
        
        this.logger.info(`✅ Plan mode disabled! Resumed work session: ${this.sessionId}`);
        
        // Re-setup event handlers for work session (they were unsubscribed when plan mode started)
        this.setupSessionEventHandlers();
        
        // Notify UI
        this.logger.info('[Plan Mode] Emitting plan_mode_disabled status event');
        this.onMessageEmitter.fire({
            type: 'status',
            data: { 
                status: 'plan_mode_disabled',
                workSessionId: this.sessionId
            },
            timestamp: Date.now()
        });
        this.logger.info('[Plan Mode] plan_mode_disabled event emitted');
        
        // Send visual message to chat
        this.onMessageEmitter.fire({
            type: 'output',
            data: '✅ **Exited Plan Mode**\n\nBack to work mode - ready to implement!',
            timestamp: Date.now()
        });
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
        this.onMessageEmitter.fire({
            type: 'output',
            data: '✅ **Plan Accepted**\n\nPlan changes kept. Exiting plan mode...',
            timestamp: Date.now()
        });
        
        // Exit plan mode
        await this.disablePlanMode();
        
        // Notify UI with accept status
        this.logger.info('[Plan Mode] Emitting plan_accepted status event');
        this.onMessageEmitter.fire({
            type: 'status',
            data: { 
                status: 'plan_accepted',
                workSessionId: this.sessionId
            },
            timestamp: Date.now()
        });
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
        this.onMessageEmitter.fire({
            type: 'output',
            data: '❌ **Plan Rejected**\n\nChanges discarded. Exiting plan mode...',
            timestamp: Date.now()
        });
        
        // Exit plan mode
        await this.disablePlanMode();
        
        // Notify UI with reject status
        this.logger.info('[Plan Mode] Emitting plan_rejected status event');
        this.onMessageEmitter.fire({
            type: 'status',
            data: { 
                status: 'plan_rejected',
                workSessionId: this.sessionId
            },
            timestamp: Date.now()
        });
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
        // MCPConfigurationService has no dispose method (no resources to clean up)
        if (this.planModeToolsService) {
            this.planModeToolsService.dispose();
        }
        
        this.onMessageEmitter.dispose();
    }
}
