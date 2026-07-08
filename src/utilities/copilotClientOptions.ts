/**
 * Stdio connection descriptor consumed by the SDK's `CopilotClient`. This is the
 * exact shape `RuntimeConnection.forStdio({ path, args })` produces — built as a
 * plain literal here so this module stays decoupled from the (lazily-loaded) SDK.
 */
export interface StdioConnection {
    kind: 'stdio';
    path: string;
    args: string[];
}

export interface CopilotClientOptions {
    logLevel: 'info';
    /**
     * How the client connects to / spawns the Copilot runtime. As of SDK 1.0.x
     * the CLI path is supplied here via `connection.path` — the old top-level
     * `cliPath` option was removed and is silently ignored (the SDK falls back to
     * resolving a bundled platform package, which does not exist in the packaged
     * VSIX, so the path MUST go through `connection`).
     */
    connection: StdioConnection;
    /** Working directory for the runtime process (SDK 1.0.x renamed this from `cwd`). */
    workingDirectory: string;
}

export interface BuildOpts {
    /**
     * When true, passes `--yolo` to the CLI to enable broader bypass behavior
     * beyond the SDK's `approveAll` permission handler. CLI 1.0.52 still
     * accepts this flag (verified by grepping app.js); 3.8.7 mistakenly removed
     * it based on a misdiagnosed "too many arguments" error that turned out to
     * be unrelated.
     */
    useYolo?: boolean;
}

/**
 * Build the options object passed to `new CopilotClient({...})`.
 *
 * SDK 1.0.x contract (changed from 0.3.0):
 *   - CLI path/args go under `connection: RuntimeConnection.forStdio({ path, args })`
 *     (top-level `cliPath`/`cliArgs` are gone and silently ignored).
 *   - working directory is `workingDirectory` (was `cwd`).
 *   - there is no `autoStart`; the caller must `await client.start()`.
 *
 * `connection.args` is empty by default. When `opts.useYolo` is true, `--yolo` is
 * included so the CLI applies whatever bypass behavior it implements at that flag
 * level (in addition to the SDK's `approveAll` permission handler, which is wired
 * separately in `createSessionWithModelFallback`).
 */
export function buildCopilotClientOptions(cliPath: string, cwd: string, opts: BuildOpts = {}): CopilotClientOptions {
    const args: string[] = [];
    if (opts.useYolo) {
        args.push('--yolo');
    }
    return {
        logLevel: 'info',
        connection: { kind: 'stdio', path: cliPath, args },
        workingDirectory: cwd,
    };
}
