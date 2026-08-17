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

/** What a subscription hands back. Structural, so `vscode.Disposable` satisfies it. */
export interface Unsubscribe {
    dispose(): void;
}

/**
 * What a host needs from whatever is rendering it.
 *
 * Declared as the slice actually used rather than by importing `ChatViewProvider`,
 * so a second implementation (Task 7's panel surface) owes nothing beyond these,
 * and so the unit suite can supply a fake.
 */
export interface ChatSurface {
    addAssistantMessage(text: string, messageId?: string): void;
    addReasoningMessage(text: string, storeInBackend?: boolean, reasoningId?: string): void;
    sendMessageDelta(messageId: string, deltaContent: string): void;
    sendReasoningDelta(reasoningId: string, deltaContent: string): void;
    sendTaskComplete(summary?: string): void;
    setThinking(isThinking: boolean): void;
}

/**
 * The slice of `SDKSessionManager` a host touches.
 *
 * Deliberately not the concrete class — v4.0 moves the manager across a process
 * boundary, and call sites written against a narrow contract survive that move.
 * Same reason `CopilotClientProvider` declares `ManagedClient` (spine S4).
 */
export interface SessionManagerLike {
    onDidReceiveOutput(handler: (data: { content: string; messageId?: string }) => void): Unsubscribe;
    onDidReceiveReasoning(handler: (data: { reasoningId?: string; content: string }) => void): Unsubscribe;
    onDidReceiveError(handler: (error: string) => void): Unsubscribe;
    onDidMessageDelta(handler: (data: { messageId: string; deltaContent: string }) => void): Unsubscribe;
    onDidReceiveReasoningDelta(handler: (data: { reasoningId: string; deltaContent: string }) => void): Unsubscribe;
    onDidTaskComplete(handler: (data?: { summary?: string }) => void): Unsubscribe;
}

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
    private surface?: ChatSurface;
    private readonly managerSubscriptions: Unsubscribe[] = [];

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

    /** Point this host at what renders it. */
    public attachSurface(surface: ChatSurface): void {
        this.surface = surface;
    }

    /**
     * Take ownership of a manager and route its events to this host's surface.
     *
     * This routing used to live in `wireManagerEvents`, closed over the single
     * module-level `chatProvider` — so every session's output reached the sidebar
     * regardless of which session produced it. Here the destination is *this*
     * host's surface, which is what makes two live sessions possible.
     */
    public attachManager(manager: SessionManagerLike): void {
        // A host outlives its managers — every restart and session switch builds a
        // new one. Replace the wiring rather than adding to it, or each restart
        // doubles every message on screen.
        this.detachManager();

        this.subscribe(manager.onDidReceiveOutput(({ content, messageId }) => {
            this.surface?.addAssistantMessage(content, messageId);
            this.surface?.setThinking(false);
        }));

        this.subscribe(manager.onDidReceiveReasoning(({ content, reasoningId }) => {
            this.surface?.addReasoningMessage(content, true, reasoningId);
        }));

        this.subscribe(manager.onDidReceiveError((error) => {
            this.logger.error(`[ChatSessionHost ${this.handle}] ${error}`);
            this.surface?.addAssistantMessage(`Error: ${error}`);
            this.surface?.setThinking(false);
        }));

        this.subscribe(manager.onDidMessageDelta(({ messageId, deltaContent }) => {
            this.surface?.sendMessageDelta(messageId, deltaContent);
        }));

        this.subscribe(manager.onDidReceiveReasoningDelta(({ reasoningId, deltaContent }) => {
            this.surface?.sendReasoningDelta(reasoningId, deltaContent);
        }));

        this.subscribe(manager.onDidTaskComplete((data) => {
            this.surface?.sendTaskComplete(data?.summary);
        }));
    }

    /** Stop routing whatever manager is currently attached. */
    public detachManager(): void {
        for (const subscription of this.managerSubscriptions) {
            subscription.dispose();
        }
        this.managerSubscriptions.length = 0;
    }

    /**
     * Hold a manager subscription until the manager is replaced or the host dies.
     *
     * Kept apart from `disposeCallbacks` because these have the shorter life of the
     * two: a host sheds managers repeatedly and is disposed once.
     */
    private subscribe(subscription: Unsubscribe): void {
        this.managerSubscriptions.push(subscription);
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
        // Dropped first: teardown below unsubscribes, but an event already queued
        // must not reach a surface this host no longer speaks for.
        this.surface = undefined;
        this.detachManager();

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
