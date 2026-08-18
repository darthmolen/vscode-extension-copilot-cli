/**
 * v3.13.0 Task 7 phase 3 — what "start" means for a host with no session.
 *
 * Task 6's case (c) is "no session id — start a fresh one", but the sidebar at
 * activation also has no session id and must do the opposite: bring back the
 * window's last conversation, per `copilotCLI.resumeLastSession`. Both are null
 * ids, so the host has to carry which one it is, or *New Tab* opens the sidebar's
 * conversation in a tab.
 *
 * CLAUDE.md's rule applies directly: a setting is a standing default, a gesture is
 * a stated intent, and the gesture wins. Clicking New Tab is the gesture.
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

/** Every manager event the host subscribes to on attach. */
const MANAGER_EVENTS = [
    'onDidReceiveOutput', 'onDidReceiveReasoning', 'onDidReceiveError',
    'onDidMessageDelta', 'onDidReceiveReasoningDelta', 'onDidTaskComplete',
    'onDidStartTool', 'onDidUpdateTool', 'onDidCompleteTool',
    'onDidStartSubagent', 'onDidSubagentMessage', 'onDidCompleteSubagent',
    'onDidChangeStatus', 'onDidProduceDiff', 'onDidUpdateUsage'
];

function fakeManager() {
    const manager = { getSessionId: () => 'started', isRunning: () => true };
    for (const event of MANAGER_EVENTS) {
        manager[event] = () => ({ dispose() {} });
    }
    return manager;
}

function makeHost(over = {}) {
    const requests = [];
    const host = new ChatSessionHost({
        handle: 'host#1',
        sessionId: null,
        workspace: new WorkspaceRuntimeState(),
        logger: silentLogger,
        startManager: async (options) => { requests.push(options); return fakeManager(); },
        ...over
    });
    return { host, requests };
}

describe('ChatSessionHost start intent', () => {
    it('defaults to the window default, which is what the sidebar needs', async () => {
        const { host, requests } = makeHost();

        await host.ensureStarted();

        expect(requests[0].fresh).to.equal(false);
        expect(requests[0].resume).to.equal(false);
        expect(requests[0].sessionId).to.equal(null);
    });

    it('asks for a brand-new session when built for one', async () => {
        const { host, requests } = makeHost({ whenNoSession: 'new' });

        await host.ensureStarted();

        expect(requests[0].fresh).to.equal(true);
    });

    it('resumes its own session regardless of the intent, once it has one', async () => {
        // A New Tab host that has started and adopted an id is no longer "new" —
        // on the next start it is case (b), resume this session.
        const { host, requests } = makeHost({ sessionId: 'already-mine', whenNoSession: 'new' });

        await host.ensureStarted();

        expect(requests[0].fresh).to.equal(false,
            'a host with a session has one to resume; fresh would abandon it');
        expect(requests[0].resume).to.equal(true);
        expect(requests[0].sessionId).to.equal('already-mine');
    });

    it('hands the caller itself, so bootstrap can find the right host', async () => {
        const { host, requests } = makeHost();

        await host.ensureStarted();

        expect(requests[0].host).to.equal(host);
    });
});
