/**
 * buildSessionTranscript — the event log projected into a transcript (v3.13.0 P2)
 *
 * The bug: a replayed transcript renders every tool call as an identical bubble
 * reading "Tool execution", frozen at running, because our own summary of the log
 * was lossy and the wire type could not express a tool at all.
 *
 * The fix is to stop summarising. The CLI's `events.jsonl` already records the full
 * lifecycle, so this folds it into the transcript: `tool.execution_start` joined to
 * `tool.execution_complete` on `toolCallId`, status derived from `success`.
 *
 * Fixtures are written per test rather than checked in, so each one shows exactly
 * the log shape it is claiming something about. Shapes are taken from
 * `planning/spikes/tool-replay-reader/FINDINGS.md`, measured against real sessions —
 * including an extension-created one running our own plan-mode tools.
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildSessionTranscript } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'services', 'sessionTranscriptBuilder.js')
);

let dir;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-'));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

/** Writes an events.jsonl and returns its path. */
function writeLog(events) {
    const file = path.join(dir, 'events.jsonl');
    fs.writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    return file;
}

const at = (seconds) => new Date(Date.UTC(2026, 7, 17, 10, 0, seconds)).toISOString();

function userMessage(content, seconds = 0) {
    return { type: 'user.message', data: { content }, timestamp: at(seconds) };
}
function assistantMessage(content, seconds = 1) {
    return { type: 'assistant.message', data: { content }, timestamp: at(seconds) };
}
function toolStart(over = {}, seconds = 2) {
    const { agentId, ...data } = over;
    return {
        type: 'tool.execution_start',
        data: { toolCallId: 't1', toolName: 'bash', arguments: { command: 'ls' }, turnId: '0', ...data },
        ...(agentId ? { agentId } : {}),
        timestamp: at(seconds)
    };
}
function toolComplete(over = {}, seconds = 3) {
    return {
        type: 'tool.execution_complete',
        data: { toolCallId: 't1', success: true, result: { content: 'ok' }, turnId: '0', ...over },
        timestamp: at(seconds)
    };
}

describe('buildSessionTranscript', () => {
    describe('re-created session ids', () => {
        it('returns only the run after the last session.start', async () => {
            // A session id can be re-created -- plan sessions do it on every
            // plan-mode entry -- which appends another session.start while
            // keeping the earlier lines. Replaying both would show the user a
            // conversation the agent has no memory of.
            const file = writeLog([
                { type: 'session.start', data: {}, timestamp: at(0) },
                userMessage('first run question', 1),
                assistantMessage('first run answer', 2),
                { type: 'session.start', data: {}, timestamp: at(3) },
                userMessage('second run question', 4),
                assistantMessage('second run answer', 5)
            ]);

            const messages = await buildSessionTranscript(file);

            expect(messages.map(m => m.content)).to.deep.equal([
                'second run question',
                'second run answer'
            ]);
        });

        it('drops tool calls from an earlier run too', async () => {
            const file = writeLog([
                { type: 'session.start', data: {}, timestamp: at(0) },
                toolStart({ toolCallId: 'old-1', toolName: 'bash' }, 1),
                toolComplete({ toolCallId: 'old-1' }, 2),
                { type: 'session.start', data: {}, timestamp: at(3) },
                userMessage('only this run', 4)
            ]);

            const messages = await buildSessionTranscript(file);

            expect(messages.filter(m => m.kind === 'tool')).to.have.lengthOf(0);
            expect(messages.map(m => m.content)).to.deep.equal(['only this run']);
        });

        it('leaves a single-run transcript untouched', async () => {
            const file = writeLog([
                { type: 'session.start', data: {}, timestamp: at(0) },
                userMessage('hello', 1),
                assistantMessage('hi', 2)
            ]);

            const messages = await buildSessionTranscript(file);

            expect(messages.map(m => m.content)).to.deep.equal(['hello', 'hi']);
        });
    });

    it('keeps user and assistant messages, in order', async () => {
        const messages = await buildSessionTranscript(writeLog([
            userMessage('hello'), assistantMessage('hi')
        ]));

        expect(messages.map(m => [m.kind, m.content])).to.deep.equal([
            ['user', 'hello'], ['assistant', 'hi']
        ]);
    });

    it('carries each message own timestamp, not the time it was replayed', async () => {
        const [message] = await buildSessionTranscript(writeLog([userMessage('hello', 30)]));

        expect(message.timestamp).to.equal(Date.parse(at(30)));
    });

    it('rebuilds a completed tool from its start and complete', async () => {
        const [message] = await buildSessionTranscript(writeLog([
            toolStart({ toolName: 'grep', arguments: { pattern: 'foo' } }),
            toolComplete()
        ]));

        expect(message.kind).to.equal('tool');
        expect(message.tool).to.include({
            toolCallId: 't1', toolName: 'grep', status: 'complete'
        });
        expect(message.tool.arguments).to.deep.equal({ pattern: 'foo' });
    });

    it('marks a failed tool failed, and keeps why it failed', async () => {
        const [message] = await buildSessionTranscript(writeLog([
            toolStart(),
            toolComplete({ success: false, result: null, error: { message: 'Command failed: ls', code: 'failure' } })
        ]));

        expect(message.tool.status).to.equal('failed');
        expect(message.tool.error).to.deep.equal({ message: 'Command failed: ls', code: 'failure' });
    });

    it('replays an interrupted tool as still running rather than inventing an outcome', async () => {
        const [message] = await buildSessionTranscript(writeLog([toolStart()]));

        expect(message.tool.status).to.equal('running');
        expect(message.tool.endTime).to.equal(undefined);
    });

    it('gives a tool real start and end times so a chip can show its duration', async () => {
        const [message] = await buildSessionTranscript(writeLog([
            toolStart({}, 2), toolComplete({}, 5)
        ]));

        expect(message.tool.startTime).to.equal(Date.parse(at(2)));
        expect(message.tool.endTime).to.equal(Date.parse(at(5)));
    });

    it('treats a plan-mode custom tool exactly like a built-in', async () => {
        // Measured in an extension-created session: our registered tools log the
        // same way built-ins do. This is the test that closes §7.1.
        const [message] = await buildSessionTranscript(writeLog([
            toolStart({ toolCallId: 'p1', toolName: 'update_work_plan', arguments: { plan: '…' } }),
            toolComplete({ toolCallId: 'p1' })
        ]));

        expect(message.tool.toolName).to.equal('update_work_plan');
        expect(message.tool.status).to.equal('complete');
    });

    it('keeps the agent id a sub-agent tool was tagged with', async () => {
        const [message] = await buildSessionTranscript(writeLog([
            toolStart({ agentId: 'agent-7' }), toolComplete()
        ]));

        // agentId sits on the event, not under data — verified in the spike.
        expect(message.agentId).to.equal('agent-7');
    });

    it('ignores events that are not messages or tools', async () => {
        const messages = await buildSessionTranscript(writeLog([
            { type: 'hook.start', data: {}, timestamp: at(0) },
            { type: 'session.start', data: {}, timestamp: at(0) },
            userMessage('hello', 1),
            { type: 'permission.requested', data: {}, timestamp: at(2) }
        ]));

        expect(messages).to.have.lengthOf(1);
    });

    it('survives a malformed line rather than losing the transcript', async () => {
        const file = path.join(dir, 'events.jsonl');
        fs.writeFileSync(file, [
            JSON.stringify(userMessage('before')),
            '{ this is not json',
            JSON.stringify(assistantMessage('after'))
        ].join('\n') + '\n');

        const messages = await buildSessionTranscript(file);

        expect(messages.map(m => m.content)).to.deep.equal(['before', 'after']);
    });

    it('returns a fresh transcript each call, never accumulating', async () => {
        // Ported from SessionService.loadSessionHistory's tests, which this replaces.
        const file = writeLog([userMessage('hello'), assistantMessage('hi')]);

        await buildSessionTranscript(file);
        const second = await buildSessionTranscript(file);

        expect(second).to.have.lengthOf(2);
    });

    it('returns nothing for a session with no log', async () => {
        expect(await buildSessionTranscript(path.join(dir, 'absent.jsonl'))).to.deep.equal([]);
    });

    it('never sets hasDiff — the snapshot it would point at is long deleted', async () => {
        const [message] = await buildSessionTranscript(writeLog([toolStart(), toolComplete()]));

        expect(message.tool.hasDiff).to.equal(undefined);
    });

    describe('result truncation', () => {
        it('carries a short result whole', async () => {
            const [message] = await buildSessionTranscript(writeLog([
                toolStart(), toolComplete({ result: { content: 'small output' } })
            ]));

            expect(message.tool.result).to.equal('small output');
            expect(message.tool.resultTruncated).to.equal(undefined);
        });

        it('caps a long result and says so', async () => {
            const long = 'x'.repeat(9000);
            const [message] = await buildSessionTranscript(writeLog([
                toolStart(), toolComplete({ result: { content: long } })
            ]), { maxResultChars: 100 });

            expect(message.tool.result).to.have.lengthOf(100);
            expect(message.tool.resultTruncated).to.equal(true);
        });

        it('caps by default, so a caller cannot forget to', async () => {
            const long = 'x'.repeat(200_000);
            const [message] = await buildSessionTranscript(writeLog([
                toolStart(), toolComplete({ result: { content: long } })
            ]));

            expect(message.tool.result.length).to.be.below(long.length);
            expect(message.tool.resultTruncated).to.equal(true);
        });
    });
});
