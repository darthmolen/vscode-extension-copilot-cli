/**
 * Which model a session starts on.
 *
 * CLAUDE.md's *"intentional actions are treated intentionally"*, applied to model
 * choice. Switching model mid-session is a **gesture**; `copilotCLI.model` is a
 * standing **default**. Honouring the gesture and not recording it means the
 * default silently wins back at the next resume — so the user's own choice is the
 * one thing that does not survive.
 *
 * The precedence is therefore: what this session recorded, then the configured
 * default, then the fallback. Which also gives the setting the scope the backlog
 * asks for — it governs **new** sessions, because only a new session has nothing
 * recorded.
 *
 * Free of `vscode` and of the filesystem: the read belongs to `SessionService`,
 * which already owns `~/.copilot/session-state` I/O. This is only the ordering,
 * because the ordering is the part that was wrong.
 */

export interface StartupModelInputs {
    /** What this session recorded the last time its model was switched. */
    persisted: string | null | undefined;
    /** `copilotCLI.model`. Empty means unset, not "a model called empty string". */
    configured: string | null | undefined;
    /** `DEFAULT_MODEL` — resolves to the server-side router picking per turn. */
    fallback: string;
}

export function chooseStartupModel(inputs: StartupModelInputs): string {
    return nonEmpty(inputs.persisted) ?? nonEmpty(inputs.configured) ?? inputs.fallback;
}

function nonEmpty(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
