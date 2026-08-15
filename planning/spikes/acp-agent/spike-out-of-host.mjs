#!/usr/bin/env node
/**
 * Spike: can SDKSessionManager drive the SDK from outside the extension host,
 * and do plan mode's custom tools still fire there?
 *
 * This is the highest-value unknown in the v4.0 AHP/ACP re-plan. Plan mode's
 * entire security model is six host-side `defineTool()` closures plus an
 * `availableTools` whitelist. If those closures stop firing once the manager
 * runs in its own process, the ACP-agent direction loses plan mode.
 *
 * The spike deliberately runs as a PLAIN NODE PROCESS with no `vscode` module
 * available at all — the same condition an ACP agent subprocess would face.
 * It injects a HostBridge (added in Phase 0.1) and asserts:
 *
 *   1. the compiled manager loads and constructs with vscode absent
 *   2. a real Copilot SDK session starts from that process
 *   3. plan mode enables, creating the second (plan) session
 *   4. the six plan-mode tools are registered and the whitelist is applied
 *   5. a real prompt causes a plan-mode tool CLOSURE to execute in-process
 *
 * Step 5 is the one that matters: it proves tool callbacks reach back into our
 * process rather than being resolved inside the CLI.
 *
 * Usage:  node planning/spikes/acp-agent/spike-out-of-host.mjs [--offline]
 *
 * Requires: live Copilot auth (~/.copilot), Node 24+, `npm run compile-tests`
 * already run so `out/` is current. `--offline` runs steps 1–4 only.
 */

import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir, homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const RESULTS_DIR = join(__dirname, 'results');
const OFFLINE = process.argv.includes('--offline');

const require = createRequire(import.meta.url);

// ── Ban the vscode module ────────────────────────────────────────────────────
// Anything that reaches for it will throw, exactly as in a real agent process.
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'vscode') {
        const err = new Error("Cannot find module 'vscode' (banned by spike)");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
    }
    return originalRequire.apply(this, arguments);
};

const results = { startedAt: new Date().toISOString(), offline: OFFLINE, steps: [] };
const step = (name, ok, detail) => {
    results.steps.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
    return ok;
};

const log = [];
const host = {
    logger: {
        debug: m => log.push(`[debug] ${m}`),
        info: m => log.push(`[info] ${m}`),
        warn: (m) => log.push(`[warn] ${m}`),
        error: (m) => log.push(`[error] ${m}`)
    },
    getConfig(key, defaultValue) {
        // Mirror the settings an agent process would be handed as a snapshot.
        if (key === 'yolo') return true;              // no interactive approvals
        if (key === 'filterSessionsByFolder') return false;
        return defaultValue;
    },
    getWorkspaceFolder: () => REPO_ROOT,
    getGlobalStorageDir: () => join(tmpdir(), 'acp-spike-global-storage'),
    showError: m => log.push(`[toast:error] ${m}`),
    showWarning: m => log.push(`[toast:warn] ${m}`),
    async askSessionRecovery() { return 'new'; },
    getActiveAgent: () => null
    // NOTE: no createMessageEnhancer — an agent process has no editor.
};

async function main() {
    mkdirSync(RESULTS_DIR, { recursive: true });

    // ── 1. Load + construct with vscode absent ───────────────────────────────
    let SDKSessionManager;
    try {
        ({ SDKSessionManager } = require(join(REPO_ROOT, 'out', 'sdkSessionManager.js')));
        step('1. manager module loads with vscode absent', true);
    } catch (e) {
        step('1. manager module loads with vscode absent', false, e.message);
        return finish(1);
    }

    // Resolve the CLI the same way CliBundleService does: prefer the native
    // platform binary, fall back to the loader shim.
    const platformPkg = `@github/copilot-${process.platform}-${process.arch}`;
    const candidates = [
        join(REPO_ROOT, 'node_modules', platformPkg, 'copilot'),
        join(REPO_ROOT, 'node_modules', platformPkg, 'app.js'),
        join(REPO_ROOT, 'node_modules/@github/copilot/npm-loader.js')
    ];
    const cliPath = candidates.find(p => existsSync(p));
    step('0. resolved a Copilot CLI entry point', !!cliPath, cliPath || candidates.join(' | '));
    let manager;
    try {
        manager = new SDKSessionManager(undefined, {}, false, undefined, cliPath, host);
        step('1b. manager constructs with an injected HostBridge', true);
    } catch (e) {
        step('1b. manager constructs with an injected HostBridge', false, e.message);
        return finish(1);
    }

    // ── 4a. Tool registration is inspectable before any network call ─────────
    // PLAN_MODE_AVAILABLE_TOOLS is the declared whitelist; getTools() the closures.
    try {
        const { PLAN_MODE_AVAILABLE_TOOLS, PlanModeToolsService } =
            require(join(REPO_ROOT, 'out', 'extension', 'services', 'planModeToolsService.js'));
        const probeDir = join(tmpdir(), `acp-spike-plan-${Date.now()}`);
        mkdirSync(probeDir, { recursive: true });
        const svc = new PlanModeToolsService(
            'spike-work-session', REPO_ROOT, { fire() {} },
            { createTempSnapshot: () => join(probeDir, 'snap'), getTempDir: () => probeDir, cleanupTempFile() {} },
            () => {}
        );
        await svc.initialize();
        const tools = svc.getTools();
        const names = tools.map(t => t.name).sort();
        step('4a. plan-mode tool closures build outside the extension host', tools.length === 6,
            `${tools.length} tools: ${names.join(', ')}`);
        step('4b. availableTools whitelist is intact', PLAN_MODE_AVAILABLE_TOOLS.length === 13,
            `${PLAN_MODE_AVAILABLE_TOOLS.length} entries`);
        results.planModeToolNames = names;
        results.availableTools = PLAN_MODE_AVAILABLE_TOOLS;
        rmSync(probeDir, { recursive: true, force: true });
    } catch (e) {
        step('4a. plan-mode tool closures build outside the extension host', false, e.message);
    }

    if (OFFLINE) {
        console.log('\n(--offline: skipping live SDK steps 2, 3, 5)');
        return finish(0);
    }

    // ── 2. Real session from this process ────────────────────────────────────
    const statuses = [];
    manager.onDidChangeStatus(s => statuses.push(s.status));
    const output = [];
    manager.onDidReceiveOutput(o => output.push(o.content));

    try {
        await manager.start();
        step('2. real SDK session starts from a non-extension-host process', !!manager.getSessionId(),
            `sessionId=${manager.getSessionId()}`);
    } catch (e) {
        step('2. real SDK session starts from a non-extension-host process', false, e.message);
        return finish(1);
    }

    // ── 3. Plan mode enables (creates the second session) ────────────────────
    try {
        await manager.enablePlanMode();
        const inPlan = manager.getCurrentMode() === 'plan';
        step('3. plan mode enables (dual session)', inPlan,
            `mode=${manager.getCurrentMode()} planPath=${manager.getPlanFilePath()}`);
        results.planFilePath = manager.getPlanFilePath();
    } catch (e) {
        step('3. plan mode enables (dual session)', false, e.message);
        return finish(1);
    }

    // ── 5. THE decisive check: does a tool closure execute in THIS process? ──
    // Ask for something that can only be satisfied by calling update_work_plan,
    // whose handler writes plan.md from inside our process.
    const planPath = manager.getPlanFilePath();
    const before = existsSync(planPath) ? require('fs').readFileSync(planPath, 'utf-8') : '';
    const marker = `SPIKE-MARKER-${Date.now()}`;

    try {
        await manager.sendMessage(
            `Call the update_work_plan tool exactly once. Set the plan content to a markdown ` +
            `document whose first line is "# ${marker}" followed by one bullet: "- proof of life". ` +
            `Do not explore the codebase. Do not call any other tool.`
        );
        // sendMessage resolves when the turn completes.
        const after = existsSync(planPath) ? require('fs').readFileSync(planPath, 'utf-8') : '';
        const fired = after.includes(marker) && after !== before;
        step('5. plan-mode tool CLOSURE executed in-process (wrote plan.md)', fired,
            fired ? `plan.md contains ${marker}` : `plan.md unchanged (len ${after.length})`);
        results.planMdAfter = after.slice(0, 400);
    } catch (e) {
        step('5. plan-mode tool CLOSURE executed in-process (wrote plan.md)', false, e.message);
    }

    results.statuses = statuses;
    results.outputSample = output.slice(-3);

    try { await manager.stop(); } catch { /* best effort */ }
    manager.dispose?.();
    return finish(0);
}

function finish(code) {
    results.finishedAt = new Date().toISOString();
    results.passed = results.steps.filter(s => s.ok).length;
    results.total = results.steps.length;
    results.log = log.slice(-80);
    mkdirSync(RESULTS_DIR, { recursive: true });
    const file = join(RESULTS_DIR, `out-of-host-${OFFLINE ? 'offline' : 'live'}.json`);
    writeFileSync(file, JSON.stringify(results, null, 2));
    console.log(`\n${results.passed}/${results.total} steps passed → ${file}`);
    process.exit(code);
}

main().catch(e => {
    console.error('SPIKE CRASHED:', e);
    step('crash', false, e?.message);
    finish(1);
});
