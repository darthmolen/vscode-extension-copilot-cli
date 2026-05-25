export interface CopilotClientOptions {
    logLevel: 'info';
    cliPath: string;
    cliArgs: string[];
    cwd: string;
    autoStart: true;
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
 * `cliArgs` is empty by default. When `opts.useYolo` is true, `--yolo` is
 * included so the CLI applies whatever bypass behavior it implements at that
 * flag level (in addition to the SDK's `approveAll` permission handler, which
 * is wired separately in `createSessionWithModelFallback`).
 */
export function buildCopilotClientOptions(cliPath: string, cwd: string, opts: BuildOpts = {}): CopilotClientOptions {
    const cliArgs: string[] = [];
    if (opts.useYolo) {
        cliArgs.push('--yolo');
    }
    return {
        logLevel: 'info',
        cliPath,
        cliArgs,
        cwd,
        autoStart: true,
    };
}
