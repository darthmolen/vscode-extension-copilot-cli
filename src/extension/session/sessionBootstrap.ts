/**
 * Session bootstrap, aimed at a host instead of at the window.
 *
 * `onSessionStarted` used to write the new session's id, active flag, workspace
 * path and model into the `BackendState` singleton, then adopt the id onto
 * `sidebarHost` by name. `loadSessionHistory` likewise called
 * `backendState.setMessages`. Both were indistinguishable from correct while the
 * sidebar was the only surface — and both become "starting a panel's session
 * rewrites the sidebar's conversation" the moment a second host exists.
 *
 * Extracted rather than inlined so the targeting is a thing a test can drive:
 * bootstrap one host, assert the other did not move. Free of `vscode`, like the
 * rest of `session/`.
 */

import { Message } from '../../shared/models';
import { ChatSessionHost } from './ChatSessionHost';

export interface StartedSessionDetails {
    /** The id the CLI assigned, or null if it has not reported one. */
    sessionId: string | null;
    /**
     * The SDK's session-state directory — *not* the VS Code workspace folder.
     *
     * Window state rather than session state, which is where it has always lived.
     * With N sessions this is genuinely the last writer's value; it drives only the
     * "view plan" affordance, so the cost is small and the fix belongs with plan
     * mode's own design pass in Task 8 rather than here.
     */
    workspacePath: string | null;
    /** The configured default model for the session that just started. */
    model: string | null;
}

/** Record what the CLI reported when this host's session came up. */
export function recordSessionStart(host: ChatSessionHost, details: StartedSessionDetails): void {
    if (details.sessionId) {
        // Adopting also indexes the host by session id in the registry, which is
        // why it is the host's own method rather than a state write.
        host.adoptSessionId(details.sessionId);
    }
    host.state.setSessionActive(true);
    host.workspace.setWorkspacePath(details.workspacePath);
    host.state.setCurrentModel(details.model);
}

/** Replay a projected transcript into the host whose session it belongs to. */
export function loadTranscriptInto(host: ChatSessionHost, messages: Message[]): void {
    host.state.setMessages(messages);
}
