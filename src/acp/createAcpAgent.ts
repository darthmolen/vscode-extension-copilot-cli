/**
 * Composition root for the ACP agent process (IN-3).
 *
 * The only place that knows what a session *is*: a new `SDKSessionManager`, started
 * against the **shared** `CopilotClientProvider`, wrapped in an `SdkSessionBackend`.
 * Every other file in `src/acp/` takes its collaborators as parameters, which is
 * what keeps them free of `vscode` and of the CLI.
 *
 * Split in two on purpose. `createSessionStarter` is the wiring — one provider, N
 * managers — and is worth testing on its own. `createAcpAgent` is the trivial
 * assembly on top. The alternative was hanging `startSession` off the agent so a
 * test could reach it, which would have put a peephole in production for the
 * convenience of the test.
 */

import type { LoggerLike } from '../logger';
import { CopilotAcpAgent, AcpSessionBackend } from './CopilotAcpAgent';
import { SdkSessionBackend, AcpManagerSlice, PermissionPolicy, HistoryReader } from './SdkSessionBackend';
import { SessionService } from '../extension/services/SessionService';
import * as path from 'path';
import * as os from 'os';

/**
 * What the entry point must supply. `createManager` is injected rather than calling
 * `new SDKSessionManager(...)` here so this module — and its tests — need neither
 * the CLI nor `vscode`.
 */
export interface AcpAgentCompositionDeps {
    logger: LoggerLike;
    /** Directory the agent may use for persistent files. */
    globalStorageDir: string;
    /** Fallback workspace when a client opens a session without a cwd. */
    workspaceFolder?: string;
    /**
     * The single shared client provider. **One instance for the whole process** —
     * see {@link createSessionStarter}.
     */
    clientProvider: unknown;
    /** Builds a manager bound to the given workspace and provider. */
    createManager(args: {
        workspaceFolder: string;
        clientProvider: unknown;
        settings: Record<string, unknown>;
        /** When present, the manager attaches to this existing session instead of minting one. */
        resumeSessionId?: string;
    }): AcpManagerSlice;
    /** Snapshot of `copilotCLI.*` settings taken at launch. */
    settings?: Readonly<Record<string, unknown>>;
    /** Where session transcripts live. Defaults to the CLI's own store. */
    sessionStateDir?: string;
    agentName?: string;
    agentVersion?: string;
}

/**
 * Where a session's stored conversation lives, and how to turn it into turns.
 *
 * Reuses `SessionService.loadSessionHistory` rather than parsing `events.jsonl` here.
 * A second parser would be a second opinion about which events count as "what was
 * said", and the two would diverge the first time the CLI added an event type — with
 * the ACP transcript and the sidebar transcript disagreeing about the same session.
 * `SessionService` imports only `fs`, `path`, `readline` and `crypto`, so it is safe
 * in a process with no `vscode`.
 *
 * `sessionStateDir` is a parameter rather than a constant so this is testable against
 * a real file without writing into the user's `~/.copilot`.
 */
export function createHistoryReader(sessionStateDir: string): HistoryReader {
    return async sessionId => {
        const eventsPath = path.join(sessionStateDir, sessionId, 'events.jsonl');
        const messages = await SessionService.loadSessionHistory(eventsPath);
        return messages.map(m => ({ role: m.role, content: m.content }));
    };
}

/** The CLI's own session store. */
export const DEFAULT_SESSION_STATE_DIR = path.join(os.homedir(), '.copilot', 'session-state');

/**
 * How the agent answers a permission request it cannot put to its host.
 *
 * `yolo` is the only setting that changes this, and it changes only this: a host
 * that IS reachable is still asked, and its answer still stands, including when it
 * says no. The setting exists for the unattended case — an agent driven by a script
 * has nobody to ask, and denying every request would make it useless.
 *
 * Read from the launch snapshot rather than from live configuration because an agent
 * process has no VS Code to read from, and because a permission policy that could
 * change mid-session would mean two identical requests getting different answers for
 * reasons invisible in the transcript.
 */
function permissionPolicy(deps: AcpAgentCompositionDeps): PermissionPolicy {
    return { fallback: deps.settings?.yolo === true ? 'approve-once' : 'deny' };
}

/**
 * Build the function that turns a `session/new` into a running backend.
 *
 * **Every manager receives the same provider instance.** That is the whole payoff
 * of spine S4: a manager *given* a provider is a consumer and will not stop it, so
 * N sessions share one CLI process. If each built its own, N sessions would spawn N
 * CLIs and the first session to close would stop a client the others were still
 * using.
 */
export function createSessionStarter(
    deps: AcpAgentCompositionDeps
): (params: { cwd: string }) => Promise<AcpSessionBackend> {
    return async ({ cwd }) => {
        const manager = deps.createManager({
            // The client's cwd wins: an ACP client opens a session *for* a
            // directory, and that is more specific than whatever the process was
            // launched in.
            workspaceFolder: cwd || deps.workspaceFolder || process.cwd(),
            clientProvider: deps.clientProvider,
            settings: { ...(deps.settings ?? {}) }
        });

        return SdkSessionBackend.start(
            manager,
            deps.logger,
            permissionPolicy(deps),
            createHistoryReader(deps.sessionStateDir ?? DEFAULT_SESSION_STATE_DIR)
        );
    };
}

/**
 * Build the function that resumes an existing session for `session/load`.
 *
 * Deliberately the same construction path as {@link createSessionStarter}, differing
 * only by `resumeSessionId`. A separate path would drift — the shared provider, the
 * per-session bridge and the cwd rule all have to stay identical, and the only thing
 * a resume changes is which session the manager attaches to.
 */
export function createSessionLoader(
    deps: AcpAgentCompositionDeps
): (params: { sessionId: string; cwd: string }) => Promise<AcpSessionBackend> {
    return async ({ sessionId, cwd }) => {
        const manager = deps.createManager({
            workspaceFolder: cwd || deps.workspaceFolder || process.cwd(),
            clientProvider: deps.clientProvider,
            settings: { ...(deps.settings ?? {}) },
            resumeSessionId: sessionId
        });

        return SdkSessionBackend.start(
            manager,
            deps.logger,
            permissionPolicy(deps),
            createHistoryReader(deps.sessionStateDir ?? DEFAULT_SESSION_STATE_DIR)
        );
    };
}

/** Assemble the agent. See {@link createSessionStarter} for the part that matters. */
export function createAcpAgent(deps: AcpAgentCompositionDeps): CopilotAcpAgent {
    return new CopilotAcpAgent({
        logger: deps.logger,
        agentName: deps.agentName,
        agentVersion: deps.agentVersion,
        startSession: createSessionStarter(deps),
        loadSession: createSessionLoader(deps)
    });
}
