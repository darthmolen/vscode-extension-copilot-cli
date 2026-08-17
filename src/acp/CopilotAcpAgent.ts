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

export interface CopilotAcpAgentDeps {
    logger: LoggerLike;
    /** Shown to a host so a user can tell whose agent this is. */
    agentName?: string;
    agentVersion?: string;
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

export class CopilotAcpAgent {
    private caps: KnownClientCapabilities = structuredClone(DENY_ALL_CLIENT_CAPABILITIES);

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
        });
    }
}
