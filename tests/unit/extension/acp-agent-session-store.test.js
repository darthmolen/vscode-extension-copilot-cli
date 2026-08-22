/**
 * CopilotAcpAgent — `session/list`, `session/fork`, `session/delete` (IN-3 §4c.6).
 *
 * We had all three behaviours already (`SessionService.forkSession`, the session
 * store under `~/.copilot/session-state`); they were simply not reachable over the
 * protocol. This is the difference between "an ACP agent" and "our agent, over ACP".
 *
 * ## The capability bug this also fixes
 *
 * `sessionCapabilities` gates `list`, `delete`, `fork`, `resume` **and `close`** —
 * and we shipped `session/close` without advertising it. A capability-respecting host
 * would never have called it, so the leak it fixes was unreachable for exactly the
 * clients that behave best. The agent's own comment warns about the forward version
 * of this ("a capability we advertise is one the client will act on"); this is the
 * inverse, and it fails more quietly.
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

function makeBackend(id) {
    return {
        sessionId: id,
        currentModeId: 'work',
        order: [],
        onEvent: () => () => {},
        prompt: async () => ({ stopReason: 'end_turn' }),
        setMode: async () => {},
        setPermissionRequester() {},
        history: async () => [],
        async cancel() { this.order.push('cancel'); },
        async close() { this.order.push('close'); }
    };
}

function makeHarness(over = {}) {
    const calls = { list: [], fork: [], delete: [] };
    const made = [];
    const agent = new CopilotAcpAgent({
        logger: silentLogger,
        startSession: async () => { const b = makeBackend(`session-${made.length + 1}`); made.push(b); return b; },
        loadSession: async ({ sessionId }) => { const b = makeBackend(sessionId); made.push(b); return b; },
        listSessions: async params => { calls.list.push(params); return [
            { sessionId: 'older', cwd: '/w/one', title: 'Fix the parser', updatedAt: '2026-08-01T00:00:00.000Z' },
            { sessionId: 'newer', cwd: '/w/two' }
        ]; },
        forkSession: async params => { calls.fork.push(params); const b = makeBackend('forked-1'); made.push(b); return b; },
        deleteSession: async sessionId => { calls.delete.push(sessionId); },
        ...over
    });
    return { calls, made, agent, conn: acp.client().connect(agent.register(acp.agent())) };
}

const init = conn => conn.agent.request(acp.methods.agent.initialize,
    { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
const newSession = conn => conn.agent.request(acp.methods.agent.session.new, { cwd: REPO_ROOT, mcpServers: [] });
const list = (conn, params = {}) => conn.agent.request(acp.methods.agent.session.list, params);
const fork = (conn, sessionId) => conn.agent.request(acp.methods.agent.session.fork,
    { sessionId, cwd: REPO_ROOT, mcpServers: [] });
const del = (conn, sessionId) => conn.agent.request(acp.methods.agent.session.delete, { sessionId });
const prompt = (conn, sessionId) => conn.agent.request(acp.methods.agent.session.prompt, {
    sessionId, prompt: [{ type: 'text', text: 'hi' }]
});

describe('CopilotAcpAgent — advertising what it can do (IN-3 §4c.6)', function () {
    this.timeout(10000);

    /**
     * The one that was already broken. `session/close` shipped unadvertised, so the
     * resource release it performs was unreachable for any client that checks first.
     */
    it('advertises session/close, which it already implements', async () => {
        const res = await init(makeHarness().conn);

        expect(res.agentCapabilities.sessionCapabilities?.close).to.deep.equal({});
    });

    it('advertises list, fork and delete', async () => {
        const caps = (await init(makeHarness().conn)).agentCapabilities.sessionCapabilities;

        expect(caps?.list, 'list').to.deep.equal({});
        expect(caps?.fork, 'fork').to.deep.equal({});
        expect(caps?.delete, 'delete').to.deep.equal({});
    });

    /**
     * `session/resume` resumes WITHOUT replaying — a different method from
     * `session/load`, which we implement. Advertising it would have a host call
     * something we do not serve.
     */
    it('does not advertise session/resume, which it does not implement', async () => {
        const caps = (await init(makeHarness().conn)).agentCapabilities.sessionCapabilities;

        expect(caps?.resume ?? null).to.equal(null);
    });
});

describe('CopilotAcpAgent — session/list (IN-3 §4c.6)', function () {
    this.timeout(10000);

    it('reports the stored sessions', async () => {
        const res = await list(makeHarness().conn);

        expect(res.sessions.map(s => s.sessionId)).to.deep.equal(['older', 'newer']);
    });

    /** `cwd` is required on `SessionInfo`; a host groups by it. */
    it('reports each session with the directory it belongs to', async () => {
        const res = await list(makeHarness().conn);

        expect(res.sessions[0].cwd).to.equal('/w/one');
    });

    it('passes a cwd filter through rather than ignoring it', async () => {
        const h = makeHarness();

        await list(h.conn, { cwd: '/w/one' });

        expect(h.calls.list).to.deep.equal([{ cwd: '/w/one' }]);
    });

    it('carries a title and a timestamp where the store has them', async () => {
        const res = await list(makeHarness().conn);

        expect(res.sessions[0].title).to.equal('Fix the parser');
        expect(res.sessions[0].updatedAt).to.equal('2026-08-01T00:00:00.000Z');
    });

    /** No sessions is an answer, not a failure. */
    it('reports an empty store as an empty list', async () => {
        const h = makeHarness({ listSessions: async () => [] });

        expect((await list(h.conn)).sessions).to.deep.equal([]);
    });
});

describe('CopilotAcpAgent — session/fork (IN-3 §4c.6)', function () {
    this.timeout(10000);

    it('returns a new session id, not the one it forked from', async () => {
        const res = await fork(makeHarness().conn, 'source-a');

        expect(res.sessionId).to.equal('forked-1');
        expect(res.sessionId).to.not.equal('source-a');
    });

    it('tells the backend which session to fork', async () => {
        const h = makeHarness();

        await fork(h.conn, 'source-a');

        expect(h.calls.fork[0].sessionId).to.equal('source-a');
    });

    /**
     * A fork the client cannot then address is a session id handed out for nothing —
     * the same failure `session/new` guards against.
     */
    it('makes the fork addressable straight away', async () => {
        const h = makeHarness();

        const { sessionId } = await fork(h.conn, 'source-a');

        expect((await prompt(h.conn, sessionId)).stopReason).to.equal('end_turn');
    });

    it('reports the modes, as session/new does', async () => {
        const res = await fork(makeHarness().conn, 'source-a');

        expect(res.modes.currentModeId).to.equal('work');
        expect(res.modes.availableModes.map(m => m.id)).to.deep.equal(['work', 'plan']);
    });

    it('fails with a reason rather than a bare internal error', async () => {
        const h = makeHarness({ forkSession: async () => { throw new Error('source session not found'); } });

        let message = '';
        try { await fork(h.conn, 'nope'); } catch (e) { message = e.message ?? ''; }
        expect(message).to.include('source session not found');
    });
});

describe('CopilotAcpAgent — session/delete (IN-3 §4c.6)', function () {
    this.timeout(10000);

    it('deletes the session it was asked about', async () => {
        const h = makeHarness();

        await del(h.conn, 'older');

        expect(h.calls.delete).to.deep.equal(['older']);
    });

    /**
     * Deleting the store underneath a running session would leave a manager driving a
     * conversation whose history no longer exists. It gets shut down first, by the
     * same route `session/close` uses.
     */
    it('shuts a live session down before deleting its store', async () => {
        const h = makeHarness();
        const { sessionId } = await newSession(h.conn);

        await del(h.conn, sessionId);

        expect(h.made[0].order).to.deep.equal(['cancel', 'close']);
        expect(h.calls.delete).to.deep.equal([sessionId]);
    });

    it('forgets a deleted session, so it cannot be prompted afterwards', async () => {
        const h = makeHarness();
        const { sessionId } = await newSession(h.conn);

        await del(h.conn, sessionId);

        let rejected = false;
        try { await prompt(h.conn, sessionId); } catch { rejected = true; }
        expect(rejected, 'a deleted session still accepted a prompt').to.equal(true);
    });

    /** Deleting one that was never live is the ordinary case — nothing to shut down. */
    it('deletes a session that is not running', async () => {
        const h = makeHarness();

        await del(h.conn, 'never-opened');

        expect(h.calls.delete).to.deep.equal(['never-opened']);
    });

    /**
     * This one fails loudly on purpose, unlike `session/close`. Close is idempotent
     * because a client cannot know we released first; delete is destructive, and
     * reporting success for a deletion that did not happen would leave a host showing
     * a session the user believes is gone.
     */
    it('reports a failed deletion instead of claiming success', async () => {
        const h = makeHarness({ deleteSession: async () => { throw new Error('permission denied'); } });

        let message = '';
        try { await del(h.conn, 'older'); } catch (e) { message = e.message ?? ''; }
        expect(message).to.include('permission denied');
    });
});
