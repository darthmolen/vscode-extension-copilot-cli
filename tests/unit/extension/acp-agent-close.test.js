/**
 * CopilotAcpAgent — `session/close` (IN-3 §4c.2).
 *
 * The schema is unusually direct about this one: the agent "**must** cancel any
 * ongoing work related to the session (treat it as if `session/cancel` was called)
 * and then free up any resources associated with the session."
 *
 * Until now we did not implement it at all, so nothing was ever released. Each
 * session held a manager, an SDK session and a CLI-side conversation for the life of
 * the agent process — a long-running agent accumulating sessions it would never use
 * again is the difference between a process that idles and one that has to be
 * restarted.
 *
 * The ordering matters as much as the actions. Releasing a manager with a turn still
 * running tears the CLI session out from under work in flight; cancel comes first.
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

function makeHarness(backends) {
    const made = [];
    const agent = new CopilotAcpAgent({
        logger: silentLogger,
        startSession: async () => {
            const b = backends[made.length] ?? makeBackend(`session-${made.length + 1}`);
            made.push(b);
            return b;
        },
        loadSession: async ({ sessionId }) => {
            const b = makeBackend(sessionId);
            made.push(b);
            return b;
        }
    });
    return { made, agent, conn: acp.client().connect(agent.register(acp.agent())) };
}

const newSession = conn => conn.agent.request(acp.methods.agent.session.new, { cwd: REPO_ROOT, mcpServers: [] });
const close = (conn, sessionId) => conn.agent.request(acp.methods.agent.session.close, { sessionId });
const prompt = (conn, sessionId) => conn.agent.request(acp.methods.agent.session.prompt, {
    sessionId, prompt: [{ type: 'text', text: 'hi' }]
});

describe('CopilotAcpAgent — session/close (IN-3 §4c.2)', function () {
    this.timeout(10000);

    it('releases the session', async () => {
        const h = makeHarness([makeBackend('session-a')]);
        const { sessionId } = await newSession(h.conn);

        await close(h.conn, sessionId);

        expect(h.made[0].order).to.include('close');
    });

    /**
     * "Treat it as if `session/cancel` was called" — and before releasing, not after.
     * Freeing a manager with a turn in flight pulls the CLI session out from under
     * running work.
     */
    it('cancels in-flight work before releasing, in that order', async () => {
        const h = makeHarness([makeBackend('session-a')]);
        const { sessionId } = await newSession(h.conn);

        await close(h.conn, sessionId);

        expect(h.made[0].order).to.deep.equal(['cancel', 'close']);
    });

    /**
     * The leak this exists to stop. A closed session must stop being addressable, or
     * the map grows for the life of the process and every backend in it stays alive.
     */
    it('forgets the session, so a later request cannot reach it', async () => {
        const h = makeHarness([makeBackend('session-a')]);
        const { sessionId } = await newSession(h.conn);

        await close(h.conn, sessionId);

        let rejected = false;
        try { await prompt(h.conn, sessionId); } catch { rejected = true; }
        expect(rejected, 'a closed session still accepted a prompt').to.equal(true);
    });

    it('leaves other sessions alone', async () => {
        const h = makeHarness([makeBackend('session-a'), makeBackend('session-b')]);
        const first = await newSession(h.conn);
        const second = await newSession(h.conn);

        await close(h.conn, first.sessionId);

        expect(h.made[1].order).to.deep.equal([]);
        const res = await prompt(h.conn, second.sessionId);
        expect(res.stopReason).to.equal('end_turn');
    });

    /**
     * Closing something already gone is a race, not a fault: a client cannot know the
     * agent released it first. Erroring would turn ordinary shutdown into noise.
     */
    it('accepts a close for a session it does not have', async () => {
        const h = makeHarness([]);

        const res = await close(h.conn, 'never-existed');

        expect(res).to.deep.equal({});
    });

    /** Closing twice is the same race seen from the client's side. */
    it('accepts a second close of the same session', async () => {
        const h = makeHarness([makeBackend('session-a')]);
        const { sessionId } = await newSession(h.conn);

        await close(h.conn, sessionId);
        const res = await close(h.conn, sessionId);

        expect(res).to.deep.equal({});
        expect(h.made[0].order).to.deep.equal(['cancel', 'close']);
    });

    /**
     * A backend that fails to shut down cleanly has still stopped being usable.
     * Keeping it addressable because its teardown threw would be the leak this
     * method exists to prevent, reintroduced by the error path.
     */
    it('forgets the session even when releasing it fails', async () => {
        const backend = makeBackend('session-a');
        backend.close = async () => { throw new Error('CLI already gone'); };
        const h = makeHarness([backend]);
        const { sessionId } = await newSession(h.conn);

        await close(h.conn, sessionId);

        let rejected = false;
        try { await prompt(h.conn, sessionId); } catch { rejected = true; }
        expect(rejected, 'a session that failed to close stayed addressable').to.equal(true);
    });
});
