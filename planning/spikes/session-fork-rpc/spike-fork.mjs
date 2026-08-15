#!/usr/bin/env node
/**
 * Spike: does `sessions.fork` work against OUR bundled CLI, and does `name` land?
 *
 * The API is verified present in the installed SDK 1.0.5 — `fork: async (params)
 * => connection.sendRequest("sessions.fork", params)` at dist/generated/rpc.js,
 * typed at rpc.d.ts. What the types cannot tell us is whether the CLI we
 * actually ship implements the method, and whether the `name` we pass is
 * honoured. That is what decides Slice 1.
 *
 * Objectives:
 *   0. prove we are talking to the BUNDLED CLI — print its path and --version
 *   1. sessions.fork succeeds and returns { sessionId, name? }
 *   2. the name we pass actually lands on the new session
 *   3. a fork is resumable while the parent is still live on the same client
 *
 * Deliberately NOT proving `toEventId` is exclusive — rpc.d.ts documents it, and
 * Slice 3 will verify it empirically when it needs to.
 *
 * Usage: node planning/spikes/session-fork-rpc/spike-fork.mjs
 * Requires: live Copilot auth (~/.copilot), Node 24+.
 */

import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';

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

/** Reads the label the CLI persisted for a session, if any. */
function readSessionName(sessionId) {
    const p = join(homedir(), '.copilot', 'session-state', sessionId, 'session-name.txt');
    return existsSync(p) ? readFileSync(p, 'utf-8').trim() : null;
}

async function main() {
    mkdirSync(RESULTS_DIR, { recursive: true });

    // ── 0. Prove we are on the BUNDLED CLI, not whatever is on PATH ──────────
    // The Phase 0.2 spike failed exactly here by guessing
    // @github/copilot/index.js, which does not exist — that package ships only
    // npm-loader.js; the real binary is in the platform package.
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
    let reportedVersion = '(unknown)';
    try {
        reportedVersion = execFileSync(cliPath, ['--version'], { encoding: 'utf-8' }).trim();
    } catch (e) {
        reportedVersion = `(--version failed: ${e.message})`;
    }
    step('0. resolved the bundled CLI', true, `${cliPath}`);
    step('0b. CLI identity', reportedVersion.includes(bundledVersion),
        `bundled package ${bundledVersion} · binary reports "${reportedVersion}"`);
    results.cliPath = cliPath;
    results.bundledVersion = bundledVersion;
    results.reportedVersion = reportedVersion;

    // ── Start a client and a parent session ─────────────────────────────────
    const { CopilotClient } = await import('@github/copilot-sdk');
    const { buildCopilotClientOptions } = require(join(REPO_ROOT, 'out/utilities/copilotClientOptions.js'));
    const { ensureNodeExecPath, findSystemNodeRuntime } =
        require(join(REPO_ROOT, 'out/extension/services/cliBundleService.js'));
    const noop = { info() {}, warn() {}, error() {}, debug() {} };
    ensureNodeExecPath(findSystemNodeRuntime(noop), noop);

    const client = new CopilotClient(buildCopilotClientOptions(cliPath, REPO_ROOT, { useYolo: true }));
    await client.start();

    const parent = await client.createSession({ clientName: 'fork-spike' });
    const parentId = parent.sessionId ?? parent.id;
    await parent.sendAndWait('Reply with exactly: hello from the parent');
    step('1a. parent session created and answered', !!parentId, `parentId=${parentId}`);

    // ── 1 + 2. Fork with an explicit name ───────────────────────────────────
    const forkName = `Spike Parent (fork ${Date.now()})`;
    let forkResult;
    try {
        const sessionsRpc = client.rpc?.sessions;
        step('1b. sessions.fork is exposed by this CLI', typeof sessionsRpc?.fork === 'function',
            `typeof fork = ${typeof sessionsRpc?.fork}`);
        forkResult = await sessionsRpc.fork({ sessionId: parentId, name: forkName });
        step('1. sessions.fork succeeded', !!forkResult?.sessionId, JSON.stringify(forkResult));
    } catch (e) {
        step('1. sessions.fork succeeded', false, `${e?.code ?? ''} ${e?.message ?? e}`);
        results.forkError = { code: e?.code, message: e?.message };
        await client.stop().catch(() => {});
        return finish(1);
    }

    const forkId = forkResult.sessionId;
    const persistedName = readSessionName(forkId);
    step('2. the name we passed landed on the fork',
        forkResult.name === forkName || persistedName === forkName,
        `rpc returned name=${JSON.stringify(forkResult.name)} · session-name.txt=${JSON.stringify(persistedName)}`);
    results.forkName = { requested: forkName, returned: forkResult.name, persisted: persistedName };

    // Does the parent keep its own name, or did the fork disturb it?
    results.parentName = readSessionName(parentId);
    step('2b. parent name untouched', results.parentName !== forkName,
        `parent session-name.txt=${JSON.stringify(results.parentName)}`);

    // ── 3. Resume the fork while the parent is still live ────────────────────
    try {
        const forked = await client.resumeSession(forkId, { clientName: 'fork-spike' });
        await forked.sendAndWait('Reply with exactly: hello from the fork');
        const parentStillLive = parent.sessionId === parentId || parent.id === parentId;
        step('3. fork resumable while parent is still live on the same client', parentStillLive,
            `forkId=${forkId}`);
        await forked.disconnect?.().catch?.(() => {});
    } catch (e) {
        step('3. fork resumable while parent is still live on the same client', false, e?.message ?? String(e));
    }

    await parent.disconnect?.().catch?.(() => {});
    await client.stop().catch(() => {});
    return finish(0);
}

function finish(code) {
    results.finishedAt = new Date().toISOString();
    results.passed = results.steps.filter(s => s.ok).length;
    results.total = results.steps.length;
    mkdirSync(RESULTS_DIR, { recursive: true });
    const file = join(RESULTS_DIR, 'fork-spike.json');
    writeFileSync(file, JSON.stringify(results, null, 2));
    console.log(`\n${results.passed}/${results.total} steps passed → ${file}`);
    process.exit(code);
}

main().catch(e => {
    console.error('SPIKE CRASHED:', e);
    step('crash', false, e?.message);
    finish(1);
});
