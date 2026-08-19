#!/usr/bin/env node
/**
 * Spike (IN-3, Cycle 0): does `onPreToolUse` returning `permissionDecision: 'allow'`
 * suppress `onPermissionRequest`?
 *
 * Why this must be answered before any production code: `getSessionHooks()` installs
 * an `onPreToolUse` hook that returns `{ permissionDecision: 'allow' }` unconditionally
 * at every one of the twelve session-creation sites in `sdkSessionManager.ts`. The SDK
 * drops a `permission.requested` event on the floor when it carries `resolvedByHook: true`
 * (`session.ts:505`). If the CLI sets that flag in response to a hook `allow`, then our
 * permission handler never runs and forwarding to `session/request_permission` is dead
 * on arrival — no amount of correct mapping code would help.
 *
 * Nothing in either SDK's source settles what the CLI does with it, so this probes the
 * real CLI. It talks to the SDK DIRECTLY — no extension, no manager, no webview — so the
 * only variable is the hook.
 *
 * Three runs, same prompt, same session config except for the one thing under test:
 *
 *   A. hook returns 'allow'  — the shape `sdkSessionManager.ts` ships today
 *   B. no hooks at all       — the control; proves the prompt does raise a permission
 *   C. hook returns 'ask'    — the candidate fix, if A turns out to suppress
 *
 * Each run records every `onPermissionRequest` invocation and every `permission.requested`
 * event seen on the raw event stream (including its `resolvedByHook` flag), so we can tell
 * "the CLI never asked" apart from "the CLI asked and the SDK filtered it".
 *
 * Usage:  node planning/spikes/acp-agent/spike-permission-hook.mjs
 * Requires: live Copilot auth (~/.copilot), Node 24+.
 */

import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const RESULTS_DIR = join(__dirname, 'results');
const require = createRequire(import.meta.url);

// The prompt has to force a tool the CLI actually gates. `shell` is the one variant
// guaranteed to be permission-checked, and `echo` is inert.
const MARKER = 'hook-spike-proof-of-life';
const PROMPT =
    `Run this exact shell command and nothing else: echo ${MARKER}. ` +
    `Do not read any files. Do not explore the repository. Call no other tool.`;

const TURN_TIMEOUT_MS = 90_000;

function resolveCliPath() {
    const platformPkg = `@github/copilot-${process.platform}-${process.arch}`;
    const candidates = [
        join(REPO_ROOT, 'node_modules', platformPkg, 'copilot'),
        join(REPO_ROOT, 'node_modules', platformPkg, 'app.js'),
        join(REPO_ROOT, 'node_modules/@github/copilot/npm-loader.js')
    ];
    return candidates.find(p => existsSync(p));
}

/**
 * One run. `hooks` is passed to `createSession` verbatim (or omitted when null).
 */
async function runCase({ name, hooks, sdk, cliPath }) {
    const permissionHandlerCalls = [];
    const permissionEvents = [];
    const toolEvents = [];

    const client = new sdk.CopilotClient({
        logLevel: 'error',
        // No `--yolo`: the flag would bypass the very check we are probing.
        connection: { kind: 'stdio', path: cliPath, args: [] },
        workingDirectory: REPO_ROOT
    });
    await client.start();

    let session;
    try {
        const config = {
            clientName: 'acp-permission-hook-spike',
            streaming: true,
            onPermissionRequest: async (request) => {
                permissionHandlerCalls.push({ kind: request?.kind, request });
                // Approve so the turn can finish; we are measuring whether we were
                // asked, not what we answer.
                return { kind: 'approve-once' };
            }
        };
        if (hooks) {
            config.hooks = hooks;
        }
        session = await client.createSession(config);

        // Watch the RAW event stream too. `onPermissionRequest` firing tells us the
        // SDK dispatched; the raw event tells us whether the CLI asked at all and
        // what it set `resolvedByHook` to. Only both together distinguish the cases.
        session.on('permission.requested', (event) => {
            permissionEvents.push({
                resolvedByHook: event?.data?.resolvedByHook ?? false,
                kind: event?.data?.permissionRequest?.kind
            });
        });
        session.on('tool.execution_start', (event) => toolEvents.push(event?.data?.toolName ?? '?'));

        // Explicit timeout: sendAndWait defaults to 60s and REJECTS on expiry, which
        // would read as a crash rather than as the hang we care about.
        const turn = session.sendAndWait({ prompt: PROMPT }, TURN_TIMEOUT_MS);
        const timedOut = Symbol('timeout');
        const outcome = await Promise.race([
            turn.then(() => 'completed'),
            new Promise(r => setTimeout(() => r(timedOut), TURN_TIMEOUT_MS))
        ]);
        if (outcome === timedOut) {
            return { name, error: `turn did not finish within ${TURN_TIMEOUT_MS}ms`, permissionHandlerCalls, permissionEvents, toolEvents };
        }
    } catch (e) {
        return { name, error: e?.message ?? String(e), permissionHandlerCalls, permissionEvents, toolEvents };
    } finally {
        try { await session?.destroy(); } catch { /* best effort */ }
        try { await client.stop?.(); } catch { /* best effort */ }
    }

    return {
        name,
        handlerFired: permissionHandlerCalls.length > 0,
        handlerCallCount: permissionHandlerCalls.length,
        permissionKinds: permissionHandlerCalls.map(c => c.kind),
        // The kind alone does not say whether the request is USABLE. A `hook`
        // request carries none of the shell/write detail a host needs to render a
        // meaningful prompt, so record the whole payload.
        permissionRequests: permissionHandlerCalls.map(c => c.request),
        rawPermissionEvents: permissionEvents,
        toolEvents
    };
}

async function main() {
    mkdirSync(RESULTS_DIR, { recursive: true });

    const cliPath = resolveCliPath();
    if (!cliPath) {
        console.error('❌ no Copilot CLI entry point found under node_modules');
        process.exit(1);
    }
    console.log(`CLI: ${cliPath}\n`);

    const sdk = await import('@github/copilot-sdk');

    const allowHook = { onPreToolUse: () => ({ permissionDecision: 'allow' }) };
    const askHook = { onPreToolUse: () => ({ permissionDecision: 'ask' }) };
    // The hook exists for its SIDE EFFECT (file snapshots), not for its decision.
    // These two ask whether the side effect can be kept while the decision is
    // withheld — the only shape that would preserve the native request variants.
    const silentHook = { onPreToolUse: () => ({}) };
    const voidHook = { onPreToolUse: () => { /* snapshot only */ } };

    const cases = [
        { name: "B. control — no hooks", hooks: null },
        { name: "A. onPreToolUse → 'allow' (what we ship today)", hooks: allowHook },
        { name: "C. onPreToolUse → 'ask'", hooks: askHook },
        { name: "D. onPreToolUse → {} (no decision)", hooks: silentHook },
        { name: "E. onPreToolUse → undefined (no return)", hooks: voidHook }
    ];

    const results = { startedAt: new Date().toISOString(), cliPath, prompt: PROMPT, cases: [] };
    for (const c of cases) {
        console.log(`── ${c.name}`);
        const r = await runCase({ ...c, sdk, cliPath });
        results.cases.push(r);
        if (r.error) {
            console.log(`   ⚠️  ${r.error}`);
        }
        console.log(`   handler fired: ${r.handlerFired ? 'YES' : 'no'} (${r.handlerCallCount ?? 0} calls${r.permissionKinds?.length ? `: ${r.permissionKinds.join(', ')}` : ''})`);
        console.log(`   raw permission.requested: ${JSON.stringify(r.rawPermissionEvents)}`);
        console.log(`   tools: ${JSON.stringify(r.toolEvents)}\n`);
    }

    const control = results.cases.find(c => c.name.startsWith('B'));
    const shipped = results.cases.find(c => c.name.startsWith('A'));
    const candidate = results.cases.find(c => c.name.startsWith('C'));
    const silent = results.cases.find(c => c.name.startsWith('D'));
    const voided = results.cases.find(c => c.name.startsWith('E'));

    // A request is only useful if it arrives with the SAME variant the control saw.
    // `hook` requests carry no command text, path or diff, so forwarding one gives
    // the host nothing to show a user — which is the whole point of forwarding.
    const controlKind = control?.permissionKinds?.[0];
    const preservesVariant = c => c?.handlerFired && c.permissionKinds?.[0] === controlKind;
    results.controlKind = controlKind;
    results.variantPreserved = {
        A: preservesVariant(shipped), C: preservesVariant(candidate),
        D: preservesVariant(silent), E: preservesVariant(voided)
    };

    // The verdict only means something if the control asked. If it did not, the
    // prompt failed to trigger a gated tool and the run proves nothing either way.
    if (!control?.handlerFired) {
        results.verdict = 'INCONCLUSIVE — the control run raised no permission at all; the prompt did not reach a gated tool.';
    } else if (shipped?.handlerFired) {
        results.verdict = "NO SUPPRESSION — onPreToolUse 'allow' leaves onPermissionRequest firing. No change needed to getSessionHooks().";
    } else {
        const survivors = ['C', 'D', 'E'].filter(k => results.variantPreserved[k]);
        results.verdict = survivors.length
            ? `SUPPRESSED — 'allow' hides the request. Case(s) ${survivors.join('/')} restore it with the native '${controlKind}' variant intact; use the earliest of those.`
            : "SUPPRESSED, AND NO HOOK SHAPE RESTORES THE NATIVE VARIANT — the hook must be withheld entirely when a forwarding requester is installed.";
    }

    console.log(`VERDICT: ${results.verdict}`);
    results.finishedAt = new Date().toISOString();
    const file = join(RESULTS_DIR, 'permission-hook.json');
    writeFileSync(file, JSON.stringify(results, null, 2));
    console.log(`\n→ ${file}`);
}

main().catch(e => {
    console.error('SPIKE CRASHED:', e);
    process.exit(1);
});
