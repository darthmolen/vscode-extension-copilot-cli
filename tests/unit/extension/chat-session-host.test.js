/**
 * ChatSessionHost — one host per conversation (v3.13.0 Task 4)
 *
 * The extension had one module-level `sessionManager`, one `BackendState` and one
 * set of slash-command services, so "a chat session" was whatever those globals
 * happened to hold. A second surface needs more than one of them.
 *
 * These tests drive that out. Nothing here imports `vscode` or the SDK — the host
 * takes its manager and its window state by injection, which is also the point:
 * `WorkspaceRuntimeState` is shared *explicitly* at the composition root rather
 * than reached for as a global.
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

function makeHost(over = {}) {
    return new ChatSessionHost({
        handle: 'host#1',
        sessionId: 'session-a',
        workspace: new WorkspaceRuntimeState(),
        logger: silentLogger,
        ...over
    });
}

describe('ChatSessionHost', () => {
    it('gives each session its own transcript', () => {
        const workspace = new WorkspaceRuntimeState();
        const a = makeHost({ sessionId: 'session-a', workspace });
        const b = makeHost({ sessionId: 'session-b', workspace });

        a.state.addMessage({ kind: 'user', content: 'only in A' });

        expect(a.state.getMessages()).to.have.lengthOf(1);
        expect(b.state.getMessages()).to.have.lengthOf(0);
    });

    it('shares the workspace runtime state it was given', () => {
        const workspace = new WorkspaceRuntimeState();
        const a = makeHost({ sessionId: 'session-a', workspace });
        const b = makeHost({ sessionId: 'session-b', workspace });

        workspace.setActiveFilePath('/repo/src/extension.ts');

        expect(a.workspace.getActiveFilePath()).to.equal('/repo/src/extension.ts');
        expect(b.workspace.getActiveFilePath()).to.equal('/repo/src/extension.ts');
    });

    it('runs its teardown once, however many times it is disposed', () => {
        // `disposeAll()` after an explicit `dispose()` is the live path for this —
        // closing a tab and then reloading the window.
        const host = makeHost();
        let disposed = 0;
        host.onDispose(() => { disposed++; });

        host.dispose();
        host.dispose();

        expect(disposed).to.equal(1);
    });

    it('carries the session id on its own state, not just as a field', () => {
        const host = makeHost({ sessionId: 'session-xyz' });

        expect(host.sessionId).to.equal('session-xyz');
        expect(host.state.getSessionId()).to.equal('session-xyz');
    });

    /**
     * A host outlives the CLI session it speaks for, in both directions: the
     * sidebar's host exists before `manager.start()` has assigned an id (that id
     * only arrives in `onSessionStarted`), and Task 6 case (c) has the host start
     * a fresh session under a new one.
     */
    describe('session identity', () => {
        it('can exist before the CLI has assigned an id', () => {
            const host = makeHost({ sessionId: null });

            expect(host.sessionId).to.equal(null);
            expect(host.state.getSessionId()).to.equal(null);
        });

        it('adopts the id the CLI assigns once the session starts', () => {
            const host = makeHost({ sessionId: null });

            host.adoptSessionId('session-from-cli');

            expect(host.sessionId).to.equal('session-from-cli');
            expect(host.state.getSessionId()).to.equal('session-from-cli');
        });

        it('keeps its transcript when it adopts an id', () => {
            const host = makeHost({ sessionId: null });
            host.state.addMessage({ kind: 'user', content: 'sent before start' });

            host.adoptSessionId('session-from-cli');

            expect(host.state.getMessages()).to.have.lengthOf(1);
        });
    });

    /**
     * `_setupRpcHandlers` built the slash-command services *during* handler
     * registration and assigned them back onto the handler context. With one
     * surface that is invisible; a second surface re-registers and overwrites the
     * first's services. Construction belongs to the session, once.
     */
    describe('slash-command services', () => {
        function countingFactory() {
            const calls = [];
            const factory = (host) => {
                calls.push(host);
                return { builtFor: host.sessionId };
            };
            factory.calls = calls;
            return factory;
        }

        it('builds them once, however often they are read', () => {
            const createServices = countingFactory();
            const host = makeHost({ createServices });

            const first = host.services;
            const second = host.services;

            expect(createServices.calls).to.have.lengthOf(1);
            expect(second).to.equal(first);
        });

        it('builds them for the host that owns them', () => {
            const createServices = countingFactory();
            const host = makeHost({ sessionId: 'session-xyz', createServices });

            expect(host.services.builtFor).to.equal('session-xyz');
            expect(createServices.calls[0]).to.equal(host);
        });

        it('never lets one session overwrite another session services', () => {
            const createServices = countingFactory();
            const a = makeHost({ sessionId: 'session-a', createServices });
            const b = makeHost({ sessionId: 'session-b', createServices });

            expect(a.services).to.not.equal(b.services);
            expect(a.services.builtFor).to.equal('session-a');
            expect(b.services.builtFor).to.equal('session-b');
        });
    });
});
