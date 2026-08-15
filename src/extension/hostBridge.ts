/**
 * HostBridge — the boundary between the agent loop and its host.
 *
 * `SDKSessionManager` drives the Copilot SDK and is otherwise pure Node. The
 * handful of things it genuinely needs from VS Code — settings, the workspace
 * folder, global storage, user-facing notifications, and the message enhancer
 * that reads editor state — are gathered here so the manager can also run
 * outside the extension host (e.g. inside a separate agent process).
 *
 * Nothing in this file imports `vscode` at module scope; the VS Code
 * implementation requires it lazily inside the factory.
 */

import type * as vscode from 'vscode';
import type { LoggerLike } from '../logger';
import type { ErrorType } from '../sessionErrorUtils';

/**
 * Enhances an outbound prompt with host context (active file, selection,
 * `@file` references). Must run on the client side — it reads editor state.
 */
export interface MessageEnhancerLike {
    enhanceMessageWithContext(message: string): Promise<string>;
    dispose(): void;
}

export interface HostBridge {
    readonly logger: LoggerLike;

    /** Read a `copilotCLI.<key>` setting. */
    getConfig<T>(key: string, defaultValue?: T): T | undefined;

    /** The first workspace folder, or undefined when there is none. */
    getWorkspaceFolder(): string | undefined;

    /** Directory the host reserves for this extension's persistent files. */
    getGlobalStorageDir(): string;

    /** Fire-and-forget user notifications. */
    showError(message: string): void;
    showWarning(message: string): void;

    /**
     * Ask the user how to recover a session that could not be resumed.
     * Hosts without a UI should resolve to `'new'`.
     */
    askSessionRecovery(
        sessionId: string,
        errorType: ErrorType,
        attemptCount: number,
        lastError: Error
    ): Promise<'retry' | 'new'>;

    /**
     * The agent the user has pinned for this session, if any. Consulted after
     * a session is recreated so the selection survives reconnects. Hosts that
     * do not track a sticky agent may omit it.
     */
    getActiveAgent?(): string | null;

    /**
     * Build the client-side message enhancer. Optional: hosts with no editor
     * omit it and prompts are sent through unchanged.
     */
    createMessageEnhancer?(): MessageEnhancerLike;
}

/** Pass-through enhancer for hosts with no editor context to add. */
export class NoopMessageEnhancer implements MessageEnhancerLike {
    public async enhanceMessageWithContext(message: string): Promise<string> {
        return message;
    }
    public dispose(): void {
        /* nothing to dispose */
    }
}

/**
 * The VS Code implementation. `vscode` and the editor-bound services are
 * required lazily so importing this module stays safe in a non-VS Code host.
 */
export function createVSCodeHostBridge(context: vscode.ExtensionContext): HostBridge {
    const vscodeApi = require('vscode');
    const { Logger } = require('../logger');
    const { showSessionRecoveryDialog } = require('../sessionErrorUtils');

    return {
        get logger(): LoggerLike {
            return Logger.getInstance();
        },

        getConfig<T>(key: string, defaultValue?: T): T | undefined {
            const config = vscodeApi.workspace.getConfiguration('copilotCLI') as {
                get<V>(section: string, fallback?: V): V | undefined;
            };
            return defaultValue === undefined
                ? config.get<T>(key)
                : config.get<T>(key, defaultValue);
        },

        getWorkspaceFolder(): string | undefined {
            return vscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
        },

        getGlobalStorageDir(): string {
            return context.globalStorageUri.fsPath;
        },

        showError(message: string): void {
            vscodeApi.window.showErrorMessage(message);
        },

        showWarning(message: string): void {
            vscodeApi.window.showWarningMessage(message);
        },

        askSessionRecovery(
            sessionId: string,
            errorType: ErrorType,
            attemptCount: number,
            lastError: Error
        ): Promise<'retry' | 'new'> {
            return showSessionRecoveryDialog(vscodeApi, sessionId, errorType, attemptCount, lastError);
        },

        getActiveAgent(): string | null {
            const { getBackendState } = require('../backendState');
            return getBackendState().getActiveAgent();
        },

        createMessageEnhancer(): MessageEnhancerLike {
            const { MessageEnhancementService } = require('./services/messageEnhancementService');
            return new MessageEnhancementService();
        }
    };
}
