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
 * A live connection. Narrow on purpose: callers need to know it exists so they can
 * hold it and shut down, not to drive it.
 */
export interface AcpServerConnection {
    readonly ready: Promise<unknown>;
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
        const connection = app.connect(acp.ndJsonStream(output, input));
        logger?.info('[ACP] serving over NDJSON stream');
        return connection;
    })();

    ready.catch(error => {
        logger?.error(
            `[ACP] failed to serve: ${error instanceof Error ? error.message : String(error)}`
        );
    });

    return { ready };
}
