/**
 * SessionState / WorkspaceRuntimeState — the state split (v3.13.0 Task 3)
 *
 * `BackendState` mixed two lifetimes in one object: things that belong to a
 * conversation (id, messages, plan mode, model, agent) and things that belong
 * to the window (workspace path, active file, MCP tools and statuses). One
 * `BackendState` per chat surface would therefore have duplicated or staled the
 * second group.
 *
 * These tests pin the boundary before any host exists to consume it, and pin
 * that the existing `BackendState` facade still behaves exactly as it did — the
 * 16 call sites are re-pointed in Task 4, not here.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const {
    SessionState,
    WorkspaceRuntimeState,
    BackendState,
    getBackendState,
    getWorkspaceRuntimeState
} = require(path.join(__dirname, '../../..', 'out', 'backendState.js'));

describe('state split', () => {
    describe('SessionState — one per conversation', () => {
        it('keeps messages isolated between instances', () => {
            const a = new SessionState();
            const b = new SessionState();
            a.addMessage({ kind: 'user', content: 'only in a' });

            expect(a.getMessages()).to.have.lengthOf(1);
            expect(b.getMessages()).to.have.lengthOf(0);
        });

        it('keeps session identity isolated between instances', () => {
            const a = new SessionState();
            const b = new SessionState();
            a.setSessionId('session-a');
            b.setSessionId('session-b');

            expect(a.getSessionId()).to.equal('session-a');
            expect(b.getSessionId()).to.equal('session-b');
        });

        it('starts the clock when the session first becomes active', () => {
            const s = new SessionState();
            expect(s.getSessionStartTime()).to.equal(null);
            s.setSessionActive(true);
            expect(s.getSessionStartTime()).to.be.a('number');
        });

        it('counts tool messages separately from the rest', () => {
            const s = new SessionState();
            s.addMessage({ kind: 'user', content: 'hi' });
            s.addMessage({ kind: 'tool', content: 'edit', toolName: 'edit' });
            s.addMessage({ kind: 'tool', content: 'bash', toolName: 'bash' });

            expect(s.getMessageCount()).to.equal(3);
            expect(s.getToolCallCount()).to.equal(2);
        });

        it('returns a copy of messages so callers cannot mutate history', () => {
            const s = new SessionState();
            s.addMessage({ kind: 'user', content: 'original' });
            s.getMessages().push({ kind: 'user', content: 'injected' });

            expect(s.getMessages()).to.have.lengthOf(1);
        });
    });

    describe('WorkspaceRuntimeState — one per window', () => {
        it('is shared, so two holders observe one workspace path', () => {
            const shared = new WorkspaceRuntimeState();
            shared.setWorkspacePath('/repo');

            // Two hosts would each hold a reference to the same instance.
            const first = shared;
            const second = shared;
            second.setActiveFilePath('/repo/src/index.ts');

            expect(first.getWorkspacePath()).to.equal('/repo');
            expect(first.getActiveFilePath()).to.equal('/repo/src/index.ts');
        });

        it('holds MCP tools and statuses', () => {
            const w = new WorkspaceRuntimeState();
            w.setMcpServerTools('playwright', ['browser_click']);
            w.setMcpServerStatus('playwright', 'connected');

            expect(w.getMcpServerTools()).to.deep.equal({ playwright: ['browser_click'] });
            expect(w.getMcpServerStatuses()).to.deep.equal({ playwright: 'connected' });
        });
    });

    describe('BackendState facade — unchanged for existing callers', () => {
        it('still exposes session and workspace state through one object', () => {
            const s = new BackendState();
            s.setSessionId('abc');
            s.setWorkspacePath('/repo');
            s.addMessage({ kind: 'user', content: 'hello' });

            const full = s.getFullState();
            expect(full.sessionId).to.equal('abc');
            expect(full.workspacePath).to.equal('/repo');
            expect(full.messages).to.have.lengthOf(1);
        });

        it('reset() clears session state but keeps environment state', () => {
            const s = new BackendState();
            s.setSessionId('abc');
            s.setWorkspacePath('/repo');
            s.setActiveFilePath('/repo/a.ts');
            s.addMessage({ kind: 'user', content: 'hello' });

            s.reset();

            expect(s.getSessionId()).to.equal(null);
            expect(s.getMessages()).to.have.lengthOf(0);
            // Environment survives — this is why the two halves have different lifetimes.
            expect(s.getWorkspacePath()).to.equal('/repo');
            expect(s.getActiveFilePath()).to.equal('/repo/a.ts');
        });

        it('clearSession() drops MCP state', () => {
            const s = new BackendState();
            s.setMcpServerStatus('playwright', 'connected');
            s.clearSession();
            expect(s.getMcpServerStatuses()).to.deep.equal({});
        });
    });

    describe('singletons', () => {
        it('getBackendState returns the same instance', () => {
            expect(getBackendState()).to.equal(getBackendState());
        });

        it('the facade reads through to the shared workspace state', () => {
            // The window-scoped half must be the *same* object the facade uses,
            // or a host writing through one would be invisible to the other.
            getWorkspaceRuntimeState().setWorkspacePath('/shared-repo');
            expect(getBackendState().getWorkspacePath()).to.equal('/shared-repo');
        });
    });
});
