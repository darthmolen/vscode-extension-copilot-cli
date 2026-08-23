/**
 * IN-3 spike — can @agentclientprotocol/sdk serve the AGENT side for us?
 *
 * The IN-3 ticket assumed we hand-roll NDJSON JSON-RPC framing and reuse the
 * gotchas proven in tests/harness/acp-spike.mjs. But the protocol authors now
 * publish a zero-dependency TypeScript SDK (@agentclientprotocol/sdk, Apache-2.0)
 * whose agent half is exactly our surface. This spike decides whether scope
 * item 1 disappears.
 *
 * Five questions, none answerable from the README:
 *   1. Does `agent()` register initialize / newSession / prompt and connect?
 *   2. Does the in-process `connect(clientApp)` overload really avoid a transport?
 *      (If so it is our test seam — our agent checked by THEIR client.)
 *   3. Can the agent stream session/update notifications mid-prompt?
 *   4. Does NDJSON framing over real pipes still work (the shipped path)?
 *   5. Can an ESM agent consume our CJS-compiled SDKSessionManager from out/?
 *      This one gates the whole architecture: the SDK is "type": "module" and
 *      our extension compiles to CommonJS.
 *
 * Run: node planning/spikes/acp-agent/spike-acp-sdk-agent.mjs
 */

import * as acp from '@agentclientprotocol/sdk';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const results = [];
const step = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const PROTOCOL_VERSION = 1;

/** The smallest agent that can answer a prompt, plus a record of what it saw. */
function buildAgent(seen) {
    return acp
        .agent()
        .onRequest('initialize', ({ params }) => {
            seen.initialize = params;
            return {
                protocolVersion: PROTOCOL_VERSION,
                agentCapabilities: { loadSession: false }
            };
        })
        .onRequest('session/new', ({ params }) => {
            seen.newSession = params;
            return { sessionId: 'spike-session-1' };
        })
        // The handler receives { params, requestId, signal, client } — `client` is
        // the clientward caller, and `signal` is how session/cancel surfaces.
        .onRequest('session/prompt', async ({ params, signal, client }) => {
            seen.prompt = params;
            seen.hasAbortSignal = typeof signal?.aborted === 'boolean';
            // Stream one chunk before returning, the shape IN-3's event mapping needs.
            // `client` exposes request/notify, not typed per-method helpers.
            // There is no client.sessionUpdate(); notifications go through notify().
            await client.notify('session/update', {
                sessionId: params.sessionId,
                update: {
                    sessionUpdate: 'agent_message_chunk',
                    content: { type: 'text', text: 'hello from the spike agent' }
                }
            });
            return { stopReason: 'end_turn' };
        });
}

// ── 1-3. In-process agent ⇄ client ─────────────────────────────
async function inProcess() {
    const seen = {};
    const updates = [];

    const clientApp = acp.client().onNotification('session/update', ({ params }) => {
        updates.push(params);
    });

    const agentApp = buildAgent(seen);
    // The CLIENT drives, so connect from the client side. Agent-facing methods
    // live on `.agent` (a ClientContext); the AgentConnection returned by
    // agentApp.connect() is the mirror image, for calling clientward.
    const conn = clientApp.connect(agentApp);
    step('2. connect(agentApp) returns a connection with no transport', !!conn?.agent);

    try {
        const session = await conn.agent.buildSession(REPO).start();

        // NOT a bug — a contract we must not lean on. buildSession().start()
        // issues session/new only. A real client (Zed) sends initialize first,
        // but our agent must not require it to have run, or the SDK's own
        // shortcut path breaks us.
        step('1a. buildSession().start() does NOT send initialize',
            seen.initialize === undefined,
            'agent must not depend on initialize having run');
        step('1b. session/new reached the agent with our cwd',
            seen.newSession?.cwd === REPO, seen.newSession?.cwd);

        // initialize is reachable explicitly, which is what a real client does.
        const init = await conn.agent.request('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {}
        });
        step('1a2. initialize round-trips when sent explicitly',
            init?.protocolVersion === PROTOCOL_VERSION,
            `protocolVersion=${init?.protocolVersion}`);

        const res = await session.prompt('ping');
        step('1c. session/prompt returns a stopReason', !!res?.stopReason, res?.stopReason);
        step('1d. the handler gets an AbortSignal (how session/cancel arrives)',
            seen.hasAbortSignal === true);

        const chunk = updates.find(u => u?.update?.sessionUpdate === 'agent_message_chunk');
        step('3. agent streamed a session/update mid-prompt',
            !!chunk, chunk ? JSON.stringify(chunk.update.content) : `${updates.length} updates`);
    } catch (e) {
        step('1-3. in-process round trip', false, e.message);
    }
}

// ── 4. Real NDJSON framing over pipes ──────────────────────────
async function overNdjson() {
    try {
        const { Readable, Writable } = await import('node:stream');
        const chunks = [];

        // Agent writes here; we read what it produced.
        const sink = Writable.toWeb(new Writable({
            write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); }
        }));
        // A single initialize request, newline-delimited.
        const request = JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }
        }) + '\n';
        const source = Readable.toWeb(Readable.from([Buffer.from(request)]));

        const stream = acp.ndJsonStream(sink, source);
        step('4a. ndJsonStream builds a Stream', !!stream?.readable && !!stream?.writable);

        buildAgent({}).connect(stream);
        await new Promise(r => setTimeout(r, 300));

        const out = Buffer.concat(chunks).toString('utf8');
        const line = out.split('\n').filter(Boolean)[0];
        const parsed = line ? JSON.parse(line) : null;
        step('4b. agent answered over NDJSON framing',
            parsed?.id === 1 && parsed?.result?.protocolVersion === PROTOCOL_VERSION,
            line ? line.slice(0, 90) : '(no output)');
        step('4c. framing is newline-delimited, not Content-Length',
            !out.includes('Content-Length'));
    } catch (e) {
        step('4. NDJSON framing', false, e.message);
    }
}

// ── 5. ESM agent ⇄ our CJS-compiled manager ────────────────────
function cjsInterop() {
    try {
        const mod = require(join(REPO, 'out', 'sdkSessionManager.js'));
        step('5a. ESM agent can require() our CJS manager',
            typeof mod.SDKSessionManager === 'function');

        const provider = require(join(REPO, 'out', 'extension', 'services', 'CopilotClientProvider.js'));
        step('5b. and the S4 CopilotClientProvider',
            typeof provider.CopilotClientProvider === 'function');
    } catch (e) {
        step('5. CJS interop', false, e.message);
    }
}

console.log('IN-3 spike — @agentclientprotocol/sdk agent side\n');
// The package does not export ./package.json, so read it off disk.
const sdkVersion = require(join(REPO, 'node_modules/@agentclientprotocol/sdk/package.json')).version;
console.log(`sdk version: ${sdkVersion}\n`);
await inProcess();
console.log('');
await overNdjson();
console.log('');
cjsInterop();

const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
