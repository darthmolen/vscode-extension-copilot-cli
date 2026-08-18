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

import { SessionState, WorkspaceRuntimeState, FullState, composeFullState } from '../../backendState';
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
    notifyToolStart(toolState: any): void;
    updateToolExecution(toolState: any): void;
    startSubagent(subagent: any): void;
    subagentMessage(subagent: any): void;
    completeSubagent(subagent: any): void;
    setSessionActive(active: boolean): void;
    sendModelSwitched(model: string, success: boolean): void;
    postMessage(message: any): void;
    notifyDiffAvailable(diff: any): void;
    /** The VS Code workspace folder this surface resolves relative images against. */
    setWorkspacePath(workspacePath: string | undefined): void;
    sendAvailableModels(models: Array<{ id: string; name: string; multiplier?: number; outputPrice?: number }>): void;
    setValidateAttachmentsCallback(callback: (filePaths: string[]) => Promise<{ valid: boolean; error?: string }>): void;
    /** Render this surface's whole state from cold. */
    sendInit(): void;
    /** Bring this surface to the front — what the collision rule does instead of
     *  opening a second one for a session that already has a surface. */
    show(preserveFocus?: boolean): void;
    dispose(): void;
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
    onDidStartTool(handler: (toolState: any) => void): Unsubscribe;
    onDidUpdateTool(handler: (toolState: any) => void): Unsubscribe;
    onDidCompleteTool(handler: (toolState: any) => void): Unsubscribe;
    onDidStartSubagent(handler: (subagent: { agentId: string; [k: string]: any }) => void): Unsubscribe;
    onDidSubagentMessage(handler: (subagent: any) => void): Unsubscribe;
    onDidCompleteSubagent(handler: (subagent: any) => void): Unsubscribe;
    onDidChangeStatus(handler: (status: { status: string; model?: string; newSessionId?: string; [k: string]: any }) => void): Unsubscribe;
    onDidProduceDiff(handler: (diffData: any) => void): Unsubscribe;
    onDidUpdateUsage(handler: (usage: any) => void): Unsubscribe;

    // Commands. Named for what the session does, not for the SDK call underneath,
    // so the host can speak ACP's verbs to its callers.
    sendMessage(
        text: string,
        attachments?: unknown,
        isRetry?: boolean,
        isSteering?: boolean,
        agentName?: string
    ): unknown;
    abortMessage(): Promise<void> | void;
    switchModel(model: string): Promise<void>;
    compactSession(): Promise<any>;
    selectAgent(agentName: string): Promise<void>;
    deselectAgent(): Promise<void>;
    reloadAgents(): Promise<void>;
}

export interface PromptOptions {
    attachments?: unknown;
    agentName?: string;
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
     * What starting means when this host has no session id.
     *
     * `'window-default'` — the sidebar at activation: bring back the last
     * conversation if `copilotCLI.resumeLastSession` says so.
     * `'new'` — a *New Tab*: the gesture said new, so neither the setting nor the
     * most-recent-by-mtime heuristic gets a vote.
     *
     * Both cases have a null session id, which is why this cannot be inferred.
     * Defaults to `'window-default'`, the behaviour that shipped.
     */
    whenNoSession?: 'window-default' | 'new';
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
    /**
     * This conversation's state. Supplied rather than built when the host must
     * share a transcript with something else — during the migration the sidebar's
     * host shares the `BackendState` facade's instance, because `ChatViewProvider`
     * still records messages through it. A host that builds its own would read an
     * empty transcript while the surface wrote to another.
     */
    state?: SessionState;
    logger: LoggerLike;
    createServices?: ChatSessionServicesFactory;
    /**
     * Brings a CLI session into being and hands back its manager.
     *
     * Injected because building one needs the extension host. The host decides
     * *whether* to call it; this only does it.
     */
    startManager?: (options: { sessionId: string | null; resume: boolean; fresh: boolean; host: ChatSessionHost }) => Promise<SessionManagerLike>;
    /** Window-scoped, memoised colour allocator shared with the sub-agent panels. */
    assignSubagentColor?: (agentId: string) => string;
    /**
     * Reads the before/after files and computes the inline diff. Injected because
     * it is filesystem work — the host routes the result, it does not do I/O.
     */
    enrichDiff?: (diffData: any) => any;
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
    private readonly assignSubagentColor?: (agentId: string) => string;
    private readonly enrichDiff?: (diffData: any) => any;
    private readonly startManager?: (options: { sessionId: string | null; resume: boolean; fresh: boolean; host: ChatSessionHost }) => Promise<SessionManagerLike>;
    private readonly whenNoSession: 'window-default' | 'new';
    /** In flight, so two surfaces attaching at once cannot start two sessions. */
    private starting?: Promise<void>;
    private live = false;
    private readonly onAdoptSessionId?: (host: ChatSessionHost, previousSessionId: string | null) => void;
    private builtServices?: ChatSessionServices;
    private surface?: ChatSurface;
    private readonly managerSubscriptions: Unsubscribe[] = [];
    /**
     * A true `#private` field, not a TypeScript `private`.
     *
     * TypeScript's is erased at runtime, so `host.manager` would still resolve and
     * a JS call site could reach straight through to the SDK. Task 5 rerouted 75
     * call sites through this host precisely so v4.0 can swap the manager for an
     * AHP session handle without touching them; a guarantee that only holds while
     * everyone compiles is not the guarantee that was wanted.
     */
    #manager?: SessionManagerLike;

    constructor(deps: ChatSessionHostDeps) {
        this.handle = deps.handle;
        this.currentSessionId = deps.sessionId;
        this.workspace = deps.workspace;
        this.logger = deps.logger;
        this.createServices = deps.createServices;
        this.assignSubagentColor = deps.assignSubagentColor;
        this.enrichDiff = deps.enrichDiff;
        this.startManager = deps.startManager;
        this.whenNoSession = deps.whenNoSession ?? 'window-default';
        this.onAdoptSessionId = deps.onAdoptSessionId;

        this.state = deps.state ?? new SessionState();
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
     * Point this host at what renders it.
     *
     * Attachment on its own starts nothing — that is the whole separation. A
     * surface that wants the session running asks for it with `ensureStarted()`.
     */
    public attachSurface(surface: ChatSurface): void {
        this.surface = surface;
    }

    /**
     * Everything the surface showing this host needs to render itself from cold.
     *
     * The surface used to build this from `getBackendState()`, which is the window
     * singleton — correct only while the sidebar was the only surface. A panel
     * reading that would render the sidebar's conversation.
     */
    public getFullState(): FullState {
        return composeFullState(this.state, this.workspace);
    }

    /**
     * What is rendering this host, if anything.
     *
     * Deliberately unlike `.manager`, which is a true `#private`: the manager moves
     * across a process boundary in v4.0 and call sites written against it would not
     * survive, whereas surfaces are ours and stay extension-side. Session bootstrap
     * at the composition root needs to reach *this* host's surface — telling the
     * sidebar a panel's session just started is the bug this exists to prevent.
     */
    public getSurface(): ChatSurface | undefined {
        return this.surface;
    }

    /**
     * This host has nothing rendering it any more.
     *
     * A closed tab must say so. Left attached, the host keeps writing into a
     * webview that no longer exists — and worse, `registry.get(id)?.getSurface()`
     * still reports a live surface, so reopening the tab reveals a dead one and the
     * session becomes unreachable.
     *
     * Guarded on identity: a surface that has already been replaced by another must
     * not be able to detach its successor on the way out.
     */
    public detachSurface(surface?: ChatSurface): void {
        if (surface && this.surface !== surface) {
            return;
        }
        this.surface = undefined;
    }

    /** Whether a CLI session is running for this host right now. */
    public get isLive(): boolean {
        return this.live;
    }

    /**
     * Make sure this host has a running session, and only then.
     *
     * The three cases the plan names, in one place:
     *
     *  (a) already live  — return immediately, start nothing. This is what a tab
     *      attaching to a streaming session must do, and what `onDidBecomeReady`
     *      got wrong by calling `resumeAndStartSession` unconditionally.
     *  (b) known session, not running — resume it.
     *  (c) no session id — start a fresh one.
     *
     * Replaying the transcript is deliberately *not* here. ACP separates
     * `session/resume` from `session/load`, and so do we: this brings the session
     * back, the reader shows its history.
     */
    public ensureStarted(): Promise<void> {
        if (this.live) {
            return Promise.resolve();
        }
        // Concurrent callers share one attempt rather than racing two starts.
        if (this.starting) {
            return this.starting;
        }
        if (!this.startManager) {
            return Promise.reject(new Error(
                `[ChatSessionHost ${this.handle}] no way to start a session was supplied`
            ));
        }

        const resume = this.currentSessionId !== null;
        // Only a host that has *never* had a session can be asking for a new one.
        // Once it has adopted an id it is case (b) — resume this session — and
        // treating it as fresh would abandon the conversation it is showing.
        const fresh = !resume && this.whenNoSession === 'new';
        this.starting = this.startManager({ sessionId: this.currentSessionId, resume, fresh, host: this })
            .then((manager) => {
                this.attachManager(manager);
                this.live = true;
            })
            .finally(() => {
                // Cleared either way: a failed start must leave the host retryable.
                this.starting = undefined;
            });
        return this.starting;
    }

    /** The session ended — the host stays, and can be started again. */
    public markStopped(): void {
        this.live = false;
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
        this.live = true;
        // A host outlives its managers — every restart and session switch builds a
        // new one. Replace the wiring rather than adding to it, or each restart
        // doubles every message on screen.
        this.detachManager();
        this.#manager = manager;

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

        this.subscribe(manager.onDidStartTool((toolState) => {
            this.surface?.notifyToolStart(toolState);
        }));

        // Update and complete are the same thing to a surface: the tool's state
        // changed. Only the terminal status differs, and it is inside the payload.
        this.subscribe(manager.onDidUpdateTool((toolState) => {
            this.surface?.updateToolExecution(toolState);
        }));

        this.subscribe(manager.onDidCompleteTool((toolState) => {
            this.surface?.updateToolExecution(toolState);
        }));

        this.subscribe(manager.onDidStartSubagent((subagent) => {
            // Colour is assigned through the window-scoped, memoised allocator, so
            // this surface and the pop-out panels agree on the colour for an agent
            // without having to share a call site.
            const color = this.assignSubagentColor?.(subagent.agentId);
            this.surface?.startSubagent(color ? { ...subagent, color } : subagent);
        }));

        this.subscribe(manager.onDidSubagentMessage((subagent) => {
            this.surface?.subagentMessage(subagent);
        }));

        this.subscribe(manager.onDidCompleteSubagent((subagent) => {
            this.surface?.completeSubagent(subagent);
        }));

        this.subscribe(manager.onDidChangeStatus((statusData) => {
            this.applyStatus(statusData);
        }));

        this.subscribe(manager.onDidProduceDiff((diffData) => {
            this.surface?.notifyDiffAvailable(this.enrichDiff ? this.enrichDiff(diffData) : diffData);
        }));

        this.subscribe(manager.onDidUpdateUsage((usageData) => {
            this.surface?.postMessage({ type: 'usage_info', data: usageData });
        }));
    }

    /**
     * The half of a status change that belongs to one conversation.
     *
     * The window's half — status bar, toasts, the session dropdown — deliberately
     * stays in `extension.ts`. A background tab must not rewrite the window's
     * status bar because its own CLI exited.
     */
    private applyStatus(statusData: { status: string; model?: string; newSessionId?: string }): void {
        switch (statusData.status) {
            case 'thinking':
                this.surface?.setThinking(true);
                break;
            case 'ready':
                this.surface?.setThinking(false);
                break;
            case 'exited':
            case 'stopped':
                // No longer live, so a later `ensureStarted()` may bring it back
                // rather than assuming a session is still running.
                this.markStopped();
                this.state.setSessionActive(false);
                this.surface?.setSessionActive(false);
                break;
            case 'aborted':
                this.surface?.addAssistantMessage('_Generation stopped by user._');
                this.surface?.setThinking(false);
                break;
            case 'session_expired':
                // The CLI replaced the session underneath us. Adopting re-indexes
                // this host, so a later lookup by the new id finds it.
                if (statusData.newSessionId) {
                    this.adoptSessionId(statusData.newSessionId);
                }
                break;
            case 'model_switched':
                this.state.setCurrentModel(statusData.model || null);
                this.surface?.sendModelSwitched(statusData.model || '', true);
                break;
            case 'model_switch_failed':
                this.surface?.sendModelSwitched(statusData.model || '', false);
                break;
            case 'plan_accepted':
                this.surface?.postMessage({ type: 'status', data: statusData });
                // Shown at once; cleared when the first CLI response arrives.
                this.surface?.setThinking(true);
                break;
            case 'plan_mode_enabled':
            case 'plan_mode_disabled':
            case 'plan_rejected':
            case 'plan_ready':
            case 'reset_metrics':
                this.surface?.postMessage({ type: 'status', data: statusData });
                break;
            default:
                // `session_renamed` and anything new: window-scoped or nothing to show.
                break;
        }
    }

    // ── Commands ─────────────────────────────────────────────────────────────
    //
    // Every one of these used to be a call to the module-level `sessionManager` in
    // `extension.ts`, which answers "the window's session" rather than "this
    // surface's". They are silent when no manager is attached: the CLI may have
    // failed to start, and a user can still press the buttons.

    /**
     * Send a turn to this session. ACP's `session/prompt`.
     */
    public async prompt(text: string, options: PromptOptions = {}): Promise<void> {
        await this.#manager?.sendMessage(text, options.attachments, false, false, options.agentName);
    }

    /**
     * Stop the current turn. ACP's `session/cancel`, and **fire-and-forget on
     * purpose**: on the wire it is a notification and an `AbortSignal` agent-side,
     * so a Promise-returning cancel would not survive v4.0's process boundary.
     */
    public cancel(): void {
        void this.#manager?.abortMessage();
    }

    public async switchModel(model: string): Promise<void> {
        await this.#manager?.switchModel(model);
    }

    public async compact(): Promise<any> {
        return this.#manager?.compactSession();
    }

    /** `null` clears the selection — one call rather than two verbs at every site. */
    public async selectAgent(agentName: string | null): Promise<void> {
        if (agentName) {
            await this.#manager?.selectAgent(agentName);
        } else {
            await this.#manager?.deselectAgent();
        }
    }

    public async reloadAgents(): Promise<void> {
        await this.#manager?.reloadAgents();
    }

    /**
     * Rename this session.
     *
     * The CLI takes this as a slash command rather than an RPC, so it travels as a
     * prompt. Kept in one place so that quirk does not spread to call sites.
     */
    public async rename(name: string): Promise<void> {
        await this.#manager?.sendMessage(`/rename ${name}`);
    }

    /** Stop routing whatever manager is currently attached. */
    public detachManager(): void {
        for (const subscription of this.managerSubscriptions) {
            subscription.dispose();
        }
        this.managerSubscriptions.length = 0;
        this.#manager = undefined;
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
        this.live = false;
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
