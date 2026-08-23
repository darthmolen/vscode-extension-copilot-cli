#!/usr/bin/env node
/**
 * Spike: what does `copilot --acp` offer, compared with our ACP agent?
 *
 * The ACP Registry already lists `github-copilot-cli` as `@github/copilot --acp`.
 * So before publishing our own entry, the honest question is what ours adds — and
 * the answer should come from probing both, not from arguing about architecture.
 *
 * This drives ANY ACP agent over stdio with the same battery of probes and prints a
 * profile: what it advertises, which methods it answers, what it streams, and whether
 * it asks permission. Point it at either agent and diff the two.
 *
 *   node spike-compare-upstream.mjs upstream   # copilot --acp
 *   node spike-compare-upstream.mjs ours       # our agent
 *
 * Hand-rolled NDJSON rather than the ACP SDK, deliberately: the SDK would normalise
 * away exactly the differences being measured — an unimplemented method should show
 * up as the error it really is, not as a typed absence.
 */

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../../..');
const WHICH = process.argv[2] ?? 'upstream';

const CLI = join(REPO, 'node_modules/@github/copilot-linux-x64/copilot');
const TARGETS = {
    upstream: { cmd: CLI, args: ['--acp'], label: 'copilot --acp (1.0.68)' },
    ours: {
        cmd: process.execPath,
        args: [join(REPO, 'out/acp/main.js'), '--cli-path', CLI],
        label: 'our ACP agent'
    }
};
const target = TARGETS[WHICH];
if (!target) { console.error(`unknown target: ${WHICH}`); process.exit(1); }
if (!existsSync(CLI)) { console.error('no CLI'); process.exit(1); }

const child = spawn(target.cmd, target.args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: REPO });
const pending = new Map();
const updates = [];
const permissions = [];
let nextId = 1, buf = '', stderr = '';

child.stderr.on('data', d => { stderr += d.toString(); });
child.stdout.on('data', chunk => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
        if (!line.trim()) { continue; }
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id !== undefined && pending.has(m.id)) {
            const { resolve } = pending.get(m.id);
            pending.delete(m.id);
            resolve(m);                                  // resolve with the WHOLE envelope,
        } else if (m.method === 'session/update') {      // so errors are visible rather than thrown
            updates.push(m.params);
        } else if (m.method === 'session/request_permission' && m.id !== undefined) {
            permissions.push(m.params);
            const allow = (m.params?.options ?? []).find(o => o.kind === 'allow_once');
            child.stdin.write(JSON.stringify({
                jsonrpc: '2.0', id: m.id,
                result: { outcome: { outcome: 'selected', optionId: allow?.optionId } }
            }) + '\n');
        }
    }
});

const req = (method, params, timeoutMs = 60_000) => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise(resolve => {
        pending.set(id, { resolve });
        setTimeout(() => { if (pending.delete(id)) { resolve({ error: { message: `timeout after ${timeoutMs}ms` } }); } }, timeoutMs);
    });
};

const supported = r => (r?.error ? `✗ ${String(r.error.message ?? r.error.code).slice(0, 60)}` : '✓ answered');
const profile = { target: target.label, methods: {}, advertised: {}, streamed: {}, permissions: 0 };

async function main() {
    // ── What does it advertise? ────────────────────────────────────
    const init = await req('initialize', { protocolVersion: 1, clientCapabilities: {} });
    profile.advertised = {
        protocolVersion: init?.result?.protocolVersion,
        agentInfo: init?.result?.agentInfo,
        authMethods: init?.result?.authMethods ?? null,
        agentCapabilities: init?.result?.agentCapabilities ?? null
    };
    profile.methods.initialize = supported(init);

    const s = await req('session/new', { cwd: REPO, mcpServers: [] });
    profile.methods['session/new'] = supported(s);
    const sessionId = s?.result?.sessionId;
    profile.advertised.modesOnNewSession = s?.result?.modes ?? null;

    if (!sessionId) { return finish(); }

    // ── What does it stream, and does it ask permission? ───────────
    const before = updates.length;
    await req('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: 'Run this exact shell command and nothing else: echo acp-compare' }]
    }, 120_000);
    const shellRun = updates.slice(before);
    profile.permissions = permissions.length;
    profile.permissionShape = permissions[0]
        ? { kind: permissions[0]?.toolCall?.kind, title: permissions[0]?.toolCall?.title,
            options: (permissions[0]?.options ?? []).map(o => o.kind) }
        : null;

    const mark = updates.length;
    await req('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: `Create a file acp-compare-${WHICH}.txt containing one line: hello. Then use your todo list tool to record two steps: "one", "two".` }]
    }, 180_000);
    const rest = updates.slice(mark);

    const all = [...shellRun, ...rest];
    const byVariant = {};
    for (const u of all) {
        const v = u?.update?.sessionUpdate ?? '?';
        byVariant[v] = (byVariant[v] ?? 0) + 1;
    }
    profile.streamed = byVariant;
    profile.streamed._diffContent = all.filter(u => u?.update?.content?.some?.(c => c?.type === 'diff')).length;

    // ── Which of the session-lifecycle methods does it answer? ─────
    profile.methods['session/set_mode'] = supported(await req('session/set_mode', { sessionId, modeId: 'plan' }, 60_000));
    profile.methods['session/list']     = supported(await req('session/list', {}, 60_000));
    profile.methods['session/load']     = supported(await req('session/load', { sessionId, cwd: REPO, mcpServers: [] }, 60_000));
    profile.methods['session/fork']     = supported(await req('session/fork', { sessionId, cwd: REPO, mcpServers: [] }, 60_000));
    profile.methods['session/close']    = supported(await req('session/close', { sessionId }, 60_000));

    finish();
}

function finish() {
    console.log(`\n══ ${profile.target} ══`);
    console.log('\nadvertised:');
    console.log('  agentInfo        :', JSON.stringify(profile.advertised.agentInfo));
    console.log('  authMethods      :', JSON.stringify(profile.advertised.authMethods));
    console.log('  agentCapabilities:', JSON.stringify(profile.advertised.agentCapabilities));
    console.log('  modes on new     :', JSON.stringify(profile.advertised.modesOnNewSession));
    console.log('\nmethods:');
    for (const [m, r] of Object.entries(profile.methods)) { console.log(`  ${m.padEnd(20)} ${r}`); }
    console.log('\nstreamed update variants:', JSON.stringify(profile.streamed));
    console.log('permission requests   :', profile.permissions);
    console.log('permission shape      :', JSON.stringify(profile.permissionShape));
    mkdirSync(join(__dirname, 'results'), { recursive: true });
    writeFileSync(join(__dirname, 'results', `${WHICH}.json`),
        JSON.stringify({ ...profile, stderrTail: stderr.split('\n').slice(-6) }, null, 2));
    child.stdin.end(); child.kill();
    process.exit(0);
}

main().catch(e => { console.error('CRASHED:', e); child.kill(); process.exit(1); });
