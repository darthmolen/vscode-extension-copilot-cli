/**
 * One chat session, owned end to end.
 *
 * Before this, "the session" was three module-level globals in `extension.ts` —
 * a `sessionManager`, the `BackendState` singleton and the slash-command services
 * built during handler registration. That works while exactly one chat surface
 * exists and breaks the moment a second one opens.
 *
 * A host owns what belongs to a conversation: its id, its transcript, and (from
 * later steps) its `SDKSessionManager` and event wiring. What belongs to the
 * *window* — workspace path, active file, MCP state — is injected as a shared
 * `WorkspaceRuntimeState`, so the sharing is visible at the composition root
 * instead of hidden behind a global lookup.
 *
 * Deliberately free of `vscode` and SDK imports so it is requirable from a plain
 * mocha process; see `chatHtml.ts` for the same constraint and the reason.
 */

import { SessionState, WorkspaceRuntimeState } from '../../backendState';
import { LoggerLike } from '../../logger';
import type { InfoSlashHandlers } from '../services/slashCommands/InfoSlashHandlers';
import type { CodeReviewSlashHandlers } from '../services/slashCommands/CodeReviewSlashHandlers';
import type { NotSupportedSlashHandlers } from '../services/slashCommands/NotSupportedSlashHandlers';
import type { MCPConfigurationService } from '../services/mcpConfigurationService';
import type { CLIPassthroughService } from '../services/CLIPassthroughService';

/**
 * The slash-command collaborators one session owns.
 *
 * Type-only imports: these classes are constructed by the composition root, never
 * here, so nothing in this module pulls them in at runtime.
 */
export interface ChatSessionServices {
    infoHandlers: InfoSlashHandlers;
    codeReviewHandlers: CodeReviewSlashHandlers;
    notSupportedHandlers: NotSupportedSlashHandlers;
    mcpConfigService: MCPConfigurationService;
    cliPassthroughService: CLIPassthroughService;
}

/**
 * Builds the slash-command services belonging to one session.
 *
 * Injected rather than called directly so this module stays clear of the config
 * plumbing those services need, and so the composition root keeps the choice of
 * which collaborators are shared per window (MCP registry, config service) and
 * which are rebuilt per session.
 */
export type ChatSessionServicesFactory = (host: ChatSessionHost) => ChatSessionServices;

export interface ChatSessionHostDeps {
    /**
     * Stable identity for logs, independent of the session id — which may be null,
     * and may change. Without it a collision between two hosts claiming one session
     * is noticeable but not diagnosable.
     */
    handle: string;
    /**
     * The CLI session this host speaks for, when there is one.
     *
     * `null` is the normal state for a host that exists before the CLI has
     * assigned an id — the sidebar's host is built at activation, but the id only
     * arrives once `manager.start()` has returned. See `adoptSessionId`.
     */
    sessionId: string | null;
    /** Window-scoped state, shared with every other host. */
    workspace: WorkspaceRuntimeState;
    logger: LoggerLike;
    createServices?: ChatSessionServicesFactory;
    /**
     * Told whenever this host takes on a session id, so whoever indexes hosts by
     * id stays correct no matter who called `adoptSessionId`.
     */
    onAdoptSessionId?: (host: ChatSessionHost, previousSessionId: string | null) => void;
}

export class ChatSessionHost {
    /** Stable across this host's whole life, unlike `sessionId`. */
    public readonly handle: string;

    private currentSessionId: string | null;
    /** This conversation's state. One per host — never shared. */
    public readonly state: SessionState;
    /** Shared window state. Injected, not reached for. */
    public readonly workspace: WorkspaceRuntimeState;

    private readonly logger: LoggerLike;
    private readonly disposeCallbacks: Array<() => void> = [];
    private readonly createServices?: ChatSessionServicesFactory;
    private readonly onAdoptSessionId?: (host: ChatSessionHost, previousSessionId: string | null) => void;
    private builtServices?: ChatSessionServices;

    constructor(deps: ChatSessionHostDeps) {
        this.handle = deps.handle;
        this.currentSessionId = deps.sessionId;
        this.workspace = deps.workspace;
        this.logger = deps.logger;
        this.createServices = deps.createServices;
        this.onAdoptSessionId = deps.onAdoptSessionId;

        this.state = new SessionState();
        this.state.setSessionId(deps.sessionId);
    }

    /** The CLI session this host speaks for, or `null` before one has started. */
    public get sessionId(): string | null {
        return this.currentSessionId;
    }

    /**
     * Take on the id the CLI assigned. The transcript is untouched — messages sent
     * while the session was starting belong to the session that starts.
     */
    public adoptSessionId(sessionId: string): void {
        const previousSessionId = this.currentSessionId;
        this.currentSessionId = sessionId;
        this.state.setSessionId(sessionId);
        this.logger.info(`[ChatSessionHost] adopted session ${sessionId}`);
        this.onAdoptSessionId?.(this, previousSessionId);
    }

    /**
     * This session's slash-command services, built on first read and kept.
     *
     * Lazy because a host may be created to answer "is this session live?" long
     * before anything asks it to handle a slash command.
     */
    public get services(): ChatSessionServices {
        if (!this.builtServices) {
            if (!this.createServices) {
                throw new Error(
                    `[ChatSessionHost ${this.sessionId}] no service factory was supplied`
                );
            }
            this.builtServices = this.createServices(this);
        }
        return this.builtServices;
    }

    /**
     * Register cleanup to run when this host is torn down.
     *
     * A local callback list rather than `DisposableStore`, which imports `vscode`
     * and would take this module out of reach of the unit suite.
     */
    public onDispose(callback: () => void): void {
        this.disposeCallbacks.push(callback);
    }

    /** Tear down everything this session owns. */
    public dispose(): void {
        for (const callback of this.disposeCallbacks) {
            try {
                callback();
            } catch (error) {
                // One bad teardown must not strand the rest.
                this.logger.error(
                    `[ChatSessionHost ${this.sessionId}] dispose callback failed`,
                    error instanceof Error ? error : undefined
                );
            }
        }
        this.disposeCallbacks.length = 0;
    }
}
