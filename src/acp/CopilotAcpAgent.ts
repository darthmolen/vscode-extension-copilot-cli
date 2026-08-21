/**
 * Serves `SDKSessionManager` to an ACP client (IN-3).
 *
 * Direction matters and is the opposite of the abandoned `feature/4.0-acp-migration`
 * branch: that one made us an ACP *client* of `copilot --acp`. This makes us an ACP
 * *agent* that a host drives, keeping the Copilot SDK underneath:
 *
 *     host ──ACP──▶ this agent ──SDK──▶ CLI
 *
 * `copilot --acp` is never invoked, so cli#1574 and cli#1607 are off our path.
 *
 * The ACP SDK is ESM-only and this file compiles to CommonJS. That works because
 * tsconfig's `module: Node16` preserves `await import(...)` as a real dynamic import
 * rather than downlevelling it to `require()` — the same trick `loadSDK()` in
 * sdkSessionManager.ts already relies on for `@github/copilot-sdk`.
 */

import type { AgentApp, AgentContext } from '@agentclientprotocol/sdk' with { 'resolution-mode': 'import' };
import { LoggerLike } from '../logger';
import { ACP_SESSION_MODES, AcpPermissionRequester } from './SdkSessionBackend';
import { AcpPermissionOutcome } from './permissionMapper';
import {
    SessionUpdateNotification,
    messageDeltaUpdate,
    reasoningDeltaUpdate,
    toolStartUpdate,
    toolUpdateUpdate,
    subagentStartUpdate,
    subagentMessageUpdate,
    subagentCompleteUpdate,
    planUpdate,
    replayTurnUpdate,
    ReplayTurn
} from './sessionUpdateMapper';

// `resolution-mode` is required on both the type import above and here: TypeScript
// will not resolve ESM types from a CommonJS file without it (TS1542).
type AcpModule = typeof import('@agentclientprotocol/sdk', { with: { 'resolution-mode': 'import' } });

let acpModule: AcpModule | null = null;

/** Lazily load the ESM-only ACP SDK from CommonJS. */
async function loadAcp(): Promise<AcpModule> {
    if (!acpModule) {
        acpModule = await import('@agentclientprotocol/sdk');
    }
    return acpModule;
}

/**
 * The per-session backend this agent fronts. One `SDKSessionManager` per session,
 * per spine S3 — `setActiveSession()` disposes the previous subscription, so a
 * single manager can only emit for one session at a time.
 *
 * Narrow on purpose: declare the slice we touch rather than importing the concrete
 * manager, so this file does not pin the manager's shape the way 75 call sites
 * would (the same reasoning behind Lane B keeping `.manager` private).
 */
/** A tool call as the manager reports it. */
export interface AcpToolEvent {
    toolCallId: string;
    toolName: string;
    status: string;
    arguments?: unknown;
    result?: string;
    error?: { message: string; code?: string };
}

/**
 * Everything a session can emit, in one union.
 *
 * `kind` is ours, not the manager's field names, so the backend absorbs any emitter
 * rename rather than propagating it into the agent and the mapper.
 */
export type AcpBackendEvent =
    | { kind: 'message'; messageId: string; deltaContent: string }
    | { kind: 'reasoning'; reasoningId: string; deltaContent: string }
    | { kind: 'toolStart'; tool: AcpToolEvent }
    | { kind: 'toolUpdate'; tool: AcpToolEvent }
    | { kind: 'subagentStart'; agentId: string; agentName?: string; agentDisplayName?: string }
    | { kind: 'subagentMessage'; agentId: string; content?: string; reasoningText?: string }
    | { kind: 'subagentComplete'; agentId: string; status: 'complete' | 'failed'; agentDisplayName?: string; error?: string }
    | {
        kind: 'plan';
        todos: Array<{ id?: string; title?: string; description?: string; status?: string }>;
        dependencies?: Array<{ todoId: string; dependsOn: string }>;
      };

export interface AcpSessionBackend {
    /** The Copilot session id. Also the ACP session id — see `session/new`. */
    readonly sessionId: string;
    /**
     * Subscribe to everything the session emits. Returns an unsubscribe.
     *
     * ONE subscription carrying a discriminated union, not a method per emitter:
     * sixteen `onX` methods would be sixteen subscriptions to release at turn end,
     * and the leak this already guards against would get sixteen times easier to
     * introduce.
     */
    onEvent(listener: (event: AcpBackendEvent) => void): () => void;
    /** Send a prompt; resolves when the turn ends. */
    prompt(text: string): Promise<{ stopReason: string }>;
    /** The mode the session is in right now. */
    readonly currentModeId: string;
    /** Enter `modeId`, or reject if it is not one this backend has. */
    setMode(modeId: string): Promise<void>;
    /** Stop the turn in flight. Safe to call when nothing is running. */
    cancel(): Promise<void>;
    /**
     * Cancel anything running and release everything this session holds.
     *
     * Separate from `cancel()`: cancel stops a turn and leaves the session usable,
     * this ends the session. After it, the backend is not to be used again.
     */
    close(): Promise<void>;
    /**
     * The conversation so far, oldest first, for `session/load` to replay.
     *
     * On the backend rather than the agent because only the backend knows where a
     * session's history lives; the agent only knows it has to send it.
     */
    history(): Promise<ReplayTurn[]>;
    /**
     * Route permission requests to `requester` — the host, over
     * `session/request_permission`.
     *
     * Required rather than optional: a backend that silently could not forward would
     * fall back to its own policy on every request, and the symptom (things quietly
     * approved, or quietly denied) says nothing about the cause.
     */
    setPermissionRequester(requester: AcpPermissionRequester): void;
}

export interface CopilotAcpAgentDeps {
    logger: LoggerLike;
    /** Shown to a host so a user can tell whose agent this is. */
    agentName?: string;
    agentVersion?: string;
    /**
     * Starts a backend for one session. Injected rather than constructed here so
     * the protocol surface is testable without spawning a CLI.
     */
    startSession(params: { cwd: string }): Promise<AcpSessionBackend>;
    /**
     * Resume an EXISTING session by id. Distinct from `startSession`: it must not
     * mint a new id, because the client already holds the one it is asking for.
     */
    loadSession(params: { sessionId: string; cwd: string }): Promise<AcpSessionBackend>;
}

/**
 * What we tell a client we can do. Every entry is `false` until the code behind it
 * exists — a capability we advertise is one the client will act on, so an optimistic
 * `true` is a lie that surfaces as a confusing failure rather than a clean refusal.
 */
const ADVERTISED_CAPABILITIES = {
    loadSession: true,
    promptCapabilities: { image: false, audio: false, embeddedContext: false }
} as const;

/**
 * The ACP schema's own default for `clientCapabilities` — deny everything. The
 * protocol assumes nothing is supported until a client says otherwise, and so do we.
 *
 * This is the value that must survive an `initialize` that never happens: the SDK's
 * `buildSession().start()` issues `session/new` alone, so a handler can run before
 * any capability has been advertised. Reading `undefined` here would not usually
 * crash — it would silently take the permissive branch.
 */
const DENY_ALL_CLIENT_CAPABILITIES = {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
    auth: { terminal: false }
};

/** Client capabilities as this agent currently understands them. */
export interface KnownClientCapabilities {
    fs: { readTextFile: boolean; writeTextFile: boolean };
    terminal: boolean;
    auth: { terminal: boolean };
    [key: string]: unknown;
}

/**
 * Flatten ACP content blocks to the plain prompt text the manager takes.
 *
 * ACP models a prompt as blocks — text, resource links, and optionally images or
 * audio — because an agent may support richer input. We advertise none of those
 * (see {@link ADVERTISED_CAPABILITIES}), so text is all that can legitimately
 * arrive; anything else is dropped rather than stringified into the prompt, where
 * it would read as noise the model tries to answer.
 */
function textOf(blocks: ReadonlyArray<{ type: string; text?: string }>): string {
    return blocks
        .filter(b => b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text as string)
        .join('');
}

/**
 * Route one backend event to its ACP notification.
 *
 * Returns `undefined` for a kind we do not map. That is deliberate: the manager may
 * grow emitters, and a prompt should not die because one carried a shape we had no
 * mapping for yet.
 */
function toSessionUpdate(sessionId: string, event: AcpBackendEvent): SessionUpdateNotification | undefined {
    switch (event.kind) {
        case 'message': return messageDeltaUpdate(sessionId, event);
        case 'reasoning': return reasoningDeltaUpdate(sessionId, event);
        case 'toolStart': return toolStartUpdate(sessionId, event.tool);
        case 'toolUpdate': return toolUpdateUpdate(sessionId, event.tool);
        case 'subagentStart': return subagentStartUpdate(sessionId, event);
        case 'subagentMessage': return subagentMessageUpdate(sessionId, event);
        case 'subagentComplete': return subagentCompleteUpdate(sessionId, event);
        case 'plan': return planUpdate(sessionId, event);
        default: return undefined;
    }
}

export class CopilotAcpAgent {
    private caps: KnownClientCapabilities = structuredClone(DENY_ALL_CLIENT_CAPABILITIES);

    /**
     * Live sessions, keyed by the id we handed the client. ACP multiplexes — every
     * request carries a `sessionId` — so inbound work is routed through here.
     *
     * Deliberately *not* called a registry: Lane B owns `ChatSessionRegistry`, which
     * binds a session to a UI surface and can exist before its id does. This maps a
     * protocol id to a running backend and cannot: the id is minted by starting one.
     */
    private readonly sessions = new Map<string, AcpSessionBackend>();

    /**
     * The client of the current connection, or `undefined` before one opens.
     *
     * Connection-scoped, NOT request-scoped, and that is the point: a permission can
     * be raised by work that outlives the turn that triggered it — a background tool,
     * a sub-agent still finishing — and the per-request `client` inside
     * `session/prompt` is dead by then. `onConnect` hands us one that lives as long
     * as the client does.
     */
    private client: AgentContext | undefined;

    constructor(private readonly deps: CopilotAcpAgentDeps) {}

    /**
     * What the client has told us it can do — never undefined, and never more
     * permissive than the client actually advertised.
     */
    public get clientCapabilities(): KnownClientCapabilities {
        return this.caps;
    }

    /**
     * Record what a client advertised.
     *
     * A plain assignment is correct here *because the SDK parses request params
     * against the generated ACP schemas before a handler runs*, filling every
     * documented default — verified: omitted, `{}` and partial advertisements all
     * arrive complete. So there is nothing to merge into.
     *
     * The falsy guard is the part that is ours: it keeps
     * {@link DENY_ALL_CLIENT_CAPABILITIES} intact on any path that reaches here
     * without schema parsing. If a second, non-request source of capabilities ever
     * appears, this needs to become a real merge — and a test that fails without one.
     */
    private upgradeCapabilities(advertised: KnownClientCapabilities | undefined): void {
        if (!advertised) {
            return;
        }
        this.caps = advertised;
    }

    /**
     * Send the stored conversation to the client as `session/update` notifications.
     *
     * This is what distinguishes `session/load` from `session/resume` — the latter
     * exists precisely to resume *without* replaying. Ordinary update notifications,
     * sent during the request; the protocol has no separate replay channel.
     *
     * A failure to read history does not fail the load. The transcript is worth less
     * than the session: denying someone a working session because a log file on disk
     * was unreadable trades something valuable for something cosmetic.
     */
    private async replayHistory(
        sessionId: string,
        backend: AcpSessionBackend,
        client: { notify(method: string, params: unknown): Promise<void> }
    ): Promise<void> {
        const acpModule = await loadAcp();
        let turns: ReplayTurn[];
        try {
            turns = await backend.history();
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.deps.logger.warn(`[ACP] session/load ${sessionId}: history unavailable (${reason})`);
            return;
        }

        for (const turn of turns) {
            await client.notify(
                acpModule.methods.client.session.update,
                replayTurnUpdate(sessionId, turn) as never
            );
        }
        this.deps.logger.info(`[ACP] session/load ${sessionId}: replayed ${turns.length} turn(s)`);
    }

    /**
     * Point one backend's permission requests at whatever client is connected.
     *
     * Called from `onConnect` as well as from `session/new` and `session/load`, so a
     * backend that outlives a reconnect is re-pointed at the client that is there now
     * rather than at the closed one.
     *
     * Forwarding is unconditional. `session/request_permission` is baseline protocol
     * surface — on ACP's `Client` interface it is one of only two non-optional
     * members, and `ClientCapabilities` has no permission-shaped field to gate it on.
     */
    private forwardPermissionsTo(backend: AcpSessionBackend): void {
        const client = this.client;
        if (!client) {
            // Leave the backend on its own fallback, which denies. Deciding here too
            // would put a second answer to "what if nobody can be asked" in a second
            // file, and the two would eventually disagree — so this returns rather
            // than inventing an outcome. `onConnect` repairs every live session the
            // moment a client appears.
            this.deps.logger.warn(
                `[ACP] no client connected; session ${backend.sessionId} will fall back rather than ask`
            );
            return;
        }

        const requester: AcpPermissionRequester = async request => {
            const acp = await loadAcp();
            return await client.request(
                acp.methods.client.session.requestPermission,
                request as never
            ) as { outcome?: AcpPermissionOutcome };
        };
        backend.setPermissionRequester(requester);
    }

    /**
     * Registers this agent's handlers on an ACP `AgentApp` and returns it.
     *
     * The app is passed in rather than constructed here so a caller can decide the
     * transport — `connect(stream)` for stdio, or `connect(clientApp)` in-process,
     * which is how this is tested.
     */
    public register(app: AgentApp): AgentApp {
        return app.onConnect(connection => {
            this.client = connection.client;
            this.deps.logger.info('[ACP] client connected; permission requests will be forwarded');
            // Backends started before the connection opened would otherwise keep
            // falling back forever. In practice `session/new` cannot precede a
            // connection, but a reconnect can — and a session that survives one must
            // start asking the new client, not the closed one.
            for (const backend of this.sessions.values()) {
                this.forwardPermissionsTo(backend);
            }
        })
        .onRequest('initialize', async ({ params }) => {
            const acp = await loadAcp();
            this.upgradeCapabilities(params?.clientCapabilities as KnownClientCapabilities | undefined);
            return {
                protocolVersion: acp.PROTOCOL_VERSION,
                agentCapabilities: ADVERTISED_CAPABILITIES,
                agentInfo: {
                    name: this.deps.agentName ?? 'Copilot CLI Chat',
                    version: this.deps.agentVersion ?? '0.0.0'
                }
            };
        })
        .onRequest('session/new', async ({ params }) => {
            // The ACP session id IS the Copilot session id. The SDK's example mints
            // a random one because it has no durable session of its own; ours live
            // in ~/.copilot/session-state and `session/load` must resume by that id.
            // A second id space would be a mapping to maintain for no gain.
            //
            // Returning a session id for a backend that never started would hand the
            // client a handle to nothing, so a failure must reject. But a bare throw
            // is generalised to "Internal error" with the cause buried in `data`,
            // which reaches a host UI as no explanation at all. `RequestError` keeps
            // the reason in the message where a user will actually see it.
            const acpModule = await loadAcp();
            let backend: AcpSessionBackend;
            try {
                backend = await this.deps.startSession({ cwd: params.cwd });
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                this.deps.logger.error(`[ACP] session/new failed to start a backend: ${reason}`);
                throw acpModule.RequestError.internalError(undefined, reason);
            }
            this.sessions.set(backend.sessionId, backend);
            this.forwardPermissionsTo(backend);
            this.deps.logger.info(`[ACP] session/new → ${backend.sessionId}`);

            return {
                sessionId: backend.sessionId,
                // A host renders the modes a session advertises, so an agent that
                // implements set_mode without this is unreachable: nothing in any
                // real client would ever offer the switch.
                modes: {
                    currentModeId: backend.currentModeId,
                    availableModes: ACP_SESSION_MODES.map(m => ({ ...m }))
                }
            };
        })
        .onRequest('session/load', async ({ params, client }) => {
            const acpModule = await loadAcp();
            let backend: AcpSessionBackend;
            try {
                backend = await this.deps.loadSession({
                    sessionId: params.sessionId,
                    cwd: params.cwd
                });
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                this.deps.logger.error(`[ACP] session/load ${params.sessionId} failed: ${reason}`);
                throw acpModule.RequestError.internalError(undefined, reason);
            }

            // Keyed by the id the CLIENT asked for. A resumed session that landed
            // under a different key would be unreachable by the handle the client
            // already holds.
            this.sessions.set(params.sessionId, backend);
            this.forwardPermissionsTo(backend);

            // Before the response, not after. A host is entitled to read the response
            // as "the session is ready", so updates arriving later would append to a
            // transcript the user is already looking at.
            await this.replayHistory(params.sessionId, backend, client);
            this.deps.logger.info(`[ACP] session/load → ${params.sessionId}`);

            return {
                modes: {
                    currentModeId: backend.currentModeId,
                    availableModes: ACP_SESSION_MODES.map(m => ({ ...m }))
                }
            };
        })
        .onRequest('session/close', async ({ params }) => {
            const backend = this.sessions.get(params.sessionId);
            if (!backend) {
                // A client cannot know we released it first, so closing something
                // already gone is a race rather than a fault. Erroring here would turn
                // ordinary shutdown into noise a host has to explain to someone.
                this.deps.logger.info(`[ACP] session/close for a session already gone: ${params.sessionId}`);
                return {};
            }

            // Dropped from the map first, and unconditionally. A backend whose
            // teardown throws has still stopped being usable, and keeping it
            // addressable because of that would reintroduce the very leak this
            // method exists to prevent.
            this.sessions.delete(params.sessionId);

            try {
                // "Treat it as if session/cancel was called" — and before releasing.
                // Freeing a manager with a turn in flight pulls the CLI session out
                // from under work that is still running.
                await backend.cancel();
                await backend.close();
                this.deps.logger.info(`[ACP] session/close → ${params.sessionId}`);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                this.deps.logger.warn(`[ACP] session/close ${params.sessionId} did not shut down cleanly: ${reason}`);
            }

            return {};
        })
        .onNotification('session/cancel', async ({ params }) => {
            const backend = this.sessions.get(params.sessionId);
            if (!backend) {
                // A notification has no reply, so throwing here would surface as an
                // unhandled rejection inside the agent rather than an error the
                // client could act on. Cancelling something already gone is also a
                // normal race, not a fault.
                this.deps.logger.warn(`[ACP] session/cancel for unknown session: ${params.sessionId}`);
                return;
            }

            try {
                await backend.cancel();
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                this.deps.logger.error(`[ACP] session/cancel ${params.sessionId} failed: ${reason}`);
            }
        })
        .onRequest('session/set_mode', async ({ params }) => {
            const acpModule = await loadAcp();
            const backend = this.sessions.get(params.sessionId);
            if (!backend) {
                throw acpModule.RequestError.internalError(
                    undefined,
                    `unknown session: ${params.sessionId}`
                );
            }

            try {
                await backend.setMode(params.modeId);
            } catch (error) {
                // The backend rejects unknown modes and names them. Carrying that
                // through as a RequestError keeps the reason in the message, where a
                // host will show it, instead of a bare "Internal error".
                const reason = error instanceof Error ? error.message : String(error);
                throw acpModule.RequestError.internalError(undefined, reason);
            }

            return {};
        })
        .onRequest('session/prompt', async ({ params, client }) => {
            const acpModule = await loadAcp();
            const backend = this.sessions.get(params.sessionId);
            if (!backend) {
                // Name the id. "Session not found" alone leaves a host operator
                // unable to tell a stale handle from a routing bug.
                throw acpModule.RequestError.internalError(
                    undefined,
                    `unknown session: ${params.sessionId}`
                );
            }

            // Subscribe for the turn, not for the session: the client context that
            // can deliver notifications belongs to this request. Unsubscribing in
            // `finally` matters more than it looks — a leak here is invisible until
            // a long session multiplies every chunk by the number of turns taken.
            const unsubscribe = backend.onEvent(event => {
                const notification = toSessionUpdate(backend.sessionId, event);
                if (!notification) {
                    // An emitter we do not map yet. Dropping it keeps the turn
                    // running; throwing here would kill a prompt over a message we
                    // merely had no shape for.
                    return;
                }
                void client.notify(acpModule.methods.client.session.update, notification as never);
            });

            try {
                const { stopReason } = await backend.prompt(textOf(params.prompt));
                return { stopReason } as { stopReason: 'end_turn' | 'cancelled' };
            } finally {
                unsubscribe();
            }
        });
    }
}
