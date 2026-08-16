/**
 * Owns the CopilotClient's lifecycle: build it, start it, wire its diagnostics,
 * replace it when the connection dies, and stop it.
 *
 * Extracted from `SDKSessionManager` in spine S4. Two reasons, one structural and
 * one a live bug:
 *
 *  - `start()` and `recreateClient()` each carried their own copy of the
 *    resolve-cli-path → build-options → new → start → init-capabilities sequence.
 *  - Because the client and its `_lifecycleListenersAttached` flag were reset in
 *    different places, `stop()` cleared the client but left the flag set. The next
 *    `start()` therefore skipped listener attachment and ran blind — no CLI stderr,
 *    no exit code, no connection-close signal. `restart()` hit this every time.
 *    Here the flag is only ever cleared alongside the client it describes, in
 *    `setClient()`, so the two cannot drift apart.
 *
 * It also lets N `SDKSessionManager`s share one CLI process: a manager given a
 * provider consumes it, while a manager that builds its own owns it.
 */

import { buildCopilotClientOptions, CopilotClientOptions } from '../../utilities/copilotClientOptions';
import { LoggerLike } from '../../logger';

/**
 * The slice of the SDK client this provider touches. Deliberately narrow — the
 * real `CopilotClient` type is not imported, so tests can supply a fake and this
 * module carries no runtime dependency on the lazily-loaded SDK.
 */
export interface ManagedClient {
    start(): Promise<void>;
    stop(): Promise<void>;
}

export interface CopilotClientProviderDeps {
    logger: LoggerLike;
    /** Working directory handed to the runtime process. */
    workingDirectory: string;
    /** Resolved per creation, so a re-created client picks up a re-resolved CLI. */
    resolveCliPath(): string;
    /** Read per creation, so a config change takes effect on the next client. */
    useYolo(): boolean;
    /** Injectable purely so tests need neither the SDK nor a spawned CLI. */
    createClient(options: CopilotClientOptions): ManagedClient;
    /** Runs after start() and before the client is handed out (model capabilities). */
    onClientStarted?(client: ManagedClient): Promise<void>;
}

export class CopilotClientProvider {
    private client: ManagedClient | null = null;
    private listenersAttached = false;

    constructor(private readonly deps: CopilotClientProviderDeps) {}

    /** The live client, or null. Does not create one. */
    public get current(): ManagedClient | null {
        return this.client;
    }

    /** The started client, creating and wiring one on first use. */
    public async get(): Promise<ManagedClient> {
        if (this.client) {
            this.ensureListenersAttached();
            return this.client;
        }
        return this.create();
    }

    /**
     * Replace a dead client with a fresh one. The old client's `stop()` is
     * expected to throw when the connection is already closed — that is the
     * normal case here, not an error.
     */
    public async recreate(): Promise<ManagedClient> {
        this.deps.logger.info('[Client Recreate] Recreating CopilotClient...');
        await this.stop();
        const client = await this.create();
        this.deps.logger.info('[Client Recreate] Fresh CopilotClient created and started');
        return client;
    }

    /** Stop and release the client, if any. Safe to call when there is none. */
    public async stop(): Promise<void> {
        const client = this.client;
        if (!client) {
            this.setClient(null);
            return;
        }
        this.setClient(null);
        try {
            await client.stop();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.deps.logger.debug(`[Client] Error stopping client (expected if already dead): ${message}`);
        }
    }

    private async create(): Promise<ManagedClient> {
        const cliPath = this.deps.resolveCliPath();
        const options = buildCopilotClientOptions(cliPath, this.deps.workingDirectory, {
            useYolo: this.deps.useYolo()
        });

        const client = this.deps.createClient(options);
        this.setClient(client);

        // SDK 1.0.x removed `autoStart`; the connection must be opened explicitly
        // before any RPC.
        await client.start();
        this.ensureListenersAttached();
        await this.deps.onClientStarted?.(client);

        return client;
    }

    /** The single place the client and its listener flag change together. */
    private setClient(client: ManagedClient | null): void {
        this.client = client;
        this.listenersAttached = false;
    }

    /**
     * The SDK swallows CLI stderr, process exit and connection close. Without
     * these, a dead CLI looks like an unexplained hang.
     *
     * Idempotent and synchronous, so callers that only learn the CLI has spawned
     * later (`setActiveSession`) can re-ask without tracking state themselves.
     */
    public ensureListenersAttached(): void {
        if (!this.client || this.listenersAttached) {
            return;
        }

        const internals = this.client as unknown as {
            cliProcess?: { stderr?: { on(event: string, cb: (data: Buffer) => void): void }; on(event: string, cb: (code: number | null, signal: string | null) => void): void };
            connection?: { onClose?(cb: () => void): void };
        };

        const proc = internals.cliProcess;
        if (!proc) {
            return; // Not spawned yet — a later get() will wire it.
        }
        this.listenersAttached = true;

        proc.stderr?.on('data', (data: Buffer) => {
            for (const line of data.toString().split('\n').filter(l => l.trim())) {
                this.deps.logger.warn(`[CLI stderr] ${line}`);
            }
        });

        proc.on('exit', (code, signal) => {
            this.deps.logger.error(`[CLI Process] Exited with code=${code}, signal=${signal}`);
        });

        internals.connection?.onClose?.(() => {
            this.deps.logger.error('[CLI Connection] JSON-RPC connection closed');
        });
    }
}
