/**
 * A live session's tool calls belong in its transcript, not only on screen.
 *
 * `WebviewChatSurface.addAssistantMessage` records into `host.state`;
 * `notifyToolStart` does not. So a running session's transcript held the narration
 * and none of the doing — and every `sendInit()` renders from that state. Hide and
 * re-show the sidebar container, and VS Code disposes the view, re-resolves it, the
 * webview readies, init renders `host.state`, and **every tool chip in the
 * conversation is gone**.
 *
 * Introduced by v3.13.0 and never released. `chatViewProvider.addToolExecution` on
 * `main` recorded tools into `backendState`; extracting the surface kept the
 * `rpcRouter.toolStart(...)` half and dropped the `storeInBackend` half.
 *
 * The old recording was lossy — `content: 'Tool execution'` and `toolName:
 * toolState.name`, a field the live payload has never had, which is exactly the grey
 * "Tool execution" bubble P2 set out to kill. So the fix is not to restore it but to
 * record what `buildSessionTranscript` would have recorded, so the live transcript
 * and the replayed one finally agree.
 *
 * Recorded on the **host**, not the surface: a host with no surface — a closed tab
 * winding down — must still have a complete transcript, and there is nothing to
 * write through.
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ChatSessionRegistry } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'ChatSessionRegistry.js')
);
const { WorkspaceRuntimeState } = require(
    path.join(__dirname, '../../..', 'out', 'backendState.js')
);
const { buildSessionTranscript } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'services', 'sessionTranscriptBuilder.js')
);

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** A manager whose tool stream the test drives by hand. */
function makeFakeManager() {
    const handlers = new Map();
    const subscribe = (event) => (handler) => {
        const set = handlers.get(event) ?? new Set();
        set.add(handler);
        handlers.set(event, set);
        return { dispose: () => set.delete(handler) };
    };
    return new Proxy({
        emit: (event, payload) => [...(handlers.get(event) ?? [])].forEach(fn => fn(payload)),
        dispose() {}
    }, {
        get: (target, prop) => {
            if (prop in target) { return target[prop]; }
            if (prop === 'onDidBecomeIdle') { return undefined; }
            if (typeof prop === 'string' && prop.startsWith('onDid')) { return subscribe(prop); }
            return typeof prop === 'string' ? async () => {} : undefined;
        }
    });
}

describe('a host records its session\'s tool calls', () => {
    let registry;

    beforeEach(() => {
        registry = new ChatSessionRegistry({ workspace: new WorkspaceRuntimeState(), logger: silentLogger });
    });

    function live(sessionId) {
        const host = registry.create(sessionId);
        const manager = makeFakeManager();
        host.attachManager(manager);
        return { host, manager };
    }

    const aStart = (toolCallId, toolName = 'bash') => ({
        toolCallId, toolName,
        arguments: { command: 'npm test' },
        status: 'running',
        startTime: 1000
    });

    function toolsIn(host) {
        return host.getFullState().messages.filter(m => m.kind === 'tool');
    }

    it('puts a started tool into the transcript, where sendInit will find it', () => {
        const { host, manager } = live('session-a');

        manager.emit('onDidStartTool', aStart('call-1'));

        expect(toolsIn(host)).to.have.lengthOf(1);
        expect(toolsIn(host)[0].tool.toolName).to.equal('bash');
    });

    it('replaces that entry when the tool completes, rather than appending a second', () => {
        const { host, manager } = live('session-a');
        manager.emit('onDidStartTool', aStart('call-1'));

        manager.emit('onDidCompleteTool', { ...aStart('call-1'), status: 'complete', endTime: 2000 });

        const tools = toolsIn(host);
        expect(tools, 'a completed tool appeared twice').to.have.lengthOf(1);
        expect(tools[0].tool.status).to.equal('complete');
        expect(tools[0].tool.endTime).to.equal(2000);
    });

    it('replaces on progress updates too', () => {
        const { host, manager } = live('session-a');
        manager.emit('onDidStartTool', aStart('call-1'));

        manager.emit('onDidUpdateTool', { ...aStart('call-1'), progress: 'halfway' });

        expect(toolsIn(host)).to.have.lengthOf(1);
        expect(toolsIn(host)[0].tool.progress).to.equal('halfway');
    });

    it('keeps distinct tools distinct, in the order they started', () => {
        const { host, manager } = live('session-a');

        manager.emit('onDidStartTool', aStart('call-1', 'view'));
        manager.emit('onDidStartTool', aStart('call-2', 'bash'));
        manager.emit('onDidCompleteTool', { ...aStart('call-1', 'view'), status: 'complete' });

        expect(toolsIn(host).map(m => m.tool.toolCallId)).to.deep.equal(['call-1', 'call-2']);
    });

    it('interleaves with the narration rather than bunching at the end', () => {
        // The whole point: "Now update the tables:" → the edit → "Now the next one:".
        const { host, manager } = live('session-a');
        host.state.addMessage({ kind: 'assistant', content: 'Now update the tables:', timestamp: 1 });
        manager.emit('onDidStartTool', aStart('call-1', 'edit'));
        host.state.addMessage({ kind: 'assistant', content: 'Now the next one:', timestamp: 3 });

        expect(host.getFullState().messages.map(m => m.kind))
            .to.deep.equal(['assistant', 'tool', 'assistant']);
    });

    /**
     * Reversed by the PR #49 review and the decision in §9 of the review doc.
     *
     * This used to assert the `agentId` was *carried*, on the theory that replay and live should
     * agree about it. They do agree — by excluding it. A sub-agent's tools belong to the dock, which
     * is the standing product decision and what the live renderer already does
     * (`ToolExecution.handleToolStart` returns early on `agentId`).
     *
     * Recording them made a re-init draw them flat in the main transcript, which **neither** other
     * path does: `agentId` is an SDK envelope field and is never written to `events.jsonl`, so a
     * replay from disk cannot produce one either.
     */
    it('does not record a sub-agent\'s tools — those belong to the dock', () => {
        const { host, manager } = live('session-a');

        manager.emit('onDidStartTool', { ...aStart('call-1'), agentId: 'agent-7' });

        expect(toolsIn(host), 'a sub-agent tool leaked into the main transcript').to.have.lengthOf(0);
    });

    it('still records the parent session\'s own tools alongside a sub-agent\'s', () => {
        const { host, manager } = live('session-a');

        manager.emit('onDidStartTool', { ...aStart('call-1', 'bash') });
        manager.emit('onDidStartTool', { ...aStart('call-2', 'task'), agentId: 'agent-7' });

        expect(toolsIn(host).map(m => m.tool.toolCallId)).to.deep.equal(['call-1']);
    });

    it('ignores a sub-agent tool\'s completion too, rather than resurrecting it', () => {
        const { host, manager } = live('session-a');
        const subTool = { ...aStart('call-1'), agentId: 'agent-7' };

        manager.emit('onDidStartTool', subTool);
        manager.emit('onDidCompleteTool', { ...subTool, status: 'complete' });

        expect(toolsIn(host)).to.have.lengthOf(0);
    });

    it('records into its own session and no other', () => {
        const a = live('session-a');
        const b = live('session-b');

        a.manager.emit('onDidStartTool', aStart('call-1'));

        expect(toolsIn(a.host)).to.have.lengthOf(1);
        expect(toolsIn(b.host), 'a tool leaked into another conversation').to.have.lengthOf(0);
    });

    it('records even with no surface attached — a winding-down tab still has a transcript', () => {
        const { host, manager } = live('session-a');
        expect(host.getSurface()).to.equal(undefined);

        manager.emit('onDidStartTool', aStart('call-1'));

        expect(toolsIn(host)).to.have.lengthOf(1);
    });

    it('a new conversation starts with no tools', () => {
        const { host, manager } = live('session-a');
        manager.emit('onDidStartTool', aStart('call-1'));

        host.beginNewConversation();

        expect(toolsIn(host)).to.have.lengthOf(0);
    });

    /**
     * The binding test the plan asks for: two representations of one fact, compared
     * by **value** rather than by asserting the same field names twice in two files.
     * Field-name assertions are how the live and replayed transcripts drifted in the
     * first place.
     */
    describe('the live transcript matches the replayed one', () => {
        let dir;
        beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-')); });
        afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

        it('produces the same tool message the event log would', async () => {
            // The event log stores ISO timestamps and `buildSessionTranscript` parses
            // them; `SDKSessionManager.handleToolStart` parses the *same* string into
            // `startTime` before emitting. So the two paths are equivalent only when
            // the fixture feeds them equivalent inputs — an earlier draft of this test
            // handed the builder a raw number, and it read as the year 1000.
            const startedAt = '2026-08-22T19:04:27.213Z';
            const eventsPath = path.join(dir, 'events.jsonl');
            fs.writeFileSync(eventsPath, [
                JSON.stringify({
                    type: 'tool.execution_start',
                    timestamp: startedAt,
                    data: { toolCallId: 'call-1', toolName: 'bash', arguments: { command: 'npm test' } }
                })
            ].join('\n'), 'utf-8');
            const [fromDisk] = await buildSessionTranscript(eventsPath);

            const { host, manager } = live('session-a');
            manager.emit('onDidStartTool', { ...aStart('call-1'), startTime: Date.parse(startedAt) });
            const [fromLive] = toolsIn(host);

            expect(fromLive.kind).to.equal(fromDisk.kind);
            expect(fromLive.content).to.equal(fromDisk.content);
            expect(fromLive.timestamp).to.equal(fromDisk.timestamp);
            expect(fromLive.tool.toolCallId).to.equal(fromDisk.tool.toolCallId);
            expect(fromLive.tool.toolName).to.equal(fromDisk.tool.toolName);
            expect(fromLive.tool.status).to.equal(fromDisk.tool.status);
            expect(fromLive.tool.startTime).to.equal(fromDisk.tool.startTime);
            expect(fromLive.tool.arguments).to.deep.equal(fromDisk.tool.arguments);
        });

        it('truncates a large result exactly as the replay does', async () => {
            // One `bash` in a real run returned 181.7 KB. The replay path caps
            // results and flags the cut; the live path did not cap at all, so
            // recording it verbatim would put megabytes in memory, send them on
            // every init, and re-break the agreement this describe block exists to
            // hold — a transcript that differs from its own replay.
            const startedAt = '2026-08-22T19:04:27.213Z';
            const endedAt = '2026-08-22T19:04:29.000Z';
            const huge = 'x'.repeat(50000);
            const eventsPath = path.join(dir, 'events.jsonl');
            fs.writeFileSync(eventsPath, [
                JSON.stringify({
                    type: 'tool.execution_start', timestamp: startedAt,
                    data: { toolCallId: 'call-1', toolName: 'bash', arguments: {} }
                }),
                JSON.stringify({
                    type: 'tool.execution_complete', timestamp: endedAt,
                    data: { toolCallId: 'call-1', success: true, result: { content: huge } }
                })
            ].join('\n'), 'utf-8');
            const [fromDisk] = await buildSessionTranscript(eventsPath);

            const { host, manager } = live('session-a');
            manager.emit('onDidStartTool', { ...aStart('call-1'), startTime: Date.parse(startedAt) });
            manager.emit('onDidCompleteTool', {
                ...aStart('call-1'), startTime: Date.parse(startedAt),
                status: 'complete', endTime: Date.parse(endedAt), result: huge
            });
            const [fromLive] = toolsIn(host);

            expect(fromLive.tool.result.length).to.equal(fromDisk.tool.result.length);
            expect(fromLive.tool.result).to.equal(fromDisk.tool.result);
            expect(fromLive.tool.resultTruncated).to.equal(true);
            expect(fromDisk.tool.resultTruncated).to.equal(true);
        });

        it('leaves a small result alone, on both paths', async () => {
            const startedAt = '2026-08-22T19:04:27.213Z';
            const eventsPath = path.join(dir, 'events.jsonl');
            fs.writeFileSync(eventsPath, [
                JSON.stringify({
                    type: 'tool.execution_start', timestamp: startedAt,
                    data: { toolCallId: 'call-1', toolName: 'bash', arguments: {} }
                }),
                JSON.stringify({
                    type: 'tool.execution_complete', timestamp: startedAt,
                    data: { toolCallId: 'call-1', success: true, result: { content: 'ok' } }
                })
            ].join('\n'), 'utf-8');
            const [fromDisk] = await buildSessionTranscript(eventsPath);

            const { host, manager } = live('session-a');
            manager.emit('onDidStartTool', { ...aStart('call-1'), startTime: Date.parse(startedAt) });
            manager.emit('onDidCompleteTool', {
                ...aStart('call-1'), startTime: Date.parse(startedAt), status: 'complete', result: 'ok'
            });
            const [fromLive] = toolsIn(host);

            expect(fromLive.tool.result).to.equal('ok');
            expect(fromLive.tool.result).to.equal(fromDisk.tool.result);
            expect(fromLive.tool.resultTruncated).to.equal(undefined);
        });
    });
});
