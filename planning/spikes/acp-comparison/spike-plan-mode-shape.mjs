#!/usr/bin/env node
/**
 * Spike: is upstream's ACP "Plan" mode a SECOND SESSION, or tool limits on one?
 *
 * `copilot --acp` advertises a Plan mode, which made our dual-session plan mode look
 * like a duplicate. But advertising a mode and running a second session are different
 * claims, and only the first was measured. Ours creates a real second SDK session at
 * `<id>-plan`, writes `plan.md` into the WORK session's directory, and supports
 * accept/reject with rollback.
 *
 * Measured on disk, not from the protocol:
 *   - does a second session directory appear when plan mode is entered?
 *   - does the session id the agent reports change?
 *   - does a plan.md appear anywhere?
 *   - which tools does it actually call while in plan mode?
 */

import { spawn } from 'node:child_process';
import { readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../../..');
const STATE = join(homedir(), '.copilot', 'session-state');
const CLI = join(REPO, 'node_modules/@github/copilot-linux-x64/copilot');
const PLAN_MODE = 'https://agentclientprotocol.com/protocol/session-modes#plan';

const snapshot = () => new Set(readdirSync(STATE));
const child = spawn(CLI, ['--acp'], { stdio: ['pipe', 'pipe', 'pipe'], cwd: REPO });
const pending = new Map();
const updates = [];
let nextId = 1, buf = '';

child.stdout.on('data', c => {
    buf += c.toString();
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
        if (!line.trim()) { continue; }
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id !== undefined && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m); }
        else if (m.method === 'session/update') { updates.push(m.params); }
        else if (m.method === 'session/request_permission' && m.id !== undefined) {
            const allow = (m.params?.options ?? []).find(o => o.kind === 'allow_once');
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { outcome: { outcome: 'selected', optionId: allow?.optionId } } }) + '\n');
        }
    }
});
const req = (method, params, ms = 120_000) => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise(r => { pending.set(id, { resolve: r }); setTimeout(() => { if (pending.delete(id)) { r({ error: { message: 'timeout' } }); } }, ms); });
};
const toolNames = from => updates.slice(from)
    .filter(u => u?.update?.sessionUpdate === 'tool_call')
    .map(u => u.update.title ?? u.update.rawInput?.name ?? '?');

const out = {};
async function main() {
    await req('initialize', { protocolVersion: 1, clientCapabilities: {} });

    const before = snapshot();
    const s = await req('session/new', { cwd: REPO, mcpServers: [] });
    const sessionId = s?.result?.sessionId;
    const afterNew = snapshot();
    out.sessionId = sessionId;
    out.dirsCreatedByNew = [...afterNew].filter(d => !before.has(d));

    const setMode = await req('session/set_mode', { sessionId, modeId: PLAN_MODE });
    out.setMode = setMode?.error ? `ERROR ${setMode.error.message}` : 'accepted';

    const afterMode = snapshot();
    out.dirsCreatedByEnteringPlanMode = [...afterMode].filter(d => !afterNew.has(d));

    const mark = updates.length;
    await req('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: 'Make a short plan for tidying a repository. Do not change any files.' }]
    }, 180_000);

    const afterPrompt = snapshot();
    out.dirsCreatedByPlanPrompt = [...afterPrompt].filter(d => !afterMode.has(d));
    out.toolsCalledInPlanMode = toolNames(mark);
    out.updateVariantsInPlanMode = [...new Set(updates.slice(mark).map(u => u?.update?.sessionUpdate))];
    out.sessionIdStillSame = sessionId;
    out.planMdInSessionDir = existsSync(join(STATE, sessionId ?? 'x', 'plan.md'));
    out.filesInSessionDir = existsSync(join(STATE, sessionId ?? 'x'))
        ? readdirSync(join(STATE, sessionId ?? 'x')) : [];
    out.anyPlanSuffixDirs = [...afterPrompt].filter(d => d.endsWith('-plan')).length;

    console.log(JSON.stringify(out, null, 2));
    mkdirSync(join(__dirname, 'results'), { recursive: true });
    writeFileSync(join(__dirname, 'results', 'upstream-plan-mode.json'), JSON.stringify(out, null, 2));
    child.stdin.end(); child.kill(); process.exit(0);
}
main().catch(e => { console.error('CRASHED:', e); child.kill(); process.exit(1); });
