#!/usr/bin/env node
/**
 * Experiment 3: Dual CLI — SDK Bundled + System PATH
 *
 * Reproduces our production scenario: SDK v0.1.22 installed with a
 * newer CLI (0.0.410) on the system PATH.
 * Tests three sub-scenarios:
 *   3a: cliPath pointing to PATH version (0.0.410)
 *   3b: cliPath pointing to bundled version (0.0.403)
 *   3c: No cliPath (let SDK resolve internally via getBundledCliPath)
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

const SDK_VERSION = '0.1.22';

console.log('=============================================');
console.log(` EXPERIMENT 3: Dual CLI (SDK + PATH)`);
console.log('=============================================\n');

const workdir = mkdtempSync(join(tmpdir(), 'exp3-'));
console.log(`Workspace: ${workdir}`);

// Install SDK
console.log(`\nInstalling @github/copilot-sdk@${SDK_VERSION}...`);
execFileSync('npm', ['init', '-y'], { cwd: workdir, stdio: 'pipe' });
execFileSync('npm', ['install', `@github/copilot-sdk@${SDK_VERSION}`], {
    cwd: workdir,
    stdio: 'pipe',
    timeout: 120000,
});

const arch = process.arch === 'x64' ? 'linux-x64' : 'linux-arm64';
const bundledPath = join(workdir, 'node_modules', '@github', `copilot-${arch}`, 'copilot');

// Find system CLI on PATH
let systemPath;
try {
    systemPath = execFileSync('which', ['copilot'], { encoding: 'utf-8', timeout: 5000 }).trim();
} catch {
    systemPath = null;
}

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

console.log('\n[ENVIRONMENT]');
console.log(`  Bundled CLI: ${existsSync(bundledPath) ? bundledPath : 'NOT FOUND'}`);
console.log(`  Bundled ver: ${existsSync(bundledPath) ? getVersion(bundledPath) : 'N/A'}`);
console.log(`  System CLI:  ${systemPath || 'NOT ON PATH'}`);
console.log(`  System ver:  ${systemPath ? getVersion(systemPath) : 'N/A'}`);

async function testScenario(label, cliPathOverride) {
    console.log(`\n--- ${label} ---`);

    const sdkPath = join(workdir, 'node_modules', '@github', 'copilot-sdk', 'dist', 'client.js');
    const sdk = await import(sdkPath);
    const { CopilotClient } = sdk;

    const opts = {
        logLevel: 'error',
        cwd: workdir,
        autoStart: false,
    };

    if (cliPathOverride !== undefined) {
        opts.cliPath = cliPathOverride;
        console.log(`  cliPath: ${cliPathOverride}`);
    } else {
        console.log('  cliPath: (not set — SDK resolves internally)');
    }

    try {
        const client = new CopilotClient(opts);
        await client.start();

        // Give it a moment
        await new Promise(r => setTimeout(r, 5000));

        try { await client.stop(); } catch { /* ignore */ }
        console.log('  Result: CLI started successfully');
    } catch (err) {
        const msg = err.message || String(err);
        if (msg.includes('headless') || msg.includes('ENOENT') || msg.includes('spawn')) {
            console.log(`  Result: FAILED — ${msg.substring(0, 200)}`);
        } else {
            console.log(`  Result: Error (may be auth-related): ${msg.substring(0, 200)}`);
        }
    }
}

// 3a: cliPath = system PATH version
if (systemPath) {
    await testScenario('3a: cliPath = system CLI (PATH)', systemPath);
} else {
    console.log('\n--- 3a: SKIPPED (no system CLI on PATH) ---');
}

// 3b: cliPath = bundled version
if (existsSync(bundledPath)) {
    // Snapshot before
    const beforeHash = hashFile(bundledPath);
    await testScenario('3b: cliPath = bundled CLI', bundledPath);
    const afterHash = hashFile(bundledPath);
    console.log(`  Binary changed: ${beforeHash !== afterHash ? 'YES (auto-updated!)' : 'NO'}`);
}

// 3c: No cliPath (SDK internal resolution)
try {
    await testScenario('3c: cliPath = (SDK default)', undefined);
} catch (err) {
    console.log(`  3c failed: ${err.message}`);
    console.log('  (Expected — getBundledCliPath uses import.meta.resolve which may fail in CJS/ESM contexts)');
}

console.log('\n=============================================');
console.log(' EXPERIMENT 3: COMPLETE');
console.log('=============================================');
