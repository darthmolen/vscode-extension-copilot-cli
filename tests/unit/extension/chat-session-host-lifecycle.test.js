/**
 * Attachment is not bootstrap (v3.13.0 Task 6)
 *
 * The ready flow auto-resumes: `onDidBecomeReady` calls `resumeAndStartSession`,
 * because with one surface "the webview is ready" and "start the session" happen
 * together. Copied into a tab, that re-resumes or double-inits a session that is
 * already streaming.
 *
 * The rule this pins: **the host owns start/resume/load; a surface only attaches
 * and detaches.** Four verbs, kept apart because ACP keeps them apart —
 * `session/resume` restarts a session, `session/load` replays its history, and
 * collapsing them is what made "resume" mean two things (Lane A addendum).
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { ChatSessionRegistry } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'ChatSessionRegistry.js')
);
const { WorkspaceRuntimeState } = require(
    path.join(__dirname, '../../..', 'out', 'backendState.js')
);

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeFakeManager() {
    const noop = () => ({ dispose() {} });
    return new Proxy({}, {
        get: (_t, prop) => (typeof prop === 'string' && prop.startsWith('onDid') ? noop : undefined)
    });
}

describe('ChatSessionHost — attach vs bootstrap', () => {
    let registry, started;

    beforeEach(() => {
        started = [];
        registry = new ChatSessionRegistry({
            workspace: new WorkspaceRuntimeState(),
            logger: silentLogger,
            // Stands in for `startCLISession`. Recording what it was asked to do is
            // the whole assertion: case (a) must never reach here.
            startManager: async ({ sessionId, resume }) => {
                started.push({ sessionId, resume });
                return makeFakeManager();
            }
        });
    });

    it('starts nothing when a surface attaches to a live session', async () => {
        const host = registry.create('session-a');
        host.attachManager(makeFakeManager());

        host.attachSurface({});
        await host.ensureStarted();

        expect(started).to.have.lengthOf(0);
        expect(host.isLive).to.equal(true);
    });

    it('resumes a known session that is not running', async () => {
        const host = registry.create('session-a');

        await host.ensureStarted();

        expect(started).to.deep.equal([{ sessionId: 'session-a', resume: true }]);
        expect(host.isLive).to.equal(true);
    });

    it('starts fresh when there is no session to resume', async () => {
        const host = registry.create();

        await host.ensureStarted();

        expect(started).to.deep.equal([{ sessionId: null, resume: false }]);
    });

    it('starts once however many surfaces attach', async () => {
        const host = registry.create('session-a');

        await host.ensureStarted();
        await host.ensureStarted();
        await host.ensureStarted();

        expect(started).to.have.lengthOf(1);
    });

    it('does not start twice when two surfaces attach at the same moment', async () => {
        const host = registry.create('session-a');

        await Promise.all([host.ensureStarted(), host.ensureStarted()]);

        expect(started).to.have.lengthOf(1);
    });

    it('is not live before anything starts it', () => {
        const host = registry.create('session-a');

        expect(host.isLive).to.equal(false);
    });

    it('stops being live when its session ends', async () => {
        const host = registry.create('session-a');
        await host.ensureStarted();

        host.markStopped();

        expect(host.isLive).to.equal(false);
    });

    it('can be started again after stopping, and resumes rather than starting fresh', async () => {
        const host = registry.create('session-a');
        await host.ensureStarted();
        host.markStopped();

        await host.ensureStarted();

        expect(started).to.deep.equal([
            { sessionId: 'session-a', resume: true },
            { sessionId: 'session-a', resume: true }
        ]);
    });

    it('reports a failed start as not live, so a retry can try again', async () => {
        const failing = new ChatSessionRegistry({
            workspace: new WorkspaceRuntimeState(),
            logger: silentLogger,
            startManager: async () => { throw new Error('CLI missing'); }
        });
        const host = failing.create('session-a');

        let raised;
        try { await host.ensureStarted(); } catch (error) { raised = error; }

        expect(raised?.message).to.equal('CLI missing');
        expect(host.isLive).to.equal(false);
    });
});
