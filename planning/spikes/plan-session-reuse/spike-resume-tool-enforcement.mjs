#!/usr/bin/env node
/**
 * spike-resume-tool-enforcement.mjs — Does resumeSession() ENFORCE
 * `availableTools` the way createSession() does?
 *
 * Why this matters
 * ----------------
 * Change 5 of the plan makes enablePlanMode() resume an existing plan session
 * instead of re-creating it, so the planning conversation survives. Plan mode's
 * safety guarantee is that the agent cannot write, commit, or install:
 *
 *     availableTools: this.planModeToolsService.getAvailableToolNames()
 *                                                  // sdkSessionManager.ts:1789
 *
 * `ResumeSessionConfig` extends `SessionConfigBase`, which *declares*
 * `availableTools` (types.d.ts:132). Declaring it is not enforcing it. If the
 * runtime ignores the restriction on the resume path, change 5 would silently
 * hand plan mode a full toolset.
 *
 * Method
 * ------
 * Behavioural, not advertised-capability. Rather than trusting a tool listing,
 * restrict the session to read-only tools and then ask the agent to create a
 * file. If enforcement holds, no tool exists that can do it and the file never
 * appears — whatever the write tool happens to be called.
 *
 *   Phase A: createSession({ availableTools: READ_ONLY }) -> ask for a write
 *            Establishes that the restriction works at all. If A fails to
 *            block, the probe is invalid and the run says so rather than
 *            drawing a conclusion about resume.
 *   Phase B: resumeSession({ availableTools: READ_ONLY }) -> ask for a write
 *            The actual question.
 *
 * A blocks + B blocks  -> enforcement holds on resume. Change 5 is safe.
 * A blocks + B writes  -> enforcement gap. Change 5 must fall back to create.
 * A writes             -> probe invalid; restriction never applied. Inconclusive.
 *
 * Usage (Node 24+, from project root):
 *   node planning/spikes/plan-session-reuse/spike-resume-tool-enforcement.mjs
 *   node planning/spikes/plan-session-reuse/spike-resume-tool-enforcement.mjs --keep
 *
 * Writes only to ~/.copilot/session-state/<SPIKE_ID>/ and a probe directory
 * under the OS temp dir. Both are removed on exit unless --keep is passed.
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

const SPIKE_ID = `spike-tools-${Date.now()}`;
const SESSION_DIR = path.join(os.homedir(), '.copilot', 'session-state', SPIKE_ID);
const CONTROL_DIR = path.join(os.homedir(), '.copilot', 'session-state', `${SPIKE_ID}-control`);
const PROBE_DIR = path.join(os.tmpdir(), `copilot-tool-probe-${Date.now()}`);

const MODEL = 'claude-sonnet-4.6';
const CREATE_TIMEOUT = 60_000;
const SEND_TIMEOUT = 90_000;

/**
 * Deliberately read-only. Mirrors the safe half of PLAN_MODE_AVAILABLE_TOOLS
 * (planModeToolsService.ts:25-41) and omits every shell and edit tool:
 * no bash, no powershell, no editor.
 */
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

function textOf(result) {
    if (!result) { return ''; }
    if (typeof result === 'string') { return result; }
    for (const k of ['text', 'content', 'message', 'response', 'output']) {
        const v = result[k];
        if (typeof v === 'string') { return v; }
    }
    return JSON.stringify(result);
}

/** Ask the session to write a file, then report whether it actually appeared. */
async function probeWrite(session, label, probeFile) {
    const prompt =
        `Create a file at the absolute path ${probeFile} containing exactly the word WROTE. `
        + `Use whatever tool you have. If you have no tool capable of writing a file, `
        + `reply exactly: BLOCKED.`;
    const res = await withTimeout(session.sendAndWait({ prompt }), SEND_TIMEOUT, `${label} sendAndWait`);
    const said = textOf(res);
    const wrote = fs.existsSync(probeFile);
    info(`${label} replied: ${said.slice(0, 180).replace(/\s+/g, ' ')}`);
    info(`${label} file created on disk: ${wrote}`);
    return { wrote, said };
}

/** Best-effort listing of tools the session believes it has. Diagnostic only. */
async function listTools(session, label) {
    try {
        const res = await withTimeout(session.rpc.tools.list({}), 20_000, `${label} tools.list`);
        const names = (res?.tools ?? []).map(t => t?.name).filter(Boolean);
        info(`${label} tools.list: ${names.length} tool(s)${names.length ? ' — ' + names.slice(0, 12).join(', ') : ''}`);
        return names;
    } catch (e) {
        warn(`${label} tools.list unavailable: ${e.message}`);
        return null;
    }
}

console.log(`\n${B}=== resumeSession() availableTools enforcement ===${X}\n`);
info(`Session id  : ${SPIKE_ID}`);
info(`Probe dir   : ${PROBE_DIR}`);
info(`Restriction : [${READ_ONLY.join(', ')}]  (no shell, no editor)\n`);

if (parseInt(process.versions.node, 10) < 24) {
    fail(`Node 24+ required; got v${process.versions.node}`);
    process.exit(1);
}
if (!fs.existsSync(CLI_PATH)) {
    fail(`CLI not found at ${CLI_PATH}`);
    process.exit(1);
}

fs.mkdirSync(PROBE_DIR, { recursive: true });
const PROBE_A = path.join(PROBE_DIR, 'create-probe.txt');
const PROBE_B = path.join(PROBE_DIR, 'resume-probe.txt');
const PROBE_C = path.join(PROBE_DIR, 'control-probe.txt');

const { CopilotClient, approveAll } = await import(SDK_URL);
pass('SDK imported from the CLI bundle');

async function withClient(fn) {
    const client = new CopilotClient({ cliPath: CLI_PATH, cwd: PROBE_DIR, autoStart: true });
    try {
        return await fn(client);
    } finally {
        try { await client.stop(); } catch { /* best effort */ }
    }
}

// --- Phase A: createSession with the restriction -----------------------------
console.log(`\n${B}[A] createSession with availableTools restriction${X}`);
let resultA;
try {
    resultA = await withClient(async (client) => {
        const session = await withTimeout(
            client.createSession({
                sessionId: SPIKE_ID,
                model: MODEL,
                availableTools: READ_ONLY,
                onPermissionRequest: approveAll,
            }),
            CREATE_TIMEOUT, 'createSession'
        );
        await listTools(session, 'A');
        return probeWrite(session, 'A', PROBE_A);
    });
} catch (e) {
    fail(`phase A failed: ${e.message}`);
    process.exit(1);
}

// --- Phase B: resumeSession with the same restriction ------------------------
console.log(`\n${B}[B] resumeSession with the SAME restriction${X}`);
let resultB = null, threw = null;
try {
    resultB = await withClient(async (client) => {
        const session = await withTimeout(
            client.resumeSession(SPIKE_ID, {
                model: MODEL,
                availableTools: READ_ONLY,
                onPermissionRequest: approveAll,
                clientName: 'vscode-copilot-cli',
            }),
            CREATE_TIMEOUT, 'resumeSession'
        );
        await listTools(session, 'B');
        return probeWrite(session, 'B', PROBE_B);
    });
} catch (e) {
    threw = e;
    fail(`phase B threw: ${e.message}`);
}

// --- Phase C: CONTROL — no restriction, same probe ---------------------------
// Without this, "no file appeared" is ambiguous: the model was *told* to reply
// BLOCKED, so it may simply never have attempted a write. The control proves
// the probe can actually detect a write when one is permitted.
console.log(`
${B}[C] CONTROL — unrestricted session, same probe${X}`);
let resultC = null;
try {
    resultC = await withClient(async (client) => {
        const session = await withTimeout(
            client.createSession({
                sessionId: `${SPIKE_ID}-control`,
                model: MODEL,
                onPermissionRequest: approveAll,
            }),
            CREATE_TIMEOUT, 'control createSession'
        );
        return probeWrite(session, 'C', PROBE_C);
    });
} catch (e) {
    fail(`control failed: ${e.message}`);
}

// --- Verdict -----------------------------------------------------------------
console.log(`\n${B}=== Results ===${X}\n`);
console.log(`  A createSession wrote a file : ${resultA.wrote}`);
console.log(`  B resumeSession wrote a file : ${threw ? 'n/a (threw)' : resultB.wrote}\n`);
console.log(`  C control (unrestricted)     : ${resultC ? resultC.wrote : 'n/a (failed)'}
`);

let verdict;
if (threw) {
    verdict = 'INCONCLUSIVE — resume threw';
    fail(`resumeSession failed: ${threw.message}`);
} else if (resultA.wrote) {
    verdict = 'INCONCLUSIVE — restriction never applied';
    warn('Phase A wrote the file, so availableTools did not restrict even on create.');
    console.log('\n  => The probe cannot answer the resume question. Check the tool names');
    console.log('     in READ_ONLY against what this CLI actually exposes, then re-run.');
} else if (!resultC || !resultC.wrote) {
    verdict = 'INCONCLUSIVE — control did not write';
    warn('The unrestricted control also produced no file.');
    console.log('\n  => The probe cannot distinguish "tool blocked" from "model never tried",');
    console.log('     so A and B blocking proves nothing. Fix the probe before trusting it.');
} else if (!resultB.wrote) {
    verdict = 'ENFORCED ON RESUME';
    pass('Both paths blocked the write. availableTools is enforced on resume.');
    console.log('\n  => Change 5 is safe: resuming the plan session keeps its tool');
    console.log('     restrictions. Plan mode retains its no-write guarantee.');
} else {
    verdict = 'ENFORCEMENT GAP ON RESUME';
    fail('create blocked the write, but resume ALLOWED it.');
    console.log('\n  => Change 5 is NOT safe as designed. Resuming a plan session would');
    console.log('     restore a full toolset. Fall back to createSession and accept the');
    console.log('     amnesia, or restrict tools by another mechanism before resuming.');
}

console.log(`\n${B}VERDICT: ${verdict}${X}\n`);

// --- Cleanup -----------------------------------------------------------------
if (KEEP) {
    info(`Kept ${SESSION_DIR}`);
    info(`Kept ${CONTROL_DIR}`);
    info(`Kept ${PROBE_DIR}`);
} else {
    for (const dir of [SESSION_DIR, CONTROL_DIR, PROBE_DIR]) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
            info(`Cleaned up ${dir}`);
        } catch (e) {
            warn(`Could not clean up ${dir}: ${e.message}`);
        }
    }
}

process.exit(0);
