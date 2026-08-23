/**
 * C1, the writer half — session bootstrap writes to the host that started.
 *
 * `onSessionStarted` wrote the new session's id, active flag, workspace path and
 * model into the `BackendState` singleton, and adopted the id onto `sidebarHost`
 * by name. Both were indistinguishable from correct while the sidebar was the only
 * surface. With a second one, starting a panel's session renames the sidebar's
 * conversation and hands it the panel's id — which is also how two hosts end up
 * claiming one session.
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
const { recordSessionStart } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'sessionBootstrap.js')
);

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeHost(over = {}) {
    return new ChatSessionHost({
        handle: 'host#1',
        sessionId: null,
        workspace: new WorkspaceRuntimeState(),
        logger: silentLogger,
        ...over
    });
}

describe('recordSessionStart()', () => {
    it('adopts the id onto the host that started, and no other', () => {
        const workspace = new WorkspaceRuntimeState();
        const starting = makeHost({ workspace });
        const bystander = makeHost({ handle: 'host#2', sessionId: 'untouched', workspace });

        recordSessionStart(starting, { sessionId: 'brand-new', workspacePath: null, model: null });

        expect(starting.sessionId).to.equal('brand-new');
        expect(starting.state.getSessionId()).to.equal('brand-new');
        expect(bystander.sessionId).to.equal('untouched');
        expect(bystander.state.getSessionId()).to.equal('untouched');
    });

    it('marks only the starting host active', () => {
        const workspace = new WorkspaceRuntimeState();
        const starting = makeHost({ workspace });
        const bystander = makeHost({ handle: 'host#2', sessionId: 'other', workspace });

        recordSessionStart(starting, { sessionId: 'brand-new', workspacePath: null, model: null });

        expect(starting.state.isSessionActive()).to.equal(true);
        expect(bystander.state.isSessionActive()).to.equal(false);
    });

    it('sets the configured model on the starting host only', () => {
        const workspace = new WorkspaceRuntimeState();
        const starting = makeHost({ workspace });
        const bystander = makeHost({ handle: 'host#2', sessionId: 'other', workspace });

        recordSessionStart(starting, { sessionId: 'x', workspacePath: null, model: 'claude-opus-5' });

        expect(starting.state.getCurrentModel()).to.equal('claude-opus-5');
        expect(bystander.state.getCurrentModel()).to.equal(null);
    });

    it('records the workspace path as window state, where every surface sees it', () => {
        const workspace = new WorkspaceRuntimeState();
        const starting = makeHost({ workspace });
        const bystander = makeHost({ handle: 'host#2', sessionId: 'other', workspace });

        recordSessionStart(starting, { sessionId: 'x', workspacePath: '/session-state/x', model: null });

        expect(bystander.getFullState().workspacePath).to.equal('/session-state/x');
    });

    it('starts a session that has no id yet without inventing one', () => {
        const host = makeHost({ sessionId: null });

        recordSessionStart(host, { sessionId: null, workspacePath: null, model: null });

        expect(host.sessionId).to.equal(null);
        expect(host.state.isSessionActive()).to.equal(true);
    });
});

describe('loadTranscriptInto()', () => {
    const { loadTranscriptInto } = require(
        path.join(__dirname, '../../..', 'out', 'extension', 'session', 'sessionBootstrap.js')
    );

    it('replays a session\'s history into that session\'s host alone', () => {
        const workspace = new WorkspaceRuntimeState();
        const restoring = makeHost({ sessionId: 'restoring', workspace });
        const bystander = makeHost({ handle: 'host#2', sessionId: 'other', workspace });
        bystander.state.addMessage({ kind: 'user', content: 'the sidebar conversation' });

        loadTranscriptInto(restoring, [
            { kind: 'user', content: 'from the log' },
            { kind: 'assistant', content: 'also from the log' }
        ]);

        expect(restoring.state.getMessages()).to.have.lengthOf(2);
        expect(bystander.state.getMessages()).to.have.lengthOf(1);
        expect(bystander.state.getMessages()[0].content).to.equal('the sidebar conversation');
    });
});
