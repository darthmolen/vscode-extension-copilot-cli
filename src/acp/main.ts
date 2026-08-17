/**
 * Entry point for the ACP agent process (IN-3).
 *
 *     host ──ACP(stdio)──▶ this process ──SDK──▶ Copilot CLI
 *
 * Deliberately the only file here that constructs anything concrete. Everything
 * else in `src/acp/` takes its collaborators as parameters, which is what keeps
 * them free of `vscode`, free of the CLI, and testable in-process. The cost of
 * that discipline is paid here, once.
 *
 * Run it directly:
 *     node out/acp/main.js --workspace /path/to/repo
 *
 * **stdout is the protocol.** Anything written there that is not a framed JSON-RPC
 * message corrupts the stream, so every log line goes to stderr — including the
 * ones the manager and its services emit through the injected logger.
 */

import * as os from 'os';
import * as path from 'path';
import { SDKSessionManager, resolveCliPath } from '../sdkSessionManager';
import { CopilotClientProvider } from '../extension/services/CopilotClientProvider';
import { createHeadlessHostBridge } from './HeadlessHostBridge';
import { createAcpAgent } from './createAcpAgent';
import { serveOverStream } from './serveOverStream';
import type { LoggerLike } from '../logger';

/** Reads `--flag value` pairs; unknown flags are ignored rather than fatal. */
function readFlag(argv: readonly string[], name: string): string | undefined {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/**
 * Every line goes to stderr. stdout belongs to the protocol, and a stray log there
 * is not a cosmetic problem — it is a parse error on the client's side.
 */
function createStderrLogger(): LoggerLike {
    const write = (level: string, message: string) => {
        process.stderr.write(`[${level}] ${new Date().toISOString()} ${message}\n`);
    };
    return {
        debug: m => write('DEBUG', m),
        info: m => write('INFO ', m),
        warn: m => write('WARN ', m),
        error: (m, e) => write('ERROR', e ? `${m}: ${e.message}` : m)
    };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
    const logger = createStderrLogger();
    const workspaceFolder = readFlag(argv, 'workspace') ?? process.cwd();
    const globalStorageDir =
        readFlag(argv, 'storage') ?? path.join(os.homedir(), '.copilot', 'acp-agent');
    const injectedCliPath = readFlag(argv, 'cli-path');

    // Settings normally come from VS Code's configuration service, which does not
    // exist here. A launcher may pass a JSON snapshot; otherwise the manager sees
    // an empty object and falls back to each caller's default.
    const settingsJson = readFlag(argv, 'settings');
    let settings: Record<string, unknown> = {};
    if (settingsJson) {
        try {
            settings = JSON.parse(settingsJson) as Record<string, unknown>;
        } catch (error) {
            logger.warn(`[ACP] ignoring unparseable --settings: ${(error as Error).message}`);
        }
    }

    // ONE provider for the whole process — the S4 payoff. Every manager below is
    // handed this instance, so N sessions share a single CLI, and no manager owns
    // it (an owner would stop the shared client when its session closed).
    const bootstrapBridge = createHeadlessHostBridge({
        logger, globalStorageDir, workspaceFolder, settings
    });
    // The Copilot SDK is ESM-only; `module: Node16` keeps this a real dynamic
    // import rather than downlevelling it to require(). Loaded up front because the
    // provider's createClient is synchronous.
    const { CopilotClient } = await import('@github/copilot-sdk');

    const clientProvider = new CopilotClientProvider({
        logger,
        workingDirectory: workspaceFolder,
        resolveCliPath: () => injectedCliPath ?? resolveCliPath(logger, undefined, bootstrapBridge),
        useYolo: () => bootstrapBridge.getConfig<boolean>('yolo', false) ?? false,
        createClient: options => new CopilotClient(options as never)
    });

    const agent = createAcpAgent({
        logger,
        globalStorageDir,
        workspaceFolder,
        clientProvider,
        settings,
        agentName: 'Copilot CLI Chat',
        agentVersion: readFlag(argv, 'agent-version') ?? '0.0.0',
        // Each session gets its own bridge, because each carries its own cwd — the
        // manager reads the workspace from its host at construction, so a shared
        // bridge would pin every session to the process's directory.
        createManager: ({ workspaceFolder: sessionCwd, clientProvider: provider, settings: s }) =>
            new SDKSessionManager(
                undefined,
                {},
                /* resumeLastSession */ false,
                /* specificSessionId */ undefined,
                injectedCliPath,
                createHeadlessHostBridge({
                    logger, globalStorageDir, workspaceFolder: sessionCwd, settings: s
                }),
                provider as CopilotClientProvider
            )
    });

    logger.info(`[ACP] agent starting · workspace=${workspaceFolder}`);

    const connection = serveOverStream(agent, {
        // Node streams are converted to web streams, which is what the SDK's
        // ndJsonStream consumes.
        input: (await import('stream')).Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
        output: (await import('stream')).Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
        logger
    });

    await connection.ready;
    // Resolve only when stdin closes: the host owns our lifetime.
    await new Promise<void>(resolve => process.stdin.once('end', resolve));
    logger.info('[ACP] stdin closed; exiting');
}

// Only self-start when run directly, so the module can be imported by a test or a
// supervisor without immediately seizing stdio.
if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`[ACP] fatal: ${error instanceof Error ? error.stack : error}\n`);
        process.exitCode = 1;
    });
}
