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
    /** Resume-or-start for this window. `extension.ts` binds the context. */
    resumeAndStart(request: { sessionId?: string | null; fresh?: boolean; host?: ChatSessionHost }): Promise<void>;
    /** The manager that resulted, or null if the start failed. */
    getManager(): TManager | null;
    logger: { warn(message: string): void };
}

export function createStartManager<TManager extends RunningSessionLike>(
    deps: StartManagerDeps<TManager>
): (options: { sessionId: string | null; resume: boolean; fresh?: boolean; host?: ChatSessionHost }) => Promise<TManager> {
    return async ({ sessionId, fresh, host }) => {
        // Captured before, so a request for a *new* session can tell whether one
        // was actually started or whether it is being handed the incumbent.
        const alreadyRunning = deps.getManager();

        // The host travels with the request because a *fresh* session has no id
        // yet, so nothing else identifies which host the bootstrap belongs to.
        await deps.resumeAndStart({ sessionId, fresh, host });

        const manager = deps.getManager();
        if (!manager) {
            throw new Error('CLI session failed to start');
        }

        // The tab defect, caught at runtime. `openNew` asks for a new session; if
        // the start path declines — because it re-asked "is anything running" and
        // answered yes — this hands back the incumbent, the new host attaches to
        // it, and both surfaces render one conversation. The session-id check
        // below cannot see it: a fresh request names nothing to compare against.
        if (fresh && manager === alreadyRunning) {
            throw new Error(
                'Asked to start a new session but got the one already running'
            );
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
