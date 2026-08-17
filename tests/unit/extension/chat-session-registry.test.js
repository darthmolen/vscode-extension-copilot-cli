/**
 * ChatSessionRegistry — the one place that knows which sessions are live (v3.13.0 Task 4)
 *
 * Task 7's serializer and Task 6's attach flow both need the same question answered:
 * "is this session already running, or am I starting it?" Today nothing can answer it,
 * because a live session is just whatever the module-level `sessionManager` points at.
 *
 * The registry answers it. `get()` is the "already live?" probe — deliberately
 * non-creating, because Task 6's case (a) must attach to a running session without
 * starting anything.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { ChatSessionRegistry } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'ChatSessionRegistry.js')
);
const { WorkspaceRuntimeState } = require(
    path.join(__dirname, '../../..', 'out', 'backendState.js')
);

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeRegistry(over = {}) {
    return new ChatSessionRegistry({
        workspace: new WorkspaceRuntimeState(),
        logger: silentLogger,
        ...over
    });
}

describe('ChatSessionRegistry', () => {
    it('does not report a session that was never created', () => {
        const registry = makeRegistry();

        expect(registry.get('never-started')).to.equal(undefined);
    });

    it('returns the same host for repeated getOrCreate on one session', async () => {
        const registry = makeRegistry();

        const first = await registry.getOrCreate('session-a');
        const second = await registry.getOrCreate('session-a');

        expect(second).to.equal(first);
        expect(registry.get('session-a')).to.equal(first);
    });

    it('keeps separate hosts for separate sessions', async () => {
        const registry = makeRegistry();

        const a = await registry.getOrCreate('session-a');
        const b = await registry.getOrCreate('session-b');

        expect(b).to.not.equal(a);
        expect(b.sessionId).to.equal('session-b');
    });

    it('hands every host the same workspace runtime state', async () => {
        const workspace = new WorkspaceRuntimeState();
        const registry = makeRegistry({ workspace });

        const a = await registry.getOrCreate('session-a');
        const b = await registry.getOrCreate('session-b');
        workspace.setActiveFilePath('/repo/README.md');

        expect(a.workspace.getActiveFilePath()).to.equal('/repo/README.md');
        expect(b.workspace).to.equal(a.workspace);
    });

    it('gives every host its own slash-command services', async () => {
        const built = [];
        const registry = makeRegistry({
            createServices: (host) => {
                built.push(host.sessionId);
                return { builtFor: host.sessionId };
            }
        });

        const a = await registry.getOrCreate('session-a');
        const b = await registry.getOrCreate('session-b');

        expect(a.services.builtFor).to.equal('session-a');
        expect(b.services.builtFor).to.equal('session-b');
        expect(built).to.deep.equal(['session-a', 'session-b']);
    });

    /**
     * The red path: the CLI never starts (auth failure, missing bundle, wrong Node),
     * so `onSessionStarted` never fires and no id is ever assigned. The host is real
     * — it holds the user's message and the error bubble — and it must not become
     * invisible just because the thing it speaks for failed to exist.
     */
    describe('a host whose session never materialises', () => {
        it('tracks a host created before any id exists', () => {
            const registry = makeRegistry();

            const host = registry.create();

            expect(host.sessionId).to.equal(null);
            expect(registry.size).to.equal(1);
        });

        it('tears down a pending host on disposeAll, rather than stranding it', () => {
            const registry = makeRegistry();
            const host = registry.create();
            let disposed = 0;
            host.onDispose(() => { disposed++; });

            registry.disposeAll();

            expect(disposed).to.equal(1);
            expect(registry.size).to.equal(0);
        });

        it('can be disposed directly, having no id to dispose by', () => {
            const registry = makeRegistry();
            const host = registry.create();
            let disposed = 0;
            host.onDispose(() => { disposed++; });

            registry.disposeHost(host);

            expect(disposed).to.equal(1);
            expect(registry.size).to.equal(0);
        });

        it('becomes findable by id once the retry succeeds and it adopts one', () => {
            const registry = makeRegistry();
            const host = registry.create();

            host.adoptSessionId('session-after-retry');

            expect(registry.get('session-after-retry')).to.equal(host);
            expect(registry.size).to.equal(1);
        });

        it('does not double-count a host that adopts an id', () => {
            const registry = makeRegistry();
            const host = registry.create();

            host.adoptSessionId('session-a');
            host.adoptSessionId('session-a-renamed');

            expect(registry.size).to.equal(1);
            expect(registry.get('session-a')).to.equal(undefined);
            expect(registry.get('session-a-renamed')).to.equal(host);
        });
    });

    /**
     * One session, one host is load-bearing for v3.13.0, and Task 6 case (a) is what
     * enforces it. This is the backstop for when something upstream resumes a session
     * that is already open — so the log line has to identify *both* hosts, or the
     * upstream bug is merely noticed rather than diagnosable (Lane A, rec. 6).
     */
    it('names both hosts when two of them claim one session', () => {
        const warnings = [];
        const registry = makeRegistry({
            logger: { ...silentLogger, warn: (message) => warnings.push(message) }
        });
        const incumbent = registry.create();
        const newcomer = registry.create();

        incumbent.adoptSessionId('session-a');
        newcomer.adoptSessionId('session-a');

        expect(warnings).to.have.lengthOf(1);
        expect(warnings[0]).to.contain('session-a');
        expect(warnings[0]).to.contain(incumbent.handle);
        expect(warnings[0]).to.contain(newcomer.handle);
        expect(incumbent.handle).to.not.equal(newcomer.handle);
    });

    it('forgets a disposed session so the next getOrCreate builds a fresh host', async () => {
        const registry = makeRegistry();
        const first = await registry.getOrCreate('session-a');

        registry.dispose('session-a');

        expect(registry.get('session-a')).to.equal(undefined);
        expect(await registry.getOrCreate('session-a')).to.not.equal(first);
    });

    it('disposes the host it drops', async () => {
        const registry = makeRegistry();
        const host = await registry.getOrCreate('session-a');
        let disposed = 0;
        host.onDispose(() => { disposed++; });

        registry.dispose('session-a');

        expect(disposed).to.equal(1);
    });

    it('disposes every live host on disposeAll', async () => {
        const registry = makeRegistry();
        let disposed = 0;
        (await registry.getOrCreate('session-a')).onDispose(() => { disposed++; });
        (await registry.getOrCreate('session-b')).onDispose(() => { disposed++; });

        registry.disposeAll();

        expect(disposed).to.equal(2);
        expect(registry.get('session-a')).to.equal(undefined);
        expect(registry.get('session-b')).to.equal(undefined);
    });

    it('ignores disposing a session it never had', () => {
        const registry = makeRegistry();

        expect(() => registry.dispose('never-started')).to.not.throw();
    });
});
