#!/usr/bin/env node
/**
 * spike-105-compat.mjs — CLI 1.0.5 Compatibility Check
 *
 * Tests whether CLI 1.0.5 works with our SDK (0.1.32) using the
 * project's installed SDK — no temp npm installs.
 *
 * What we test:
 *   1. Node version  — Must be 24+ (node:sqlite requirement)
 *   2. Session create — CopilotClient can boot and create a session
 *   3. Send message   — sendAndWait returns a response
 *   4. Session resume — Can we resume an existing session by ID?
 *
 * Usage (run from project root with Node 24+):
 *   node planning/spikes/check-version-105/spike-105-compat.mjs
 *   node planning/spikes/check-version-105/spike-105-compat.mjs --skip-resume
 */

import { execFileSync } from 'child_process';

const SKIP_RESUME = process.argv.includes('--skip-resume');

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';

function pass(msg) { console.log(`  ${GREEN}✓ PASS${RESET}  ${msg}`); }
function fail(msg) { console.log(`  ${RED}✗ FAIL${RESET}  ${msg}`); }
function warn(msg) { console.log(`  ${YELLOW}⚠ WARN${RESET}  ${msg}`); }
function info(msg) { console.log(`  ${CYAN}ℹ${RESET}      ${msg}`); }

let failures = 0;

function check(label, ok, detail = '') {
    if (ok) {
        pass(label);
    } else {
        fail(`${label}${detail ? ' — ' + detail : ''}`);
        failures++;
    }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════');
console.log(' CLI 1.0.5 Compatibility Spike');
console.log('═══════════════════════════════════════════════════\n');

// ─── Test 0: Node Version ────────────────────────────────────────────────────

console.log('[1/4] Node version check...');

const nodeVersion = process.versions.node;
const nodeMajor = parseInt(nodeVersion.split('.')[0], 10);
check('Node.js 24+ required', nodeMajor >= 24, `got v${nodeVersion}`);

if (nodeMajor < 24) {
    console.log(`\n${RED}Node 24+ is required. Run with: nvm use 24 && node spike-105-compat.mjs${RESET}`);
    process.exit(1);
}

// ─── Test 1: SDK + CLI version ───────────────────────────────────────────────

console.log('\n[2/4] SDK and CLI version...');

const { CopilotClient, approveAll } = await import('@github/copilot-sdk');
info('SDK imported from project node_modules');

// Get CLI version from PATH
try {
    const cliVer = execFileSync('copilot', ['--version'], { encoding: 'utf-8', timeout: 5000 }).trim();
    info(`CLI reports: ${cliVer}`);
} catch (e) {
    warn(`Could not get CLI version: ${e.message}`);
}

// ─── Test 2: SDK Session Create ──────────────────────────────────────────────

console.log('\n[3/4] SDK session create...');

let sessionId = null;
let client = null;

try {
    client = new CopilotClient({
        cwd: process.cwd(),
        autoStart: true,
    });

    const session = await Promise.race([
        client.createSession({
            model: 'gpt-5',
            onPermissionRequest: approveAll,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout after 30s')), 30_000)),
    ]);
    check('createSession() succeeded', true);
    sessionId = session.sessionId;
    info(`Session ID: ${sessionId}`);

    // Send a message
    const result = await Promise.race([
        session.sendAndWait({ prompt: 'Say "OK" and nothing else.' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('sendAndWait timeout 60s')), 60_000)),
    ]);
    check('sendAndWait() returned a response', !!result);

    await client.stop();
    client = null;
} catch (err) {
    check('SDK session lifecycle', false, err.message);
    if (client) { await client.stop().catch(() => {}); client = null; }
}

// ─── Test 3: Session Resume ─────────────────────────────────────────────────

if (SKIP_RESUME || !sessionId) {
    console.log('\n[4/4] Session resume... SKIPPED');
    if (!sessionId) warn('No session ID from step 3 — skipping resume test');
} else {
    console.log('\n[4/4] Session resume...');

    let client2 = null;
    try {
        client2 = new CopilotClient({
            cwd: process.cwd(),
            autoStart: true,
        });

        const resumed = await Promise.race([
            client2.resumeSession({ sessionId }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('resumeSession timeout 30s')), 30_000)),
        ]);
        check('resumeSession() succeeded', true);
        info(`Resumed session: ${resumed.sessionId}`);

        const r2 = await Promise.race([
            resumed.sendAndWait({ prompt: 'Reply "RESUMED OK" and nothing else.' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('sendAndWait timeout 60s')), 60_000)),
        ]);
        check('Resumed session can send messages', !!r2);

        await client2.stop();
    } catch (err) {
        check('resumeSession()', false, err.message);
        if (client2) { await client2.stop().catch(() => {}); }
    }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════');
if (failures === 0) {
    console.log(`${GREEN} ✓ ALL CHECKS PASSED — CLI 1.0.5 is compatible${RESET}`);
} else {
    console.log(`${RED} ✗ ${failures} CHECK(S) FAILED${RESET}`);
}
console.log('═══════════════════════════════════════════════════');

process.exit(failures > 0 ? 1 : 0);
