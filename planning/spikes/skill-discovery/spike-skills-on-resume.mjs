#!/usr/bin/env node
/**
 * spike-skills-on-resume.mjs — Do skillDirectories work on the RESUME path?
 *
 * Why
 * ---
 * spike-skill-directories.mjs showed skills resolve fine with the extension's
 * current 13-directory list — via createSession. That disproves the "stale
 * duplicate collides" hypothesis but leaves the reported symptom unexplained.
 *
 * The extension resumes by default (`copilotCLI.resumeLastSession` is true), so
 * in normal use the session the user talks to is a RESUMED one, not a created
 * one. This session has already found one create/resume asymmetry the types did
 * not hint at (createSession on an existing id loses all context while
 * resumeSession restores it), so "forwarded on the wire" is not evidence that
 * skills actually load.
 *
 * Method
 * ------
 *   Phase 1: createSession({ skillDirectories }) -> can it load a skill?
 *   Phase 2: resumeSession(sameId, { skillDirectories }) -> can it still?
 *
 * Same probe both times, so the two are directly comparable.
 *
 *   both FOUND    -> resume is fine; the symptom is elsewhere.
 *   create FOUND,
 *   resume MISS   -> skills are lost on resume. That is the bug, and it hits
 *                    every normal startup.
 *
 * Usage (Node 24+, from project root):
 *   node planning/spikes/skill-discovery/spike-skills-on-resume.mjs
 *   node planning/spikes/skill-discovery/spike-skills-on-resume.mjs --keep
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

const HOME = os.homedir();
const SPIKE_ID = `spike-skills-resume-${Date.now()}`;
const SESSION_DIR = path.join(HOME, '.copilot', 'session-state', SPIKE_ID);

const MODEL = 'claude-sonnet-4.6';
const CREATE_TIMEOUT = 60_000;
const SEND_TIMEOUT = 120_000;
const SKILL = 'brainstorming';   // superpowers, no name collisions

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

/** Reproduces SkillDirectoriesService.resolveSkillDirectories(). */
function resolveSkillDirectories() {
    const MAX_DEPTH = 5;
    function walk(dir, depth) {
        if (depth >= MAX_DEPTH || !fs.existsSync(dir)) { return []; }
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
        const out = [];
        for (const e of entries) {
            if (!e.isDirectory()) { continue; }
            if (e.name === 'skills') { out.push(path.join(dir, e.name)); }
            else { out.push(...walk(path.join(dir, e.name), depth + 1)); }
        }
        return out;
    }
    const candidates = [
        path.join(HOME, '.claude', 'skills'),
        path.join(HOME, '.agents', 'skills'),
        ...walk(path.join(HOME, '.claude', 'plugins', 'cache'), 0),
    ];
    const seen = new Set(), out = [];
    for (const d of candidates) {
        if (!seen.has(d) && fs.existsSync(d)) { seen.add(d); out.push(d); }
    }
    return out;
}

console.log(`\n${B}=== skillDirectories on the resume path ===${X}\n`);

if (parseInt(process.versions.node, 10) < 24) {
    fail(`Node 24+ required; got v${process.versions.node}`);
    process.exit(1);
}
if (!fs.existsSync(CLI_PATH)) {
    fail(`CLI not found at ${CLI_PATH}`);
    process.exit(1);
}

const SKILL_DIRS = resolveSkillDirectories();
info(`Session id  : ${SPIKE_ID}`);
info(`Skill dirs  : ${SKILL_DIRS.length}`);
info(`Probe skill : ${SKILL}\n`);

const { CopilotClient, approveAll } = await import(SDK_URL);

const PROMPT =
    `Use your skill tool to load the skill named "${SKILL}". `
    + `Reply with exactly FOUND if it loaded, or exactly NOTFOUND if no such `
    + `skill is available to you. Do not explain.`;

async function ask(session, label) {
    const res = await withTimeout(session.sendAndWait({ prompt: PROMPT }), SEND_TIMEOUT, `${label} send`);
    const said = textOf(res);
    const found = /FOUND/.test(said) && !/NOTFOUND/.test(said);
    info(`${label}: ${found ? 'FOUND' : 'NOTFOUND'}`);
    return found;
}

// The exact extra fields the extension injects on both paths
// (sdkSessionManager.ts:409-414 and :2170-2176).
const COMMON = {
    model: MODEL,
    onPermissionRequest: approveAll,
    clientName: 'vscode-copilot-cli',
    streaming: true,
    skillDirectories: SKILL_DIRS,
};

// --- Phase 1: create ---------------------------------------------------------
console.log(`${B}[1/2] createSession with skillDirectories${X}`);
let createdFound = null;
{
    const client = new CopilotClient({ cliPath: CLI_PATH, cwd: process.cwd(), autoStart: true });
    try {
        const session = await withTimeout(
            client.createSession({ sessionId: SPIKE_ID, ...COMMON }),
            CREATE_TIMEOUT, 'createSession'
        );
        createdFound = await ask(session, 'create');
    } catch (e) {
        fail(`create phase failed: ${e.message}`);
        process.exit(1);
    } finally {
        try { await client.stop(); } catch { /* best effort */ }
    }
}

// --- Phase 2: resume ---------------------------------------------------------
console.log(`\n${B}[2/2] resumeSession with the SAME skillDirectories${X}`);
let resumedFound = null, threw = null;
{
    const client = new CopilotClient({ cliPath: CLI_PATH, cwd: process.cwd(), autoStart: true });
    try {
        const session = await withTimeout(
            client.resumeSession(SPIKE_ID, { ...COMMON }),
            CREATE_TIMEOUT, 'resumeSession'
        );
        resumedFound = await ask(session, 'resume');
    } catch (e) {
        threw = e;
        fail(`resume phase failed: ${e.message}`);
    } finally {
        try { await client.stop(); } catch { /* best effort */ }
    }
}

// --- Verdict -----------------------------------------------------------------
console.log(`\n${B}=== Results ===${X}\n`);
console.log(`  createSession  : ${createdFound ? 'FOUND' : 'NOTFOUND'}`);
console.log(`  resumeSession  : ${threw ? 'n/a (threw)' : (resumedFound ? 'FOUND' : 'NOTFOUND')}\n`);

let verdict;
if (threw) {
    verdict = 'INCONCLUSIVE — resume threw';
} else if (!createdFound) {
    verdict = 'INCONCLUSIVE — create did not find the skill either';
    warn('The probe never established a working baseline.');
    console.log('\n  => Check the skill name and the resolved directories before');
    console.log('     drawing any conclusion about resume.');
} else if (createdFound && !resumedFound) {
    verdict = 'SKILLS LOST ON RESUME';
    fail('Skills load on create but NOT on resume.');
    console.log('\n  => This is the bug. The extension resumes by default, so in normal');
    console.log('     use the agent never sees plugin skills. Fixing the directory list');
    console.log('     would not have helped.');
} else {
    verdict = 'SKILLS WORK ON BOTH PATHS';
    pass('Skills load on create and on resume.');
    console.log('\n  => The resume path is not the cause either. The resolver defects are');
    console.log('     worth cleaning up, but the reported symptom needs another');
    console.log('     explanation — check the extension\'s own logs next.');
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
