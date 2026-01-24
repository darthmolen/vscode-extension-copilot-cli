import { ChildProcess, spawn } from 'child_process';
import * as vscode from 'vscode';

export interface CLIConfig {
    allowAllTools?: boolean;
    allowAllUrls?: boolean;
    yolo?: boolean;
    allowedTools?: string[];
    allowedUrls?: string[];
}

export interface CLIMessage {
    type: 'output' | 'error' | 'status' | 'file_change';
    data: any;
    timestamp: number;
}

export class CLIProcessManager {
    private process: ChildProcess | null = null;
    private outputBuffer: string = '';
    private errorBuffer: string = '';
    private readonly onMessageEmitter = new vscode.EventEmitter<CLIMessage>();
    public readonly onMessage = this.onMessageEmitter.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly config: CLIConfig = {}
    ) {}

    public async start(): Promise<void> {
        if (this.process) {
            throw new Error('CLI process is already running');
        }

        const cliPath = this.getCopilotCLIPath();
        const args = this.buildCLIArgs();

        console.log(`Starting Copilot CLI: ${cliPath} ${args.join(' ')}`);

        this.process = spawn(cliPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env }
        });

        if (!this.process.stdout || !this.process.stderr) {
            throw new Error('Failed to create CLI process streams');
        }

        this.process.stdout.on('data', (data: Buffer) => {
            this.handleStdout(data.toString());
        });

        this.process.stderr.on('data', (data: Buffer) => {
            this.handleStderr(data.toString());
        });

        this.process.on('error', (error: Error) => {
            this.handleProcessError(error);
        });

        this.process.on('exit', (code: number | null, signal: string | null) => {
            this.handleProcessExit(code, signal);
        });
    }

    public async sendInput(input: string): Promise<void> {
        if (!this.process || !this.process.stdin) {
            throw new Error('CLI process is not running');
        }

        return new Promise((resolve, reject) => {
            this.process!.stdin!.write(input + '\n', (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    public async stop(): Promise<void> {
        if (!this.process) {
            return;
        }

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (this.process) {
                    this.process.kill('SIGKILL');
                }
                resolve();
            }, 5000);

            this.process!.once('exit', () => {
                clearTimeout(timeout);
                resolve();
            });

            this.process!.kill('SIGTERM');
        });
    }

    public isRunning(): boolean {
        return this.process !== null && !this.process.killed;
    }

    public async restart(): Promise<void> {
        await this.stop();
        await this.start();
    }

    private getCopilotCLIPath(): string {
        // Try to get from configuration
        const configPath = vscode.workspace.getConfiguration('copilotCLI').get<string>('cliPath');
        if (configPath) {
            return configPath;
        }

        // Default to 'gh' in PATH (assuming gh copilot CLI is installed)
        return 'gh';
    }

    private buildCLIArgs(): string[] {
        const args: string[] = ['copilot', 'chat'];

        if (this.config.yolo) {
            args.push('--yolo');
        }

        if (this.config.allowAllTools) {
            args.push('--allow-all-tools');
        }

        if (this.config.allowAllUrls) {
            args.push('--allow-all-urls');
        }

        if (this.config.allowedTools) {
            for (const tool of this.config.allowedTools) {
                args.push('--allow-tool', tool);
            }
        }

        if (this.config.allowedUrls) {
            for (const url of this.config.allowedUrls) {
                args.push('--allow-url', url);
            }
        }

        return args;
    }

    private handleStdout(data: string): void {
        this.outputBuffer += data;
        this.processOutputBuffer();
    }

    private handleStderr(data: string): void {
        this.errorBuffer += data;
        
        this.onMessageEmitter.fire({
            type: 'error',
            data: data,
            timestamp: Date.now()
        });
    }

    private processOutputBuffer(): void {
        const lines = this.outputBuffer.split('\n');
        
        // Keep the last partial line in the buffer
        this.outputBuffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim()) {
                this.onMessageEmitter.fire({
                    type: 'output',
                    data: line,
                    timestamp: Date.now()
                });
            }
        }
    }

    private handleProcessError(error: Error): void {
        console.error('CLI Process Error:', error);
        this.onMessageEmitter.fire({
            type: 'status',
            data: { status: 'error', error: error.message },
            timestamp: Date.now()
        });
    }

    private handleProcessExit(code: number | null, signal: string | null): void {
        console.log(`CLI Process exited with code ${code} and signal ${signal}`);
        this.process = null;
        
        this.onMessageEmitter.fire({
            type: 'status',
            data: { status: 'exited', code, signal },
            timestamp: Date.now()
        });
    }

    public dispose(): void {
        this.stop();
        this.onMessageEmitter.dispose();
    }
}
