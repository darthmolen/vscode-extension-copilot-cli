/**
 * Which session the sidebar should bring back.
 *
 * `determineSessionToResume` asked for the most recent by mtime and nothing else.
 * So switching to an older session and reading it without sending anything left no
 * trace: reload, and you were back on the newer one. The user's choice was the one
 * input the decision did not have.
 *
 * CLAUDE.md's *"intentional actions are treated intentionally"*, applied to session
 * selection — a gesture beats a heuristic, and it has to be *recorded* or the
 * heuristic quietly reasserts itself at the next boundary.
 *
 * **Scope, deliberately narrow.** This answers *which* session, never *whether* to
 * resume one. `copilotCLI.resumeLastSession` answers that and stays the user's to
 * set; recording a choice is not permission to override it.
 *
 * Free of `vscode` and of the filesystem, like the rest of `session/`.
 */

export interface SessionToResumeInputs {
    /** What this window recorded the last time the user chose a session. */
    recorded: string | null | undefined;
    /**
     * Whether a recorded session can still be brought back here — it exists on
     * disk and no other surface in this window is already showing it.
     *
     * Asked only of `recorded`. The fallback has already been filtered by
     * `getMostRecentSession`, which is given the live session ids, and re-checking
     * it here would be a second copy of one rule.
     */
    isAvailable(sessionId: string): boolean;
    /** The mtime heuristic's answer, as before. */
    mostRecent: string | null | undefined;
}

export function chooseSessionToResume(inputs: SessionToResumeInputs): string | null {
    const recorded = inputs.recorded?.trim();
    if (recorded && inputs.isAvailable(recorded)) {
        return recorded;
    }
    return inputs.mostRecent?.trim() || null;
}
