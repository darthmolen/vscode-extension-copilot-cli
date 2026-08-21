/**
 * CopilotAcpAgent — `session/prompt` (IN-3, walking skeleton cycle 4)
 *
 * Closes the walking skeleton: a prompt goes in, assistant output comes back out
 * as `session/update` notifications, and the turn ends with a stop reason.
 *
 * Also where **addressability** is proven — cycle 3 deliberately left it out
 * rather than expose the session lookup publicly just to observe it. With two
 * sessions live, prompting one must reach that one's backend and no other.
 *
 * Method names come from `acp.methods`, never string literals: `notify()` has an
 * escape-hatch overload that makes a typo'd string compile clean, while a typo on
 * the constant is TS2551. See planning/spikes/acp-agent/FINDINGS-acp-sdk.md.
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

/**
 * A backend that records what it was asked and replays a scripted set of chunks,
 * so both directions of the mapping are observable without a CLI.
 */
function makeBackend(id, script = ['hello']) {
    const listeners = new Set();
    return {
        sessionId: id,
        prompts: [],
        onEvent(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        async prompt(text) {
            this.prompts.push(text);
            for (const chunk of script) {
                // The backend emits typed events now; the agent maps them.
                for (const l of listeners) { l({ kind: 'message', messageId: 'm1', deltaContent: chunk }); }
            }
            return { stopReason: 'end_turn' };
        },
        setMode: async () => {},
        cancel: async () => {},
        currentModeId: 'work',
        // The contract grew `history()` and `close()`; a fake without them leans on
        // the agent's error handling instead of exercising what these test.
        history: async () => [],
        close: async () => {},
        setPermissionRequester() {},
        listenerCount: () => listeners.size
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
        }
    });
    const updates = [];
    const client = acp.client().onNotification(acp.methods.client.session.update,
        ({ params }) => updates.push(params));
    return { made, updates, agent, conn: client.connect(agent.register(acp.agent())) };
}

const newSession = conn => conn.agent.request(acp.methods.agent.session.new, { cwd: REPO_ROOT, mcpServers: [] });
const prompt = (conn, sessionId, text) =>
    conn.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text }]
    });

describe('CopilotAcpAgent — session/prompt (IN-3 cycle 4)', () => {
    let h;

    beforeEach(() => {
        h = makeHarness([makeBackend('session-a'), makeBackend('session-b')]);
    });

    it('delivers the prompt text to the session backend', async () => {
        const { sessionId } = await newSession(h.conn);

        await prompt(h.conn, sessionId, 'what is 2+2?');

        expect(h.made[0].prompts).to.deep.equal(['what is 2+2?']);
    });

    it('streams assistant output back as agent_message_chunk updates', async () => {
        h = makeHarness([makeBackend('session-a', ['four', ', obviously'])]);
        const { sessionId } = await newSession(h.conn);

        await prompt(h.conn, sessionId, 'what is 2+2?');

        const chunks = h.updates.filter(u => u.update?.sessionUpdate === 'agent_message_chunk');
        expect(chunks.map(c => c.update.content.text)).to.deep.equal(['four', ', obviously']);
        expect(chunks[0].sessionId, 'chunks must carry the session they belong to').to.equal(sessionId);
    });

    it('returns the stop reason the backend ended with', async () => {
        const { sessionId } = await newSession(h.conn);

        const res = await prompt(h.conn, sessionId, 'hi');

        expect(res.stopReason).to.equal('end_turn');
    });

    /** The addressability proof cycle 3 deferred to here. */
    it('routes a prompt to its own session, not another live one', async () => {
        const a = await newSession(h.conn);
        const b = await newSession(h.conn);

        await prompt(h.conn, b.sessionId, 'for b only');

        expect(h.made[1].prompts, 'b did not receive its prompt').to.deep.equal(['for b only']);
        expect(h.made[0].prompts, 'a received a prompt meant for b').to.be.empty;
    });

    it('rejects a prompt for a session that does not exist', async () => {
        let error;
        try {
            await prompt(h.conn, 'never-created', 'hello');
        } catch (e) {
            error = e;
        }

        expect(error, 'an unknown session must not silently succeed').to.be.an('error');
        const message = String(error.message ?? error);
        // Naming the id is what distinguishes "we looked and it is not there" from
        // any other failure. Without this the test passed while session/prompt was
        // still unimplemented, because "Method not found: session/prompt" also
        // matches a loose /session/i.
        expect(message, 'the error must name the session it could not find').to.include('never-created');
    });

    /**
     * Subscribing per turn means unsubscribing per turn. A leak here is invisible
     * until a long session multiplies every chunk by the number of turns taken.
     */
    it('leaves no output subscription behind after the turn', async () => {
        const { sessionId } = await newSession(h.conn);

        await prompt(h.conn, sessionId, 'one');
        await prompt(h.conn, sessionId, 'two');

        expect(h.made[0].listenerCount(), 'subscriptions accumulated across turns').to.equal(0);
    });
});
