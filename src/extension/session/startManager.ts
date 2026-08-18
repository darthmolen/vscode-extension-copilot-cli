/**
 * The composition root's answer to "start this host's session".
 *
 * Extracted from an inline closure in `activate()` for one reason: the closure
 * was `async () => resumeAndStartSession(context)`, which discards the
 * `{ sessionId, resume }` the host computed. TypeScript cannot catch that — a
 * zero-argument function is assignable to a one-argument type — so opening or
 * restoring a surface for session X resumed whatever the mtime heuristic picked,
 * and nothing failed. A named function with its collaborators injected is a seam
 * a test can stand on.
 *
 * Free of `vscode` and SDK imports, like the rest of `session/`.
 */

import { RunningSessionLike } from './sessionStartPlan';

export interface StartManagerDeps<TManager extends RunningSessionLike> {
    /** Resume-or-start for this window. `extension.ts` binds the context. */
    resumeAndStart(request: { sessionId?: string | null }): Promise<void>;
    /** The manager that resulted, or null if the start failed. */
    getManager(): TManager | null;
    logger: { warn(message: string): void };
}

export function createStartManager<TManager extends RunningSessionLike>(
    deps: StartManagerDeps<TManager>
): (options: { sessionId: string | null; resume: boolean }) => Promise<TManager> {
    return async ({ sessionId }) => {
        await deps.resumeAndStart({ sessionId });

        const manager = deps.getManager();
        if (!manager) {
            throw new Error('CLI session failed to start');
        }

        // The guard that would have caught C2 at runtime. A manager for some other
        // session is worse than none: the host attaches to it and the surface shows
        // a conversation nobody asked for. An id-less manager is fine — a fresh
        // session adopts its id moments later.
        const started = manager.getSessionId();
        if (sessionId && started && started !== sessionId) {
            throw new Error(
                `Asked to start session ${sessionId} but got ${started}`
            );
        }

        return manager;
    };
}
