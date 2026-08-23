/**
 * Which chat surface a command-palette entry acts on.
 *
 * Every other route into a session carries its surface with it — the RPC channel
 * *is* the identity, and `registerChatHandlers` closes over one host per surface.
 * The palette is the single origin with none, which is why P3 §4.2 gives it a rule
 * rather than a fallback.
 *
 * The rule is **never pick a surface the user did not indicate**. A focused chat is
 * an indication. A window with exactly one chat has nothing to guess between, so the
 * sidebar wins there as the sole candidate rather than as a default. Anything else
 * has no answer, and the command must say so instead of driving whichever session
 * started last — the defect the whole task exists to remove.
 *
 * Free of `vscode`, like the rest of the decisions in this cycle: the composition
 * root supplies the focus flags.
 */

export interface CommandSurfaceCandidate<S> {
    surface: S;
    /** Whether this chat currently has the user's attention. */
    isActive: boolean;
}

export function resolveCommandSurface<S>(candidates: CommandSurfaceCandidate<S>[]): S | undefined {
    const active = candidates.filter(candidate => candidate.isActive);
    if (active.length === 1) {
        return active[0].surface;
    }
    // Two claiming focus is not something VS Code should report; if it does,
    // guessing between them is still the wrong answer.
    if (active.length > 1) {
        return undefined;
    }
    return candidates.length === 1 ? candidates[0].surface : undefined;
}
