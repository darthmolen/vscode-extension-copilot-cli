/**
 * serveOverStream — the agent on a real wire (IN-3)
 *
 * Everything before this drove the agent through `clientApp.connect(agentApp)`,
 * which skips the transport entirely. This is the first test where bytes are
 * actually framed, written and parsed.
 *
 * It uses in-memory streams rather than spawning a subprocess, so the *transport*
 * is real while the process boundary is not. That is deliberate: it makes the
 * NDJSON round trip a fast unit test, and leaves subprocess concerns (argv, cwd,
 * signals) to the spike that runs the real binary.
 *
 * What it is really guarding: that our agent speaks the framing the SDK expects
 * over a genuine byte stream — newline-delimited, no `Content-Length` — and that a
 * request in produces a response out.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { Readable, Writable } from 'stream';

import * as acp from '@agentclientprotocol/sdk';

const require = createRequire(import.meta.url);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const { serveOverStream } = require(join(REPO_ROOT, 'out', 'acp', 'serveOverStream.js'));
const { CopilotAcpAgent } = require(join(REPO_ROOT, 'out', 'acp', 'CopilotAcpAgent.js'));

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeAgent() {
    return new CopilotAcpAgent({
        logger: silentLogger,
        startSession: async ({ cwd }) => ({
            sessionId: 'wire-session-1',
            cwd,
            onEvent: () => () => {},
            prompt: async () => ({ stopReason: 'end_turn' }),
            setPermissionRequester() {},
            history: async () => [],
            close: async () => {}
        })
    });
}

/** Feed `lines` in, collect everything written out. */
async function roundTrip(agent, requests, settleMs = 200) {
    const written = [];
    const output = Writable.toWeb(new Writable({
        write(chunk, _enc, cb) { written.push(Buffer.from(chunk)); cb(); }
    }));
    const payload = requests.map(r => JSON.stringify(r)).join('\n') + '\n';
    const input = Readable.toWeb(Readable.from([Buffer.from(payload, 'utf8')]));

    serveOverStream(agent, { input, output, logger: silentLogger });
    await new Promise(r => setTimeout(r, settleMs));

    const raw = Buffer.concat(written).toString('utf8');
    return {
        raw,
        messages: raw.split('\n').filter(Boolean).map(l => JSON.parse(l))
    };
}

describe('serveOverStream (IN-3)', () => {
    it('answers an initialize request over the wire', async () => {
        const { messages } = await roundTrip(makeAgent(), [{
            jsonrpc: '2.0', id: 1, method: acp.methods.agent.initialize,
            params: { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} }
        }]);

        const reply = messages.find(m => m.id === 1);
        expect(reply, 'no reply to initialize').to.exist;
        expect(reply.result.protocolVersion).to.equal(acp.PROTOCOL_VERSION);
    });

    /**
     * The framing guard. ACP is newline-delimited; LSP-style `Content-Length`
     * headers are a different protocol and a natural thing to reach for.
     */
    it('frames responses as NDJSON, one JSON value per line', async () => {
        const { raw, messages } = await roundTrip(makeAgent(), [{
            jsonrpc: '2.0', id: 1, method: acp.methods.agent.initialize,
            params: { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} }
        }]);

        expect(raw, 'Content-Length framing is the wrong protocol').to.not.include('Content-Length');
        expect(raw.endsWith('\n'), 'each message must be newline-terminated').to.equal(true);
        expect(messages).to.have.lengthOf(1);
    });

    it('handles several requests arriving in one chunk', async () => {
        const cwd = join(tmpdir(), 'wire-workspace');
        const { messages } = await roundTrip(makeAgent(), [
            {
                jsonrpc: '2.0', id: 1, method: acp.methods.agent.initialize,
                params: { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} }
            },
            {
                jsonrpc: '2.0', id: 2, method: acp.methods.agent.session.new,
                params: { cwd, mcpServers: [] }
            }
        ]);

        expect(messages.map(m => m.id).sort()).to.deep.equal([1, 2]);
        expect(messages.find(m => m.id === 2).result.sessionId).to.equal('wire-session-1');
    });

    it('replies with a JSON-RPC error rather than dying on an unknown method', async () => {
        const { messages } = await roundTrip(makeAgent(), [{
            jsonrpc: '2.0', id: 7, method: 'session/does_not_exist', params: {}
        }]);

        const reply = messages.find(m => m.id === 7);
        expect(reply, 'an unknown method must still get a reply').to.exist;
        expect(reply.error, 'must be a JSON-RPC error, not a result').to.exist;
    });

    it('returns a connection the caller can close', async () => {
        const output = Writable.toWeb(new Writable({ write(_c, _e, cb) { cb(); } }));
        const input = Readable.toWeb(Readable.from([]));

        const connection = serveOverStream(makeAgent(), { input, output, logger: silentLogger });

        expect(connection, 'caller needs a handle to shut down cleanly').to.exist;
    });
});
