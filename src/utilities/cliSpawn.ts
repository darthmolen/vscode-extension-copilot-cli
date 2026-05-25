/**
 * Build the spawn command/args for invoking the Copilot CLI at `cliPath`.
 *
 * On Windows you cannot directly `execFileSync` a `.js` file (the OS doesn't
 * know how to execute it — `spawnSync` returns `EFTYPE`). The CLI's npm-loader
 * and pure-JS entrypoints are both .js files; native binaries are not. This
 * helper mirrors what `@github/copilot-sdk` does internally
 * (client.ts:1586): for .js paths, invoke the current Node executable with
 * the script as the first argument; for native binaries, invoke directly.
 */
export function buildCliSpawnCommand(cliPath: string): { command: string; args: string[] } {
    if (cliPath.endsWith('.js')) {
        return { command: process.execPath, args: [cliPath] };
    }
    return { command: cliPath, args: [] };
}
