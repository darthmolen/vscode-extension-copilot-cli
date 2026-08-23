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
import type { ChatSessionHost } from './ChatSessionHost';

export interface StartManagerDeps<TManager extends RunningSessionLike> {
    /**
     * Resume-or-start for this window. `extension.ts` binds the context.
     *
     * Returns the manager it started, when it started one. That return value is
     * load-bearing: two starts can run concurrently on a window reload — a restored
     * tab's fresh session and the sidebar's ambient resume — and reading a shared
     * handle back afterwards gave whichever finished last. Returning it keeps each
     * start's own manager with its own caller.
     */
    resumeAndStart(request: { sessionId?: string | null; fresh?: boolean; host?: ChatSessionHost }):
        Promise<TManager | null | undefined | void>;
    logger: { warn(message: string): void };
}

export function createStartManager<TManager extends RunningSessionLike>(
    deps: StartManagerDeps<TManager>
): (options: { sessionId: string | null; resume: boolean; fresh?: boolean; host?: ChatSessionHost }) => Promise<TManager> {
    return async ({ sessionId, fresh, host }) => {
        // The host travels with the request because a *fresh* session has no id
        // yet, so nothing else identifies which host the bootstrap belongs to.
        const started = await deps.resumeAndStart({ sessionId, fresh, host });

        // Only the manager this call produced. There used to be a `getManager()`
        // fallback to the window's handle for the case where the start path
        // declined to start anything — and that fallback is how *New Tab* attached
        // a second host to the sidebar's running manager, two surfaces rendering
        // one conversation. P3 gave every host its own manager, so there is no
        // window handle left to fall back to, and "nothing was started" is now what
        // it always meant: a failure, said out loud.
        if (!started) {
            throw new Error('CLI session failed to start');
        }
        const manager = started;

        // The guard that would have caught C2 at runtime. A manager for some other
        // session is worse than none: the host attaches to it and the surface shows
        // a conversation nobody asked for. An id-less manager is fine — a fresh
        // session adopts its id moments later.
        const startedSessionId = manager.getSessionId();
        if (sessionId && startedSessionId && startedSessionId !== sessionId) {
            throw new Error(
                `Asked to start session ${sessionId} but got ${startedSessionId}`
            );
        }

        return manager;
    };
}
