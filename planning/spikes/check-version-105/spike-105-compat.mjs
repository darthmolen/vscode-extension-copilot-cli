#!/usr/bin/env node
/**
 * spike-105-compat.mjs — CLI 1.0.5 Compatibility Check
 *
 * Tests whether CLI 1.0.5 works with our SDK (0.1.32) by reproducing
 * the exact conditions a new user faces: fresh install, no 0.0.414 fallback.
 *
 * What we test:
 *   1. Flag compat  — --headless --stdio --no-auto-update accepted?
 *   2. Session create — CopilotClient can boot and reach "ready" state?
 *   3. Session resume — Can we resume an existing session by ID?
 *   4. Regression: 1.0.4 broke session loading — verify 1.0.5 is fixed.
 *
 * Prerequisites:
 *   GITHUB_TOKEN env var must be set (Copilot auth).
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_... node spike-105-compat.mjs
 *   GITHUB_TOKEN=ghp_... node spike-105-compat.mjs --skip-resume
 */

import { execFileSync, execSync } from 'child_process';
import { mkdtempSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

const SKIP_RESUME = process.argv.includes('--skip-resume');
const CLI_VERSION = '1.0.5';
const SDK_VERSION = '0.1.32';

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
console.log(` CLI ${CLI_VERSION} Compatibility Spike`);
console.log(` SDK: ${SDK_VERSION}`);
console.log(`═══════════════════════════════════════════════════\n`);

if (!process.env.GITHUB_TOKEN) {
    warn('GITHUB_TOKEN not set — will use logged-in CLI user (useLoggedInUser: true)');
}

const workdir = mkdtempSync(join(tmpdir(), 'spike-105-'));
console.log(`Workspace: ${workdir}\n`);

function cleanup() {
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// ─── Install ─────────────────────────────────────────────────────────────────

console.log(`[1/4] Installing CLI ${CLI_VERSION} and SDK ${SDK_VERSION}...`);

execFileSync('npm', ['init', '-y'], { cwd: workdir, stdio: 'pipe' });
execFileSync('npm', ['install', `@github/copilot@${CLI_VERSION}`, `@github/copilot-sdk@${SDK_VERSION}`], {
    cwd: workdir,
    stdio: 'pipe',
    timeout: 120_000,
});

const arch = process.arch === 'x64' ? 'linux-x64' : 'linux-arm64';
const cliPath = join(workdir, 'node_modules', '@github', `copilot-${arch}`, 'copilot');

if (!existsSync(cliPath)) {
    fail(`CLI binary not found at ${cliPath}`);
    process.exit(1);
}

const cliVer = execFileSync(cliPath, ['--version', '--no-auto-update'], { encoding: 'utf-8', timeout: 5000 }).trim();
info(`CLI binary: ${cliPath}`);
info(`CLI self-reports: ${cliVer}`);
check(`CLI version contains ${CLI_VERSION}`, cliVer.includes(CLI_VERSION));

// ─── Test 1: Flag Compatibility ───────────────────────────────────────────────

console.log('\n[2/4] Flag compatibility...');

const HEADLESS_INIT = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2.0', capabilities: {}, clientInfo: { name: 'spike', version: '1.0' } }
});

// Test --headless --stdio --no-auto-update (what the SDK uses)
const headlessOut = execFileSync('bash', ['-c',
    `echo '${HEADLESS_INIT}' | timeout 8 "${cliPath}" --headless --stdio --no-auto-update 2>&1 || true`
], { encoding: 'utf-8', timeout: 12_000 });

const headlessOk = headlessOut.includes('"result"');
const headlessRejected = /unknown flag|unknown option|not recognized/i.test(headlessOut);

check('--headless --stdio --no-auto-update accepted', headlessOk && !headlessRejected,
    headlessRejected ? 'FLAG REJECTED — SDK will fail to start' : headlessOut.substring(0, 120));

// ─── Test 2: SDK Session Create ───────────────────────────────────────────────

console.log('\n[3/4] SDK session create...');

const sdkPath = join(workdir, 'node_modules', '@github', 'copilot-sdk', 'dist', 'client.js');
const { CopilotClient } = await import(sdkPath);

let sessionId = null;

const clientOpts = process.env.GITHUB_TOKEN
    ? { cliPath, logLevel: 'error', cwd: workdir, useLoggedInUser: false, githubToken: process.env.GITHUB_TOKEN }
    : { cliPath, logLevel: 'error', cwd: workdir, useLoggedInUser: true };

try {
    const client = new CopilotClient(clientOpts);

    await client.start();
    check('CopilotClient.start() succeeded', true);

    // Create a session
    const session = await Promise.race([
        client.createSession({ systemPrompt: 'You are a test assistant. Reply with "OK" only.' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout after 30s')), 30_000)),
    ]);
    check('createSession() succeeded', true);
    sessionId = session.id;
    info(`Session ID: ${sessionId}`);

    // Send a message
    const result = await Promise.race([
        session.sendAndWait('Say "OK" and nothing else.'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('sendAndWait timeout 30s')), 30_000)),
    ]);
    const gotResponse = result && (result.text || result.content || result.message || JSON.stringify(result)).length > 0;
    check('sendAndWait() returned a response', gotResponse, gotResponse ? '' : JSON.stringify(result));

    await client.stop();
} catch (err) {
    check('SDK session lifecycle', false, err.message);
}

// ─── Test 3: Session Resume ───────────────────────────────────────────────────

if (SKIP_RESUME || !sessionId) {
    console.log('\n[4/4] Session resume... SKIPPED');
    if (!sessionId) warn('No session ID from step 3 — skipping resume test');
} else {
    console.log('\n[4/4] Session resume (1.0.4 regression check)...');

    try {
        const client2 = new CopilotClient(clientOpts);

        await client2.start();

        const resumed = await Promise.race([
            client2.resumeSession(sessionId),
            new Promise((_, reject) => setTimeout(() => reject(new Error('resumeSession timeout 30s')), 30_000)),
        ]);
        check('resumeSession() succeeded (1.0.4 regression)', true);
        info(`Resumed session: ${resumed.id}`);

        // Send a follow-up to confirm the resumed session is functional
        const r2 = await Promise.race([
            resumed.sendAndWait('Reply "RESUMED OK" and nothing else.'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('sendAndWait timeout 30s')), 30_000)),
        ]);
        const resumeWorked = r2 && (r2.text || r2.content || JSON.stringify(r2)).length > 0;
        check('Resumed session can send messages', resumeWorked);

        await client2.stop();
    } catch (err) {
        // This is the specific regression from 1.0.4
        const isKnownRegression = /load|read|parse|ENOENT|events\.jsonl/i.test(err.message);
        check('resumeSession() succeeded (1.0.4 regression)', false,
            isKnownRegression
                ? `KNOWN 1.0.4 REGRESSION REPRODUCED: ${err.message}`
                : err.message
        );
    }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════');
if (failures === 0) {
    console.log(`${GREEN} ✓ ALL CHECKS PASSED — CLI ${CLI_VERSION} is compatible${RESET}`);
} else {
    console.log(`${RED} ✗ ${failures} CHECK(S) FAILED — CLI ${CLI_VERSION} has issues${RESET}`);
}
console.log('═══════════════════════════════════════════════════');

process.exit(failures > 0 ? 1 : 0);
