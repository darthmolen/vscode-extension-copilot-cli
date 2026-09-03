#!/usr/bin/env node
/**
 * spike-cold-start-into-plan.mjs — Can we resume straight into plan mode, and
 * mint the work session only when plan mode is left?
 *
 * The design under test
 * ---------------------
 * Today, startup that finds a `-plan` id strips the suffix and resumes the WORK
 * session (sdkSessionManager.ts:765-770), then re-enters plan mode. That strip is
 * vestigial: it exists because plan sessions used to be re-created and therefore
 * were not resumable, so the work session was the only anchor that survived a
 * restart.
 *
 * It also breaks outright. A work session the user left immediately for plan mode
 * has a directory (workspace.yaml, plan.md) but no transcript, and
 * `session.resume` answers "Session not found" — the "Previous session not found"
 * dialog, reproduced from a real session store.
 *
 * The symmetric design: resume the PLAN session directly, and let
 * `disablePlanMode` mint the work session, which is the one moment it is actually
 * needed (`ensureSessionAlive` already does exactly this on expiry).
 *
 * Two things must hold for that to be safe, and neither is proven by the earlier
 * spikes, which resumed a plan session inside a process that had already created
 * its work session:
 *
 *   1. A COLD resume of a `-plan` id — fresh client, no work session ever created
 *      in this process — restores the planning conversation AND still enforces
 *      `availableTools`. Restoring the conversation while quietly dropping the
 *      restriction would hand plan mode a full toolset.
 *
 *   2. `createSession({ sessionId: <workId> })` against the phantom work directory
 *      succeeds and leaves `plan.md` intact. That directory already exists and
 *      holds plan.md; creating under the same id is what keeps the `-plan`
 *      pairing, rather than minting a fresh UUID and orphaning the plan session.
 *
 * Phases
 * ------
 *   A  create W, send nothing, stop        -> the phantom work session
 *   B  create W-plan restricted, say GAMMA -> the planning conversation
 *   C  COLD resume W-plan restricted       -> recall GAMMA? write blocked?
 *   D  create W under the phantom dir      -> succeeds? plan.md survives?
 *
 * Phase C carries a control the earlier tool spike taught: "no file appeared" is
 * ambiguous unless an unrestricted session demonstrably writes one.
 *
 * Usage (Node 24+, from project root):
 *   node planning/spikes/plan-session-reuse/spike-cold-start-into-plan.mjs
 *   node planning/spikes/plan-session-reuse/spike-cold-start-into-plan.mjs --keep
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

const KEEP = process.argv.includes('--keep');

const CLI_PKG = path.join(
    os.homedir(),
    'AppData/Roaming/Code/User/globalStorage/darthmolen.copilot-cli-extension',
    'cli/_1.0.67/node_modules/@github/copilot-win32-x64'
);
const SDK_URL = pathToFileURL(path.join(CLI_PKG, 'copilot-sdk', 'index.js')).href;
const CLI_PATH = path.join(CLI_PKG, 'copilot.exe');

const STATE = path.join(os.homedir(), '.copilot', 'session-state');
const WORK_ID = `spike-cold-${Date.now()}`;
const PLAN_ID = `${WORK_ID}-plan`;
const WORK_DIR = path.join(STATE, WORK_ID);
const PLAN_DIR = path.join(STATE, PLAN_ID);
const PROBE_DIR = path.join(os.tmpdir(), `cold-plan-probe-${Date.now()}`);

// No explicit model: claude-sonnet-4.6 is no longer available on this account,
// and the account default is what the extension falls back to anyway.
const CREATE_TIMEOUT = 60_000;
const SEND_TIMEOUT = 120_000;

/** Read-only, mirroring the safe half of PLAN_MODE_AVAILABLE_TOOLS. */
const READ_ONLY = ['view', 'grep', 'glob'];

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', B = '\x1b[1m', X = '\x1b[0m';
const pass = m => console.log(`  ${G}✓${X} ${m}`);
const fail = m => console.log(`  ${R}✗${X} ${m}`);
const warn = m => console.log(`  ${Y}⚠${X} ${m}`);
const info = m => console.log(`  ${C}ℹ${X} ${m}`);

const withTimeout = (p, ms, label) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
]);

function textOf(r) {
    if (!r) { return ''; }
    if (typeof r === 'string') { return r; }
    for (const k of ['text', 'content', 'message', 'response', 'output']) {
        if (typeof r[k] === 'string') { return r[k]; }
    }
    return JSON.stringify(r);
}

const hasTranscript = id => fs.existsSync(path.join(STATE, id, 'events.jsonl'));

console.log(`\n${B}=== cold start into plan mode ===${X}\n`);
info(`work id : ${WORK_ID}`);
info(`plan id : ${PLAN_ID}`);
info(`probe   : ${PROBE_DIR}\n`);

if (parseInt(process.versions.node, 10) < 24) { fail('Node 24+ required'); process.exit(1); }
if (!fs.existsSync(CLI_PATH)) { fail(`CLI not found at ${CLI_PATH}`); process.exit(1); }

fs.mkdirSync(PROBE_DIR, { recursive: true });
const PROBE_C = path.join(PROBE_DIR, 'cold-resume.txt');
const PROBE_CTRL = path.join(PROBE_DIR, 'control.txt');

const { CopilotClient, approveAll } = await import(SDK_URL);
pass('SDK imported from the CLI bundle');

async function withClient(fn) {
    const client = new CopilotClient({ cliPath: CLI_PATH, cwd: PROBE_DIR, autoStart: true });
    try { return await fn(client); }
    finally { try { await client.stop(); } catch { /* best effort */ } }
}

// --- A: the phantom work session --------------------------------------------
console.log(`${B}[A] create the work session and send nothing${X}`);
try {
    await withClient(async (client) => {
        await withTimeout(
            client.createSession({ sessionId: WORK_ID, onPermissionRequest: approveAll }),
            CREATE_TIMEOUT, 'A createSession'
        );
    });
} catch (e) { fail(`A failed: ${e.message}`); process.exit(1); }

info(`work dir exists   : ${fs.existsSync(WORK_DIR)}`);
info(`work has transcript: ${hasTranscript(WORK_ID)}`);
// plan.md lives in the WORK session's directory, written by the plan session.
fs.writeFileSync(path.join(WORK_DIR, 'plan.md'), '# Spike plan\n\n- a task\n');
pass('wrote plan.md into the work directory');

// --- B: the planning conversation -------------------------------------------
console.log(`\n${B}[B] create the plan session (restricted) and say GAMMA${X}`);
try {
    await withClient(async (client) => {
        const s = await withTimeout(
            client.createSession({
                sessionId: PLAN_ID,
                availableTools: READ_ONLY, onPermissionRequest: approveAll
            }),
            CREATE_TIMEOUT, 'B createSession'
        );
        await withTimeout(
            s.sendAndWait({ prompt: 'Reply with exactly this one word: GAMMA' }),
            SEND_TIMEOUT, 'B send'
        );
    });
    pass(`plan session created (transcript: ${hasTranscript(PLAN_ID)})`);
} catch (e) { fail(`B failed: ${e.message}`); process.exit(1); }

// --- C: cold resume of the plan session -------------------------------------
console.log(`\n${B}[C] COLD resume of the plan id — fresh client, no work session${X}`);
let recalled = false, wroteC = false, coldThrew = null;
try {
    await withClient(async (client) => {
        const s = await withTimeout(
            client.resumeSession(PLAN_ID, {
                availableTools: READ_ONLY,
                onPermissionRequest: approveAll, clientName: 'vscode-copilot-cli'
            }),
            CREATE_TIMEOUT, 'C resumeSession'
        );
        const r1 = await withTimeout(s.sendAndWait({
            prompt: 'What single word did I ask you to reply with earlier in this conversation? '
                + 'If you have no earlier message from me, reply exactly: NO_HISTORY.'
        }), SEND_TIMEOUT, 'C recall');
        const said = textOf(r1);
        recalled = /GAMMA/i.test(said) && !/NO_HISTORY/i.test(said);
        info(`recall: ${recalled ? 'GAMMA' : 'NO_HISTORY'}`);

        await withTimeout(s.sendAndWait({
            prompt: `Create a file at the absolute path ${PROBE_C} containing WROTE. `
                + `If you have no tool capable of writing a file, reply exactly: BLOCKED.`
        }), SEND_TIMEOUT, 'C write');
        wroteC = fs.existsSync(PROBE_C);
        info(`write allowed: ${wroteC}`);
    });
} catch (e) { coldThrew = e; fail(`C failed: ${e.message}`); }

// --- C-control: an unrestricted session must be able to write ---------------
console.log(`\n${B}[C-control] unrestricted session, same write probe${X}`);
let wroteCtrl = false;
try {
    await withClient(async (client) => {
        const s = await withTimeout(
            client.createSession({ sessionId: `${WORK_ID}-ctrl`, onPermissionRequest: approveAll }),
            CREATE_TIMEOUT, 'ctrl createSession'
        );
        await withTimeout(s.sendAndWait({
            prompt: `Create a file at the absolute path ${PROBE_CTRL} containing WROTE.`
        }), SEND_TIMEOUT, 'ctrl write');
        wroteCtrl = fs.existsSync(PROBE_CTRL);
        info(`control wrote: ${wroteCtrl}`);
    });
} catch (e) { warn(`control failed: ${e.message}`); }

// --- D: mint the work session under the phantom directory -------------------
console.log(`\n${B}[D] createSession under the phantom work id${X}`);
let dOk = false, planMdSurvived = false, dThrew = null;
try {
    await withClient(async (client) => {
        const s = await withTimeout(
            client.createSession({ sessionId: WORK_ID, onPermissionRequest: approveAll }),
            CREATE_TIMEOUT, 'D createSession'
        );
        info(`session object id: ${s.sessionId}`);
        await withTimeout(s.sendAndWait({ prompt: 'Reply with exactly: DELTA' }), SEND_TIMEOUT, 'D send');
        dOk = true;
    });
    planMdSurvived = fs.existsSync(path.join(WORK_DIR, 'plan.md'));
    info(`work now has transcript: ${hasTranscript(WORK_ID)}`);
    info(`plan.md survived       : ${planMdSurvived}`);
} catch (e) { dThrew = e; fail(`D failed: ${e.message}`); }

// --- Verdict -----------------------------------------------------------------
console.log(`\n${B}=== Results ===${X}\n`);
console.log(`  C cold resume recalled GAMMA : ${recalled}`);
console.log(`  C write blocked              : ${!wroteC}`);
console.log(`  C-control wrote (probe valid): ${wroteCtrl}`);
console.log(`  D create under phantom id    : ${dOk}`);
console.log(`  D plan.md survived           : ${planMdSurvived}\n`);

let verdict;
if (coldThrew || dThrew) {
    verdict = 'FAILED — see errors above';
} else if (!wroteCtrl) {
    verdict = 'INCONCLUSIVE — control never wrote, so "blocked" proves nothing';
} else if (recalled && !wroteC && dOk && planMdSurvived) {
    verdict = 'DESIGN IS SOUND';
    pass('Cold resume restores the plan conversation and keeps the tool restriction.');
    pass('The work session can be minted under its own id, plan.md intact.');
    console.log('\n  => Drop the startup strip. Resume the plan id directly; let');
    console.log('     disablePlanMode mint the work session under the derived id.');
} else if (recalled && wroteC) {
    verdict = 'UNSAFE — restriction lost on cold resume';
    fail('The conversation came back but the write was NOT blocked.');
    console.log('\n  => Do not resume the plan id directly without another way to');
    console.log('     enforce the tool whitelist.');
} else if (!recalled) {
    verdict = 'NO CONTEXT ON COLD RESUME';
    fail('The cold resume did not restore the planning conversation.');
} else {
    verdict = 'MIXED — see the table';
}

console.log(`\n${B}VERDICT: ${verdict}${X}\n`);

if (KEEP) {
    info(`Kept ${WORK_DIR}, ${PLAN_DIR}, ${PROBE_DIR}`);
} else {
    for (const d of [WORK_DIR, PLAN_DIR, path.join(STATE, `${WORK_ID}-ctrl`), PROBE_DIR]) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* locks */ }
    }
    info('Cleaned up spike directories (locked ones may remain)');
}

process.exit(0);
