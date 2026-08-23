#!/usr/bin/env node
/**
 * Spike S-A: one CLI process, two live sessions.
 *
 * `CopilotClientProvider`'s own header says it *"lets N `SDKSessionManager`s share
 * one CLI process"*, and `SDKSessionManager` carries `ownsClientProvider` guarding
 * `stop()`. The seam is complete — and the single construction site in
 * `extension.ts` passes six arguments where the provider is the seventh. **It has
 * never been shared.** Every manager spawns its own CLI.
 *
 * P3 §4.7 wants to build one provider at the composition root and inject it. Per
 * CLAUDE.md's SDK-first rule, prove the path executes before writing the extension
 * against the assumption.
 *
 * Objectives:
 *   0. prove we are on the BUNDLED CLI, not whatever is on PATH
 *   1. two sessions over ONE client both answer, independently
 *   2. they are genuinely distinct sessions (different ids, separate transcripts)
 *   3. disconnecting one does NOT kill the other
 *   4. exactly one CLI process is running while both sessions are live
 *
 * If any of 1–3 fails, §4.7 drops out and the rest of P3 still lands: N processes
 * is a cost, not a correctness problem.
 *
 * Usage: node planning/spikes/shared-client/spike-shared-client.mjs
 * Requires: live Copilot auth (~/.copilot), Node 24+, `npm run compile-tests`.
 */

import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const RESULTS_DIR = join(__dirname, 'results');
const require = createRequire(import.meta.url);

const results = { startedAt: new Date().toISOString(), steps: [] };
const step = (name, ok, detail) => {
    results.steps.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
    return ok;
};

/** How many copilot CLI processes this user has running right now. */
function copilotProcessCount() {
    try {
        const out = execFileSync('bash', ['-lc', "ps -u \"$(id -un)\" -o args= | grep -c '[c]opilot.*--stdio' || true"],
            { encoding: 'utf-8' });
        return Number(out.trim());
    } catch {
        return -1;
    }
}

async function main() {
    mkdirSync(RESULTS_DIR, { recursive: true });

    const platformPkg = `@github/copilot-${process.platform}-${process.arch}`;
    const candidates = [
        join(REPO_ROOT, 'node_modules', platformPkg, 'copilot'),
        join(REPO_ROOT, 'node_modules', platformPkg, 'app.js'),
        join(REPO_ROOT, 'node_modules/@github/copilot/npm-loader.js')
    ];
    const cliPath = candidates.find(p => existsSync(p));
    if (!cliPath) {
        step('0. resolved the bundled CLI', false, `none of: ${candidates.join(' | ')}`);
        return finish(1);
    }
    const bundledVersion = JSON.parse(
        readFileSync(join(REPO_ROOT, 'node_modules/@github/copilot/package.json'), 'utf-8')
    ).version;
    step('0. resolved the bundled CLI', true, `${cliPath} (package ${bundledVersion})`);
    results.cliPath = cliPath;

    const { CopilotClient } = await import('@github/copilot-sdk');
    const { buildCopilotClientOptions } = require(join(REPO_ROOT, 'out/utilities/copilotClientOptions.js'));
    const { ensureNodeExecPath, findSystemNodeRuntime } =
        require(join(REPO_ROOT, 'out/extension/services/cliBundleService.js'));
    const { CopilotClientProvider } = require(join(REPO_ROOT, 'out/extension/services/CopilotClientProvider.js'));
    const noop = { info() {}, warn() {}, error() {}, debug() {} };
    ensureNodeExecPath(findSystemNodeRuntime(noop), noop);

    const before = copilotProcessCount();

    // The provider the extension would build once at the composition root.
    const provider = new CopilotClientProvider({
        logger: noop,
        workingDirectory: REPO_ROOT,
        resolveCliPath: () => cliPath,
        useYolo: () => true,
        createClient: (options) => new CopilotClient(options)
    });

    // Two "managers" — here, two consumers asking the same provider for a client.
    const clientA = await provider.get();
    const clientB = await provider.get();
    step('1a. both consumers got the SAME client object', clientA === clientB,
        clientA === clientB ? 'one provider, one client' : 'the provider handed out two clients');

    const sessionA = await clientA.createSession({ clientName: 'shared-client-spike-A' });
    const sessionB = await clientB.createSession({ clientName: 'shared-client-spike-B' });
    const idA = sessionA.sessionId ?? sessionA.id;
    const idB = sessionB.sessionId ?? sessionB.id;
    step('2. two distinct sessions over one client', !!idA && !!idB && idA !== idB, `A=${idA} B=${idB}`);
    results.sessions = { idA, idB };

    const replyA = await sessionA.sendAndWait('Reply with exactly: AAA');
    const replyB = await sessionB.sendAndWait('Reply with exactly: BBB');
    const textOf = (r) => JSON.stringify(r).slice(0, 200);
    step('1b. session A answered', JSON.stringify(replyA).includes('AAA'), textOf(replyA));
    step('1c. session B answered', JSON.stringify(replyB).includes('BBB'), textOf(replyB));

    const during = copilotProcessCount();
    step('4. exactly one CLI process while both are live', during - before === 1,
        `before=${before} during=${during} (delta ${during - before})`);
    results.processes = { before, during };

    // 3. Disconnect A. B must survive — this is the whole point of the seam.
    await sessionA.disconnect();
    let bSurvived = false;
    let bError = null;
    try {
        const reply = await sessionB.sendAndWait('Reply with exactly: STILL HERE');
        bSurvived = JSON.stringify(reply).includes('STILL HERE');
        results.afterDisconnect = textOf(reply);
    } catch (e) {
        bError = e?.message ?? String(e);
        results.afterDisconnectError = bError;
    }
    step('3. disconnecting one session left the other working', bSurvived, bError ?? results.afterDisconnect);

    await sessionB.disconnect().catch(() => {});
    await provider.stop();
    const after = copilotProcessCount();
    step('4b. stopping the provider stopped the CLI', after <= before, `before=${before} after=${after}`);
    results.processes.after = after;

    return finish(results.steps.every(s => s.ok) ? 0 : 1);
}

function finish(code) {
    results.finishedAt = new Date().toISOString();
    results.exitCode = code;
    writeFileSync(join(RESULTS_DIR, 'result.json'), JSON.stringify(results, null, 2));
    console.log(`\n${code === 0 ? 'SPIKE PASSED' : 'SPIKE FAILED'} — results/result.json`);
    process.exit(code);
}

main().catch((e) => {
    console.error(e);
    results.fatal = e?.message ?? String(e);
    finish(1);
});
