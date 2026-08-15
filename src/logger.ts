// Type-only: erased at compile time, so requiring this module never pulls in
// the vscode runtime. The output channel is created lazily in the constructor.
import type * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

/**
 * The logging surface every consumer actually uses.
 *
 * Services depend on this rather than on `Logger` so they can run outside the
 * extension host (e.g. inside a separate agent process).
 */
export interface LoggerLike {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string, error?: Error): void;
    error(message: string, error?: Error): void;
}

export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel = LogLevel.DEBUG;

    private constructor() {
        // Required lazily so this module can load where vscode does not exist.
        const vscodeApi = require('vscode');
        this.outputChannel = vscodeApi.window.createOutputChannel('Copilot CLI');
    }

    /**
     * Install a logger for hosts that have no VS Code output channel.
     * Pass `undefined` to fall back to the lazily-created VS Code logger.
     */
    public static setInstance(logger: LoggerLike | undefined): void {
        Logger.instance = logger as Logger | undefined as Logger;
    }

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public show(): void {
        this.outputChannel.show();
    }

    public setLogLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    private log(level: LogLevel, levelName: string, message: string, error?: Error): void {
        if (level < this.logLevel) {
            return;
        }

        const timestamp = new Date().toISOString();
        const formattedMessage = `[${levelName}] ${timestamp} ${message}`;
        
        this.outputChannel.appendLine(formattedMessage);
        
        if (error) {
            this.outputChannel.appendLine(`        Error: ${error.message}`);
            if (error.stack) {
                this.outputChannel.appendLine(`        Stack: ${error.stack}`);
            }
        }
    }

    public debug(message: string): void {
        this.log(LogLevel.DEBUG, 'DEBUG', message);
    }

    public info(message: string): void {
        this.log(LogLevel.INFO, 'INFO ', message);
    }

    public warn(message: string, error?: Error): void {
        this.log(LogLevel.WARN, 'WARN ', message, error);
    }

    public error(message: string, error?: Error): void {
        this.log(LogLevel.ERROR, 'ERROR', message, error);
    }

    public dispose(): void {
        this.outputChannel.dispose();
    }
}
