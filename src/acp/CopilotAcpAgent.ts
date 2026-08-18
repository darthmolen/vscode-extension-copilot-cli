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

import type { AgentApp } from '@agentclientprotocol/sdk' with { 'resolution-mode': 'import' };
import { LoggerLike } from '../logger';
import { ACP_SESSION_MODES } from './SdkSessionBackend';

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
export interface AcpSessionBackend {
    /** The Copilot session id. Also the ACP session id — see `session/new`. */
    readonly sessionId: string;
    /** Subscribe to assistant output. Returns an unsubscribe. */
    onOutput(listener: (text: string) => void): () => void;
    /** Send a prompt; resolves when the turn ends. */
    prompt(text: string): Promise<{ stopReason: string }>;
    /** The mode the session is in right now. */
    readonly currentModeId: string;
    /** Enter `modeId`, or reject if it is not one this backend has. */
    setMode(modeId: string): Promise<void>;
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
}

/**
 * What we tell a client we can do. Every entry is `false` until the code behind it
 * exists — a capability we advertise is one the client will act on, so an optimistic
 * `true` is a lie that surfaces as a confusing failure rather than a clean refusal.
 */
const ADVERTISED_CAPABILITIES = {
    loadSession: false,
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
     * Registers this agent's handlers on an ACP `AgentApp` and returns it.
     *
     * The app is passed in rather than constructed here so a caller can decide the
     * transport — `connect(stream)` for stdio, or `connect(clientApp)` in-process,
     * which is how this is tested.
     */
    public register(app: AgentApp): AgentApp {
        return app.onRequest('initialize', async ({ params }) => {
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
            const unsubscribe = backend.onOutput(text => {
                void client.notify(acpModule.methods.client.session.update, {
                    sessionId: backend.sessionId,
                    update: {
                        sessionUpdate: 'agent_message_chunk',
                        content: { type: 'text', text }
                    }
                });
            });

            try {
                const { stopReason } = await backend.prompt(textOf(params.prompt));
                return { stopReason } as { stopReason: 'end_turn' };
            } finally {
                unsubscribe();
            }
        });
    }
}
