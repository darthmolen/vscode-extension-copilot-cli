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
import { applyResult } from '../services/sessionTranscriptBuilder';

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
    /**
     * Whether this surface has the user's attention, when it can tell.
     *
     * Optional because only an editor tab can answer it — VS Code exposes `active`
     * on `WebviewPanel` and nothing equivalent on `WebviewView`. A surface that
     * cannot tell says nothing rather than guessing.
     */
    isActive?(): boolean;
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

    // Plan mode, teardown and the read-only queries. These reached the module-level
    // `sessionManager` until P3 — the handle that answers "whichever session started
    // last" once a second surface exists.
    enablePlanMode(): Promise<void>;
    disablePlanMode(): Promise<void>;
    acceptPlan(): Promise<void>;
    rejectPlan(): Promise<void>;
    stop(): Promise<void>;
    // `any` rather than the SDK's `ModelInfo[]` / `McpServer[]` on purpose, matching
    // `compactSession(): Promise<any>` above. This module imports neither `vscode`
    // nor the SDK so it stays requirable from plain mocha and portable to v4.0;
    // importing SDK types for these signatures would spend that for decoration.
    getPlanFilePath(): string | undefined;
    getAvailableModels(): Promise<any[]>;
    validateAttachments(filePaths: string[]): Promise<{ valid: boolean; error?: string }>;
    listMcpServers(): Promise<any[]>;
    listConfiguredMcpServers(): Promise<Record<string, any>>;
    forkSession(sourceSessionId: string, opts?: { sessionStateDir?: string }): Promise<string>;
    /**
     * The session is quiet — no turn, no background agents, no attached shells.
     *
     * **Optional, and the host degrades honestly without it.** A manager that
     * cannot say this leaves the wind-down reading turn status instead, which is
     * blind to work that outlives the assistant's turn.
     *
     * A *signal*, not a state: it fires on every idle, is never replayed to a late
     * subscriber, and must be armed and re-armed rather than latched. Lane A's
     * emitter enforces that — a replayed signal is a lie about the present — and
     * filters out sub-agent idles, which would otherwise fire while the parent is
     * still working.
     */
    onDidBecomeIdle?(handler: () => void): Unsubscribe;
    /** End it. The host owns this — see `ChatSessionHost.dispose`. */
    dispose(): void;
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
    /**
     * This host has finished and wants to be taken out of service.
     *
     * A host cannot dispose itself cleanly — the registry holds it in two
     * collections — so the wind-down signals out and the registry does the
     * removal. Same shape and same reason as `onAdoptSessionId`.
     */
    onReleased?: (host: ChatSessionHost) => void;
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
    private readonly onReleased?: (host: ChatSessionHost) => void;
    /**
     * Whether this session has nothing in flight.
     *
     * Two sources, and the stricter one wins. A manager offering `onDidBecomeIdle`
     * reports true quiet — turn, background agents and attached shells. One that
     * does not leaves this tracking `thinking` / `ready`, which says only that the
     * assistant's turn ended.
     *
     * Starts `true`: a session nothing has been asked of has no turn to wait for,
     * and no idle will ever arrive for it.
     */
    private quiet = true;
    /** Whether this host's manager reports true idleness, or only turn boundaries. */
    private hasIdleSignal = false;
    /** A wind-down is armed and waiting for this session to finish its turn. */
    private releasePending = false;
    private builtServices?: ChatSessionServices;
    private surface?: ChatSurface;
    private readonly managerSubscriptions: Unsubscribe[] = [];
    /** Window-scoped handlers wired for the *current* manager. See `ownManagerSubscription`. */
    private readonly windowSubscriptions: Unsubscribe[] = [];
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
        this.onReleased = deps.onReleased;

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
        // Somebody came back for this conversation. Whatever countdown was running
        // is off — that is the whole reconnect story for a reselected session.
        if (this.releasePending) {
            this.logger.info(`[ChatSessionHost ${this.handle}] wind-down cancelled — a surface reattached`);
            this.releasePending = false;
        }
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
        // In-flight first, and `live` only after. `wireManagerEvents` calls
        // `attachManager` — which sets `live` — *before* `manager.start()` resolves,
        // because the wiring must be in place to catch startup events. Checking
        // `live` first therefore told a surface the session was ready while it still
        // had no id: opening a chat tab sent `[Init] Sending 0 messages` with
        // `sessionId: null`, never re-sent, and the tab could not restore on reload.
        // While a start is running, the promise is the only honest answer.
        if (this.starting) {
            return this.starting;
        }
        if (this.live) {
            return Promise.resolve();
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
     * Nothing is rendering this host any more; end it once its work is finished.
     *
     * Called by whoever knows the surface is gone for good — `ChatPanelService`
     * when a tab closes. The sidebar never calls it: VS Code tears its view down
     * whenever the container is hidden and re-resolves it later into the same
     * surface, which `closingEndsSurface` already distinguishes.
     *
     * Two things this gets right that a naive version would not:
     *
     *  - **Idle is a transition, not a state.** If this session is not working when
     *    the surface goes, there may never be another transition to wait for — so
     *    that case ends now rather than living forever. This is why the host tracks
     *    quiet itself rather than waiting on a signal that may never come.
     *  - **Any reattach cancels it.** Reselecting a closed tab's session from the
     *    dropdown finds this host through the registry and attaches to it; the
     *    countdown must not fire afterwards.
     *
     * A hung turn never finishes, so its host never winds down. That is exactly
     * today's behaviour for every host, so it is not a regression — and a
     * wall-clock deadline that kills a long legitimate task is worse than a session
     * that outlives its tab.
     */
    public releaseWhenIdle(): void {
        if (this.surface) {
            return;
        }
        if (this.quiet) {
            this.logger.info(`[ChatSessionHost ${this.handle}] no surface and nothing running — winding down`);
            this.release();
            return;
        }
        this.logger.info(`[ChatSessionHost ${this.handle}] no surface, work in flight — winding down at the next idle`);
        this.releasePending = true;
    }

    /** Take this host out of service. The registry does the removal; see `onReleased`. */
    private release(): void {
        this.releasePending = false;
        this.onReleased?.(this);
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

        // Handed the manager it already has: nothing to do, and doing something is
        // the bug. **Two callers attach, and on one path they overlap** —
        // `wireManagerEvents` attaches and *then* registers the window-scoped
        // handlers against this host, after which `ensureStarted()` attaches the
        // same manager again, because `startManager`'s contract is "hand back the
        // manager and let the host attach it".
        //
        // The second call used to tear down and rebuild. Harmless for the routing
        // below, which it re-adds — and fatal for `windowSubscriptions`, which it
        // released and nobody re-registered. Measured live: a session started
        // through a tab's `ensureStarted` logged **zero of 71** window-scoped tool
        // events and went silent on `[CLI Status]` while 50 turns ran, taking the
        // sub-agent dock, the status bar, the MCP state and the dropdown refresh
        // with it. A session started through `handleNewSession` — direct
        // `startCLISession`, no `ensureStarted` — logged every one.
        //
        // Idempotence rather than deleting one of the two calls: both are
        // legitimate on their own paths, and correctness should not depend on the
        // order two independent callers happen to run in.
        if (this.#manager === manager) {
            return;
        }

        // A host outlives its managers — every restart and session switch builds a
        // new one. Replace the wiring rather than adding to it, or each restart
        // doubles every message on screen.
        // Only a *different* manager reaches here, so replacing always means the old
        // one is finished. Disposed, not merely detached: with the module-level
        // handle gone this host is a manager's sole owner, so letting one fall out
        // of scope leaks a live CLI session per restart. `detachManager` keeps its
        // own meaning — drop the routing, keep the session — because a session
        // switch still needs it.
        this.disposeManager();
        this.releaseWindowSubscriptions();
        this.#manager = manager;
        // A new manager has said nothing yet. Inheriting the last one's quiet would
        // arm a countdown against a session that may be working.
        this.quiet = true;
        this.hasIdleSignal = typeof manager.onDidBecomeIdle === 'function';
        if (manager.onDidBecomeIdle) {
            this.subscribe(manager.onDidBecomeIdle(() => {
                this.quiet = true;
                this.releaseIfPending();
            }));
        }

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
            // Recorded *and* rendered. Rendering alone put the narration in the
            // transcript and left the doing on screen only, so the next `sendInit()`
            // — a hidden sidebar re-resolving, a reattach, a refresh — replayed the
            // conversation with every tool chip missing.
            //
            // On the host rather than on the surface, unlike the message writers in
            // `WebviewChatSurface`: a host with no surface is still a conversation,
            // and there would be nothing to write through.
            this.recordTool(toolState);
            // Attribution, at the one point where a tool chip can go missing without
            // anything failing: the host routed it, but to nothing. With N surfaces
            // "did it render" and "was there something to render into" are different
            // questions, and only this line can tell them apart — the webview logs
            // its own arrival separately, so the two together bracket the boundary.
            this.logger.debug(
                `[ChatSessionHost ${this.handle}] tool ${toolState?.toolName} → ` +
                `${this.surface ? 'surface' : 'NO SURFACE ATTACHED'}`
            );
            this.surface?.notifyToolStart(toolState);
        }));

        // Update and complete are the same thing to a surface: the tool's state
        // changed. Only the terminal status differs, and it is inside the payload.
        // Same for the transcript — `recordTool` replaces the entry for this call
        // rather than appending, so one tool stays one line however often it moves.
        this.subscribe(manager.onDidUpdateTool((toolState) => {
            this.recordTool(toolState);
            this.surface?.updateToolExecution(toolState);
        }));

        this.subscribe(manager.onDidCompleteTool((toolState) => {
            this.recordTool(toolState);
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
     * Put a tool call in this conversation's transcript.
     *
     * Guarded on `toolCallId` because it is the identity the upsert turns on: a
     * payload without one would append a new line on every progress update, which
     * is worse than not recording it at all.
     */
    private recordTool(toolState: any): void {
        if (!toolState?.toolCallId) {
            this.logger.warn(`[ChatSessionHost ${this.handle}] tool event with no toolCallId — not recorded`);
            return;
        }
        // Capped through the *same* function the replay uses, not a second copy of
        // the rule. One real `bash` returned 181.7 KB, and the surface gets the
        // whole thing — it is the transcript we keep that has to stay small, and it
        // has to be cut at the same point the event log's replay cuts it.
        const recorded = { ...toolState };
        applyResult(recorded, toolState.result);
        this.state.recordTool(recorded, toolState.agentId);
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
                this.quiet = false;
                this.surface?.setThinking(true);
                break;
            case 'ready':
                // Turn-end only means the *assistant* stopped. Where the manager can
                // report true idleness, wait for it — a background agent or an
                // attached shell outliving the turn is exactly the work a wind-down
                // must not interrupt.
                if (!this.hasIdleSignal) {
                    this.quiet = true;
                }
                this.surface?.setThinking(false);
                this.releaseIfPending();
                break;
            case 'exited':
            case 'stopped':
                // An ending is an ending; no idle is coming for a dead session.
                this.quiet = true;
                // No longer live, so a later `ensureStarted()` may bring it back
                // rather than assuming a session is still running.
                this.markStopped();
                this.state.setSessionActive(false);
                this.surface?.setSessionActive(false);
                this.releaseIfPending();
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

    /** The armed wind-down, now that this session has stopped working. */
    private releaseIfPending(): void {
        if (this.releasePending && this.quiet && !this.surface) {
            this.logger.info(`[ChatSessionHost ${this.handle}] idle and unwatched — winding down`);
            this.release();
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

    /**
     * Empty this conversation so a new session starts blank.
     *
     * `handleNewSession` cleared the webview's DOM and nothing cleared this, so the
     * new session kept the previous transcript in memory and the next `sendInit()`
     * — a reload, a re-attach — rendered the old conversation back under the new
     * session's id.
     *
     * The session id is put back after the reset. `SessionState.reset()` nulls its
     * own copy, and the host's must not drift from it: the registry indexes by the
     * host's id while the surface renders the state's, and a disagreement between
     * them is unreachable-session territory. The real id arrives moments later via
     * `adoptSessionId`.
     */
    public beginNewConversation(): void {
        this.state.reset();
        this.state.setSessionId(this.currentSessionId);
        this.logger.info(`[ChatSessionHost ${this.handle}] transcript cleared for a new conversation`);
    }

    // ── Plan mode ────────────────────────────────────────────────────────────

    public async enablePlanMode(): Promise<void> {
        if (!this.requireLive('enter plan mode')) { return; }
        await this.#manager!.enablePlanMode();
    }

    public async disablePlanMode(): Promise<void> {
        if (!this.requireLive('leave plan mode')) { return; }
        await this.#manager!.disablePlanMode();
    }

    public async acceptPlan(): Promise<void> {
        if (!this.requireLive('accept the plan')) { return; }
        await this.#manager!.acceptPlan();
    }

    public async rejectPlan(): Promise<void> {
        if (!this.requireLive('reject the plan')) { return; }
        await this.#manager!.rejectPlan();
    }

    /**
     * End this session's CLI process. The host stays and can start again — this is
     * not `dispose()`, which ends the host itself.
     */
    public async stop(): Promise<void> {
        if (!this.requireLive('stop the session')) { return; }
        const manager = this.#manager!;
        this.markStopped();
        await manager.stop();
    }

    /**
     * Copy this session and hand back the new id. Task 10 opens the copy in a tab.
     *
     * Throws rather than returning a sentinel: every other verb here can sensibly
     * do nothing, but "fork" that silently forked nothing would report success to
     * `forkCurrentSession`, which announces it to the user.
     */
    public async fork(opts: { sessionStateDir?: string } = {}): Promise<string> {
        if (!this.#manager) {
            throw new Error(`[ChatSessionHost ${this.handle}] cannot fork — no active session`);
        }
        if (!this.currentSessionId) {
            throw new Error(`[ChatSessionHost ${this.handle}] cannot fork — this session has no id yet`);
        }
        return this.#manager.forkSession(this.currentSessionId, opts);
    }

    // ── Queries ──────────────────────────────────────────────────────────────
    //
    // Silent when there is no session, unlike the commands above: a query is
    // something the extension asked, not something the user did, and answering an
    // unasked question with a chat message is noise.

    /** Where this session's `plan.md` lives, or `null` if there is no session. */
    public planFilePath(): string | null {
        return this.#manager?.getPlanFilePath() ?? null;
    }

    public async availableModels(): Promise<any[]> {
        return (await this.#manager?.getAvailableModels()) ?? [];
    }

    public async validateAttachments(filePaths: string[]): Promise<{ valid: boolean; error?: string }> {
        if (!this.#manager) {
            return { valid: false, error: 'Session not active' };
        }
        return this.#manager.validateAttachments(filePaths);
    }

    public async listMcpServers(): Promise<any[]> {
        return (await this.#manager?.listMcpServers()) ?? [];
    }

    public async listConfiguredMcpServers(): Promise<Record<string, any>> {
        return (await this.#manager?.listConfiguredMcpServers()) ?? {};
    }

    /**
     * Guard for a user gesture that needs a running session.
     *
     * Says so on *this host's* surface rather than returning quietly. Every one of
     * these verbs used to be a `sessionManager` call in `extension.ts` guarded by
     * `if (!sessionManager || !sessionManager.isRunning())` and a window-wide toast;
     * a toast cannot say which of two open chats it is about, and a silent return
     * says nothing at all — which is how the wrong-session plan bug survived a whole
     * cycle (§8).
     */
    private requireLive(gesture: string): boolean {
        if (this.#manager) {
            return true;
        }
        this.logger.warn(`[ChatSessionHost ${this.handle}] cannot ${gesture} — no active session`);
        this.surface?.addAssistantMessage(`⚠ No active session — cannot ${gesture}.`);
        return false;
    }

    /** Stop routing whatever manager is currently attached, and leave it running. */
    public detachManager(): void {
        for (const subscription of this.managerSubscriptions) {
            subscription.dispose();
        }
        this.managerSubscriptions.length = 0;
        this.#manager = undefined;
    }

    /**
     * Hold a subscription that belongs to this host's *current* manager but is
     * wired outside it — the window-scoped handlers in `wireManagerEvents`.
     *
     * Those went into `context.subscriptions`, which lives as long as the extension:
     * roughly ten handlers per manager, so every session switch leaked a set and
     * every tab added one. They belong to the host that owns the manager, and they
     * go when it is replaced or when the host dies.
     */
    public ownManagerSubscription(subscription: Unsubscribe): void {
        this.windowSubscriptions.push(subscription);
    }

    private releaseWindowSubscriptions(): void {
        for (const subscription of this.windowSubscriptions) {
            try {
                subscription.dispose();
            } catch (error) {
                this.logger.error(
                    `[ChatSessionHost ${this.handle}] failed to release a manager subscription`,
                    error instanceof Error ? error : undefined
                );
            }
        }
        this.windowSubscriptions.length = 0;
    }

    /** Drop the routing *and* end the session underneath it. */
    private disposeManager(): void {
        const manager = this.#manager;
        this.detachManager();
        try {
            manager?.dispose();
        } catch (error) {
            this.logger.error(
                `[ChatSessionHost ${this.handle}] manager dispose failed`,
                error instanceof Error ? error : undefined
            );
        }
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
        // The manager goes with the host. `deactivate` used to dispose a single
        // module-level handle — the last-started session — so every other host's
        // CLI leaked.
        this.disposeManager();
        this.releaseWindowSubscriptions();

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
