/**
 * Which chat sessions are live in this window.
 *
 * The question "is this session already running?" has no answer today — a live
 * session is whatever the module-level `sessionManager` in `extension.ts` happens
 * to point at, so there is nothing to ask. Task 6's attach flow and Task 7's panel
 * serializer both have to ask it, and must get different answers for a running
 * session and a cold one.
 *
 * Hence two lookups with different jobs: `get()` probes without creating, so
 * attaching to a live session starts nothing; `getOrCreate()` is the one that may
 * bring a session into existence.
 *
 * Free of `vscode` and SDK imports, like `ChatSessionHost` — the composition root
 * supplies anything that is not.
 */

import { SessionState, WorkspaceRuntimeState } from '../../backendState';
import { LoggerLike } from '../../logger';
import { ChatSessionHost, ChatSessionServicesFactory } from './ChatSessionHost';

export interface ChatSessionRegistryDeps {
    /** Window state, shared by every host this registry builds. */
    workspace: WorkspaceRuntimeState;
    logger: LoggerLike;
    /** Passed to each host so a session's slash-command services are its own. */
    createServices?: ChatSessionServicesFactory;
    /** Window-scoped colour allocator, shared by every host and the sub-agent panels. */
    assignSubagentColor?: (agentId: string) => string;
    /** Window-scoped diff enrichment (filesystem reads), passed to every host. */
    enrichDiff?: (diffData: any) => any;
    /** Brings a CLI session into being; the host decides whether to call it. */
    startManager?: (options: { sessionId: string | null; resume: boolean; fresh: boolean; host: ChatSessionHost }) => Promise<any>;
}

export class ChatSessionRegistry {
    /**
     * Every live host, keyed by nothing but membership.
     *
     * Hosts are held from birth rather than from the moment they have a session
     * id, because a host can outlive the failure of the session it was meant to
     * speak for: if the CLI never starts, `onSessionStarted` never fires and no id
     * is ever assigned. Keying on the id would make exactly those hosts invisible
     * to `disposeAll()`, stranding their subscriptions on the one path where
     * something already went wrong.
     */
    private readonly liveHosts = new Set<ChatSessionHost>();
    /** Secondary index. Only hosts that have adopted an id appear here. */
    private readonly hostsBySessionId = new Map<string, ChatSessionHost>();
    /** Monotonic, never reused — a disposed host's handle must not reappear in logs. */
    private handlesIssued = 0;
    private readonly workspace: WorkspaceRuntimeState;
    private readonly logger: LoggerLike;
    private readonly createServices?: ChatSessionServicesFactory;
    private readonly assignSubagentColor?: (agentId: string) => string;
    private readonly enrichDiff?: (diffData: any) => any;
    private readonly startManager?: (options: { sessionId: string | null; resume: boolean; fresh: boolean; host: ChatSessionHost }) => Promise<any>;

    constructor(deps: ChatSessionRegistryDeps) {
        this.workspace = deps.workspace;
        this.logger = deps.logger;
        this.createServices = deps.createServices;
        this.assignSubagentColor = deps.assignSubagentColor;
        this.enrichDiff = deps.enrichDiff;
        this.startManager = deps.startManager;
    }

    /** The live host for a session, or `undefined`. Never creates one. */
    public get(sessionId: string): ChatSessionHost | undefined {
        return this.hostsBySessionId.get(sessionId);
    }

    /**
     * A host for a session that has not started yet.
     *
     * The sidebar's host is built this way at activation, before the CLI has
     * assigned an id — and stays this way for good if the CLI never starts.
     */
    public create(
        sessionId: string | null = null,
        state?: SessionState,
        options: { whenNoSession?: 'window-default' | 'new' } = {}
    ): ChatSessionHost {
        const host = new ChatSessionHost({
            handle: `host#${++this.handlesIssued}`,
            sessionId,
            state,
            whenNoSession: options.whenNoSession,
            workspace: this.workspace,
            logger: this.logger,
            createServices: this.createServices,
            assignSubagentColor: this.assignSubagentColor,
            enrichDiff: this.enrichDiff,
            startManager: this.startManager,
            onAdoptSessionId: (adopted, previousSessionId) => {
                this.reindex(adopted, previousSessionId);
            },
            // A host cannot dispose itself: it is held here in two collections, and
            // one of them is keyed by an id it may not have. So the wind-down
            // signals out and the removal happens here.
            onReleased: (released) => {
                this.logger.info(`[ChatSessionRegistry] releasing ${released.handle}`);
                this.disposeHost(released);
            }
        });

        this.liveHosts.add(host);
        if (sessionId) {
            this.hostsBySessionId.set(sessionId, host);
        }
        this.logger.info(
            `[ChatSessionRegistry] host created for ${sessionId ?? '(no session yet)'} (${this.liveHosts.size} live)`
        );
        return host;
    }

    /** The live host for a session, building one if this window has none. */
    public async getOrCreate(sessionId: string): Promise<ChatSessionHost> {
        return this.hostsBySessionId.get(sessionId) ?? this.create(sessionId);
    }

    /** How many hosts are live, pending ones included. */
    public get size(): number {
        return this.liveHosts.size;
    }

    /**
     * Every session this window currently has a surface for.
     *
     * The dropdown is built from `~/.copilot/session-state`, which a brand-new
     * session has not written to yet. Asking the window's single manager for "the"
     * current id answered that for one surface; with N it has to be every host's,
     * or the tab you are looking at is missing from your own dropdown.
     *
     * Hosts with no id yet are skipped — a session that has not started is not one
     * you can switch to.
     */
    public liveSessionIds(): string[] {
        return [...this.liveHosts].map(host => host.sessionId).filter((id): id is string => id !== null);
    }

    /**
     * Every host something is currently rendering.
     *
     * The candidate set for "which chat did the user mean" — see
     * `commandSurface.ts`. Hosts with no surface are excluded on purpose: a closed
     * tab's host is alive and winding down, and it is not a chat you can be
     * looking at.
     */
    public hostsWithSurfaces(): ChatSessionHost[] {
        return [...this.liveHosts].filter(host => host.getSurface() !== undefined);
    }

    public dispose(sessionId: string): void {
        const host = this.hostsBySessionId.get(sessionId);
        if (!host) {
            return;
        }
        this.disposeHost(host);
    }

    /** Dispose by identity — the only way to reach a host that has no session id. */
    public disposeHost(host: ChatSessionHost): void {
        if (!this.liveHosts.delete(host)) {
            return;
        }
        if (host.sessionId) {
            this.hostsBySessionId.delete(host.sessionId);
        }
        host.dispose();
    }

    public disposeAll(): void {
        for (const host of [...this.liveHosts]) {
            this.disposeHost(host);
        }
    }

    /** Keep the id index honest when a host takes on (or changes) its session id. */
    private reindex(host: ChatSessionHost, previousSessionId: string | null): void {
        if (previousSessionId) {
            this.hostsBySessionId.delete(previousSessionId);
        }
        if (!host.sessionId) {
            return;
        }

        const incumbent = this.hostsBySessionId.get(host.sessionId);
        if (incumbent && incumbent !== host) {
            // One session, one host is load-bearing for v3.13.0. Two hosts claiming
            // one session means something upstream resumed a session that was
            // already open; the newcomer wins the index and the incumbent stays
            // live under its handle rather than being torn down silently.
            this.logger.warn(
                `[ChatSessionRegistry] two hosts claim session ${host.sessionId}: ` +
                `incumbent ${incumbent.handle} stays live, newcomer ${host.handle} now answers lookups`
            );
        }
        this.hostsBySessionId.set(host.sessionId, host);
    }
}
