import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { Logger } from './logger';
import { getMostRecentSession } from './sessionUtils';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
    type: 'output' | 'error' | 'status' | 'file_change';
    data: any;
    timestamp: number;
}

export class CLIProcessManager {
    private sessionId: string | null = null;
    private readonly onMessageEmitter = new vscode.EventEmitter<CLIMessage>();
    public readonly onMessage = this.onMessageEmitter.event;
    private logger: Logger;
    private workingDirectory: string;
    private resumeSession: boolean;

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
        // Otherwise, if resuming, load the last session ID immediately
        else if (this.resumeSession) {
            this.loadLastSessionId();
        }
    }

    private loadLastSessionId(): void {
        try {
            // Check if folder-based filtering is enabled
            const filterByFolder = vscode.workspace.getConfiguration('copilotCLI').get<boolean>('filterSessionsByFolder', true);
            
            // Get the most recent session (filtered by folder if enabled)
            const sessionId = getMostRecentSession(this.workingDirectory, filterByFolder);
            
            if (sessionId) {
                this.sessionId = sessionId;
                this.logger.info(`Resuming session: ${this.sessionId} (folder filtering: ${filterByFolder})`);
            } else {
                this.logger.info('No previous sessions found, will start new session');
            }
        } catch (error) {
            this.logger.error('Failed to load last session ID', error instanceof Error ? error : undefined);
        }
    }

    public async start(): Promise<void> {
        // For prompt mode, we just initialize and track that we're "started"
        // Actual CLI processes are spawned per message
        this.logger.info('CLI Manager started in prompt mode');
        
        this.onMessageEmitter.fire({
            type: 'status',
            data: { status: 'ready' },
            timestamp: Date.now()
        });
    }

    public async sendMessage(message: string): Promise<void> {
        this.logger.info(`Sending message via prompt mode: ${message.substring(0, 100)}...`);
        
        const cliPath = this.getCopilotCLIPath();
        const args = this.buildCLIArgs();
        
        // Add prompt-specific args
        args.push('--prompt', message);
        // Note: NOT using --silent so we get full tool execution and formatting
        
        // Add resume flag if we have a session
        if (this.sessionId) {
            this.logger.debug(`Resuming session: ${this.sessionId}`);
            args.unshift('--resume', this.sessionId);
        }
        
        this.logger.debug(`Executing: ${cliPath} ${args.join(' ')}`);
        
        return new Promise((resolve, reject) => {
            const proc = spawn(cliPath, args, {
                cwd: this.workingDirectory,
                env: { ...process.env }
            });
            
            let stdout = '';
            let stderr = '';
            
            proc.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
            });
            
            proc.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });
            
            proc.on('error', (error: Error) => {
                this.logger.error('CLI process error', error);
                reject(error);
            });
            
            proc.on('exit', (code: number | null) => {
                if (code === 0) {
                    // Get the latest session ID
                    this.updateSessionId();
                    
                    // Clean up the output - remove stats footer
                    const cleanOutput = this.stripStatsFooter(stdout);
                    
                    // Emit the response
                    if (cleanOutput.trim()) {
                        this.onMessageEmitter.fire({
                            type: 'output',
                            data: cleanOutput.trim(),
                            timestamp: Date.now()
                        });
                    }
                    
                    resolve();
                } else {
                    this.logger.error(`CLI exited with code ${code}: ${stderr}`);
                    this.onMessageEmitter.fire({
                        type: 'error',
                        data: stderr || `Process exited with code ${code}`,
                        timestamp: Date.now()
                    });
                    reject(new Error(stderr || `Process exited with code ${code}`));
                }
            });
        });
    }

    private stripStatsFooter(output: string): string {
        // Remove the stats footer that appears at the end
        // Lines like "Total usage est:", "API time spent:", etc.
        const lines = output.split('\n');
        const statsKeywords = [
            'Total usage est:',
            'API time spent:',
            'Total session time:',
            'Total code changes:',
            'Breakdown by AI model:',
            'claude-',
            'gpt-'
        ];
        
        // Find where stats section starts
        let cutoffIndex = lines.length;
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (statsKeywords.some(keyword => line.startsWith(keyword))) {
                cutoffIndex = i;
            } else if (line.length > 0 && cutoffIndex < lines.length) {
                // We found content after finding stats, this is the cutoff
                break;
            }
        }
        
        return lines.slice(0, cutoffIndex).join('\n').trim();
    }

    private updateSessionId(): void {
        // Get the most recent session from ~/.copilot/session-state/
        try {
            const sessionDir = path.join(os.homedir(), '.copilot', 'session-state');
            const sessions = fs.readdirSync(sessionDir)
                .map(name => ({
                    name,
                    time: fs.statSync(path.join(sessionDir, name)).mtime.getTime()
                }))
                .sort((a, b) => b.time - a.time);
            
            if (sessions.length > 0) {
                const newSessionId = sessions[0].name;
                if (newSessionId !== this.sessionId) {
                    this.logger.info(`Session ID updated: ${newSessionId}`);
                    this.sessionId = newSessionId;
                }
            }
        } catch (error) {
            this.logger.error('Failed to update session ID', error instanceof Error ? error : undefined);
        }
    }

    public isRunning(): boolean {
        // In prompt mode, we're always "running" once started
        return true;
    }

    public async stop(): Promise<void> {
        this.logger.info('Stopping CLI manager (prompt mode)');
        this.sessionId = null;
        
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

    private getCopilotCLIPath(): string {
        // Try to get from configuration
        const configPath = vscode.workspace.getConfiguration('copilotCLI').get<string>('cliPath');
        if (configPath) {
            this.logger.debug(`Using configured CLI path: ${configPath}`);
            return configPath;
        }

        // Default to 'copilot' in PATH (new standalone CLI)
        // Works cross-platform:
        // - Linux/macOS: 'copilot' (installed via brew)
        // - Windows: 'copilot.exe' (installed via winget, .exe auto-resolved by spawn)
        this.logger.debug('Using default CLI path: copilot');
        return 'copilot';
    }

    private buildCLIArgs(): string[] {
        const args: string[] = [];

        // YOLO/Allow-all takes precedence
        if (this.config.yolo || this.config.allowAll) {
            this.logger.debug('YOLO mode enabled');
            args.push('--yolo');
            return args; // No need for other flags
        }

        // Specific allow flags
        if (this.config.allowAllTools) {
            this.logger.debug('Allow all tools enabled');
            args.push('--allow-all-tools');
        }

        if (this.config.allowAllPaths) {
            this.logger.debug('Allow all paths enabled');
            args.push('--allow-all-paths');
        }

        if (this.config.allowAllUrls) {
            this.logger.debug('Allow all URLs enabled');
            args.push('--allow-all-urls');
        }

        // Allow specific tools
        if (this.config.allowTools && this.config.allowTools.length > 0) {
            this.logger.debug(`Allow tools: ${this.config.allowTools.join(', ')}`);
            for (const tool of this.config.allowTools) {
                args.push('--allow-tool', tool);
            }
        }

        // Deny specific tools
        if (this.config.denyTools && this.config.denyTools.length > 0) {
            this.logger.debug(`Deny tools: ${this.config.denyTools.join(', ')}`);
            for (const tool of this.config.denyTools) {
                args.push('--deny-tool', tool);
            }
        }

        // Allow specific URLs
        if (this.config.allowUrls && this.config.allowUrls.length > 0) {
            this.logger.debug(`Allow URLs: ${this.config.allowUrls.join(', ')}`);
            for (const url of this.config.allowUrls) {
                args.push('--allow-url', url);
            }
        }

        // Deny specific URLs
        if (this.config.denyUrls && this.config.denyUrls.length > 0) {
            this.logger.debug(`Deny URLs: ${this.config.denyUrls.join(', ')}`);
            for (const url of this.config.denyUrls) {
                args.push('--deny-url', url);
            }
        }

        // Add directories
        if (this.config.addDirs && this.config.addDirs.length > 0) {
            this.logger.debug(`Add directories: ${this.config.addDirs.join(', ')}`);
            for (const dir of this.config.addDirs) {
                args.push('--add-dir', dir);
            }
        }

        // Custom agent
        if (this.config.agent) {
            this.logger.debug(`Using custom agent: ${this.config.agent}`);
            args.push('--agent', this.config.agent);
        }

        // Model selection
        if (this.config.model) {
            this.logger.debug(`Using model: ${this.config.model}`);
            args.push('--model', this.config.model);
        }

        // Autonomous mode (no ask user)
        if (this.config.noAskUser) {
            this.logger.debug('No ask user mode enabled');
            args.push('--no-ask-user');
        }

        return args;
    }

    public dispose(): void {
        this.stop();
        this.onMessageEmitter.dispose();
    }
}
