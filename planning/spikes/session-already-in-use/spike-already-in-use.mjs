#!/usr/bin/env node
/**
 * Spike S-B: two clients, one session id.
 *
 * P3 §4.5 makes the dropdown reveal-or-reattach rather than start a second manager
 * for a session that is already running. `registry.get()` is the mechanism, but the
 * plan wants to know how hard the guard behind it has to be — a warning if the
 * runtime copes, a hard refusal if it does not.
 *
 * The SDK reports `StartData.alreadyInUse` / `ResumeData.alreadyInUse` on every
 * `session.start` we log, and our source references them **zero** times. There is
 * also `sessions.checkInUse`, which takes a set of ids and returns those *"held by
 * another running process via an alive lock file"*.
 *
 * **Do not infer the answer from the field's existence.** That a conflict is
 * *reported* rather than *rejected* suggests tolerance; it does not establish it.
 *
 * Objectives:
 *   0. bundled CLI
 *   1. `sessions.checkInUse` exists, and answers false for a session nobody holds
 *   2. it answers TRUE for a session held by a live client in another process
 *   3. resuming it anyway: what `alreadyInUse` reports, and whether it works at all
 *   4. whether events.jsonl stays coherent afterwards, or interleaves/corrupts
 *
 * Usage: node planning/spikes/session-already-in-use/spike-already-in-use.mjs
 * Requires: live Copilot auth (~/.copilot), Node 24+, `npm run compile-tests`.
 */

import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
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
/** Recorded rather than judged: this spike's job is to find out, not to assert. */
const observe = (name, detail) => {
    results.steps.push({ name, ok: true, observation: detail });
    console.log(`👁  ${name} — ${detail}`);
};

function eventsPath(sessionId) {
    return join(homedir(), '.copilot', 'session-state', sessionId, 'events.jsonl');
}

function readEvents(sessionId) {
    const p = eventsPath(sessionId);
    if (!existsSync(p)) { return { lines: 0, parseErrors: 0, types: {} }; }
    const raw = readFileSync(p, 'utf-8').split('\n').filter(Boolean);
    let parseErrors = 0;
    const types = {};
    for (const line of raw) {
        try {
            const event = JSON.parse(line);
            const type = event.type ?? '(none)';
            types[type] = (types[type] ?? 0) + 1;
        } catch { parseErrors++; }
    }
    return { lines: raw.length, parseErrors, types };
}

async function main() {
    mkdirSync(RESULTS_DIR, { recursive: true });

    const platformPkg = `@github/copilot-${process.platform}-${process.arch}`;
    const cliPath = [
        join(REPO_ROOT, 'node_modules', platformPkg, 'copilot'),
        join(REPO_ROOT, 'node_modules', platformPkg, 'app.js'),
        join(REPO_ROOT, 'node_modules/@github/copilot/npm-loader.js')
    ].find(p => existsSync(p));
    if (!cliPath) { step('0. resolved the bundled CLI', false, 'not found'); return finish(1); }
    step('0. resolved the bundled CLI', true, cliPath);

    const { CopilotClient } = await import('@github/copilot-sdk');
    const { buildCopilotClientOptions } = require(join(REPO_ROOT, 'out/utilities/copilotClientOptions.js'));
    const { ensureNodeExecPath, findSystemNodeRuntime } =
        require(join(REPO_ROOT, 'out/extension/services/cliBundleService.js'));
    const noop = { info() {}, warn() {}, error() {}, debug() {} };
    ensureNodeExecPath(findSystemNodeRuntime(noop), noop);

    const options = () => buildCopilotClientOptions(cliPath, REPO_ROOT, { useYolo: true });

    // Two clients — two CLI processes, which is exactly the situation §4.5 guards
    // against being reached by accident.
    const first = new CopilotClient(options());
    await first.start();
    const second = new CopilotClient(options());
    await second.start();

    const held = await first.createSession({ clientName: 'in-use-spike-holder' });
    const sessionId = held.sessionId ?? held.id;
    await held.sendAndWait('Reply with exactly: HOLDER');
    step('1a. a session exists and is held by client one', !!sessionId, sessionId);
    results.sessionId = sessionId;

    // ── 1 + 2. sessions.checkInUse ──────────────────────────────────────────
    const checkInUse = second.rpc?.sessions?.checkInUse;
    step('1b. sessions.checkInUse is exposed by this CLI', typeof checkInUse === 'function',
        `typeof = ${typeof checkInUse}`);

    if (typeof checkInUse === 'function') {
        const unheld = 'ffffffff-0000-0000-0000-000000000000';
        try {
            const answer = await second.rpc.sessions.checkInUse({ sessionIds: [sessionId, unheld] });
            results.checkInUse = answer;
            const inUse = answer?.sessionIds ?? answer?.inUse ?? answer;
            observe('2. checkInUse answer, verbatim', JSON.stringify(answer));
            step('2a. it names the held session',
                JSON.stringify(inUse).includes(sessionId),
                `held=${sessionId}`);
            step('2b. it does not name a session nobody holds',
                !JSON.stringify(inUse).includes(unheld), `unheld=${unheld}`);
        } catch (e) {
            step('2. checkInUse answered', false, `${e?.code ?? ''} ${e?.message ?? e}`);
            results.checkInUseError = { code: e?.code, message: e?.message };
        }
    }

    const beforeEvents = readEvents(sessionId);
    results.eventsBefore = beforeEvents;

    // ── 3. Resume it anyway, from the second client ─────────────────────────
    let resumed = null;
    let resumeError = null;
    let alreadyInUseReported = null;
    try {
        // Whatever the SDK reports on the way in — this is the field our source
        // references zero times.
        second.on?.('session.start', (event) => {
            if (alreadyInUseReported === null && event?.data) {
                alreadyInUseReported = event.data.alreadyInUse ?? null;
            }
        });
        resumed = await second.resumeSession(sessionId, { clientName: 'in-use-spike-intruder' });
        observe('3a. resumeSession from a second client', 'succeeded — the runtime did NOT refuse');
        results.resumeSucceeded = true;
    } catch (e) {
        resumeError = e?.message ?? String(e);
        observe('3a. resumeSession from a second client', `REFUSED: ${resumeError}`);
        results.resumeSucceeded = false;
        results.resumeError = resumeError;
    }

    observe('3b. alreadyInUse as reported to the intruder', JSON.stringify(alreadyInUseReported));
    results.alreadyInUseReported = alreadyInUseReported;

    // ── 4. Both write. Does the log stay coherent? ──────────────────────────
    if (resumed) {
        try {
            await Promise.all([
                held.sendAndWait('Reply with exactly: FROM-HOLDER'),
                resumed.sendAndWait('Reply with exactly: FROM-INTRUDER')
            ]);
            observe('4a. both clients completed a turn on one session', 'no error raised');
            results.concurrentTurns = 'both completed';
        } catch (e) {
            observe('4a. concurrent turns', `error: ${e?.message ?? e}`);
            results.concurrentTurns = `error: ${e?.message ?? e}`;
        }
    }

    const afterEvents = readEvents(sessionId);
    results.eventsAfter = afterEvents;
    step('4b. events.jsonl still parses line by line', afterEvents.parseErrors === 0,
        `${afterEvents.lines} lines, ${afterEvents.parseErrors} unparseable ` +
        `(was ${beforeEvents.lines} lines before the second client)`);

    await resumed?.disconnect().catch(() => {});
    await held.disconnect().catch(() => {});
    await second.stop().catch(() => {});
    await first.stop().catch(() => {});

    return finish(results.steps.every(s => s.ok) ? 0 : 1);
}

function finish(code) {
    results.finishedAt = new Date().toISOString();
    results.exitCode = code;
    writeFileSync(join(RESULTS_DIR, 'result.json'), JSON.stringify(results, null, 2));
    console.log(`\n${code === 0 ? 'SPIKE COMPLETE' : 'SPIKE HAD FAILURES'} — results/result.json`);
    process.exit(code);
}

main().catch((e) => {
    console.error(e);
    results.fatal = e?.message ?? String(e);
    finish(1);
});
