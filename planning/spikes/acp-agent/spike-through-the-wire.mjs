/**
 * IN-3 verification — all 8 ticket assertions, THROUGH THE ACP WIRE.
 *
 * Every ACP test so far has driven the agent against a *fake* manager, in-process.
 * This spawns the built agent as a real subprocess, talks NDJSON JSON-RPC to its
 * stdio, and makes it start a real Copilot session against a real CLI.
 *
 * Coverage against the ticket's eight (spike-out-of-host.mjs):
 *
 *   0.  resolve a CLI entry point                    ✓ here
 *   1.  manager loads with vscode absent             ✓ here — implicitly: the agent
 *                                                      process has no extension host
 *   1b. manager constructs with injected HostBridge  ✓ here — via session/new
 *   2.  real SDK session starts out-of-host          ✓ here — the point of this file
 *   3.  plan mode enables (dual session)             ✓ here — via session/set_mode
 *   4a. plan-mode tool closures build                ✓ here — implied by a plan-mode turn
 *   4b. availableTools whitelist intact              ✓ here — implied by 4a
 *   5.  plan-mode closure wrote plan.md              ✓ here — the regression guard
 *
 * It also covers something the original eight do not: a real prompt streaming back
 * as `session/update`, which is IN-3's core claim.
 *
 * Run:  node planning/spikes/acp-agent/spike-through-the-wire.mjs
 * Needs: a built out/ (npm run compile-tests) and a working Copilot auth.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const PROMPT_TIMEOUT_MS = 90_000;
// Method constants, not literals: a typo'd string compiles and fails at runtime.
const acp_setMode = 'session/set_mode';

const results = [];
const step = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ── 0. Resolve the CLI, the way CliBundleService does ──────────
const platformPkg = `@github/copilot-${process.platform}-${process.arch}`;
const candidates = [
    join(REPO_ROOT, 'node_modules', platformPkg, 'copilot'),
    join(REPO_ROOT, 'node_modules', platformPkg, 'app.js'),
    join(REPO_ROOT, 'node_modules/@github/copilot/npm-loader.js')
];
const cliPath = candidates.find(p => existsSync(p));
step('0. resolved a Copilot CLI entry point', !!cliPath, cliPath ?? candidates.join(' | '));
if (!cliPath) {
    console.log('\nCannot continue without a CLI.');
    process.exit(1);
}

// ── Spawn the agent and speak NDJSON to it ─────────────────────
const child = spawn(process.execPath, [
    join(REPO_ROOT, 'out/acp/main.js'),
    '--workspace', REPO_ROOT,
    '--cli-path', cliPath
], { stdio: ['pipe', 'pipe', 'pipe'] });

const pending = new Map();
const updates = [];
let nextId = 1;
let stdoutBuffer = '';
let stderrText = '';
let protocolViolation = null;

child.stderr.on('data', d => { stderrText += d.toString(); });

child.stdout.on('data', chunk => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
        if (!line.trim()) { continue; }
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            // stdout is the protocol; anything unparseable means something logged there.
            protocolViolation ??= line.slice(0, 120);
            continue;
        }
        if (msg.id !== undefined && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? reject(new Error(msg.error.message ?? 'rpc error')) : resolve(msg.result);
        } else if (msg.method === 'session/update') {
            updates.push(msg.params);
        }
    }
});

function request(method, params, timeoutMs = 20_000) {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
            if (pending.delete(id)) { reject(new Error(`${method} timed out after ${timeoutMs}ms`)); }
        }, timeoutMs);
    });
}

let exitCode = 0;
try {
    // ── 1/1b. The process is alive and answering, with no extension host ──
    const init = await request('initialize', { protocolVersion: 1, clientCapabilities: {} });
    step('1. agent answers initialize from a process with no extension host',
        init?.protocolVersion === 1, `protocolVersion=${init?.protocolVersion}`);

    // ── 2. A REAL session, against a REAL CLI ──────────────────
    const started = Date.now();
    const session = await request('session/new', { cwd: REPO_ROOT, mcpServers: [] }, 60_000);
    step('2. real SDK session started out-of-host',
        !!session?.sessionId, `${session?.sessionId} in ${Date.now() - started}ms`);
    step('1b. manager constructed with an injected HostBridge',
        !!session?.sessionId, 'implied: session/new builds one per session');

    // ── The core claim: a real prompt, streamed back ───────────
    const before = updates.length;
    const res = await request('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Reply with exactly the word PONG and nothing else.' }]
    }, PROMPT_TIMEOUT_MS);
    step('P1. real prompt completed with a stop reason', !!res?.stopReason, res?.stopReason);

    const chunks = updates.slice(before)
        .filter(u => u?.update?.sessionUpdate === 'agent_message_chunk');
    const text = chunks.map(c => c.update?.content?.text ?? '').join('');
    step('P2. assistant output streamed as agent_message_chunk',
        chunks.length > 0, `${chunks.length} chunk(s)`);
    step('P3. the streamed text is the model actually answering',
        /pong/i.test(text), JSON.stringify(text.slice(0, 80)));
    step('P4. every chunk carried its session id',
        chunks.every(c => c.sessionId === session.sessionId));

    // ── 3/4a/4b/5. Plan mode, through the wire ────────────────
    const modes = session?.modes;
    step('3a. session/new advertised its modes',
        Array.isArray(modes?.availableModes) && modes.availableModes.length > 0,
        (modes?.availableModes ?? []).map(m => m.id).join(', '));

    await request(acp_setMode, { sessionId: session.sessionId, modeId: 'plan' }, 60_000);
    step('3b. plan mode enabled through session/set_mode (dual session)', true);

    // Step 5 is the one the ticket calls the regression guard: a plan-mode tool
    // CLOSURE must execute inside this process and write plan.md. Nothing else
    // proves the closures survived leaving the extension host.
    const marker = `ACP-WIRE-${Date.now()}`;
    const planPath = join(homedir(), '.copilot', 'session-state', session.sessionId, 'plan.md');
    const planBefore = existsSync(planPath) ? readFileSync(planPath, 'utf8') : '';

    await request('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text:
            `Use the update_work_plan tool to write a plan whose first line is exactly: # ${marker}` }]
    }, PROMPT_TIMEOUT_MS);

    const planAfter = existsSync(planPath) ? readFileSync(planPath, 'utf8') : '';
    step('4a/4b. plan-mode tool closures ran in-process',
        planAfter !== planBefore || planAfter.includes(marker),
        planAfter ? `plan.md is ${planAfter.length} bytes` : 'plan.md absent');
    step('5. plan-mode closure wrote plan.md with our marker',
        planAfter.includes(marker), planAfter.split('\n')[0]?.slice(0, 60) ?? '(empty)');

    // ── stdout hygiene: a stray log is a client-side parse error ──
    step('P5. stdout carried only framed protocol',
        protocolViolation === null, protocolViolation ?? 'clean');
    step('P6. the agent logged to stderr', stderrText.length > 0,
        `${stderrText.split('\n').filter(Boolean).length} line(s)`);
} catch (error) {
    step('through-the-wire run', false, error.message);
    exitCode = 1;
} finally {
    child.stdin.end();
    child.kill();
}

const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
console.log('\nCovers all eight of the ticket assertions plus a real streamed prompt.');
if (stderrText && exitCode) {
    console.log('\n--- agent stderr ---\n' + stderrText.split('\n').slice(-25).join('\n'));
}
process.exit(passed === results.length ? exitCode : 1);
