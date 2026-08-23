/**
 * The VS Code implementation of {@link HostBridge}.
 *
 * Split out of `hostBridge.ts` so the contract can be imported by a module that must
 * never reach VS Code. While both lived in one file, `sdkSessionManager.ts` held a
 * **static** import of `createVSCodeHostBridge` — and a static import survives a
 * rename, so moving the factory on its own would have left the dependency arrow
 * pointing exactly where it did before. The split is worth something only together
 * with the removal of that import; see
 * `planning/backlog/hostbridge-split-and-fallback-seam.md`.
 *
 * `vscode` is still required lazily inside the factory rather than at module scope,
 * so importing this file stays safe where the module is absent. Nothing that has to
 * run outside the extension host imports it any more, which is the actual guarantee.
 */

import type * as vscode from 'vscode';
import type { LoggerLike } from '../logger';
import type { ErrorType } from '../sessionErrorUtils';
import type { HostBridge, MessageEnhancerLike } from './hostBridge';

/**
 * Host-supplied collaborators the bridge cannot source for itself.
 *
 * These exist so the bridge stays free of global state: whoever constructs it
 * already holds the session state, so they pass in the accessor rather than
 * the bridge reaching for a singleton.
 */
export interface HostBridgeDeps {
    /** Returns the agent the user has pinned, or null. */
    getActiveAgent?(): string | null;
}

/**
 * The VS Code implementation. `vscode` and the editor-bound services are
 * required lazily so importing this module stays safe in a non-VS Code host.
 */
export function createVSCodeHostBridge(
    context: vscode.ExtensionContext,
    deps: HostBridgeDeps = {}
): HostBridge {
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
            return deps.getActiveAgent?.() ?? null;
        },

        createMessageEnhancer(): MessageEnhancerLike {
            const { MessageEnhancementService } = require('./services/messageEnhancementService');
            return new MessageEnhancementService();
        }
    };
}
