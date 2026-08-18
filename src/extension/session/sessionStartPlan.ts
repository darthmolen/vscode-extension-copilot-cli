/**
 * What a session-start request should actually do, given what is already running.
 *
 * Free of `vscode` and SDK imports on purpose — same rule as `ChatSessionHost`
 * and `ChatSessionRegistry`: a module that imports `vscode` can only be tested by
 * patching `Module.prototype.require`, which is a documented cause of the suite's
 * cross-file flake.
 *
 * This exists because the guard it replaces asked the wrong question. The old
 * `if (sessionManager && sessionManager.isRunning()) { return; }` answers *"is any
 * session running in this window"*, which was true enough while the sidebar was
 * the only surface. Once a second surface can ask for a session by name, that
 * guard hands the caller whichever manager happened to be running — a different
 * session's — and the surface wires itself to the wrong conversation.
 *
 * The distinction it draws is CLAUDE.md's "intentional actions are treated
 * intentionally": a request naming a session is a stated intent, so the
 * `resumeLastSession` setting and the most-recent-by-mtime heuristic do not get a
 * vote. A request naming nothing is the ambient startup path, unchanged.
 */

/** The slice of a session manager this decision reads. */
export interface RunningSessionLike {
    isRunning(): boolean;
    getSessionId(): string | null | undefined;
}

export interface SessionStartRequest {
    /**
     * A session the caller specifically wants back — a restored tab, a session
     * switch, a host that already knows its id. Null or absent means "whatever
     * this window would normally open".
     */
    sessionId?: string | null;
    /**
     * The caller wants a brand-new conversation, not this window's last one.
     *
     * *New Tab* means new. Without this, a surface with no session id is
     * indistinguishable from the sidebar at activation, whose null id means
     * "restore my last conversation if `resumeLastSession` says so" — so opening a
     * tab would resume the sidebar's session into it.
     */
    fresh?: boolean;
}

export interface SessionStartPlan {
    /** The running manager already *is* what was asked for; start nothing. */
    reuseRunning: boolean;
    /** The session to start the CLI against, or undefined for the ambient choice. */
    requestedSessionId: string | undefined;
    /** Whether the resume setting and the mtime heuristic still get to speak. */
    consultAmbient: boolean;
    /** Start a new conversation rather than bringing any old one back. */
    fresh: boolean;
}

export function planSessionStart(
    request: SessionStartRequest,
    running: RunningSessionLike | null | undefined
): SessionStartPlan {
    const wanted = request.sessionId ?? undefined;
    const live = running?.isRunning() === true;

    if (request.fresh) {
        // Nothing already running can satisfy "give me a new conversation".
        return { reuseRunning: false, requestedSessionId: undefined, consultAmbient: false, fresh: true };
    }

    if (wanted === undefined) {
        // Nothing named: the window's own session is as good an answer as any.
        return live
            ? { reuseRunning: true, requestedSessionId: undefined, consultAmbient: false, fresh: false }
            : { reuseRunning: false, requestedSessionId: undefined, consultAmbient: true, fresh: false };
    }

    // Named: only the *same* session counts as already satisfied. A manager with
    // no id yet cannot be it — an unadopted session is not the one asked for.
    const alreadyThatSession = live && running?.getSessionId() === wanted;
    return alreadyThatSession
        ? { reuseRunning: true, requestedSessionId: wanted, consultAmbient: false, fresh: false }
        : { reuseRunning: false, requestedSessionId: wanted, consultAmbient: false, fresh: false };
}
