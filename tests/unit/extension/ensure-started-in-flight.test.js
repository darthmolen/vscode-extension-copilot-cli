/**
 * A start in flight is not a start finished.
 *
 * Found live, not by a test. Opening a chat tab logged `[Init] Sending 0 messages`
 * *before* the session had an id, and never sent another — so the webview recorded
 * `sessionId: null`, and the tab could not restore on reload.
 *
 * The cause is an ordering assumption inside `ensureStarted`. `wireManagerEvents`
 * calls `attachManager` — which sets `live` — *before* `manager.start()` resolves,
 * because the wiring has to be in place to catch startup events. A surface whose
 * webview becomes ready during that window called `ensureStarted()`, saw `live`,
 * and was told the session was ready when it had no id yet.
 *
 * The in-flight promise is the truth during startup, so it has to be consulted
 * first.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { ChatSessionHost } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'ChatSessionHost.js')
);
const { WorkspaceRuntimeState } = require(
    path.join(__dirname, '../../..', 'out', 'backendState.js')
);

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

const MANAGER_EVENTS = [
    'onDidReceiveOutput', 'onDidReceiveReasoning', 'onDidReceiveError',
    'onDidMessageDelta', 'onDidReceiveReasoningDelta', 'onDidTaskComplete',
    'onDidStartTool', 'onDidUpdateTool', 'onDidCompleteTool',
    'onDidStartSubagent', 'onDidSubagentMessage', 'onDidCompleteSubagent',
    'onDidChangeStatus', 'onDidProduceDiff', 'onDidUpdateUsage'
];

function fakeManager(sessionId) {
    const manager = { getSessionId: () => sessionId, isRunning: () => true };
    for (const event of MANAGER_EVENTS) {
        manager[event] = () => ({ dispose() {} });
    }
    return manager;
}

const settle = () => new Promise(resolve => setImmediate(resolve));

describe('ChatSessionHost.ensureStarted() while a start is in flight', () => {
    /**
     * A host whose start wires its manager up front and only later adopts an id —
     * exactly what `wireManagerEvents` then `onSessionStarted` do.
     */
    function hostWithSlowStart() {
        let finishStart;
        const startFinished = new Promise(resolve => { finishStart = resolve; });
        const host = new ChatSessionHost({
            handle: 'host#1',
            sessionId: null,
            workspace: new WorkspaceRuntimeState(),
            logger: silentLogger,
            startManager: async ({ host: self }) => {
                // wireManagerEvents: the wiring lands before the CLI is up.
                self.attachManager(fakeManager(null));
                await startFinished;
                // onSessionStarted: the id arrives only when the CLI reports it.
                self.adoptSessionId('assigned-at-the-end');
                return fakeManager('assigned-at-the-end');
            }
        });
        return { host, finishStart };
    }

    it('does not report ready before the session has its id', async () => {
        const { host, finishStart } = hostWithSlowStart();

        const first = host.ensureStarted();
        let secondSettled = false;
        const second = host.ensureStarted().then(() => { secondSettled = true; });

        await settle();
        expect(secondSettled).to.equal(false,
            'a surface that became ready mid-start would render an init with no session id');
        expect(host.sessionId).to.equal(null);

        finishStart();
        await Promise.all([first, second]);

        expect(host.sessionId).to.equal('assigned-at-the-end');
    });

    it('joins the one attempt rather than starting a second', async () => {
        let starts = 0;
        let finishStart;
        const startFinished = new Promise(resolve => { finishStart = resolve; });
        const host = new ChatSessionHost({
            handle: 'host#1',
            sessionId: null,
            workspace: new WorkspaceRuntimeState(),
            logger: silentLogger,
            startManager: async ({ host: self }) => {
                starts++;
                self.attachManager(fakeManager(null));
                await startFinished;
                return fakeManager('one');
            }
        });

        const all = [host.ensureStarted(), host.ensureStarted(), host.ensureStarted()];
        finishStart();
        await Promise.all(all);

        expect(starts).to.equal(1);
    });

    it('still short-circuits once the start has finished', async () => {
        let starts = 0;
        const host = new ChatSessionHost({
            handle: 'host#1',
            sessionId: null,
            workspace: new WorkspaceRuntimeState(),
            logger: silentLogger,
            startManager: async () => { starts++; return fakeManager('one'); }
        });

        await host.ensureStarted();
        await host.ensureStarted();

        expect(starts).to.equal(1);
        expect(host.isLive).to.equal(true);
    });
});
