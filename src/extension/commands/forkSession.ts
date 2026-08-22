/**
 * The fork-session command's decision logic.
 *
 * Deliberately free of `vscode` and of module-level state: everything it needs
 * arrives through `ForkSessionDeps`. That is what makes it testable — the
 * version that lived inside `extension.ts` reached for three globals and a
 * module-private helper, so it had no signature and therefore no tests.
 *
 * `extension.ts` keeps a thin binder that assembles these deps from its
 * globals; the binder is small enough to be correct by inspection.
 */

import type { LoggerLike } from '../../logger';

/** User-facing notifications, so this module never touches `vscode.window`. */
export interface ForkNotifier {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export interface ForkSessionDeps {
    /** The session to fork, or null when nothing is active. */
    getSessionId(): string | null;
    /** Performs the fork and resolves to the new session id. */
    fork(sessionId: string, opts: { sessionStateDir: string }): Promise<string>;
    /**
     * Shows the fork. **Not** "switches to it" — v3.13.0 Task 10 opens the copy in
     * an editor tab and leaves the surface you were on where it was.
     *
     * The rename is not cosmetic: the old name described the old behaviour, and a
     * caller reading `switchTo` would reasonably assume the sidebar had moved.
     */
    showFork(sessionId: string): Promise<void>;
    /**
     * A human label for a session, when there is one.
     *
     * The toast names the fork because the user is not looking at it — it opened
     * elsewhere — so "it worked" is not enough to find it by.
     */
    nameOf(sessionId: string): string | null;
    notify: ForkNotifier;
    logger: LoggerLike;
    sessionStateDir: string;
}

/**
 * Fork the active session and open the copy in a tab.
 *
 * Never throws: a failed fork is reported to the user and leaves them on the
 * parent, which is the safe outcome. Success is only reported once the fork has
 * also been *shown*, so a half-completed fork is never announced as done.
 */
export async function forkCurrentSession(deps: ForkSessionDeps): Promise<void> {
    const sourceSessionId = deps.getSessionId();
    if (!sourceSessionId) {
        deps.notify.warn('No active session to fork.');
        return;
    }

    try {
        deps.logger.info(`[Fork Session] Forking session ${sourceSessionId}`);
        const newSessionId = await deps.fork(sourceSessionId, {
            sessionStateDir: deps.sessionStateDir
        });
        deps.logger.info(`[Fork Session] Created fork: ${newSessionId}`);

        await deps.showFork(newSessionId);
        // Named, and honest about where it went. The old message — "you are now on
        // the fork" — was true when forking switched the sidebar underneath you.
        // It is now false, and a toast that misdescribes where you are is worse
        // than none: the parent is still in front of you.
        const name = deps.nameOf(newSessionId);
        deps.notify.info(
            name ? `Forked to "${name}" — opened in a tab.` : 'Session forked — opened in a tab.'
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.logger.error(
            `[Fork Session] Fork failed: ${message}`,
            error instanceof Error ? error : undefined
        );
        deps.notify.error(`Failed to fork session: ${message}`);
    }
}
