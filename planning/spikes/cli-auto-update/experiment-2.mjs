#!/usr/bin/env node
/**
 * Experiment 2: SDK v0.1.25 — --no-auto-update Verification
 *
 * Clean install of SDK v0.1.25 (has --no-auto-update in PR #392).
 * Records binary hash before and after SDK spawns the CLI.
 * Expected: binary stays at whatever v0.1.25 bundles (0.0.411). No mutation.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

const SDK_VERSION = '0.1.25';

console.log('=============================================');
console.log(` EXPERIMENT 2: SDK v${SDK_VERSION} (--no-auto-update fix)`);
console.log('=============================================\n');

const workdir = mkdtempSync(join(tmpdir(), 'exp2-'));
console.log(`Workspace: ${workdir}`);

console.log(`\nInstalling @github/copilot-sdk@${SDK_VERSION}...`);
execFileSync('npm', ['init', '-y'], { cwd: workdir, stdio: 'pipe' });
execFileSync('npm', ['install', `@github/copilot-sdk@${SDK_VERSION}`], {
    cwd: workdir,
    stdio: 'pipe',
    timeout: 120000,
});

const arch = process.arch === 'x64' ? 'linux-x64' : 'linux-arm64';
const binaryPath = join(workdir, 'node_modules', '@github', `copilot-${arch}`, 'copilot');

if (!existsSync(binaryPath)) {
    console.error(`Binary not found: ${binaryPath}`);
    process.exit(1);
}

const pkgPath = join(workdir, 'node_modules', '@github', `copilot-${arch}`, 'package.json');
const pkgVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;

function hashFile(path) {
    return createHash('md5').update(readFileSync(path)).digest('hex');
}

function getVersion(path) {
    try {
        return execFileSync(path, ['--version'], { encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {
        return 'FAILED';
    }
}

// BEFORE
const beforeHash = hashFile(binaryPath);
const beforeVersion = getVersion(binaryPath);
console.log('\n[BEFORE]');
console.log(`  package.json: ${pkgVersion}`);
console.log(`  --version:    ${beforeVersion}`);
console.log(`  md5:          ${beforeHash}`);

// Verify that the SDK dist/client.js contains --no-auto-update
const clientJs = join(workdir, 'node_modules', '@github', 'copilot-sdk', 'dist', 'client.js');
const clientSrc = readFileSync(clientJs, 'utf8');
const hasNoAutoUpdate = clientSrc.includes('--no-auto-update');
console.log(`\n  SDK passes --no-auto-update: ${hasNoAutoUpdate ? 'YES' : 'NO'}`);

if (!hasNoAutoUpdate) {
    console.log('  WARNING: SDK v0.1.25 does NOT have --no-auto-update!');
    console.log('  This means the fix may not be in the published version yet.');
}

// Spawn via SDK
console.log('\nSpawning CLI via SDK (CopilotClient)...');
try {
    const sdkPath = join(workdir, 'node_modules', '@github', 'copilot-sdk', 'dist', 'client.js');
    const sdk = await import(sdkPath);
    const { CopilotClient } = sdk;

    const client = new CopilotClient({
        logLevel: 'error',
        cliPath: binaryPath,
        cwd: workdir,
        autoStart: false,
    });

    await client.start();
    console.log('Waiting 20s to see if auto-update triggers...');
    await new Promise(r => setTimeout(r, 20000));
    try { await client.stop(); } catch { /* ignore */ }
} catch (err) {
    console.log(`SDK error: ${err.message}`);
}

await new Promise(r => setTimeout(r, 5000));

// AFTER
const afterHash = hashFile(binaryPath);
const afterVersion = getVersion(binaryPath);
console.log('\n[AFTER]');
console.log(`  package.json: ${pkgVersion}`);
console.log(`  --version:    ${afterVersion}`);
console.log(`  md5:          ${afterHash}`);

console.log('\n[RESULT]');
if (beforeHash === afterHash) {
    console.log('Binary DID NOT change — --no-auto-update works!');
    console.log("Steve's PR #392 fix is effective.");
} else {
    console.log('Binary CHANGED — --no-auto-update did NOT prevent update!');
    console.log(`  Before: ${beforeVersion} (${beforeHash})`);
    console.log(`  After:  ${afterVersion} (${afterHash})`);
    console.log("  Steve's claim that bundled CLI doesn't auto-update is wrong even with the fix.");
}

console.log('\n=============================================');
console.log(' EXPERIMENT 2: COMPLETE');
console.log('=============================================');
