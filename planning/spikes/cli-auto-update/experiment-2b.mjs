#!/usr/bin/env node
/**
 * Experiment 2b: SDK v0.1.22 + Manual --no-auto-update
 *
 * Uses SDK v0.1.22 (which does NOT pass --no-auto-update) but passes
 * it manually via cliArgs. This validates our proposed extension fix.
 * Expected: binary stays at 0.0.403.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

const SDK_VERSION = '0.1.22';

console.log('=============================================');
console.log(` EXPERIMENT 2b: SDK v${SDK_VERSION} + manual --no-auto-update`);
console.log('=============================================\n');

const workdir = mkdtempSync(join(tmpdir(), 'exp2b-'));
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

// Spawn via SDK with manual --no-auto-update in cliArgs
console.log('\nSpawning CLI via SDK with cliArgs: ["--no-auto-update"]...');
try {
    const sdkPath = join(workdir, 'node_modules', '@github', 'copilot-sdk', 'dist', 'client.js');
    const sdk = await import(sdkPath);
    const { CopilotClient } = sdk;

    const client = new CopilotClient({
        logLevel: 'error',
        cliPath: binaryPath,
        cliArgs: ['--no-auto-update'],  // <-- The fix we're validating
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
    console.log('Binary DID NOT change — manual --no-auto-update works!');
    console.log('Our proposed extension fix (cliArgs: ["--no-auto-update"]) is validated.');
} else {
    console.log('Binary CHANGED — manual --no-auto-update was NOT effective.');
    console.log(`  Before: ${beforeVersion} (${beforeHash})`);
    console.log(`  After:  ${afterVersion} (${afterHash})`);
}

console.log('\n=============================================');
console.log(' EXPERIMENT 2b: COMPLETE');
console.log('=============================================');
