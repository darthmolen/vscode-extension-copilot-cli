/**
 * CopilotAcpAgent — `session/load` and `session/cancel` (IN-3)
 *
 * Completes the ticket's five-method surface: initialize, session/new,
 * session/load, session/prompt, session/cancel.
 *
 * `session/cancel` is a NOTIFICATION, not a request, and it is **not** free.
 * Verified against the SDK: with no `onNotification` handler registered, a cancel
 * is silently ignored — the prompt handler's `signal` never aborts and the turn
 * runs to completion returning `end_turn`. That is why the SDK's own example
 * (research/acp-sdk/src/examples/agent.ts:294) registers the notification and
 * manages its own AbortController rather than relying on `ctx.signal`.
 *
 * `session/load` resumes an EXISTING session by id, so it must NOT mint a new one.
 * Advertising `loadSession: true` is part of the feature: a client will not offer
 * to resume against an agent that says it cannot.
 */

import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import * as acp from '@agentclientprotocol/sdk';

const require = createRequire(import.meta.url);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const { CopilotAcpAgent } = require(join(REPO_ROOT, 'out', 'acp', 'CopilotAcpAgent.js'));

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeBackend(id) {
    return {
        sessionId: id,
        cancels: 0,
        currentModeId: 'work',
        onEvent: () => () => {},
        prompt: async () => ({ stopReason: 'end_turn' }),
        setMode: async () => {},
        async cancel() { this.cancels += 1; }
    };
}

function harness(over = {}) {
    const started = [];
    const loaded = [];
    const agent = new CopilotAcpAgent({
        logger: silentLogger,
        startSession: async params => {
            const b = makeBackend(`new-${started.length + 1}`);
            started.push({ params, backend: b });
            return b;
        },
        loadSession: async params => {
            const b = makeBackend(params.sessionId);
            loaded.push({ params, backend: b });
            return b;
        },
        ...over
    });
    return { started, loaded, agent, conn: acp.client().connect(agent.register(acp.agent())) };
}

const init = conn => conn.agent.request(acp.methods.agent.initialize,
    { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
const newSession = conn => conn.agent.request(acp.methods.agent.session.new,
    { cwd: REPO_ROOT, mcpServers: [] });
const loadSession = (conn, sessionId) => conn.agent.request(acp.methods.agent.session.load,
    { sessionId, cwd: REPO_ROOT, mcpServers: [] });
const cancel = (conn, sessionId) => conn.agent.notify(acp.methods.agent.session.cancel, { sessionId });

describe('CopilotAcpAgent — session/load (IN-3)', () => {
    let h;
    beforeEach(() => { h = harness(); });

    /** A client will not offer resume against an agent that says it cannot. */
    it('advertises loadSession now that it is implemented', async () => {
        const res = await init(h.conn);

        expect(res.agentCapabilities.loadSession).to.equal(true);
    });

    it('resumes the requested session rather than minting a new one', async () => {
        await loadSession(h.conn, 'existing-abc');

        expect(h.loaded, 'load did not reach the backend').to.have.lengthOf(1);
        expect(h.loaded[0].params.sessionId).to.equal('existing-abc');
        expect(h.started, 'load must not start a NEW session').to.be.empty;
    });

    it('makes a loaded session addressable, like a new one', async () => {
        await loadSession(h.conn, 'existing-abc');

        await cancel(h.conn, 'existing-abc');
        await new Promise(r => setTimeout(r, 30));

        expect(h.loaded[0].backend.cancels, 'loaded session was not routable').to.equal(1);
    });

    it('reports its modes, so a resumed session knows what it is in', async () => {
        const res = await loadSession(h.conn, 'existing-abc');

        expect(res.modes?.availableModes.map(m => m.id)).to.deep.equal(['work', 'plan']);
    });

    it('surfaces a session that cannot be resumed', async () => {
        const failing = harness({
            loadSession: async () => { throw new Error('session-state directory missing'); }
        });

        let error;
        try { await loadSession(failing.conn, 'gone'); } catch (e) { error = e; }

        expect(error, 'an unresumable session must not resolve').to.be.an('error');
        expect(String(error.message)).to.match(/session-state directory missing/);
    });
});

describe('CopilotAcpAgent — session/cancel (IN-3)', () => {
    let h;
    beforeEach(() => { h = harness(); });

    /**
     * The whole point. Without a registered notification handler the SDK drops the
     * cancel silently — verified — and the turn runs to completion.
     */
    it('cancels the addressed session', async () => {
        const { sessionId } = await newSession(h.conn);

        await cancel(h.conn, sessionId);
        await new Promise(r => setTimeout(r, 30));

        expect(h.started[0].backend.cancels, 'the cancel notification was dropped').to.equal(1);
    });

    it('routes cancel to its own session, not another live one', async () => {
        await newSession(h.conn);
        const b = await newSession(h.conn);

        await cancel(h.conn, b.sessionId);
        await new Promise(r => setTimeout(r, 30));

        expect(h.started[1].backend.cancels).to.equal(1);
        expect(h.started[0].backend.cancels, 'cancelled the wrong session').to.equal(0);
    });

    /**
     * A notification has no reply, so throwing at an unknown session id would
     * become an unhandled rejection in the agent process rather than an error the
     * client could see. Log and move on.
     */
    it('ignores a cancel for an unknown session instead of throwing', async () => {
        let threw = false;
        try {
            await cancel(h.conn, 'never-created');
            await new Promise(r => setTimeout(r, 30));
        } catch { threw = true; }

        expect(threw, 'a notification must not surface an error').to.equal(false);
    });
});
