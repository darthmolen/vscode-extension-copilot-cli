/**
 * CopilotAcpAgent — `session/set_mode` (IN-3)
 *
 * The method that unblocks the ticket's plan-mode assertions (3, 4a, 4b, 5),
 * including the plan.md write it calls "the regression guard that matters".
 *
 * ACP's mode model is two halves and both must be right:
 *   - `session/new` ADVERTISES what modes exist, as a `SessionModeState`
 *     (`{ currentModeId, availableModes }`). A client cannot offer a mode it was
 *     never told about, so an agent that implements set_mode but advertises
 *     nothing is unreachable through any real host.
 *   - `session/set_mode` switches, routed by sessionId like every other request.
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
        modeCalls: [],
        currentModeId: 'work',
        onEvent: () => () => {},
        prompt: async () => ({ stopReason: 'end_turn' }),
        async setMode(modeId) {
            if (modeId === 'turbo') { throw new Error(`unknown mode: ${modeId}`); }
            this.modeCalls.push(modeId);
            this.currentModeId = modeId;
        }
    };
}

function harness() {
    const made = [];
    const agent = new CopilotAcpAgent({
        logger: silentLogger,
        startSession: async () => {
            const b = makeBackend(`session-${made.length + 1}`);
            made.push(b);
            return b;
        }
    });
    return { made, conn: acp.client().connect(agent.register(acp.agent())) };
}

const newSession = conn =>
    conn.agent.request(acp.methods.agent.session.new, { cwd: REPO_ROOT, mcpServers: [] });
const setMode = (conn, sessionId, modeId) =>
    conn.agent.request(acp.methods.agent.session.setMode, { sessionId, modeId });

describe('CopilotAcpAgent — session/set_mode (IN-3)', () => {
    let h;

    beforeEach(() => { h = harness(); });

    /**
     * Without this, set_mode is dead code: a host renders the modes a session
     * advertises, so unadvertised modes can never be chosen.
     */
    it('advertises its modes on session/new', async () => {
        const res = await newSession(h.conn);

        expect(res.modes, 'session/new must carry a SessionModeState').to.be.an('object');
        expect(res.modes.currentModeId).to.equal('work');
        expect(res.modes.availableModes.map(m => m.id)).to.deep.equal(['work', 'plan']);
    });

    it('gives every advertised mode a human-facing name', async () => {
        const res = await newSession(h.conn);

        for (const mode of res.modes.availableModes) {
            expect(mode.name, `mode ${mode.id} has no name for a host to render`)
                .to.be.a('string').and.not.empty;
        }
    });

    it('switches the addressed session into the requested mode', async () => {
        const { sessionId } = await newSession(h.conn);

        await setMode(h.conn, sessionId, 'plan');

        expect(h.made[0].modeCalls).to.deep.equal(['plan']);
    });

    it('routes set_mode to its own session, not another live one', async () => {
        await newSession(h.conn);
        const b = await newSession(h.conn);

        await setMode(h.conn, b.sessionId, 'plan');

        expect(h.made[1].modeCalls).to.deep.equal(['plan']);
        expect(h.made[0].modeCalls, 'switched the wrong session').to.be.empty;
    });

    it('rejects set_mode for a session that does not exist, naming it', async () => {
        let error;
        try { await setMode(h.conn, 'never-created', 'plan'); } catch (e) { error = e; }

        expect(error).to.be.an('error');
        expect(String(error.message)).to.include('never-created');
    });

    it('surfaces a mode the backend refuses rather than reporting success', async () => {
        const { sessionId } = await newSession(h.conn);

        let error;
        try { await setMode(h.conn, sessionId, 'turbo'); } catch (e) { error = e; }

        expect(error, 'an unknown mode must not resolve').to.be.an('error');
        expect(String(error.message)).to.include('turbo');
    });
});
