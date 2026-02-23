#!/usr/bin/env node
/**
 * Experiment 1: SDK v0.1.22 — Auto-Update Proof
 *
 * Clean install of SDK v0.1.22 (no --no-auto-update).
 * Records binary hash before and after SDK spawns the CLI.
 * Expected: binary self-updates from 0.0.403 to 0.0.410+.
 */

import { execFileSync, spawn } from 'child_process';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

const SDK_VERSION = '0.1.22';
const EXPECTED_CLI = '0.0.403';

console.log('=============================================');
console.log(` EXPERIMENT 1: SDK v${SDK_VERSION} Auto-Update Proof`);
console.log('=============================================\n');

// Create isolated workspace
const workdir = mkdtempSync(join(tmpdir(), 'exp1-'));
console.log(`Workspace: ${workdir}`);

// Install SDK
console.log(`\nInstalling @github/copilot-sdk@${SDK_VERSION}...`);
execFileSync('npm', ['init', '-y'], { cwd: workdir, stdio: 'pipe' });
execFileSync('npm', ['install', `@github/copilot-sdk@${SDK_VERSION}`], {
    cwd: workdir,
    stdio: 'pipe',
    timeout: 120000,
});

// Find bundled binary
const arch = process.arch === 'x64' ? 'linux-x64' : 'linux-arm64';
const binaryPath = join(workdir, 'node_modules', '@github', `copilot-${arch}`, 'copilot');

if (!existsSync(binaryPath)) {
    console.error(`Binary not found: ${binaryPath}`);
    process.exit(1);
}

// Get package.json version
const pkgPath = join(workdir, 'node_modules', '@github', `copilot-${arch}`, 'package.json');
const pkgVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
console.log(`\nPackage.json version: ${pkgVersion}`);

function hashFile(path) {
    const data = readFileSync(path);
    return createHash('md5').update(data).digest('hex');
}

function getVersion(path) {
    try {
        return execFileSync(path, ['--version'], { encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {
        return 'FAILED';
    }
}

// BEFORE snapshot
const beforeHash = hashFile(binaryPath);
const beforeVersion = getVersion(binaryPath);
console.log('\n[BEFORE]');
console.log(`  package.json: ${pkgVersion}`);
console.log(`  --version:    ${beforeVersion}`);
console.log(`  md5:          ${beforeHash}`);

// Run the CLI via SDK (CopilotClient)
// SDK v0.1.22 does NOT pass --no-auto-update, so the CLI may auto-update
console.log('\nSpawning CLI via SDK (CopilotClient)...');
console.log('(This triggers the auto-update check)\n');

try {
    // Dynamic import of the SDK from the workspace
    const sdkPath = join(workdir, 'node_modules', '@github', 'copilot-sdk', 'dist', 'client.js');
    const sdk = await import(sdkPath);
    const { CopilotClient } = sdk;

    const client = new CopilotClient({
        logLevel: 'error',
        cliPath: binaryPath,
        cwd: workdir,
        autoStart: false, // We'll start manually to control timing
    });

    // Start the client — this spawns the CLI
    await client.start();

    // Give it time for the auto-update check to trigger
    console.log('Waiting 20s for auto-update to trigger...');
    await new Promise(r => setTimeout(r, 20000));

    // Stop the client
    try { await client.stop(); } catch { /* ignore */ }
} catch (err) {
    console.log(`SDK error (expected if auth fails): ${err.message}`);
    console.log('(Auto-update may still have triggered before auth check)');
}

// Wait a bit more for any background update to complete
await new Promise(r => setTimeout(r, 5000));

// AFTER snapshot
const afterHash = hashFile(binaryPath);
const afterVersion = getVersion(binaryPath);
console.log('\n[AFTER]');
console.log(`  package.json: ${pkgVersion}`);
console.log(`  --version:    ${afterVersion}`);
console.log(`  md5:          ${afterHash}`);

// Compare
console.log('\n[RESULT]');
if (beforeHash === afterHash) {
    console.log('Binary DID NOT change — auto-update was NOT triggered');
    console.log('(This contradicts our hypothesis)');
} else {
    console.log('Binary CHANGED — auto-update WAS triggered!');
    console.log(`  Before: ${beforeVersion} (${beforeHash})`);
    console.log(`  After:  ${afterVersion} (${afterHash})`);
    console.log(`  package.json still says: ${pkgVersion}`);
    console.log('  This proves the bundled CLI auto-updates in-place.');
}

console.log('\n=============================================');
console.log(' EXPERIMENT 1: COMPLETE');
console.log('=============================================');
