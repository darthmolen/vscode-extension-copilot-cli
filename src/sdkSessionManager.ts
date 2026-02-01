import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import { getMostRecentSession } from './sessionUtils';

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
    private planModeSnapshot: string | null = null;
    
    // Event handler cleanup
    private sessionUnsubscribe: (() => void) | null = null;

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
        // Plan mode: return plan-specific tools
        if (this.currentMode === 'plan') {
            return [
                this.createUpdateWorkPlanTool(),
                this.createRestrictedBashTool(),
                this.createRestrictedCreateTool(),
                this.createRestrictedEditTool(),
                this.createRestrictedTaskTool()
                // Note: SDK 'view', 'grep', 'glob' etc. remain available
            ];
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
        return defineTool('update_work_plan', {
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
            handler: async ({ content }: { content: string }) => {
                try {
                    const homeDir = require('os').homedir();
                    const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId!);
                    const planPath = path.join(workSessionPath, 'plan.md');
                    
                    this.logger.info(`[Plan Mode] Updating work plan at: ${planPath}`);
                    
                    // Ensure session directory exists
                    if (!fs.existsSync(workSessionPath)) {
                        this.logger.warn(`[Plan Mode] Work session directory doesn't exist: ${workSessionPath}`);
                        return `Error: Work session directory not found. Session may not exist yet.`;
                    }
                    
                    // Write the plan
                    await fs.promises.writeFile(planPath, content, 'utf-8');
                    
                    this.logger.info(`[Plan Mode] Plan updated successfully (${content.length} bytes)`);
                    
                    return `Plan updated successfully! The plan has been saved to ${planPath}. When you switch back to work mode, this plan will be ready for implementation.`;
                } catch (error) {
                    this.logger.error(`[Plan Mode] Failed to update work plan:`, error instanceof Error ? error : undefined);
                    return `Error updating plan: ${error instanceof Error ? error.message : String(error)}`;
                }
            }
        });
    }
    
    /**
     * Creates a restricted bash tool for plan mode
     * Only allows read-only commands
     */
    private createRestrictedBashTool(): any {
        const allowedCommandPrefixes = [
            'git status', 'git log', 'git branch', 'git diff', 'git show',
            'ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'tree', 'pwd',
            'npm list', 'pip list', 'pip show', 'go list', 'go mod graph',
            'which', 'whereis', 'ps', 'env', 'echo', 'date', 'uname'
        ];
        
        const blockedCommandPrefixes = [
            'git commit', 'git push', 'git checkout', 'git merge', 'git rebase', 'git cherry-pick',
            'rm', 'mv', 'cp', 'touch', 'mkdir', 'rmdir',
            'npm install', 'npm uninstall', 'npm run', 'npm start', 'npm test',
            'pip install', 'pip uninstall',
            'go get', 'go install',
            'make', 'cmake', 'cargo build', 'dotnet build',
            'sudo', 'su', 'chmod', 'chown'
        ];
        
        return defineTool('plan_bash_explore', {
            description: 'Execute READ-ONLY bash commands to analyze the environment. Only whitelisted commands are allowed in plan mode.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The bash command to execute (read-only commands only)'
                    },
                    description: {
                        type: 'string',
                        description: 'Description of what the command does'
                    }
                },
                required: ['command', 'description']
            },
            handler: async (args: { command: string; description: string }) => {
                const command = args.command.trim();
                
                // Check if command starts with a blocked prefix
                for (const blocked of blockedCommandPrefixes) {
                    if (command.startsWith(blocked)) {
                        this.logger.warn(`[Plan Mode] Blocked bash command: ${command}`);
                        return {
                            textResultForLlm: `❌ Command blocked in plan mode: "${command}"\n\nThis command is not allowed because it could modify the system. Plan mode is read-only.\n\nAllowed commands: ${allowedCommandPrefixes.join(', ')}`,
                            resultType: 'denied'
                        };
                    }
                }
                
                // Check if command starts with an allowed prefix
                let isAllowed = false;
                for (const allowed of allowedCommandPrefixes) {
                    if (command.startsWith(allowed)) {
                        isAllowed = true;
                        break;
                    }
                }
                
                if (!isAllowed) {
                    this.logger.warn(`[Plan Mode] Unknown bash command (not in whitelist): ${command}`);
                    return {
                        textResultForLlm: `❌ Command not in whitelist: "${command}"\n\nIn plan mode, only read-only commands are allowed.\n\nAllowed commands: ${allowedCommandPrefixes.join(', ')}`,
                        resultType: 'denied'
                    };
                }
                
                // Command is allowed - execute it
                this.logger.info(`[Plan Mode] Executing allowed bash command: ${command}`);
                
                try {
                    const { exec } = require('child_process');
                    const { promisify } = require('util');
                    const execAsync = promisify(exec);
                    
                    const result = await execAsync(command, {
                        cwd: this.workingDirectory,
                        timeout: 30000, // 30 second timeout
                        maxBuffer: 1024 * 1024 // 1MB buffer
                    });
                    
                    const output = result.stdout + result.stderr;
                    this.logger.info(`[Plan Mode] Bash command completed (${output.length} bytes)`);
                    
                    return {
                        textResultForLlm: output || '(command completed with no output)',
                        resultType: 'success'
                    };
                } catch (error: any) {
                    this.logger.error(`[Plan Mode] Bash command failed:`, error);
                    return {
                        textResultForLlm: `Command failed: ${error.message}\n\nStderr: ${error.stderr || '(none)'}`,
                        resultType: 'failure',
                        error: error.message
                    };
                }
            }
        });
    }
    
    /**
     * Creates a restricted create tool for plan mode
     * Only allows creating the session's plan.md file
     */
    private createRestrictedCreateTool(): any {
        return defineTool('create_plan_file', {
            description: 'Create the session plan.md file. ONLY the session plan.md file can be created in plan mode.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The path to the file (must be the session plan.md file)'
                    },
                    file_text: {
                        type: 'string',
                        description: 'The content of the plan file'
                    }
                },
                required: ['path', 'file_text']
            },
            handler: async (args: { path: string; file_text?: string }) => {
                const requestedPath = path.resolve(args.path);
                
                // Calculate the session plan path
                const homeDir = require('os').homedir();
                const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId!);
                const sessionPlanPath = path.join(workSessionPath, 'plan.md');
                
                // Only allow creating the session's plan.md file
                if (requestedPath !== sessionPlanPath) {
                    this.logger.warn(`[Plan Mode] Blocked create attempt: ${requestedPath}`);
                    return {
                        textResultForLlm: `❌ File creation blocked in plan mode!\n\nYou can ONLY create the session plan file at:\n${sessionPlanPath}\n\nYou attempted to create:\n${requestedPath}\n\nInstead, use the 'update_work_plan' tool to create/update your plan.`,
                        resultType: 'denied'
                    };
                }
                
                // Check if file already exists
                if (fs.existsSync(sessionPlanPath)) {
                    this.logger.warn(`[Plan Mode] Plan file already exists: ${sessionPlanPath}`);
                    return {
                        textResultForLlm: `❌ File already exists: ${sessionPlanPath}\n\nUse 'update_work_plan' tool to update the plan instead.`,
                        resultType: 'denied'
                    };
                }
                
                // Create the plan file
                try {
                    // Ensure session directory exists
                    if (!fs.existsSync(workSessionPath)) {
                        fs.mkdirSync(workSessionPath, { recursive: true });
                        this.logger.info(`[Plan Mode] Created session directory: ${workSessionPath}`);
                    }
                    
                    const content = args.file_text || '';
                    fs.writeFileSync(sessionPlanPath, content, 'utf8');
                    this.logger.info(`[Plan Mode] Created plan file: ${sessionPlanPath}`);
                    
                    return {
                        textResultForLlm: `✅ Plan file created successfully at ${sessionPlanPath}`,
                        resultType: 'success'
                    };
                } catch (error) {
                    this.logger.error(`[Plan Mode] Failed to create plan file:`, error instanceof Error ? error : undefined);
                    return {
                        textResultForLlm: `❌ Error creating plan file: ${error instanceof Error ? error.message : String(error)}`,
                        resultType: 'failure',
                        error: error instanceof Error ? error.message : String(error)
                    };
                }
            }
        });
    }
    
    /**
     * Creates a restricted edit tool for plan mode
     * Only allows editing the session's plan.md file
     */
    private createRestrictedEditTool(): any {
        return defineTool('edit_plan_file', {
            description: 'Edit the session plan.md file. ONLY the session plan.md file can be edited in plan mode.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The path to the file (must be the session plan.md file)'
                    },
                    old_str: {
                        type: 'string',
                        description: 'The exact string to find and replace'
                    },
                    new_str: {
                        type: 'string',
                        description: 'The new string to replace with'
                    }
                },
                required: ['path', 'old_str', 'new_str']
            },
            handler: async (args: { path: string; old_str: string; new_str: string }) => {
                const requestedPath = path.resolve(args.path);
                
                // Calculate the session plan path
                const homeDir = require('os').homedir();
                const workSessionPath = path.join(homeDir, '.copilot', 'session-state', this.workSessionId!);
                const sessionPlanPath = path.join(workSessionPath, 'plan.md');
                
                // Only allow editing the session's plan.md file
                if (requestedPath !== sessionPlanPath) {
                    this.logger.warn(`[Plan Mode] Blocked edit attempt: ${requestedPath}`);
                    return {
                        textResultForLlm: `❌ File editing blocked in plan mode!\n\nYou can ONLY edit the session plan file at:\n${sessionPlanPath}\n\nYou attempted to edit:\n${requestedPath}\n\nUse the 'update_work_plan' tool instead for better control.`,
                        resultType: 'denied'
                    };
                }
                
                // Check if file exists
                if (!fs.existsSync(sessionPlanPath)) {
                    this.logger.warn(`[Plan Mode] Plan file doesn't exist: ${sessionPlanPath}`);
                    return {
                        textResultForLlm: `❌ File doesn't exist: ${sessionPlanPath}\n\nUse 'update_work_plan' or 'create' tool to create the plan first.`,
                        resultType: 'denied'
                    };
                }
                
                // Perform the edit
                try {
                    const content = fs.readFileSync(sessionPlanPath, 'utf-8');
                    
                    // Check if old_str exists in the file
                    if (!content.includes(args.old_str)) {
                        this.logger.warn(`[Plan Mode] String not found in plan file`);
                        return {
                            textResultForLlm: `❌ String not found in plan file.\n\nSearching for:\n${args.old_str.substring(0, 100)}...\n\nConsider using 'update_work_plan' to rewrite the entire plan instead.`,
                            resultType: 'failure'
                        };
                    }
                    
                    // Replace the string
                    const newContent = content.replace(args.old_str, args.new_str);
                    fs.writeFileSync(sessionPlanPath, newContent, 'utf-8');
                    
                    this.logger.info(`[Plan Mode] Edited plan file: ${sessionPlanPath}`);
                    
                    return {
                        textResultForLlm: `✅ Plan file edited successfully at ${sessionPlanPath}`,
                        resultType: 'success'
                    };
                } catch (error) {
                    this.logger.error(`[Plan Mode] Failed to edit plan file:`, error instanceof Error ? error : undefined);
                    return {
                        textResultForLlm: `❌ Error editing plan file: ${error instanceof Error ? error.message : String(error)}`,
                        resultType: 'failure',
                        error: error instanceof Error ? error.message : String(error)
                    };
                }
            }
        });
    }
    
    /**
     * Creates a restricted task tool for plan mode
     * Only allows agent_type: "explore"
     */
    private createRestrictedTaskTool(): any {
        return defineTool('task_agent_type_explore', {
            description: 'Dispatch a task to a specialized agent. In plan mode, only "explore" agent type is allowed for codebase exploration.',
            parameters: {
                type: 'object',
                properties: {
                    agent_type: {
                        type: 'string',
                        description: 'Type of agent to use (only "explore" allowed in plan mode)'
                    },
                    instruction: {
                        type: 'string',
                        description: 'The task instruction for the agent'
                    }
                },
                required: ['agent_type', 'instruction']
            },
            handler: async (args: { agent_type: string; instruction: string }) => {
                // Only allow explore agent in plan mode
                if (args.agent_type !== 'explore') {
                    this.logger.warn(`[Plan Mode] Blocked task with agent_type: ${args.agent_type}`);
                    return {
                        textResultForLlm: `❌ Agent type "${args.agent_type}" not allowed in plan mode!\n\nOnly "explore" agent is allowed for codebase exploration during planning.\n\nAllowed: task(agent_type="explore", instruction="...")`,
                        resultType: 'denied'
                    };
                }
                
                this.logger.info(`[Plan Mode] Allowing explore task: ${args.instruction.substring(0, 50)}...`);
                
                // The SDK will handle the actual task dispatch
                // We just validate and pass through
                return {
                    textResultForLlm: `✅ Explore task allowed. The SDK will dispatch this to an exploration agent.`,
                    resultType: 'success'
                };
            }
        });
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

    public async sendMessage(message: string, isRetry: boolean = false): Promise<void> {
        if (!this.session) {
            throw new Error('Session not initialized. Call start() first.');
        }

        this.logger.info(`Sending message: ${message.substring(0, 100)}...`);
        
        // Enhance message with active file context and process @file references
        const enhancedMessage = await this.enhanceMessageWithContext(message);
        
        try {
            await this.session.sendAndWait({ prompt: enhancedMessage });
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
                
                // Destroy and recreate session
                await this.stop();
                await this.start();
                
                this.logger.info('Session recreated, retrying message...');
                
                // Retry the message once (use flag to prevent infinite loop)
                if (!isRetry) {
                    return this.sendMessage(message, true);
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
    private async enhanceMessageWithContext(message: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('copilotCLI');
        const includeActiveFile = config.get<boolean>('includeActiveFile', true);
        const resolveFileReferences = config.get<boolean>('resolveFileReferences', true);
        
        const parts: string[] = [];
        
        // Add active file context if enabled and there's an active editor
        if (includeActiveFile) {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const document = activeEditor.document;
                const relativePath = vscode.workspace.asRelativePath(document.uri);
                const selection = activeEditor.selection;
                
                parts.push(`[Active File: ${relativePath}]`);
                
                // If there's a selection, include it
                if (!selection.isEmpty) {
                    const selectedText = document.getText(selection);
                    const startLine = selection.start.line + 1;
                    const endLine = selection.end.line + 1;
                    parts.push(`[Selected lines ${startLine}-${endLine}]:\n\`\`\`\n${selectedText}\n\`\`\``);
                }
            }
        }
        
        // Process @file_name references if enabled
        const processedMessage = resolveFileReferences 
            ? await this.processFileReferences(message)
            : message;
        
        // Combine context with the message
        if (parts.length > 0) {
            return `${parts.join('\n')}\n\n${processedMessage}`;
        }
        
        return processedMessage;
    }
    
    /**
     * Processes @file_name references in the message
     */
    private async processFileReferences(message: string): Promise<string> {
        // Match @filename patterns (handles paths with /,\,., -, _)
        const fileRefPattern = /@([\w\-._/\\]+\.\w+)/g;
        let processedMessage = message;
        const matches = Array.from(message.matchAll(fileRefPattern));
        
        for (const match of matches) {
            const fileName = match[1];
            const fullMatch = match[0];
            
            try {
                // Try to find the file in the workspace
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    continue;
                }
                
                // Check if it's already a valid path
                let fileUri: vscode.Uri | null = null;
                
                // Try as relative path from workspace root
                const rootPath = workspaceFolders[0].uri.fsPath;
                const absolutePath = path.isAbsolute(fileName) 
                    ? fileName 
                    : path.join(rootPath, fileName);
                
                if (fs.existsSync(absolutePath)) {
                    fileUri = vscode.Uri.file(absolutePath);
                } else {
                    // Try to find the file using workspace findFiles
                    const pattern = `**/${fileName}`;
                    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 1);
                    if (files.length > 0) {
                        fileUri = files[0];
                    }
                }
                
                if (fileUri) {
                    const relativePath = vscode.workspace.asRelativePath(fileUri);
                    // Replace @file with the relative path
                    processedMessage = processedMessage.replace(fullMatch, relativePath);
                    this.logger.info(`Resolved ${fullMatch} to ${relativePath}`);
                }
            } catch (error) {
                this.logger.warn(`Failed to resolve file reference ${fullMatch}: ${error}`);
            }
        }
        
        return processedMessage;
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
        
        // Switch to plan mode before getting tools (so getCustomTools returns plan tool)
        this.logger.info(`[Plan Mode] Step 5/7: Switch mode to 'plan'`);
        const previousMode = this.currentMode;
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
            this.logger.info(`[Plan Mode]     availableTools: [plan_bash_explore, task_agent_type_explore, edit_plan_file, create_plan_file, update_work_plan, view, grep, glob, web_fetch, fetch_copilot_cli_documentation]`);
            this.logger.info(`[Plan Mode]     mcpServers: ${hasMcpServers ? 'enabled' : 'disabled'}`);
            this.logger.info(`[Plan Mode]     systemMessage: mode=append (plan mode instructions)`);
            this.logger.info(`[Plan Mode]   ─────────────────────────────────────────────`);
            
            this.planSession = await this.client.createSession({
                sessionId: planSessionId,
                model: this.config.model || undefined,
                tools: customTools,
                availableTools: [
                    // Custom restricted tools (5)
                    'plan_bash_explore',           // restricted bash for read-only commands
                    'task_agent_type_explore',     // restricted task for exploration only
                    'edit_plan_file',              // edit ONLY plan.md
                    'create_plan_file',            // create ONLY plan.md
                    'update_work_plan',            // update plan content
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

**AVAILABLE TOOLS IN PLAN MODE (10 total):**

*Plan Management Tools:*
- \`update_work_plan\` - **PRIMARY TOOL** for creating/updating your implementation plan
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

2. **create_plan_file** (FALLBACK) - Only if update_work_plan fails, use create_plan_file with the exact path:
   \`\`\`
   create_plan_file({ 
     path: "${path.join(require('os').homedir(), '.copilot', 'session-state', this.workSessionId!)}/plan.md",
     file_text: "# Plan\\n\\n## Problem..."
   })
   \`\`\`

❌ DO NOT try to create files in /tmp or anywhere else
❌ DO NOT use bash to create the plan
✅ ALWAYS use update_work_plan or create_plan_file (with exact path above)

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

    public dispose(): void {
        this.stop();
        this.onMessageEmitter.dispose();
    }
}
