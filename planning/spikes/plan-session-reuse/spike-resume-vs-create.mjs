#!/usr/bin/env node
/**
 * spike-resume-vs-create.mjs — Does resumeSession() restore CONVERSATIONAL
 * context, or only the events file?
 *
 * Why this matters
 * ----------------
 * The first spike (spike-session-id-reuse.mjs) showed that
 * createSession({ sessionId }) on an existing id appends to events.jsonl but
 * gives the model NO memory of earlier turns ("NO_HISTORY").
 *
 * That covered the PLAN session path only:
 *
 *     createSession({ sessionId: `${workId}-plan` })   // sdkSessionManager.ts:1787
 *
 * The WORK session path on startup uses a DIFFERENT api:
 *
 *     client.resumeSession(sessionId, resumeOptions)   // sdkSessionManager.ts:416
 *
 * If resumeSession() also returns an amnesiac session, then displaying the
 * work session's history is exactly as misleading as displaying the plan
 * session's, and "show the work history because it is the live one" is not a
 * real distinction. The restore rule would then be the same for both.
 *
 * What it does
 * ------------
 *   Round 1: createSession({ sessionId }), say ALPHA, shut down.
 *   Round 2: resumeSession(sessionId), ask the model to recall ALPHA.
 *
 * Same probe as the first spike, so the two results are directly comparable.
 *
 * Usage (Node 24+, from project root):
 *   node planning/spikes/plan-session-reuse/spike-resume-vs-create.mjs
 *   node planning/spikes/plan-session-reuse/spike-resume-vs-create.mjs --keep
 *
 * Writes only to ~/.copilot/session-state/<SPIKE_ID>/ and removes it on exit
 * unless --keep is passed. Touches no real session.
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

const SPIKE_ID = `spike-resume-${Date.now()}`;
const SESSION_DIR = path.join(os.homedir(), '.copilot', 'session-state', SPIKE_ID);
const EVENTS = path.join(SESSION_DIR, 'events.jsonl');

const MODEL = 'claude-sonnet-4.6';
const CREATE_TIMEOUT = 60_000;
const SEND_TIMEOUT = 90_000;

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', B = '\x1b[1m', X = '\x1b[0m';
const pass = m => console.log(`  ${G}✓${X} ${m}`);
const fail = m => console.log(`  ${R}✗${X} ${m}`);
const warn = m => console.log(`  ${Y}⚠${X} ${m}`);
const info = m => console.log(`  ${C}ℹ${X} ${m}`);

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

function textOf(result) {
    if (!result) { return ''; }
    if (typeof result === 'string') { return result; }
    for (const k of ['text', 'content', 'message', 'response', 'output']) {
        const v = result[k];
        if (typeof v === 'string') { return v; }
    }
    return JSON.stringify(result);
}

const RECALL_PROMPT =
    'What single word did I ask you to reply with earlier in this conversation? '
    + 'If you have no earlier message from me, reply exactly: NO_HISTORY. Then say BRAVO.';

console.log(`\n${B}=== resumeSession() vs createSession() context restore ===${X}\n`);
info(`Session id : ${SPIKE_ID}`);
info(`CLI        : ${CLI_PATH}`);
info(`Model      : ${MODEL}\n`);

if (parseInt(process.versions.node, 10) < 24) {
    fail(`Node 24+ required (node:sqlite); got v${process.versions.node}`);
    process.exit(1);
}
if (!fs.existsSync(CLI_PATH)) {
    fail(`CLI not found at ${CLI_PATH}`);
    process.exit(1);
}

const { CopilotClient, approveAll } = await import(SDK_URL);
pass('SDK imported from the CLI bundle');

async function withClient(fn) {
    const client = new CopilotClient({ cliPath: CLI_PATH, cwd: process.cwd(), autoStart: true });
    try {
        return await fn(client);
    } finally {
        try { await client.stop(); } catch { /* best effort */ }
    }
}

// --- Round 1: establish via createSession ------------------------------------
console.log(`\n${B}[1/2] createSession — establish the session${X}`);
try {
    await withClient(async (client) => {
        const session = await withTimeout(
            client.createSession({ sessionId: SPIKE_ID, model: MODEL, onPermissionRequest: approveAll }),
            CREATE_TIMEOUT, 'createSession'
        );
        info(`session object id = ${session.sessionId}`);
        const res = await withTimeout(
            session.sendAndWait({ prompt: 'Reply with exactly this one word: ALPHA' }),
            SEND_TIMEOUT, 'round1 sendAndWait'
        );
        pass(`round1 responded (${textOf(res).length} chars)`);
    });
} catch (e) {
    fail(`round1 failed: ${e.message}`);
    process.exit(1);
}

const before = readEvents();
info(`events.jsonl: ${before.lines} lines, ${before.starts}x session.start`);

// --- Round 2: resumeSession --------------------------------------------------
console.log(`\n${B}[2/2] resumeSession — same id, via the RESUME api${X}`);
let recalled = null, threw = null;
try {
    recalled = await withClient(async (client) => {
        const session = await withTimeout(
            client.resumeSession(SPIKE_ID, {
                model: MODEL,
                onPermissionRequest: approveAll,
                clientName: 'vscode-copilot-cli',
            }),
            CREATE_TIMEOUT, 'resumeSession'
        );
        info(`session object id = ${session.sessionId}`);
        const res = await withTimeout(
            session.sendAndWait({ prompt: RECALL_PROMPT }), SEND_TIMEOUT, 'round2 sendAndWait'
        );
        return textOf(res);
    });
    pass(`round2 responded (${recalled.length} chars)`);
    info(`round2 said: ${recalled.slice(0, 220).replace(/\s+/g, ' ')}`);
} catch (e) {
    threw = e;
    fail(`resumeSession threw: ${e.message}`);
}

const after = readEvents();

// --- Verdict -----------------------------------------------------------------
console.log(`\n${B}=== Results ===${X}\n`);
console.log(`                       before -> after`);
console.log(`  events.jsonl lines : ${before.lines} -> ${after.lines}`);
console.log(`  session.start count: ${before.starts} -> ${after.starts}\n`);

let verdict;
if (threw) {
    verdict = 'RESUME THREW';
    fail(`resumeSession failed outright: ${threw.message}`);
} else {
    const recalls = /ALPHA/i.test(recalled || '') && !/NO_HISTORY/i.test(recalled || '');
    console.log(`  model recalled ALPHA: ${recalls}\n`);
    if (recalls) {
        verdict = 'RESUME RESTORES CONTEXT';
        pass('resumeSession() DOES restore conversational memory.');
        console.log(`\n  => create and resume differ. The work session really is live after`);
        console.log(`     restore, so showing its history is honest; showing the plan`);
        console.log(`     session's history (created, not resumed) is not.`);
    } else {
        verdict = 'RESUME IS ALSO AMNESIAC';
        warn('resumeSession() does NOT restore conversational memory either.');
        console.log(`\n  => The rule is the SAME for both paths. Neither transcript is backed`);
        console.log(`     by model memory, so "show the work history because it is live" is`);
        console.log(`     not a real distinction.`);
    }
}

console.log(`\n${B}VERDICT: ${verdict}${X}\n`);

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
