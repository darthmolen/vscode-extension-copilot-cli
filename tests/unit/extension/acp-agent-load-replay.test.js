/**
 * CopilotAcpAgent — `session/load` replays the conversation (IN-3 §4c.1).
 *
 * `session/load` is defined as "resumes an existing session and **optionally replays
 * prior conversation history**" — it is the method that exists *because* it replays;
 * `session/resume` is the one that deliberately does not. Until now ours returned
 * modes and nothing else, so a host that loaded a session showed an empty transcript
 * while `~/.copilot/session-state/<id>/events.jsonl` held the whole conversation.
 *
 * The mechanism, from the SDK's own server test (`server-session-sse.test.ts:406`,
 * "routes session/load replay updates to session SSE and final response to connection
 * SSE"): the agent sends ordinary `session/update` notifications **during** the
 * request, then returns. There is no separate replay channel and no batch field on
 * the response.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import * as acp from '@agentclientprotocol/sdk';

const require = createRequire(import.meta.url);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const { CopilotAcpAgent } = require(join(REPO_ROOT, 'out', 'acp', 'CopilotAcpAgent.js'));

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeBackend(id, history) {
    return {
        sessionId: id,
        currentModeId: 'work',
        onEvent: () => () => {},
        prompt: async () => ({ stopReason: 'end_turn' }),
        setMode: async () => {},
        cancel: async () => {},
        setPermissionRequester() {},
        history: async () => history
    };
}

function makeHarness(backend) {
    const updates = [];
    const order = [];
    const agent = new CopilotAcpAgent({
        logger: silentLogger,
        startSession: async () => backend,
        loadSession: async () => backend
    });
    const client = acp.client().onNotification(acp.methods.client.session.update, ({ params }) => {
        updates.push(params);
        order.push('update');
    });
    return { updates, order, conn: client.connect(agent.register(acp.agent())) };
}

const load = (conn, sessionId) =>
    conn.agent.request(acp.methods.agent.session.load, { sessionId, cwd: REPO_ROOT, mcpServers: [] });

const textOf = u => u.update.content?.text;

describe('CopilotAcpAgent — session/load replay (IN-3 §4c.1)', function () {
    this.timeout(10000);

    it('replays each stored turn as a session/update', async () => {
        const h = makeHarness(makeBackend('s1', [
            { role: 'user', content: 'what is 2+2?' },
            { role: 'assistant', content: 'four' }
        ]));

        await load(h.conn, 's1');

        expect(h.updates.map(textOf)).to.deep.equal(['what is 2+2?', 'four']);
    });

    /**
     * A user turn replayed as `agent_message_chunk` would attribute the user's own
     * words to the agent — the transcript would read as the assistant talking to
     * itself. ACP has a distinct variant precisely so this cannot happen.
     */
    it('attributes each turn to whoever said it', async () => {
        const h = makeHarness(makeBackend('s1', [
            { role: 'user', content: 'q' },
            { role: 'assistant', content: 'a' }
        ]));

        await load(h.conn, 's1');

        expect(h.updates.map(u => u.update.sessionUpdate))
            .to.deep.equal(['user_message_chunk', 'agent_message_chunk']);
    });

    it('replays in the order the conversation happened', async () => {
        const h = makeHarness(makeBackend('s1', [
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'second' },
            { role: 'user', content: 'third' },
            { role: 'assistant', content: 'fourth' }
        ]));

        await load(h.conn, 's1');

        expect(h.updates.map(textOf)).to.deep.equal(['first', 'second', 'third', 'fourth']);
    });

    it('addresses every replayed update to the session being loaded', async () => {
        const h = makeHarness(makeBackend('s1', [{ role: 'user', content: 'q' }]));

        await load(h.conn, 's1');

        expect(h.updates).to.have.lengthOf(1);
        expect(h.updates.every(u => u.sessionId === 's1')).to.equal(true);
    });

    /**
     * The replay has to be finished before the response, not after. A host is
     * entitled to treat the response as "the session is ready", and updates arriving
     * afterwards would append to a transcript the user is already reading.
     */
    it('finishes replaying before it answers', async () => {
        const h = makeHarness(makeBackend('s1', [
            { role: 'user', content: 'q' },
            { role: 'assistant', content: 'a' }
        ]));

        await load(h.conn, 's1');
        h.order.push('response');

        expect(h.order).to.deep.equal(['update', 'update', 'response']);
    });

    it('still reports the modes, which is what it did before', async () => {
        const h = makeHarness(makeBackend('s1', [{ role: 'user', content: 'q' }]));

        const res = await load(h.conn, 's1');

        expect(res.modes.currentModeId).to.equal('work');
        expect(res.modes.availableModes.map(m => m.id)).to.deep.equal(['work', 'plan']);
    });

    /** A session with nothing in it is normal — a new session loaded before any turn. */
    it('loads a session with no history without complaint', async () => {
        const h = makeHarness(makeBackend('s1', []));

        const res = await load(h.conn, 's1');

        expect(h.updates).to.have.lengthOf(0);
        expect(res.modes.currentModeId).to.equal('work');
    });

    /**
     * History is read from disk, so it can fail. Failing the load over it would deny
     * the user a session that is otherwise perfectly usable — the transcript is worth
     * less than the session.
     */
    it('still opens the session when the history cannot be read', async () => {
        const backend = makeBackend('s1', []);
        backend.history = async () => { throw new Error('events.jsonl is unreadable'); };
        const h = makeHarness(backend);

        const res = await load(h.conn, 's1');

        expect(res.modes.currentModeId).to.equal('work');
    });
});
