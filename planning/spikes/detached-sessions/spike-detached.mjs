#!/usr/bin/env node
/**
 * Spike: can a session be created already flagged as "detached", pointing at a parent?
 *
 * Asked by Lane B for P4 (work↔plan pairing). Our plan-mode design creates a second
 * SDK session at `<id>-plan`, and the ONLY thing that identifies it as a plan half is
 * that suffix — a naming convention now known to two files. The generated RPC schema
 * has what look like purpose-built fields for exactly this:
 *
 *   SessionOpenOptions.detachedFromSpawningParentSessionId   (a parent pointer)
 *   SessionsListRequest.includeDetached                      (hide-from-lists, default false)
 *   LocalSessionMetadataValue.isDetached                     (readable afterwards)
 *
 * Three questions, in the order that can end the matter soonest:
 *
 *   Q3  Is it reachable WITHOUT losing `createSessionWithModelFallback`?
 *       `client.createSession()` builds its `session.create` payload field by field
 *       with no `...config` spread, so an unknown field is dropped silently — read
 *       from client.ts, and re-checked here against the wire. `sessions.open` is a
 *       DIFFERENT RPC that returns only an id, so using it means a two-step:
 *       open-with-flag, then resume to get a wired session. This measures whether
 *       that two-step actually works.
 *   Q1  Does the CLI HONOUR the parent pointer, or merely accept it?
 *   Q2  Does `sessions.list` exclude it when `includeDetached` is false?
 *
 * Lane B has already established that this can only ever be an ADDITIONAL input for
 * sessions created after P4 — the `sessions.*` surface has no update/patch/setDetached,
 * so the ~200 plan halves already on disk can never be flagged. A green result here
 * does not remove the resolver; it only decides whether new sessions get a better
 * source and whether the dropdown gets `includeDetached: false` for free.
 *
 * Usage: node planning/spikes/detached-sessions/spike-detached.mjs
 * Requires: live Copilot auth, Node 24+.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');

const results = [];
const step = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
    return ok;
};
const note = (m) => console.log(`ℹ️  ${m}`);

function cliPath() {
    const p = `@github/copilot-${process.platform}-${process.arch}`;
    for (const c of [join(REPO_ROOT, 'node_modules', p, 'copilot'),
                     join(REPO_ROOT, 'node_modules/@github/copilot/npm-loader.js')]) {
        if (existsSync(c)) { return c; }
    }
    return null;
}

const sessionDir = id => join(homedir(), '.copilot', 'session-state', id);

async function main() {
    const path = cliPath();
    if (!path) { console.error('no CLI found'); process.exit(1); }

    const sdk = await import('@github/copilot-sdk');
    const client = new sdk.CopilotClient({
        logLevel: 'error',
        connection: { kind: 'stdio', path, args: [] },
        workingDirectory: REPO_ROOT
    });
    await client.start();

    let parentId = null;
    let detachedId = null;

    try {
        // A parent to point at. Ordinary createSession, so we also learn that the
        // normal path still works alongside whatever we do next.
        const parent = await client.createSession({
            clientName: 'detached-spike-parent', streaming: false,
            onPermissionRequest: () => ({ kind: 'approve-once' })
        });
        parentId = parent.sessionId;
        step('0. a parent session exists', !!parentId, parentId);

        // ── Q3a. Does the raw RPC accept the flag at all? ──────────────
        const rpc = client.rpc;
        step('Q3a. client exposes a raw rpc accessor', !!rpc?.sessions?.open,
            rpc?.sessions?.open ? 'rpc.sessions.open present' : 'ABSENT — Q3 ends here');

        if (rpc?.sessions?.open) {
            try {
                const opened = await rpc.sessions.open({
                    kind: 'create',
                    options: {
                        workingDirectory: REPO_ROOT,
                        detachedFromSpawningParentSessionId: parentId
                    }
                });
                detachedId = opened?.sessionId ?? opened?.id ?? null;
                step('Q3b. sessions.open accepted the parent pointer', !!detachedId,
                    detachedId ? `opened ${detachedId}` : JSON.stringify(opened).slice(0, 160));
            } catch (e) {
                step('Q3b. sessions.open accepted the parent pointer', false, e?.message?.slice(0, 200));
            }
        }

        // ── Q1. Is it HONOURED — does the flag come back? ──────────────
        if (detachedId) {
            try {
                const listed = await rpc.sessions.list({ includeDetached: true });
                const rows = listed?.sessions ?? listed?.metadata ?? listed ?? [];
                const mine = (Array.isArray(rows) ? rows : []).find(r => (r?.sessionId ?? r?.id) === detachedId);
                step('Q1a. the new session appears when detached are included', !!mine,
                    mine ? JSON.stringify(mine).slice(0, 180) : `not found among ${Array.isArray(rows) ? rows.length : '?'} rows`);
                step('Q1b. the CLI recorded it as detached', mine?.isDetached === true,
                    `isDetached=${JSON.stringify(mine?.isDetached)}`);
            } catch (e) {
                step('Q1a. the new session appears when detached are included', false, e?.message?.slice(0, 160));
            }

            // ── Q2. Is it hidden by default? ───────────────────────────
            try {
                const plain = await rpc.sessions.list({});
                const rows = plain?.sessions ?? plain?.metadata ?? plain ?? [];
                const present = (Array.isArray(rows) ? rows : []).some(r => (r?.sessionId ?? r?.id) === detachedId);
                step('Q2. sessions.list hides it by default (includeDetached omitted)', !present,
                    present ? 'STILL LISTED — the flag buys nothing for a picker' : 'excluded, as the schema implies');
            } catch (e) {
                step('Q2. sessions.list hides it by default (includeDetached omitted)', false, e?.message?.slice(0, 160));
            }

            // ── Q3c. THE COST QUESTION. Is the opened session usable? ──
            // sessions.open returns an id, not a wired CopilotSession. If it can be
            // resumed through the normal path, the two-step costs nothing and
            // createSessionWithModelFallback survives. If not, the whole idea is
            // priced at "rebuild the create path by hand" and the answer is no.
            try {
                const resumed = await client.resumeSession(detachedId, {
                    clientName: 'detached-spike-child', streaming: false,
                    onPermissionRequest: () => ({ kind: 'approve-once' })
                });
                step('Q3c. the detached session resumes through the normal path',
                    !!resumed?.sessionId, `resumed ${resumed?.sessionId}`);
                try { await resumed.destroy(); } catch { /* best effort */ }
            } catch (e) {
                step('Q3c. the detached session resumes through the normal path', false,
                    e?.message?.slice(0, 200));
            }

            step('Q3d. it exists on disk like any other session', existsSync(sessionDir(detachedId)),
                sessionDir(detachedId));
        }

        try { await parent.destroy(); } catch { /* best effort */ }
    } catch (e) {
        step('spike run', false, e?.message?.slice(0, 200));
    } finally {
        try { await client.stop(); } catch { /* best effort */ }
    }

    const passed = results.filter(r => r.ok).length;
    console.log(`\n${passed}/${results.length} checks passed`);
    note(`parent=${parentId} detached=${detachedId}`);
    mkdirSync(join(__dirname, 'results'), { recursive: true });
    writeFileSync(join(__dirname, 'results', 'detached.json'),
        JSON.stringify({ parentId, detachedId, results }, null, 2));
    process.exit(0);
}

main().catch(e => { console.error('SPIKE CRASHED:', e); process.exit(1); });
