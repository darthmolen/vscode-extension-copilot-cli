/**
 * C1 — a surface renders *its own* session, not the window's singleton.
 *
 * `ChatViewProvider.sendInit()` read `getBackendState().getFullState()`. With one
 * surface that was indistinguishable from correct, because the sidebar's host was
 * deliberately handed the facade's `SessionState`. With a second surface it means
 * a panel would render the sidebar's transcript.
 *
 * The composition itself — session fields plus window fields — lives in exactly
 * one function, `composeFullState`, because this repo has now shipped the same
 * bug three times (three hand-built init payloads, two argument formatters) by
 * letting one truth live in two places.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { ChatSessionHost } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'ChatSessionHost.js')
);
const { WorkspaceRuntimeState, SessionState, BackendState, composeFullState } = require(
    path.join(__dirname, '../../..', 'out', 'backendState.js')
);

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeHost(over = {}) {
    return new ChatSessionHost({
        handle: 'host#1',
        sessionId: 'session-a',
        workspace: new WorkspaceRuntimeState(),
        logger: silentLogger,
        ...over
    });
}

describe('ChatSessionHost.getFullState()', () => {
    it('reports this host\'s own transcript, not another host\'s', () => {
        const workspace = new WorkspaceRuntimeState();
        const a = makeHost({ sessionId: 'session-a', workspace });
        const b = makeHost({ handle: 'host#2', sessionId: 'session-b', workspace });

        a.state.addMessage({ kind: 'user', content: 'only in A' });

        expect(a.getFullState().messages).to.have.lengthOf(1);
        expect(b.getFullState().messages).to.have.lengthOf(0);
    });

    it('reports this host\'s own session id and model', () => {
        const workspace = new WorkspaceRuntimeState();
        const a = makeHost({ sessionId: 'session-a', workspace });
        const b = makeHost({ handle: 'host#2', sessionId: 'session-b', workspace });
        a.state.setCurrentModel('claude-opus-5');
        b.state.setCurrentModel('gpt-5-mini');

        expect(a.getFullState().sessionId).to.equal('session-a');
        expect(b.getFullState().sessionId).to.equal('session-b');
        expect(a.getFullState().currentModel).to.equal('claude-opus-5');
        expect(b.getFullState().currentModel).to.equal('gpt-5-mini');
    });

    it('reports the window\'s workspace and active file, shared by every host', () => {
        const workspace = new WorkspaceRuntimeState();
        workspace.setWorkspacePath('/repo');
        workspace.setActiveFilePath('/repo/src/extension.ts');

        const a = makeHost({ sessionId: 'session-a', workspace });
        const b = makeHost({ handle: 'host#2', sessionId: 'session-b', workspace });

        for (const host of [a, b]) {
            expect(host.getFullState().workspacePath).to.equal('/repo');
            expect(host.getFullState().activeFilePath).to.equal('/repo/src/extension.ts');
        }
    });

    it('tracks the id the host adopts when its CLI session starts', () => {
        const host = makeHost({ sessionId: null });
        expect(host.getFullState().sessionId).to.equal(null);

        host.adoptSessionId('assigned-later');

        expect(host.getFullState().sessionId).to.equal('assigned-later');
    });
});

describe('composeFullState() is the one composition', () => {
    it('produces the same value for the facade and for a host over the same state', () => {
        const session = new SessionState();
        const workspace = new WorkspaceRuntimeState();
        session.setSessionId('shared');
        session.setSessionActive(true);
        session.setCurrentModel('claude-opus-5');
        session.addMessage({ kind: 'user', content: 'hello' });
        workspace.setWorkspacePath('/repo');
        workspace.setActiveFilePath('/repo/a.ts');

        const facade = new BackendState(session, workspace);
        const host = makeHost({ sessionId: 'shared', state: session, workspace });

        // Value comparison, not field-name comparison: the drift this guards
        // against is two builders that disagree, and only a value catches that.
        expect(host.getFullState()).to.deep.equal(facade.getFullState());
        expect(facade.getFullState()).to.deep.equal(composeFullState(session, workspace));
    });
});
