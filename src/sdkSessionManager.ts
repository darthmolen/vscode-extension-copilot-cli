import * as vscode from 'vscode';
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
    type: 'output' | 'error' | 'status' | 'file_change' | 'tool_start' | 'tool_complete' | 'tool_progress';
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
    progress?: string;
}

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

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly config: CLIConfig = {},
        resumeLastSession: boolean = true,
        specificSessionId?: string
    ) {
        this.logger = Logger.getInstance();
        this.workingDirectory = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        this.resumeSession = resumeLastSession;
        
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
            
            this.client = new CopilotClient({
                logLevel: 'info',
                ...(cliPath ? { cliPath } : {}),
                autoStart: true,
            });

            this.logger.info('CopilotClient created, initializing session...');

            // Create or resume session
            if (this.sessionId) {
                this.logger.info(`Resuming session: ${this.sessionId}`);
                this.session = await this.client.resumeSession(this.sessionId, {
                    tools: this.getCustomTools(),
                });
            } else {
                this.logger.info('Creating new session');
                this.session = await this.client.createSession({
                    model: this.config.model || undefined,
                    tools: this.getCustomTools(),
                });
                this.sessionId = this.session.sessionId;
            }

            this.logger.info(`Session active: ${this.sessionId}`);

            // Set up event listeners
            this.setupEventListeners();

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

    private setupEventListeners(): void {
        if (!this.session) {return;}

        this.session.on((event: any) => {
            this.logger.debug(`[SDK Event] ${event.type}: ${JSON.stringify(event.data)}`);

            switch (event.type) {
                case 'assistant.message':
                    // Final assistant message with full content
                    this.onMessageEmitter.fire({
                        type: 'output',
                        data: event.data.content,
                        timestamp: Date.now()
                    });
                    break;

                case 'assistant.message_delta':
                    // Streaming message chunks (optional - can enable for real-time streaming)
                    // For now, we'll just wait for the final message
                    break;

                case 'tool.execution_start':
                    this.handleToolStart(event.data);
                    break;

                case 'tool.execution_progress':
                    this.handleToolProgress(event.data);
                    break;

                case 'tool.execution_complete':
                    this.handleToolComplete(event.data);
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
                    this.logger.info(`Session ${event.type}: ${JSON.stringify(event.data)}`);
                    break;

                default:
                    // Log other events for debugging
                    this.logger.debug(`Unhandled event type: ${event.type}`);
            }
        });
    }

    private handleToolStart(data: any): void {
        const state: ToolExecutionState = {
            toolCallId: data.toolCallId,
            toolName: data.toolName,
            arguments: data.arguments,
            status: 'running',
            startTime: Date.now(),
        };
        
        this.toolExecutions.set(data.toolCallId, state);
        
        this.onMessageEmitter.fire({
            type: 'tool_start',
            data: state,
            timestamp: Date.now()
        });
    }

    private handleToolProgress(data: any): void {
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

    private handleToolComplete(data: any): void {
        const state = this.toolExecutions.get(data.toolCallId);
        if (state) {
            state.status = data.success ? 'complete' : 'failed';
            state.endTime = Date.now();
            state.result = data.result?.content;
            
            this.onMessageEmitter.fire({
                type: 'tool_complete',
                data: state,
                timestamp: Date.now()
            });

            // Check if this was a file operation
            if (state.toolName === 'edit' || state.toolName === 'write') {
                this.onMessageEmitter.fire({
                    type: 'file_change',
                    data: {
                        toolCallId: data.toolCallId,
                        toolName: state.toolName,
                        arguments: state.arguments,
                    },
                    timestamp: Date.now()
                });
            }
        }
    }

    private getCustomTools(): any[] {
        // Future: Add custom VS Code tools here
        return [];
    }

    public async sendMessage(message: string): Promise<void> {
        if (!this.session) {
            throw new Error('Session not initialized. Call start() first.');
        }

        this.logger.info(`Sending message: ${message.substring(0, 100)}...`);
        
        try {
            await this.session.sendAndWait({ prompt: message });
            this.logger.debug('Message sent and completed');
        } catch (error) {
            this.logger.error('Failed to send message', error instanceof Error ? error : undefined);
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

    public getToolExecutions(): ToolExecutionState[] {
        return Array.from(this.toolExecutions.values());
    }

    public dispose(): void {
        this.stop();
        this.onMessageEmitter.dispose();
    }
}
