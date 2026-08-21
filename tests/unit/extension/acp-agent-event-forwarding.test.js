/**
 * CopilotAcpAgent — forwarding every emitter as session/update (IN-3 scope item 3)
 *
 * The mapper decides shapes; this proves the agent actually *sends* them, through
 * the protocol, to a real client.
 *
 * The backend exposes ONE subscription (`onEvent`) carrying a discriminated union
 * rather than a method per emitter. Sixteen `onX` methods would mean sixteen
 * subscriptions to unsubscribe in the right order at turn end, and the leak this
 * already has a test for would get sixteen times easier to introduce.
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

/** A backend that replays a scripted set of events during the turn. */
function makeBackend(id, script = []) {
    const listeners = new Set();
    return {
        sessionId: id,
        currentModeId: 'work',
        // The contract grew `history()` and `close()`; a fake without them leans on
        // the agent's error handling instead of exercising what these test.
        history: async () => [],
        close: async () => {},
        setPermissionRequester() {},
        setMode: async () => {},
        cancel: async () => {},
        onEvent(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        listenerCount: () => listeners.size,
        async prompt() {
            for (const e of script) { for (const l of [...listeners]) { l(e); } }
            return { stopReason: 'end_turn' };
        }
    };
}

function harness(script) {
    let backend;
    const agent = new CopilotAcpAgent({
        logger: silentLogger,
        startSession: async () => (backend = makeBackend('s1', script)),
        loadSession: async () => (backend = makeBackend('s1', script))
    });
    const updates = [];
    const client = acp.client().onNotification(acp.methods.client.session.update,
        ({ params }) => updates.push(params));
    const conn = client.connect(agent.register(acp.agent()));
    return { conn, updates, backend: () => backend };
}

const run = async script => {
    const h = harness(script);
    const { sessionId } = await h.conn.agent.request(acp.methods.agent.session.new,
        { cwd: REPO_ROOT, mcpServers: [] });
    await h.conn.agent.request(acp.methods.agent.session.prompt,
        { sessionId, prompt: [{ type: 'text', text: 'go' }] });
    return h;
};

const kinds = updates => updates.map(u => u.update.sessionUpdate);

describe('CopilotAcpAgent — event forwarding (IN-3)', () => {
    it('forwards assistant text as agent_message_chunk', async () => {
        const h = await run([{ kind: 'message', messageId: 'm1', deltaContent: 'hello' }]);

        expect(kinds(h.updates)).to.deep.equal(['agent_message_chunk']);
        expect(h.updates[0].update.content.text).to.equal('hello');
    });

    it('forwards reasoning as agent_thought_chunk', async () => {
        const h = await run([{ kind: 'reasoning', reasoningId: 'r1', deltaContent: 'hmm' }]);

        expect(kinds(h.updates)).to.deep.equal(['agent_thought_chunk']);
    });

    it('forwards tool lifecycle as tool_call then tool_call_update', async () => {
        const tool = { toolCallId: 't1', toolName: 'read_file', status: 'running', startTime: 1 };
        const h = await run([
            { kind: 'toolStart', tool },
            { kind: 'toolUpdate', tool: { ...tool, status: 'complete', result: 'ok' } }
        ]);

        expect(kinds(h.updates)).to.deep.equal(['tool_call', 'tool_call_update']);
        expect(h.updates[1].update.status).to.equal('completed');
    });

    /** The whole point of the _meta design: it reaches the client, on the envelope. */
    it('forwards sub-agent output tagged in the envelope _meta', async () => {
        const h = await run([{ kind: 'subagentMessage', agentId: 'task-7', content: 'from a sub-agent' }]);

        expect(kinds(h.updates)).to.deep.equal(['agent_message_chunk']);
        expect(h.updates[0]._meta, '_meta did not survive the wire').to.be.an('object');
        expect(JSON.stringify(h.updates[0]._meta)).to.include('task-7');
    });

    it('leaves main-transcript output untagged', async () => {
        const h = await run([{ kind: 'message', messageId: 'm1', deltaContent: 'hello' }]);

        expect(h.updates[0]._meta, 'ordinary output must not look like sub-agent traffic')
            .to.equal(undefined);
    });

    it('forwards sub-agent lifecycle so a dock can open and close a card', async () => {
        const h = await run([
            { kind: 'subagentStart', agentId: 'task-7', agentDisplayName: 'Explorer' },
            { kind: 'subagentComplete', agentId: 'task-7', status: 'complete' }
        ]);

        expect(h.updates).to.have.lengthOf(2);
        for (const u of h.updates) {
            expect(JSON.stringify(u._meta)).to.include('task-7');
        }
    });

    it('preserves ordering across mixed event kinds', async () => {
        const tool = { toolCallId: 't1', toolName: 'grep', status: 'running', startTime: 1 };
        const h = await run([
            { kind: 'message', messageId: 'm1', deltaContent: 'let me look' },
            { kind: 'toolStart', tool },
            { kind: 'subagentMessage', agentId: 'a1', content: 'sub says' },
            { kind: 'toolUpdate', tool: { ...tool, status: 'complete' } }
        ]);

        expect(kinds(h.updates)).to.deep.equal([
            'agent_message_chunk', 'tool_call', 'agent_message_chunk', 'tool_call_update'
        ]);
    });

    it('ignores an event kind it does not recognise instead of crashing the turn', async () => {
        const h = await run([
            { kind: 'somethingNewFromTheManager', payload: 1 },
            { kind: 'message', messageId: 'm1', deltaContent: 'still here' }
        ]);

        expect(kinds(h.updates), 'an unknown kind must not stop the known ones')
            .to.deep.equal(['agent_message_chunk']);
    });

    /** Still one subscription per turn, still released — the leak guard survives the widening. */
    it('leaves no subscription behind after the turn', async () => {
        const h = await run([{ kind: 'message', messageId: 'm1', deltaContent: 'x' }]);

        expect(h.backend().listenerCount()).to.equal(0);
    });
});
