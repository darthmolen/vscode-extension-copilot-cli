/**
 * CopilotAcpAgent — `session/new` (IN-3, walking skeleton cycle 3)
 *
 * The first point the agent owns state. ACP multiplexes: every request carries a
 * `sessionId` (`PromptRequest`, `CancelNotification`, `LoadSessionRequest`), so one
 * agent connection serves N sessions and something must route id → backend.
 *
 * Per spine S3 that backend is one `SDKSessionManager` per session. It is injected
 * here as `startSession`, so these tests spawn no CLI.
 *
 * The id is the BACKEND's session id, not one we mint. The SDK's own example
 * generates a random id (research/acp-sdk/src/examples/agent.ts:31) because it has
 * no durable session of its own; we do — sessions live in ~/.copilot/session-state
 * and `session/load` will need to resume by that id. Inventing a second identifier
 * would mean maintaining a mapping between two id spaces for no gain.
 *
 * Addressability — that both sessions stay individually reachable — is proven in
 * cycle 4, where `session/prompt` routes to the right backend. It is deliberately
 * not tested here: doing so would mean exposing the lookup publicly just to observe
 * it, which is the test-shaped-production-API smell.
 */

import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

import * as acp from '@agentclientprotocol/sdk';

const require = createRequire(import.meta.url);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const { CopilotAcpAgent } = require(join(REPO_ROOT, 'out', 'acp', 'CopilotAcpAgent.js'));

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** Records every backend the agent asked for, so routing is observable. */
function makeHarness(over = {}) {
    const started = [];
    const agent = new CopilotAcpAgent({
        logger: silentLogger,
        startSession: async params => {
            const backend = { sessionId: `session-${started.length + 1}`, params };
            started.push(backend);
            return backend;
        },
        ...over
    });
    return { started, agent, conn: acp.client().connect(agent.register(acp.agent())) };
}

const newSession = (conn, cwd = REPO_ROOT) =>
    conn.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] });

describe('CopilotAcpAgent — session/new (IN-3 cycle 3)', () => {
    let h;

    beforeEach(() => {
        h = makeHarness();
    });

    it('returns the id of the backend it started, not an invented one', async () => {
        const res = await newSession(h.conn);

        expect(h.started, 'no backend was started').to.have.lengthOf(1);
        expect(res.sessionId).to.equal(h.started[0].sessionId);
    });

    it('starts one backend per call, with distinct ids', async () => {
        const first = await newSession(h.conn);
        const second = await newSession(h.conn);

        expect(h.started, 'reused a backend instead of starting a second').to.have.lengthOf(2);
        expect(second.sessionId).to.not.equal(first.sessionId);
    });

    it("passes the client's cwd to the backend", async () => {
        const cwd = join(tmpdir(), 'some-other-workspace');

        await newSession(h.conn, cwd);

        expect(h.started[0].params.cwd).to.equal(cwd);
    });

    /**
     * `session/new` runs before `initialize` on the SDK's own convenience path
     * (buildSession().start()), so it must not depend on having been initialized —
     * the same invariant cycle 2 pins for capabilities, asserted here on the path
     * that actually reaches it first.
     */
    it('works when initialize was never called', async () => {
        const res = await newSession(h.conn);

        expect(res.sessionId).to.be.a('string').and.not.empty;
    });

    it('surfaces a backend that fails to start rather than returning a broken session', async () => {
        const failing = makeHarness({
            startSession: async () => { throw new Error('CLI failed to spawn'); }
        });

        let error;
        try {
            await newSession(failing.conn);
        } catch (e) {
            error = e;
        }

        expect(error, 'a failed start must not resolve').to.be.an('error');
        expect(String(error.message ?? error)).to.match(/CLI failed to spawn/);
    });
});
