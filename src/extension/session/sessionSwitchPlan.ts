/**
 * What "switch to session X" should actually do, given what this window already has.
 *
 * `handleSwitchSession` used to stop the module-level manager — since Task 7,
 * possibly another surface's — and then build a **second** `SDKSessionManager`
 * resuming the same id. Two managers, one session directory, and the surface the
 * user was looking at silently dead.
 *
 * `ChatPanelService.openSession` already followed the right rule. Writing it down
 * once, here, is what stops the dropdown and the panel service from drifting: this
 * cycle's recurring failure is one truth living in two places, kept in step by
 * memory.
 *
 * Free of `vscode` and SDK imports, like `planSessionStart` beside it — a module
 * that imports `vscode` can only be tested by patching `Module.prototype.require`,
 * a documented cause of this suite's cross-file flake.
 */

/** The slice of a host this decision reads. */
export interface SwitchTargetLike {
    getSurface(): unknown | undefined;
}

export type SessionSwitchPlan<H extends SwitchTargetLike> =
    /** The requester is already showing it. Stop nothing, start nothing. */
    | { action: 'already-here' }
    /**
     * Another surface has it. **Reveal that surface, never steal the session.**
     * Stealing would blank a live conversation out from under whoever is watching
     * it, and one-session-one-surface is the invariant the task rests on.
     */
    | { action: 'reveal'; host: H }
    /**
     * The host is alive but nothing is rendering it — its tab was closed and the
     * wind-down is pending. Attach the requesting surface and cancel that
     * countdown; do not start a second manager for a session already running.
     */
    | { action: 'reattach'; host: H }
    /** This window has no host for it at all. Resume from disk, as before. */
    | { action: 'resume' };

export function planSessionSwitch<H extends SwitchTargetLike>(
    sessionId: string,
    requester: H | undefined,
    lookup: (sessionId: string) => H | undefined
): SessionSwitchPlan<H> {
    const incumbent = lookup(sessionId);

    if (!incumbent) {
        return { action: 'resume' };
    }
    if (incumbent === requester) {
        return { action: 'already-here' };
    }
    return incumbent.getSurface()
        ? { action: 'reveal', host: incumbent }
        : { action: 'reattach', host: incumbent };
}
