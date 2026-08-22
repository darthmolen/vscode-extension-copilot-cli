/**
 * File diffs, from our snapshot pair to ACP's `diff` content (IN-3 §4c.4).
 *
 * ACP has a first-class diff content type on `tool_call_update`, and we sent tool
 * calls without it — so the entire inline-diff experience, which is most of what this
 * extension is for, was invisible to any host driving us over the protocol. A host
 * saw "edit finished" and nothing about what changed.
 *
 * The mismatch is real rather than cosmetic. Our `onDidProduceDiff` carries a pair of
 * PATHS, because VS Code's diff editor takes URIs: `beforeUri` is a temp file holding
 * the snapshot taken before the edit, `afterUri` is the file itself. ACP wants the
 * TEXT — `path`, `oldText`, `newText` — because a host on the far end of a pipe has
 * no access to our filesystem. So something has to read the two files, and that is
 * the part with failure modes.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import * as acp from '@agentclientprotocol/sdk';

const require = createRequire(import.meta.url);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const M = require(join(REPO_ROOT, 'out', 'acp', 'sessionUpdateMapper.js'));
const { SdkSessionBackend } = require(join(REPO_ROOT, 'out', 'acp', 'SdkSessionBackend.js'));
const { CopilotAcpAgent } = require(join(REPO_ROOT, 'out', 'acp', 'CopilotAcpAgent.js'));

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const SID = 'sess-1';

const DIFF_EVENT = {
    kind: 'diff',
    toolCallId: 'tc-1',
    path: '/w/src/a.ts',
    oldText: 'const a = 1;\n',
    newText: 'const a = 2;\n'
};

describe('diffUpdate — an edit becomes ACP diff content (IN-3 §4c.4)', () => {
    const update = (over = {}) => M.diffUpdate(SID, { ...DIFF_EVENT, ...over }).update;

    /**
     * An update, not a new `tool_call`. The edit already announced itself when the
     * tool started; a second `tool_call` with the same id would either duplicate the
     * entry in a host's list or overwrite what it already showed.
     */
    it('attaches the diff to the tool call that produced it', () => {
        const u = update();

        expect(u.sessionUpdate).to.equal('tool_call_update');
        expect(u.toolCallId).to.equal('tc-1');
    });

    it('carries the file and both versions of its text', () => {
        expect(update().content).to.deep.equal([{
            type: 'diff',
            path: '/w/src/a.ts',
            oldText: 'const a = 1;\n',
            newText: 'const a = 2;\n'
        }]);
    });

    /**
     * ACP documents `oldText` as "None for new files", so a created file is `null`
     * rather than an empty string. The distinction is what lets a host render "new
     * file" instead of "every line deleted then re-added".
     */
    it('says a created file had no previous content, rather than empty content', () => {
        expect(update({ oldText: null }).content[0].oldText).to.equal(null);
    });

    it('points at the file that was changed, not the snapshot it was compared against', () => {
        expect(update().content[0].path).to.equal('/w/src/a.ts');
    });
});

describe('SdkSessionBackend — reading the two sides of a diff (IN-3 §4c.4)', () => {
    function makeManager(over = {}) {
        const noSub = { dispose() {} };
        const diffListeners = new Set();
        return {
            setPermissionHandler() {},
            async start() {},
            getSessionId: () => 'session-a',
            async sendMessage() {},
            onDidMessageDelta: () => noSub,
            onDidReceiveReasoningDelta: () => noSub,
            onDidStartTool: () => noSub,
            onDidUpdateTool: () => noSub,
            onDidCompleteTool: () => noSub,
            onDidStartSubagent: () => noSub,
            onDidSubagentMessage: () => noSub,
            onDidCompleteSubagent: () => noSub,
            onDidUpdateTodos: () => noSub,
            onDidUpdateUsage: () => noSub,
            onDidReceiveError: () => noSub,
            onDidProduceDiff(listener) {
                diffListeners.add(listener);
                return { dispose: () => diffListeners.delete(listener) };
            },
            emitDiff(e) { for (const l of [...diffListeners]) { l(e); } },
            getCurrentMode: () => 'work',
            async abortMessage() {},
            async enablePlanMode() {},
            async disablePlanMode() {},
            async stop() {},
            dispose() {},
            ...over
        };
    }

    const SNAPSHOT = {
        toolCallId: 'tc-1',
        beforeUri: '/tmp/snap/a.ts',
        afterUri: '/w/src/a.ts',
        title: 'a.ts (Before ↔ After)'
    };

    const files = { '/tmp/snap/a.ts': 'const a = 1;\n', '/w/src/a.ts': 'const a = 2;\n' };
    const reader = map => p => (p in map ? map[p] : null);

    const capture = async (event, readFileText = reader(files)) => {
        const manager = makeManager();
        const backend = await SdkSessionBackend.start(manager, silentLogger, {}, undefined, readFileText);
        const events = [];
        backend.onEvent(e => events.push(e));
        manager.emitDiff(event);
        return events.filter(e => e.kind === 'diff');
    };

    it('turns the snapshot pair into the text on both sides', async () => {
        expect(await capture(SNAPSHOT)).to.deep.equal([{
            kind: 'diff',
            toolCallId: 'tc-1',
            path: '/w/src/a.ts',
            oldText: 'const a = 1;\n',
            newText: 'const a = 2;\n'
        }]);
    });

    /**
     * A create has no snapshot to read — there was nothing there before. That is
     * `null`, which ACP defines, not an unreadable file.
     */
    it('reports a created file as having had no previous content', async () => {
        const diffs = await capture(SNAPSHOT, reader({ '/w/src/a.ts': 'brand new\n' }));

        expect(diffs[0].oldText).to.equal(null);
        expect(diffs[0].newText).to.equal('brand new\n');
    });

    /**
     * Without the file's current content there is no diff to show, and inventing one
     * would misreport what is on disk. Staying quiet costs a host a diff; guessing
     * costs it the truth.
     */
    it('says nothing at all when the changed file cannot be read', async () => {
        expect(await capture(SNAPSHOT, reader({ '/tmp/snap/a.ts': 'old\n' }))).to.deep.equal([]);
    });

    it('releases the diff subscription with all the others', async () => {
        const manager = makeManager();
        const backend = await SdkSessionBackend.start(manager, silentLogger, {}, undefined, reader(files));
        const events = [];
        const unsubscribe = backend.onEvent(e => events.push(e));

        unsubscribe();
        manager.emitDiff(SNAPSHOT);

        expect(events).to.deep.equal([]);
    });
});

/** The far end: it has to arrive at a real client, over a real connection. */
describe('CopilotAcpAgent — the diff reaches the client (IN-3 §4c.4)', function () {
    this.timeout(10000);

    it('forwards diff content on the tool call that produced it', async () => {
        const updates = [];
        let emit;
        const backend = {
            sessionId: 'session-a',
            currentModeId: 'work',
            onEvent(listener) { emit = listener; return () => {}; },
            async prompt() { emit(DIFF_EVENT); return { stopReason: 'end_turn' }; },
            setMode: async () => {}, cancel: async () => {}, close: async () => {},
            history: async () => [], setPermissionRequester() {}
        };
        const agent = new CopilotAcpAgent({ logger: silentLogger, startSession: async () => backend });
        const client = acp.client().onNotification(acp.methods.client.session.update,
            ({ params }) => updates.push(params));
        const conn = client.connect(agent.register(acp.agent()));

        const { sessionId } = await conn.agent.request(acp.methods.agent.session.new,
            { cwd: REPO_ROOT, mcpServers: [] });
        await conn.agent.request(acp.methods.agent.session.prompt, {
            sessionId, prompt: [{ type: 'text', text: 'edit it' }]
        });

        const diffs = updates.filter(u => u.update.content?.[0]?.type === 'diff');
        expect(diffs, 'no diff reached the client').to.have.lengthOf(1);
        expect(diffs[0].update.toolCallId).to.equal('tc-1');
        expect(diffs[0].update.content[0].newText).to.equal('const a = 2;\n');
    });
});
