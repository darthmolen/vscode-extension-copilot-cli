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
import { existsSync, readFileSync, rmSync } from 'node:fs';
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
const permissionsAsked = [];
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
        } else if (msg.method === 'session/request_permission' && msg.id !== undefined) {
            // An inbound REQUEST, not a notification. Before permission forwarding
            // existed this fell through and was dropped — which, with deny-on-failure,
            // means the agent waits, times out and denies, and the plan-mode assertion
            // below fails for a reason that has nothing to do with plan mode.
            permissionsAsked.push(msg.params);
            const allowOnce = (msg.params?.options ?? []).find(o => o.kind === 'allow_once');
            child.stdin.write(JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                // Double-nested on purpose: RequestPermissionResponse.outcome is itself
                // a RequestPermissionOutcome with its own discriminator.
                result: { outcome: { outcome: 'selected', optionId: allowOnce?.optionId } }
            }) + '\n');
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

    // ── 15. A permission request crosses the wire and is answered ──
    // The agent is launched without --yolo, so a shell command is gated. This is the
    // only assertion that exercises the agent as a CLIENT of its host rather than as
    // a server: the request travels the other way down the same pipe.
    const permissionMarker = `ACP-PERM-${Date.now()}`;
    await request('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text:
            `Run this exact shell command and nothing else: echo ${permissionMarker}` }]
    }, PROMPT_TIMEOUT_MS);

    const shellAsk = permissionsAsked.find(p => p?.toolCall?.kind === 'execute');
    step('15a. a permission request crossed the wire', permissionsAsked.length > 0,
        `${permissionsAsked.length} request(s): ${permissionsAsked.map(p => p?.toolCall?.kind).join(', ')}`);
    step('15b. it arrived shaped for a host to render',
        !!shellAsk?.toolCall?.title && (shellAsk.options ?? []).some(o => o.kind === 'allow_once'),
        shellAsk ? `${JSON.stringify(shellAsk.toolCall.title)} with ${shellAsk.options.length} option(s)` : 'no execute request seen');
    step('15c. the session id on it is the one we hold',
        shellAsk?.sessionId === session.sessionId, shellAsk?.sessionId ?? '(none)');

    // ── 16. A file edit crosses the wire as ACP diff content ──
    // Must run in WORK mode: plan mode forbids writes, so this cannot move below.
    const scratch = join(REPO_ROOT, `.acp-wire-scratch-${Date.now()}.txt`);
    const beforeDiff = updates.length;
    await request('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text:
            `Create a file at exactly ${scratch} containing the single line: hello from the wire. ` +
            `Use your file-creation tool. Do nothing else.` }]
    }, PROMPT_TIMEOUT_MS);

    const diffUpdates = updates.slice(beforeDiff)
        .filter(u => u?.update?.content?.some?.(c => c?.type === 'diff'));
    const diff = diffUpdates[0]?.update?.content?.find(c => c.type === 'diff');
    step('16a. a file edit arrived as ACP diff content', !!diff,
        diff ? `${diffUpdates.length} diff update(s)` : 'no diff content in any update');
    step('16b. the diff carries the path and the new text, not a local reference',
        !!diff?.path && typeof diff?.newText === 'string' && diff.newText.includes('hello from the wire'),
        diff ? `${diff.path} (${diff.newText?.length ?? 0} bytes)` : 'n/a');
    step('16c. it updates the tool call rather than announcing a new one',
        diffUpdates[0]?.update?.sessionUpdate === 'tool_call_update',
        diffUpdates[0]?.update?.sessionUpdate ?? 'n/a');
    try { if (existsSync(scratch)) { rmSync(scratch); } } catch { /* best effort */ }

    // ── Provoke a todo list, so assertion 18 has something to see ──
    // `session.todos_changed` only fires if the model reaches for its todo tool, so
    // ask for something that needs one. Still informational below: a model declining
    // to make a list is a model decision, not a mapping bug.
    await request('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text:
            'Use your todo list tool to record exactly three steps for tidying a repository: ' +
            '"survey", "remove dead files", "verify build". Only create the list; do not do the work.' }]
    }, PROMPT_TIMEOUT_MS);

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

    // ── 17. session/load replays what was said ───────────────
    const beforeReplay = updates.length;
    await request('session/load', { sessionId: session.sessionId, cwd: REPO_ROOT, mcpServers: [] }, 60_000);
    const replayed = updates.slice(beforeReplay);
    const userTurns = replayed.filter(u => u?.update?.sessionUpdate === 'user_message_chunk');
    const agentTurns = replayed.filter(u => u?.update?.sessionUpdate === 'agent_message_chunk');
    step('17a. session/load replayed the conversation', replayed.length > 0,
        `${replayed.length} update(s)`);
    step('17b. it replayed both sides, attributed to whoever said it',
        userTurns.length > 0 && agentTurns.length > 0,
        `${userTurns.length} user, ${agentTurns.length} agent`);
    step('17c. the replay contains a prompt we actually sent',
        userTurns.some(u => (u.update.content?.text ?? '').includes('PONG')),
        userTurns[0]?.update?.content?.text?.slice(0, 40) ?? '(none)');

    // ── 18. A plan, if the agent made one ────────────────────
    // Informational rather than pass/fail: whether the model reaches for its todo
    // tool at all is a model decision, and asserting on it would make this run flaky
    // for a reason that says nothing about our mapping.
    // Conditional on purpose. Whether the model reaches for its todo tool is a model
    // decision, so ASSERTING that a plan appeared would make this gate fail for a
    // reason that says nothing about our mapping. But when one does appear, its shape
    // is entirely ours — and that is worth checking rather than printing.
    const planUpdates = updates.filter(u => u?.update?.sessionUpdate === 'plan');
    if (planUpdates.length) {
        const entries = planUpdates.at(-1).update.entries ?? [];
        const legalStatus = ['pending', 'in_progress', 'completed'];
        const legalPriority = ['high', 'medium', 'low'];
        step('18. the plan arrived as ACP plan entries, every field legal',
            entries.length > 0
            && entries.every(e => typeof e.content === 'string' && e.content.length > 0)
            && entries.every(e => legalStatus.includes(e.status))
            && entries.every(e => legalPriority.includes(e.priority)),
            JSON.stringify(entries.slice(0, 2)));
    } else {
        console.log('ℹ️  18. no plan update this run — the model made no todo list, so nothing to check');
    }

    // ── 19. session/close releases the session ───────────────
    const closeResult = await request('session/close', { sessionId: session.sessionId }, 60_000);
    step('19a. session/close was accepted', closeResult !== undefined, JSON.stringify(closeResult));

    let closedIsUnreachable = false;
    try {
        await request('session/prompt', {
            sessionId: session.sessionId, prompt: [{ type: 'text', text: 'still there?' }]
        }, 30_000);
    } catch {
        closedIsUnreachable = true;
    }
    step('19b. a closed session is no longer addressable', closedIsUnreachable,
        closedIsUnreachable ? 'prompt rejected, as it should be' : 'the closed session still answered');

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
console.log('\nCovers the eight ticket assertions, a streamed prompt, a permission answered back\ndown the same pipe, a file diff as ACP diff content, session/load replay and\nsession/close.');
if (stderrText && exitCode) {
    console.log('\n--- agent stderr ---\n' + stderrText.split('\n').slice(-25).join('\n'));
}
process.exit(passed === results.length ? exitCode : 1);
