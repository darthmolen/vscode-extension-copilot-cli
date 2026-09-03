#!/usr/bin/env node
/**
 * spike-session-id-reuse.mjs — Does createSession() with an existing sessionId
 * CONTINUE that session, or START IT OVER?
 *
 * Why this matters
 * ----------------
 * enablePlanMode() creates the plan session with a derived, predictable id:
 *
 *     const planSessionId = `${this.workSessionId}-plan`;          // sdkSessionManager.ts:1732
 *     this.planSession = await this.createSessionWithModelFallback({
 *         sessionId: planSessionId, ...                            // sdkSessionManager.ts:1787
 *     });
 *
 * On the second and later entries into plan mode, that id already exists on
 * disk. The SDK documents `sessionId` only as "Optional custom session ID. If
 * not provided, the server generates one" (types.d.ts:2113-2116) — it says
 * nothing about collision with an existing session.
 *
 * The answer decides how the chat should restore after VS Code is closed in
 * plan mode:
 *
 *   CONTINUES   -> the old plan transcript is still live. Show the PLAN
 *                  session's history and stay in plan mode.
 *   STARTS OVER -> the old plan transcript belongs to nothing. Show the WORK
 *                  session's history (strip `-plan` for history loading only).
 *   THROWS      -> re-entering plan mode on an existing id is broken outright
 *                  and needs its own fix.
 *
 * What it does
 * ------------
 *   Round 1: createSession({ sessionId: SPIKE_ID }), say ALPHA, shut down.
 *   Round 2: createSession({ sessionId: SPIKE_ID }) again, ask the model to
 *            recall the earlier word, say BRAVO, shut down.
 *
 * Then it reports both signals, which can disagree:
 *   - ON DISK:         session.start count, and whether ALPHA survived in events.jsonl
 *   - IN CONVERSATION: whether the model still recalls ALPHA in round 2
 *
 * Disk continuity without conversational continuity would mean the events file
 * is appended to but the model context is not restored — that still counts as
 * STARTS OVER for our purposes, because the user would see a transcript the
 * agent has no memory of.
 *
 * Usage (Node 24+, from project root):
 *   node planning/spikes/plan-session-reuse/spike-session-id-reuse.mjs
 *   node planning/spikes/plan-session-reuse/spike-session-id-reuse.mjs --keep
 *
 * Writes only to ~/.copilot/session-state/<SPIKE_ID>/ and removes it on exit
 * unless --keep is passed. Touches no real session.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

const KEEP = process.argv.includes('--keep');

// The SDK bundled with the installed CLI. The project's node_modules may not be
// installed, and this is the exact SDK the CLI ships with.
const CLI_PKG = path.join(
    os.homedir(),
    'AppData/Roaming/Code/User/globalStorage/darthmolen.copilot-cli-extension',
    'cli/_1.0.67/node_modules/@github/copilot-win32-x64'
);
// Use the SDK and the native binary from the SAME platform package the
// extension resolves, so the spike exercises the real pairing.
const SDK_URL = pathToFileURL(path.join(CLI_PKG, 'copilot-sdk', 'index.js')).href;
const CLI_PATH = path.join(CLI_PKG, 'copilot.exe');

const SPIKE_ID = `spike-plan-reuse-${Date.now()}`;
const SESSION_DIR = path.join(os.homedir(), '.copilot', 'session-state', SPIKE_ID);
const EVENTS = path.join(SESSION_DIR, 'events.jsonl');

const MODEL = 'claude-sonnet-4.6';
const CREATE_TIMEOUT = 60_000;
const SEND_TIMEOUT = 90_000;

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', B = '\x1b[1m', X = '\x1b[0m';
const pass = m => console.log(`  ${G}\u2713${X} ${m}`);
const fail = m => console.log(`  ${R}\u2717${X} ${m}`);
const warn = m => console.log(`  ${Y}\u26a0${X} ${m}`);
const info = m => console.log(`  ${C}\u2139${X} ${m}`);

const withTimeout = (p, ms, label) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
]);

function readEvents() {
    if (!fs.existsSync(EVENTS)) { return { exists: false, lines: 0, starts: 0, raw: '' }; }
    const raw = fs.readFileSync(EVENTS, 'utf-8');
    return {
        exists: true,
        lines: raw.split('\n').filter(Boolean).length,
        starts: (raw.match(/"type":"session\.start"/g) || []).length,
        raw,
    };
}

/** Extract assistant text from a sendAndWait result across plausible shapes. */
function textOf(result) {
    if (!result) { return ''; }
    if (typeof result === 'string') { return result; }
    for (const k of ['text', 'content', 'message', 'response', 'output']) {
        const v = result[k];
        if (typeof v === 'string') { return v; }
    }
    return JSON.stringify(result);
}

console.log(`\n${B}=== createSession() session-id reuse spike ===${X}\n`);
info(`Session id : ${SPIKE_ID}`);
info(`CLI        : ${CLI_PATH}`);
info(`Model      : ${MODEL}\n`);

if (parseInt(process.versions.node, 10) < 24) {
    fail(`Node 24+ required (node:sqlite); got v${process.versions.node}`);
    process.exit(1);
}
if (!fs.existsSync(CLI_PATH)) {
    fail(`CLI not found at ${CLI_PATH}`);
    info('Adjust CLI_PATH — check globalStorage/darthmolen.copilot-cli-extension/cli/');
    process.exit(1);
}

const { CopilotClient, approveAll } = await import(SDK_URL);
pass('SDK imported from the CLI bundle');

let recalled = null;
let threw = null;

async function round(label, prompt) {
    const client = new CopilotClient({ cliPath: CLI_PATH, cwd: process.cwd(), autoStart: true });
    try {
        const session = await withTimeout(
            client.createSession({ sessionId: SPIKE_ID, model: MODEL, onPermissionRequest: approveAll }),
            CREATE_TIMEOUT, `${label} createSession`
        );
        info(`${label}: session object id = ${session.sessionId}`);
        const res = await withTimeout(
            session.sendAndWait({ prompt }), SEND_TIMEOUT, `${label} sendAndWait`
        );
        return textOf(res);
    } finally {
        try { await client.stop(); } catch { /* best effort */ }
    }
}

// --- Round 1 ---------------------------------------------------------------
console.log(`\n${B}[1/2] First create — establish the session${X}`);
try {
    const t = await round('round1', 'Reply with exactly this one word: ALPHA');
    pass(`round1 responded (${t.length} chars)`);
} catch (e) {
    fail(`round1 failed: ${e.message}`);
    process.exit(1);
}

const round1 = readEvents();
info(`events.jsonl: ${round1.lines} lines, ${round1.starts}x session.start`);
if (!round1.exists) {
    fail('No events.jsonl after round 1 — cannot continue');
    process.exit(1);
}
const alphaOnDisk1 = /ALPHA/.test(round1.raw);
info(`ALPHA present on disk: ${alphaOnDisk1}`);

// --- Round 2 ---------------------------------------------------------------
console.log(`\n${B}[2/2] Second create — SAME id, already on disk${X}`);
try {
    recalled = await round(
        'round2',
        'What single word did I ask you to reply with earlier in this conversation? '
        + 'If you have no earlier message from me, reply exactly: NO_HISTORY. Then say BRAVO.'
    );
    pass(`round2 responded (${recalled.length} chars)`);
    info(`round2 said: ${recalled.slice(0, 200).replace(/\s+/g, ' ')}`);
} catch (e) {
    threw = e;
    fail(`round2 createSession/send threw: ${e.message}`);
}

const round2 = readEvents();

// --- Verdict ---------------------------------------------------------------
console.log(`\n${B}=== Results ===${X}\n`);
console.log(`                       round1 -> round2`);
console.log(`  events.jsonl lines : ${round1.lines} -> ${round2.lines}`);
console.log(`  session.start count: ${round1.starts} -> ${round2.starts}`);
console.log(`  ALPHA on disk      : ${alphaOnDisk1} -> ${/ALPHA/.test(round2.raw)}\n`);

let verdict;
if (threw) {
    verdict = 'THROWS';
    fail('Reusing an existing sessionId throws.');
    console.log(`  ${threw.message}`);
    console.log('\n  => Re-entering plan mode on an existing id is broken and needs its own fix.');
} else {
    const diskGrew = round2.lines > round1.lines;
    const diskKeptAlpha = /ALPHA/.test(round2.raw);
    const modelRecalls = /ALPHA/i.test(recalled || '') && !/NO_HISTORY/i.test(recalled || '');

    console.log(`  disk appended      : ${diskGrew}`);
    console.log(`  disk kept ALPHA    : ${diskKeptAlpha}`);
    console.log(`  model recalled     : ${modelRecalls}\n`);

    if (modelRecalls && diskKeptAlpha) {
        verdict = 'CONTINUES';
        pass('The session CONTINUES — history and model context both survive.');
        console.log(`\n  => Option C. Show the PLAN session's history and stay in plan mode.`);
        console.log(`     The old plan transcript is still live; displaying it is honest.`);
    } else if (diskKeptAlpha && !modelRecalls) {
        verdict = 'APPENDS-ONLY';
        warn('Disk is appended to, but the model does NOT recall the earlier turn.');
        console.log(`\n  => Treat as STARTS OVER (Option A). The transcript would be shown`);
        console.log(`     to a user whose agent has no memory of it — worse than hiding it.`);
    } else {
        verdict = 'STARTS OVER';
        warn('The session STARTS OVER — earlier turns are gone.');
        console.log(`\n  => Option A. Strip \`-plan\` for loadSessionHistory only, so the chat`);
        console.log(`     shows the WORK session that is actually resumed.`);
    }
}

console.log(`\n${B}VERDICT: ${verdict}${X}\n`);

// --- Cleanup ---------------------------------------------------------------
if (KEEP) {
    info(`Kept ${SESSION_DIR}`);
} else {
    try {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        info(`Cleaned up ${SESSION_DIR}`);
    } catch (e) {
        warn(`Could not clean up ${SESSION_DIR}: ${e.message}`);
    }
}

process.exit(0);
