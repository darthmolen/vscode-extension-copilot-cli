import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import { getMostRecentSession } from './sessionUtils';

// Dynamic import for SDK (ESM module)
let CopilotClient: any;
let CopilotSession: any;

async function loadSDK() {
    if (!CopilotClient) {
        const sdk = await import('@github/copilot-sdk');
        CopilotClient = sdk.CopilotClient;
        CopilotSession = sdk.CopilotSession;
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

interface FileSnapshot {
    originalPath: string;
    tempFilePath: string;
    timestamp: number;
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
    private fileSnapshots: Map<string, FileSnapshot> = new Map();
    private tempDir: string;
    
    // Plan mode: dual session support
    private currentMode: SessionMode = 'work';
    private workSession: any | null = null;
    private planSession: any | null = null;
    private workSessionId: string | null = null;

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
        
        // Set up temp directory for file snapshots
        this.tempDir = context.globalStorageUri.fsPath;
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        
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

            // Create or resume session
            const mcpServers = this.getEnabledMCPServers();
            const hasMcpServers = Object.keys(mcpServers).length > 0;
            
            this.logger.info(`MCP Servers to configure: ${hasMcpServers ? JSON.stringify(Object.keys(mcpServers)) : 'none'}`);
            if (hasMcpServers) {
                this.logger.debug(`MCP Server details: ${JSON.stringify(mcpServers, null, 2)}`);
            }
            
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

            // Set up event listeners
            this.setupSessionEventHandlers();

            this.onMessageEmitter.fire({
                type: 'status',
                data: { status: 'ready', sessionId: this.sessionId },
                timestamp: Date.now()
            });

        } catch (error) {
            this.logger.error('Failed to start SDK session', error instanceof Error ? error : undefined);
            throw error;
        }
    }

    private setupSessionEventHandlers(): void {
        if (!this.session) {return;}

        this.session.on((event: any) => {
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
                        // Get the first quota snapshot (typically there's only one)
                        const quotaKeys = Object.keys(event.data.quotaSnapshots);
                        if (quotaKeys.length > 0) {
                            const quota = event.data.quotaSnapshots[quotaKeys[0]];
                            this.logger.debug(`Quota: ${quota.remainingPercentage}% remaining`);
                            this.onMessageEmitter.fire({
                                type: 'usage_info',
                                data: {
                                    remainingPercentage: quota.remainingPercentage
                                },
                                timestamp: Date.now()
                            });
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
        
        this.toolExecutions.set(data.toolCallId, state);
        
        // Capture file snapshot for edit/create tools
        this.captureFileSnapshot(data.toolCallId, data.toolName, data.arguments);
        
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
                const snapshot = this.fileSnapshots.get(data.toolCallId);
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
    
    private captureFileSnapshot(toolCallId: string, toolName: string, args: any): void {
        // Only capture for edit and create tools
        if (toolName !== 'edit' && toolName !== 'create') {
            return;
        }
        
        try {
            // Extract file path from arguments
            const filePath = (args as any)?.path;
            if (!filePath) {
                this.logger.debug(`No path in ${toolName} tool arguments`);
                return;
            }
            
            // For edit: file should exist, read it
            // For create: file won't exist, create empty snapshot
            let content = '';
            const fileExists = fs.existsSync(filePath);
            
            this.logger.info(`[Snapshot] ${toolName} for ${filePath}, file exists: ${fileExists}`);
            
            if (toolName === 'edit') {
                if (fileExists) {
                    content = fs.readFileSync(filePath, 'utf8');
                    this.logger.info(`[Snapshot] Captured ${content.length} bytes: ${JSON.stringify(content.substring(0, 100))}`);
                } else {
                    this.logger.warn(`[Snapshot] File doesn't exist for edit operation: ${filePath}`);
                }
            } else {
                this.logger.info(`[Snapshot] Create operation, using empty snapshot`);
            }
            
            // Write to temp file
            const tempFileName = `${toolCallId}-before-${path.basename(filePath)}`;
            const tempFilePath = path.join(this.tempDir, tempFileName);
            fs.writeFileSync(tempFilePath, content, 'utf8');
            
            // Store snapshot
            this.fileSnapshots.set(toolCallId, {
                originalPath: filePath,
                tempFilePath: tempFilePath,
                timestamp: Date.now()
            });
            
            this.logger.debug(`Captured file snapshot for ${toolName}: ${filePath} -> ${tempFilePath}`);
        } catch (error) {
            this.logger.error(`Failed to capture file snapshot: ${error}`);
        }
    }
    
    public cleanupDiffSnapshot(toolCallId: string): void {
        const snapshot = this.fileSnapshots.get(toolCallId);
        if (snapshot) {
            try {
                if (fs.existsSync(snapshot.tempFilePath)) {
                    fs.unlinkSync(snapshot.tempFilePath);
                }
                this.fileSnapshots.delete(toolCallId);
                this.logger.debug(`Cleaned up snapshot for ${toolCallId}`);
            } catch (error) {
                this.logger.error(`Failed to cleanup snapshot: ${error}`);
            }
        }
    }

    private getCustomTools(): any[] {
        // Plan mode: return plan-specific tool
        if (this.currentMode === 'plan') {
            return [this.createUpdateWorkPlanTool()];
        }
        
        // Work mode: no custom tools (for now)
        return [];
    }
    
    /**
     * Creates the update_work_plan tool for plan mode
     * This is the ONLY tool available in plan sessions
     * Writes directly to the work session's plan.md file
     */
    private createUpdateWorkPlanTool(): any {
        return {
            name: 'update_work_plan',
            description: 'Update the implementation plan for the work session. Use this to document your planning, analysis, and design work. This plan will be available when switching back to work mode.',
            parameters: {
                type: 'object',
                properties: {
                    content: {
                        type: 'string',
                        description: 'The complete plan content in markdown format. Should include problem statement, approach, tasks with checkboxes, and technical considerations.'
                    }
                },
                required: ['content']
            },
            handler: async (args: { content: string }, invocation: any) => {
                try {
                    const homeDir = require('os').homedir();
                    const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId!);
                    const planPath = path.join(workSessionPath, 'plan.md');
                    
                    this.logger.info(`[Plan Mode] Updating work plan at: ${planPath}`);
                    
                    // Ensure session directory exists
                    if (!fs.existsSync(workSessionPath)) {
                        this.logger.warn(`[Plan Mode] Work session directory doesn't exist: ${workSessionPath}`);
                        return {
                            textResultForLlm: `Error: Work session directory not found. Session may not exist yet.`,
                            resultType: 'failure'
                        };
                    }
                    
                    // Write the plan
                    await fs.promises.writeFile(planPath, args.content, 'utf-8');
                    
                    this.logger.info(`[Plan Mode] Plan updated successfully (${args.content.length} bytes)`);
                    
                    return {
                        textResultForLlm: `Plan updated successfully! The plan has been saved to ${planPath}. When you switch back to work mode, this plan will be ready for implementation.`,
                        resultType: 'success'
                    };
                } catch (error) {
                    this.logger.error(`[Plan Mode] Failed to update work plan:`, error instanceof Error ? error : undefined);
                    return {
                        textResultForLlm: `Error updating plan: ${error instanceof Error ? error.message : String(error)}`,
                        resultType: 'failure',
                        error: error instanceof Error ? error.message : String(error)
                    };
                }
            }
        };
    }
    
    private getEnabledMCPServers(): Record<string, any> {
        const mcpConfig = vscode.workspace.getConfiguration('copilotCLI')
            .get<Record<string, any>>('mcpServers', {});
        
        // Filter to only enabled servers
        const enabled: Record<string, any> = {};
        for (const [name, config] of Object.entries(mcpConfig)) {
            if (config && config.enabled !== false) {
                // Remove the 'enabled' field before passing to SDK
                const { enabled: _, ...serverConfig } = config;
                
                // Expand ${workspaceFolder} variables
                const expandedConfig = this.expandVariables(serverConfig);
                enabled[name] = expandedConfig;
            }
        }
        
        if (Object.keys(enabled).length > 0) {
            this.logger.info(`MCP Servers configured: ${Object.keys(enabled).join(', ')}`);
        }
        
        return enabled;
    }
    
    private expandVariables(obj: any): any {
        if (typeof obj === 'string') {
            // Expand ${workspaceFolder}
            const expanded = obj.replace(/\$\{workspaceFolder\}/g, this.workingDirectory);
            if (expanded !== obj) {
                this.logger.debug(`Expanded: "${obj}" -> "${expanded}"`);
            }
            return expanded;
        } else if (Array.isArray(obj)) {
            return obj.map(item => this.expandVariables(item));
        } else if (obj && typeof obj === 'object') {
            const expanded: any = {};
            for (const [key, value] of Object.entries(obj)) {
                expanded[key] = this.expandVariables(value);
            }
            return expanded;
        }
        return obj;
    }

    public async sendMessage(message: string): Promise<void> {
        if (!this.session) {
            throw new Error('Session not initialized. Call start() first.');
        }

        this.logger.info(`Sending message: ${message.substring(0, 100)}...`);
        
        try {
            await this.session.sendAndWait({ prompt: message });
            this.logger.info('Message sent and completed successfully');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // Check if this is a session.idle timeout error
            if (errorMessage.includes('Timeout') && errorMessage.includes('session.idle')) {
                // This is expected for long-running commands - just log it
                this.logger.info(`Session idle timeout (command likely completed): ${errorMessage}`);
                return; // Don't throw or emit error
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
        
        // Cleanup all file snapshots
        this.fileSnapshots.forEach(snapshot => {
            try {
                if (fs.existsSync(snapshot.tempFilePath)) {
                    fs.unlinkSync(snapshot.tempFilePath);
                }
            } catch (error) {
                this.logger.error(`Failed to cleanup snapshot: ${error}`);
            }
        });
        this.fileSnapshots.clear();

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
        if (this.currentMode === 'plan') {
            this.logger.warn('Already in plan mode');
            return;
        }
        
        if (!this.client) {
            throw new Error('Client not initialized. Call start() first.');
        }
        
        this.logger.info('Enabling plan mode...');
        
        // Store reference to work session
        this.workSession = this.session;
        this.workSessionId = this.sessionId;
        
        // Create plan session with predictable name
        const planSessionId = `${this.workSessionId}-plan`;
        this.logger.info(`Creating plan session: ${planSessionId}`);
        
        // Switch to plan mode before getting tools (so getCustomTools returns plan tool)
        this.currentMode = 'plan';
        
        try {
            const mcpServers = this.getEnabledMCPServers();
            const hasMcpServers = Object.keys(mcpServers).length > 0;
            
            this.planSession = await this.client.createSession({
                sessionId: planSessionId,
                model: this.config.model || undefined,
                tools: this.getCustomTools(), // Returns only update_work_plan tool
                availableTools: ['update_work_plan'], // Whitelist: ONLY this tool
                systemMessage: {
                    mode: 'append',
                    content: `

---
🎯 **YOU ARE IN PLAN MODE** 🎯
---

Your role is to PLAN, not to implement. You have the following capabilities:

**WHAT YOU CAN DO:**
- Analyze the codebase and understand requirements
- Ask questions to clarify the task
- Research and explore the code structure
- Design solutions and consider alternatives
- Create detailed implementation plans
- Document your thinking and reasoning

**WHAT YOU CANNOT DO:**
- You CANNOT modify files (no edit/create/delete tools)
- You CANNOT execute shell commands
- You CANNOT make changes to the codebase
- You are in READ-ONLY mode for code

**HOW TO DOCUMENT YOUR PLAN:**
Use the \`update_work_plan\` tool to write your implementation plan. This plan will be saved to the work session's plan.md file and will be available when the user switches back to work mode.

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
            
            this.session = this.planSession;
            this.sessionId = planSessionId;
            
            this.logger.info(`✅ Plan mode enabled! Session: ${planSessionId}`);
            this.logger.info(`Work session ${this.workSessionId} preserved for when plan mode is disabled`);
            
            // Setup event listeners for plan session
            this.setupSessionEventHandlers();
            
            // Notify UI
            this.onMessageEmitter.fire({
                type: 'status',
                data: { 
                    status: 'plan_mode_enabled',
                    planSessionId: planSessionId,
                    workSessionId: this.workSessionId
                },
                timestamp: Date.now()
            });
            
        } catch (error) {
            // If creation failed, revert to work mode
            this.currentMode = 'work';
            this.session = this.workSession;
            this.sessionId = this.workSessionId;
            this.logger.error('Failed to enable plan mode', error instanceof Error ? error : undefined);
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
        
        // Setup event listeners for work session (in case they were changed)
        this.setupSessionEventHandlers();
        
        // Notify UI
        this.onMessageEmitter.fire({
            type: 'status',
            data: { 
                status: 'plan_mode_disabled',
                workSessionId: this.sessionId
            },
            timestamp: Date.now()
        });
    }

    public getWorkspacePath(): string | undefined {
        return this.session?.workspacePath;
    }

    public getToolExecutions(): ToolExecutionState[] {
        return Array.from(this.toolExecutions.values());
    }

    public dispose(): void {
        this.stop();
        this.onMessageEmitter.dispose();
    }
}
