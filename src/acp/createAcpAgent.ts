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
import { SdkSessionBackend, AcpManagerSlice } from './SdkSessionBackend';

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
    createManager(args: { workspaceFolder: string; clientProvider: unknown; settings: Record<string, unknown> }): AcpManagerSlice;
    /** Snapshot of `copilotCLI.*` settings taken at launch. */
    settings?: Readonly<Record<string, unknown>>;
    agentName?: string;
    agentVersion?: string;
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

        return SdkSessionBackend.start(manager, deps.logger);
    };
}

/** Assemble the agent. See {@link createSessionStarter} for the part that matters. */
export function createAcpAgent(deps: AcpAgentCompositionDeps): CopilotAcpAgent {
    return new CopilotAcpAgent({
        logger: deps.logger,
        agentName: deps.agentName,
        agentVersion: deps.agentVersion,
        startSession: createSessionStarter(deps)
    });
}
