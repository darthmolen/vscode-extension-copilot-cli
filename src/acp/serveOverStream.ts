/**
 * Puts a {@link CopilotAcpAgent} on a real byte stream (IN-3).
 *
 * Everything up to here drove the agent through `clientApp.connect(agentApp)`,
 * which has no transport at all. This is the transport: NDJSON JSON-RPC, one value
 * per line, which is ACP's framing and **not** LSP's `Content-Length` headers.
 *
 * Takes streams rather than reaching for `process.stdin`/`stdout` directly. That is
 * what lets the NDJSON round trip be an ordinary unit test instead of a subprocess
 * fixture, and it is the same reason every other file here takes its collaborators
 * as parameters. {@link ./main} is the thin piece that supplies the real ones.
 */

import type { LoggerLike } from '../logger';
import { CopilotAcpAgent } from './CopilotAcpAgent';

type AcpModule = typeof import('@agentclientprotocol/sdk', { with: { 'resolution-mode': 'import' } });

export interface ServeOptions {
    /** Byte source — `process.stdin` as a web stream in production. */
    input: ReadableStream<Uint8Array>;
    /** Byte sink — `process.stdout` as a web stream in production. */
    output: WritableStream<Uint8Array>;
    logger?: LoggerLike;
}

/**
 * A live connection. Narrow on purpose: enough to hold it and shut it down, not to
 * drive it — the protocol surface belongs to the agent.
 *
 * `close` and `closed` exist because the previous version documented a handle a
 * caller could "hold and shut down" and then offered no way to do either. A
 * supervisor or a test could only end the server by closing the underlying stream
 * and hoping. Both delegate to the SDK's own connection, so this adds plumbing
 * rather than machinery.
 */
export interface AcpServerConnection {
    /** Settles when the lazy SDK import and `connect` have completed. */
    readonly ready: Promise<unknown>;
    /** Resolves once the connection is closed, by either side. */
    readonly closed: Promise<void>;
    /**
     * Shut down. Safe before `ready` settles, safe twice, and safe when the
     * connection never opened — a failed start is exactly when a supervisor calls
     * this, so it must not add a second failure to the first.
     */
    close(error?: unknown): Promise<void>;
}

/** The slice of the SDK connection this file touches. */
interface SdkConnection {
    closed: Promise<void>;
    close(error?: unknown): void;
}

/**
 * Serve `agent` over `options.input`/`output`.
 *
 * Synchronous by design even though the SDK loads lazily: a caller wiring stdio
 * wants a handle immediately, and any await here would leave a window where bytes
 * could arrive before the connection existed. The lazy import is awaited inside,
 * and surfaced through `ready` for anyone who needs to know when it settled.
 */
export function serveOverStream(agent: CopilotAcpAgent, options: ServeOptions): AcpServerConnection {
    const { input, output, logger } = options;

    const ready = (async () => {
        const acp: AcpModule = await import('@agentclientprotocol/sdk');
        const app = agent.register(acp.agent());
        // ndJsonStream takes (output, input) — sink first. Getting this backwards
        // produces a connection that silently never reads.
        const connection = app.connect(acp.ndJsonStream(output, input)) as unknown as SdkConnection;
        logger?.info('[ACP] serving over NDJSON stream');
        return connection;
    })();

    ready.catch(error => {
        logger?.error(
            `[ACP] failed to serve: ${error instanceof Error ? error.message : String(error)}`
        );
    });

    /** The connection once it exists, or `null` if it never will. */
    const settled = ready.then(c => c, () => null);

    return {
        ready,

        // Awaits `settled` rather than reading a field, so a caller may shut down
        // during the lazy import instead of racing it.
        close: async (error?: unknown) => {
            const connection = await settled;
            // Already-closed is not an error: a supervisor closes again when a second
            // signal lands mid-teardown, and a start that failed has nothing to close.
            connection?.close(error);
        },

        // Resolved rather than pending when the connection never opened. A caller
        // waiting on "is it finished" after a failed start would otherwise wait for
        // something that can never happen.
        closed: settled.then(c => c?.closed ?? Promise.resolve())
    };
}
