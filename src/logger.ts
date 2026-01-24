import * as vscode from 'vscode';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel = LogLevel.DEBUG;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Copilot CLI');
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
