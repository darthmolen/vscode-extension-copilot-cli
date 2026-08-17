/**
 * The `HostBridge` for a process with no editor (IN-3, absorbing IN-8).
 *
 * `SDKSessionManager` talks to its host through this seam. In the extension the
 * implementation is `createVSCodeHostBridge`; in the ACP agent process there is no
 * window, no configuration service and no user to prompt, so everything the VS Code
 * bridge *asks* must instead be *supplied at startup* or answered on our own.
 *
 * Deliberately imports no `vscode` — that is what makes the manager runnable out of
 * host, and it is asserted by loading this module with `require('vscode')` throwing.
 */

import type { HostBridge } from '../extension/hostBridge';
import type { LoggerLike } from '../logger';
import type { ErrorType } from '../sessionErrorUtils';

export interface HeadlessHostBridgeOptions {
    logger: LoggerLike;
    /** Directory the agent may use for persistent files. */
    globalStorageDir: string;
    /** Workspace root for sessions. Defaults to the process cwd. */
    workspaceFolder?: string;
    /**
     * A snapshot of `copilotCLI.*` settings, taken by whoever launched the agent.
     * There is no configuration service to query here, so what arrives at startup
     * is all this process will ever know.
     */
    settings?: Readonly<Record<string, unknown>>;
}

export function createHeadlessHostBridge(options: HeadlessHostBridgeOptions): HostBridge {
    const { logger, globalStorageDir } = options;
    const workspaceFolder = options.workspaceFolder ?? process.cwd();
    const settings = options.settings ?? {};

    return {
        logger,

        getConfig<T>(key: string, defaultValue?: T): T | undefined {
            // `in` rather than a truthiness check: `false` and `0` are legitimate
            // setting values, and `??`/`||` on a lookup miss would silently turn an
            // explicit opt-out back on.
            return key in settings ? (settings[key] as T) : defaultValue;
        },

        getWorkspaceFolder(): string | undefined {
            return workspaceFolder;
        },

        getGlobalStorageDir(): string {
            return globalStorageDir;
        },

        // No UI exists, so user-facing notifications become log lines. They are not
        // dropped: a resume failure or a bad tool policy is exactly what an operator
        // reading the agent's output needs to see.
        showError(message: string): void {
            logger.error(`[ACP] ${message}`);
        },

        showWarning(message: string): void {
            logger.warn(`[ACP] ${message}`);
        },

        /**
         * The method that would otherwise hang the agent.
         *
         * It exists so a UI can ask a human which way to recover. With no human, it
         * must answer immediately — awaiting anything here blocks the session start
         * forever, and an ACP client would see a request that never returns.
         *
         * `'new'` rather than `'retry'`: the manager only asks after its retry
         * attempts are exhausted, so answering 'retry' re-enters a loop that has
         * already failed. A fresh session is the outcome that makes progress.
         */
        async askSessionRecovery(
            sessionId: string,
            errorType: ErrorType,
            attemptCount: number,
            lastError: Error
        ): Promise<'retry' | 'new'> {
            logger.warn(
                `[ACP] session ${sessionId} could not be resumed after ${attemptCount} attempt(s) ` +
                `(${errorType}: ${lastError.message}); starting a new session`
            );
            return 'new';
        }

        // `getActiveAgent` and `createMessageEnhancer` are deliberately absent rather
        // than present-and-empty. Both are optional on HostBridge and the manager
        // probes them with `?.` — omitting them selects the no-op paths, whereas a
        // stub would claim a capability this process does not have (there is no
        // editor to enhance a prompt from, and no UI holding a pinned agent).
    };
}
