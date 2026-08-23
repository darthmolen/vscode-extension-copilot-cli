/**
 * sessionUpdateMapper — manager emitters → ACP session/update (IN-3 scope item 3)
 *
 * Pure functions, so every variant is testable without a protocol, a CLI or a
 * manager. The agent wires them; this file proves the shapes.
 *
 * **The sub-agent decision this encodes.** Our dock deliberately keeps sub-agent
 * traffic OUT of the main transcript. A generic ACP host has no dock and renders
 * whatever `session/update` it receives. Rather than choosing one reader over the
 * other, sub-agent content is sent as a NORMAL update — so a generic host shows it
 * inline and loses nothing — and tagged in the envelope's `_meta`, so our client can
 * route it to the dock instead.
 *
 * ACP guarantees this is safe: `_meta` is "reserved … to attach additional metadata",
 * and implementations "MUST NOT make assumptions about values at these keys". Note
 * `_meta` lives on the SessionNotification envelope, NOT on the update variant.
 *
 * Keys are namespaced. `_meta` is a shared extension point; an unprefixed `agentId`
 * would collide with any other agent that had the same idea.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const M = require(path.join(__dirname, '../../..', 'out', 'acp', 'sessionUpdateMapper.js'));

const SID = 'sess-1';

describe('sessionUpdateMapper — assistant text (IN-3)', () => {
    it('maps a message delta to agent_message_chunk', () => {
        const n = M.messageDeltaUpdate(SID, { messageId: 'm1', deltaContent: 'hello' });

        expect(n.sessionId).to.equal(SID);
        expect(n.update.sessionUpdate).to.equal('agent_message_chunk');
        expect(n.update.content).to.deep.equal({ type: 'text', text: 'hello' });
    });

    /** ACP has a distinct variant for thinking; folding it into message text would misrepresent it. */
    it('maps reasoning to agent_thought_chunk, not message text', () => {
        const n = M.reasoningDeltaUpdate(SID, { reasoningId: 'r1', deltaContent: 'pondering' });

        expect(n.update.sessionUpdate).to.equal('agent_thought_chunk');
        expect(n.update.content.text).to.equal('pondering');
    });
});

describe('sessionUpdateMapper — tools (IN-3)', () => {
    const started = { toolCallId: 't1', toolName: 'read_file', status: 'running', startTime: 1, arguments: { path: 'a.ts' } };

    it('maps a tool start to a tool_call carrying id and title', () => {
        const n = M.toolStartUpdate(SID, started);

        expect(n.update.sessionUpdate).to.equal('tool_call');
        expect(n.update.toolCallId).to.equal('t1');
        expect(n.update.title, 'title is required by the schema').to.be.a('string').and.not.empty;
    });

    it('translates our status vocabulary into ACP ToolCallStatus', () => {
        expect(M.toolStartUpdate(SID, { ...started, status: 'pending' }).update.status).to.equal('pending');
        expect(M.toolStartUpdate(SID, { ...started, status: 'running' }).update.status).to.equal('in_progress');
        expect(M.toolUpdateUpdate(SID, { ...started, status: 'complete' }).update.status).to.equal('completed');
        expect(M.toolUpdateUpdate(SID, { ...started, status: 'failed' }).update.status).to.equal('failed');
    });

    /**
     * `running` → `in_progress` and `complete` → `completed` are the two that differ.
     * Passing ours through unchanged would produce values not in the enum, which a
     * strict client is entitled to reject.
     */
    it('never emits a status outside the ACP enum', () => {
        const allowed = ['pending', 'in_progress', 'completed', 'failed'];
        for (const status of ['pending', 'running', 'complete', 'failed']) {
            expect(allowed).to.include(M.toolStartUpdate(SID, { ...started, status }).update.status);
        }
    });

    it('maps a tool update to tool_call_update, not a second tool_call', () => {
        const n = M.toolUpdateUpdate(SID, { ...started, status: 'complete', result: 'ok' });

        expect(n.update.sessionUpdate).to.equal('tool_call_update');
        expect(n.update.toolCallId).to.equal('t1');
    });

    it('carries the raw arguments so a host can show what was run', () => {
        const n = M.toolStartUpdate(SID, started);

        expect(n.update.rawInput).to.deep.equal({ path: 'a.ts' });
    });
});

describe('sessionUpdateMapper — sub-agent traffic (IN-3)', () => {
    const msg = { agentId: 'task-7', content: 'sub-agent says hi' };

    /**
     * The half that serves a generic host: it must be an ordinary update, so a
     * client with no dock renders it rather than dropping it.
     */
    it('sends sub-agent output as a normal agent_message_chunk', () => {
        const n = M.subagentMessageUpdate(SID, msg);

        expect(n.update.sessionUpdate).to.equal('agent_message_chunk');
        expect(n.update.content.text).to.equal('sub-agent says hi');
    });

    /** The half that serves our dock. */
    it('tags the envelope _meta with the agent id', () => {
        const n = M.subagentMessageUpdate(SID, msg);

        expect(n._meta, '_meta belongs on the envelope, not the update').to.be.an('object');
        expect(JSON.stringify(n._meta)).to.include('task-7');
    });

    it('namespaces its _meta keys so they cannot collide with another agent', () => {
        const n = M.subagentMessageUpdate(SID, msg);

        for (const key of Object.keys(n._meta)) {
            expect(key, `bare key "${key}" would collide in a shared _meta`).to.match(/\./);
        }
    });

    /** The ticket's requirement: the transcript must read correctly when _meta is ignored. */
    it('reads correctly with _meta stripped', () => {
        const n = M.subagentMessageUpdate(SID, msg);
        delete n._meta;

        expect(n.sessionId).to.equal(SID);
        expect(n.update.sessionUpdate).to.equal('agent_message_chunk');
        expect(n.update.content.text).to.equal('sub-agent says hi');
    });

    it('maps sub-agent reasoning to a thought chunk, still tagged', () => {
        const n = M.subagentMessageUpdate(SID, { agentId: 'task-7', reasoningText: 'thinking' });

        expect(n.update.sessionUpdate).to.equal('agent_thought_chunk');
        expect(JSON.stringify(n._meta)).to.include('task-7');
    });

    it('marks lifecycle so the dock can open and close a card', () => {
        const start = M.subagentStartUpdate(SID, { agentId: 'task-7', agentDisplayName: 'Explorer' });
        const done = M.subagentCompleteUpdate(SID, { agentId: 'task-7', status: 'complete' });

        expect(JSON.stringify(start._meta)).to.include('task-7');
        expect(JSON.stringify(done._meta)).to.include('task-7');
        expect(JSON.stringify(start._meta)).to.not.equal(JSON.stringify(done._meta));
    });

    /** Main-transcript traffic must NOT be tagged, or everything lands in the dock. */
    it('leaves ordinary assistant output untagged', () => {
        const n = M.messageDeltaUpdate(SID, { messageId: 'm1', deltaContent: 'hello' });

        expect(n._meta, 'main-transcript output must not look like sub-agent traffic').to.equal(undefined);
    });
});

// The `planUpdate` test that lived here handed the mapper entries already in ACP's
// shape, so it asserted little more than that a pass-through passed through — and it
// stayed green for the whole time nothing called the function. `planUpdate` now takes
// the CLI's todo rows, which is where the real translation is, and is covered in
// tests/unit/extension/acp-plan-update.test.js together with the caller that was
// missing. Shape and wiring in one file, deliberately.
