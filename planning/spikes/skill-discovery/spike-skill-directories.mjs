#!/usr/bin/env node
/**
 * spike-skill-directories.mjs — Why can't the agent see plugin skills?
 *
 * Background
 * ----------
 * The extension passes `skillDirectories` on both the create and resume paths
 * (sdkSessionManager.ts:413 and :2175), resolved by SkillDirectoriesService.
 * Against this machine that resolver returns 13 directories, all from
 * ~/.claude/plugins/cache/**. So "the plugin cache is not scanned" is NOT the
 * bug — it is scanned.
 *
 * Two defects are visible by inspection, both from blind-walking the cache
 * instead of reading ~/.claude/plugins/installed_plugins.json:
 *
 *   1. a STALE version is passed alongside the installed one
 *      (ai-plugins-and-skills 1.0.0 next to 1.1.0), and the two collide on
 *      17 skill names;
 *   2. an UNINSTALLED leftover is passed (curriculum 1.0.0) — no manifest entry.
 *
 * Whether either actually stops the agent seeing skills is a hypothesis. This
 * spike tests it rather than assuming, per CLAUDE.md's SDK-first rule.
 *
 * Phases
 * ------
 *   1. CURRENT   — all directories the resolver returns today.
 *   2. MANIFEST  — only directories named by installed_plugins.json.
 *   3. SINGLE    — one clean directory, as a baseline.
 *   4. ENABLE    — MANIFEST again with enableSkills:true set explicitly, to see
 *                  whether the runtime default is the problem
 *                  (types.d.ts:2084: "When false, no skills are loaded
 *                  regardless of skillDirectories").
 *
 * Each phase asks the agent to load two skills by name:
 *   - a NON-COLLIDING skill  (superpowers/brainstorming)
 *   - a COLLIDING skill      (ai-plugins-and-skills/plan-intake-review,
 *                             present in both the stale and installed versions)
 *
 * If the colliding one fails only in phase 1, the collision is the cause.
 * If everything fails until phase 4, enableSkills is the cause.
 * If everything succeeds, the resolver defects are real but not user-visible,
 * and the reported symptom has another source.
 *
 * Usage (Node 24+, from project root):
 *   node planning/spikes/skill-discovery/spike-skill-directories.mjs
 *   node planning/spikes/skill-discovery/spike-skill-directories.mjs --keep
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
const MODEL = 'claude-sonnet-4.6';
const CREATE_TIMEOUT = 60_000;
const SEND_TIMEOUT = 120_000;

const NON_COLLIDING = 'brainstorming';        // superpowers only
const COLLIDING = 'plan-intake-review';       // in BOTH 1.0.0 and 1.1.0

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

// --- Directory resolution ----------------------------------------------------

/** Reproduces SkillDirectoriesService.resolveSkillDirectories() exactly. */
function currentResolver() {
    const PLUGIN_CACHE_MAX_DEPTH = 5;
    function findSkillDirsIn(dir, depth, max) {
        if (depth >= max || !fs.existsSync(dir)) { return []; }
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
        const out = [];
        for (const e of entries) {
            if (!e.isDirectory()) { continue; }
            if (e.name === 'skills') { out.push(path.join(dir, e.name)); }
            else { out.push(...findSkillDirsIn(path.join(dir, e.name), depth + 1, max)); }
        }
        return out;
    }
    const candidates = [
        path.join(HOME, '.claude', 'skills'),
        path.join(HOME, '.agents', 'skills'),
        ...findSkillDirsIn(path.join(HOME, '.claude', 'plugins', 'cache'), 0, PLUGIN_CACHE_MAX_DEPTH),
    ];
    const seen = new Set(), out = [];
    for (const d of candidates) {
        if (!seen.has(d) && fs.existsSync(d)) { seen.add(d); out.push(d); }
    }
    return out;
}

/** The proposed replacement: only what installed_plugins.json actually names. */
function manifestResolver() {
    const out = [];
    const seen = new Set();
    for (const base of [path.join(HOME, '.claude', 'skills'), path.join(HOME, '.agents', 'skills')]) {
        if (fs.existsSync(base) && !seen.has(base)) { seen.add(base); out.push(base); }
    }
    const manifestPath = path.join(HOME, '.claude', 'plugins', 'installed_plugins.json');
    if (!fs.existsSync(manifestPath)) { return null; }
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { return null; }
    if (manifest?.version !== 2 || !manifest.plugins) { return null; }
    for (const entries of Object.values(manifest.plugins)) {
        for (const entry of entries ?? []) {
            if (!entry?.installPath) { continue; }
            const dir = path.join(entry.installPath, 'skills');
            if (!seen.has(dir) && fs.existsSync(dir)) { seen.add(dir); out.push(dir); }
        }
    }
    return out;
}

// --- Probe -------------------------------------------------------------------

async function probeSkills(client, label, skillDirectories, extraConfig = {}) {
    const session = await withTimeout(
        client.createSession({
            model: MODEL,
            skillDirectories,
            onPermissionRequest: (await import(SDK_URL)).approveAll,
            ...extraConfig,
        }),
        CREATE_TIMEOUT, `${label} createSession`
    );

    const ask = async (name) => {
        const prompt =
            `Use your skill tool to load the skill named "${name}". `
            + `Reply with exactly FOUND if it loaded, or exactly NOTFOUND if no such `
            + `skill is available to you. Do not explain.`;
        const res = await withTimeout(session.sendAndWait({ prompt }), SEND_TIMEOUT, `${label} ${name}`);
        const said = textOf(res);
        const found = /FOUND/.test(said) && !/NOTFOUND/.test(said);
        info(`${label} ${name}: ${found ? 'FOUND' : 'NOTFOUND'}`);
        return found;
    };

    return { nonColliding: await ask(NON_COLLIDING), colliding: await ask(COLLIDING) };
}

// --- Run ---------------------------------------------------------------------

console.log(`\n${B}=== skill directory discovery spike ===${X}\n`);

if (parseInt(process.versions.node, 10) < 24) {
    fail(`Node 24+ required; got v${process.versions.node}`);
    process.exit(1);
}
if (!fs.existsSync(CLI_PATH)) {
    fail(`CLI not found at ${CLI_PATH}`);
    process.exit(1);
}

const CURRENT = currentResolver();
const MANIFEST = manifestResolver();

info(`CURRENT resolver  : ${CURRENT.length} directories`);
info(`MANIFEST resolver : ${MANIFEST ? MANIFEST.length : 'n/a (manifest unreadable)'} directories`);

if (MANIFEST) {
    const dropped = CURRENT.filter(d => !MANIFEST.includes(d));
    const added = MANIFEST.filter(d => !CURRENT.includes(d));
    for (const d of dropped) { warn(`only in CURRENT (stale/uninstalled): ${d}`); }
    for (const d of added) { warn(`only in MANIFEST: ${d}`); }
}

const SINGLE = CURRENT.filter(d => d.includes('superpowers') && d.endsWith('skills')).slice(0, 1);
info(`SINGLE baseline   : ${SINGLE[0] ?? 'none found'}\n`);

const { CopilotClient } = await import(SDK_URL);

async function phase(label, dirs, extraConfig = {}) {
    console.log(`\n${B}[${label}] ${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'}${X}`);
    const client = new CopilotClient({ cliPath: CLI_PATH, cwd: process.cwd(), autoStart: true });
    try {
        return await probeSkills(client, label, dirs, extraConfig);
    } catch (e) {
        fail(`${label} failed: ${e.message}`);
        return null;
    } finally {
        try { await client.stop(); } catch { /* best effort */ }
    }
}

const results = {};
results.CURRENT = await phase('CURRENT', CURRENT);
if (MANIFEST) { results.MANIFEST = await phase('MANIFEST', MANIFEST); }
if (SINGLE.length) { results.SINGLE = await phase('SINGLE', SINGLE); }
if (MANIFEST) { results.ENABLE = await phase('ENABLE', MANIFEST, { enableSkills: true }); }

// --- Verdict -----------------------------------------------------------------
console.log(`\n${B}=== Results ===${X}\n`);
console.log(`  phase      non-colliding   colliding`);
for (const [k, v] of Object.entries(results)) {
    const fmt = b => (v === null ? 'n/a  ' : (b ? 'FOUND' : 'MISS '));
    console.log(`  ${k.padEnd(10)} ${fmt(v?.nonColliding).padEnd(15)} ${fmt(v?.colliding)}`);
}
console.log('');

const cur = results.CURRENT;
const man = results.MANIFEST;

if (cur && cur.nonColliding && cur.colliding) {
    warn('Skills resolve fine even with the current directory list.');
    console.log('\n  => The two resolver defects are real but do NOT explain the reported');
    console.log('     symptom. Clean them up anyway, but keep looking for the real cause');
    console.log('     (check the extension\'s own logs against these directories).');
} else if (cur && !cur.colliding && man && man.colliding) {
    fail('The colliding skill fails with the current list and works with the manifest list.');
    console.log('\n  => The stale duplicate version IS the cause. Manifest-driven');
    console.log('     resolution fixes it.');
} else if (cur && !cur.nonColliding && results.ENABLE?.nonColliding) {
    fail('Nothing resolves until enableSkills is set explicitly.');
    console.log('\n  => The runtime default for enableSkills is the cause, not the');
    console.log('     directory list. Set enableSkills:true on both session paths.');
} else if (cur && !cur.nonColliding && results.SINGLE?.nonColliding) {
    fail('A single clean directory works; the full list does not.');
    console.log('\n  => Something about the directory SET breaks discovery (count, or a');
    console.log('     bad entry). Bisect the list to find it.');
} else {
    warn('No clean signal. See the table above.');
}

if (!KEEP) {
    info('\nSessions created by this spike used generated ids; remove them from');
    info('~/.copilot/session-state/ if they accumulate.');
}

process.exit(0);
