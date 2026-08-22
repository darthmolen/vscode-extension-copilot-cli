/**
 * A closed tab winds its session down — when the work is finished (v3.13.0 P3 §4.4)
 *
 * Closing a chat tab disposed the *surface* and detached it, and left the host and
 * its manager alive for the life of the window. Open and close tabs over a day and
 * that is a live CLI session each, with no UI.
 *
 * Killing the session on close is the other extreme: it would abort a task the user
 * set running and merely stopped watching. So the rule is an orphaned host is a
 * host with no surface, **on a countdown that any reattach cancels**.
 *
 * Idle is a transition, not a state — it is the *first* one after the surface went
 * away, and if the host is not working when the surface goes there may be no
 * further transition at all, so that case winds down at once.
 *
 * The busy signal is the turn status the host already routes (`thinking` /
 * `ready`, from `assistant.turn_start` / `assistant.turn_end`). The SDK's stricter
 * `session.idle` — which also waits on background agents and attached shells —
 * lives in `sdkSessionManager.ts`, which is Lane A's file; see
 * `cross-talk:planning/cross-talk/B-to-A-02-session-idle-for-wind-down.md`.
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

/** A manager whose status stream the test drives by hand. */
function makeFakeManager() {
    let statusHandler = () => {};
    const noop = () => ({ dispose() {} });
    const manager = new Proxy({
        disposed: false,
        dispose() { this.disposed = true; },
        onDidChangeStatus: (handler) => { statusHandler = handler; return { dispose() {} }; },
        emitStatus: (status) => statusHandler({ status })
    }, {
        get: (target, prop) => prop in target
            ? target[prop]
            : (typeof prop === 'string' && prop.startsWith('onDid') ? noop : (typeof prop === 'string' ? async () => {} : undefined))
    });
    return manager;
}

function makeFakeSurface() {
    return new Proxy({}, { get: () => () => {} });
}

describe('an orphaned host winds down', () => {
    let registry;

    beforeEach(() => {
        registry = new ChatSessionRegistry({
            workspace: new WorkspaceRuntimeState(),
            logger: silentLogger
        });
    });

    function running(sessionId) {
        const host = registry.create(sessionId);
        const manager = makeFakeManager();
        const surface = makeFakeSurface();
        host.attachSurface(surface);
        host.attachManager(manager);
        return { host, manager, surface };
    }

    it('winds down at once when the surface goes while it is idle', () => {
        const { host, manager, surface } = running('session-a');

        host.detachSurface(surface);
        host.releaseWhenIdle();

        expect(manager.disposed).to.equal(true);
        expect(registry.get('session-a')).to.equal(undefined);
    });

    it('does NOT wind down mid-turn — the user only stopped watching', () => {
        const { host, manager, surface } = running('session-a');
        manager.emitStatus('thinking');

        host.detachSurface(surface);
        host.releaseWhenIdle();

        expect(manager.disposed, 'a running task was aborted because a tab closed').to.equal(false);
        expect(registry.get('session-a')).to.equal(host);
    });

    it('winds down on the first idle after the surface went away', () => {
        const { host, manager, surface } = running('session-a');
        manager.emitStatus('thinking');
        host.detachSurface(surface);
        host.releaseWhenIdle();

        manager.emitStatus('ready');

        expect(manager.disposed).to.equal(true);
        expect(registry.get('session-a')).to.equal(undefined);
    });

    it('a reattach before the countdown fires cancels it', () => {
        const { host, manager, surface } = running('session-a');
        manager.emitStatus('thinking');
        host.detachSurface(surface);
        host.releaseWhenIdle();

        host.attachSurface(makeFakeSurface());
        manager.emitStatus('ready');

        expect(manager.disposed, 'the session the user came back to was torn down').to.equal(false);
        expect(registry.get('session-a')).to.equal(host);
    });

    it('releaseWhenIdle on a host that still has a surface does nothing', () => {
        // The sidebar's slot is torn down and re-resolved by VS Code all the time;
        // only a genuinely closed tab calls this, and even then, defensively.
        const { host, manager } = running('session-a');

        host.releaseWhenIdle();

        expect(manager.disposed).to.equal(false);
    });

    it('a second idle after it has already wound down is harmless', () => {
        const { host, manager, surface } = running('session-a');
        manager.emitStatus('thinking');
        host.detachSurface(surface);
        host.releaseWhenIdle();
        manager.emitStatus('ready');

        manager.emitStatus('ready');

        expect(registry.get('session-a')).to.equal(undefined);
    });

    it('a session that exits while orphaned winds down too', () => {
        // A hung turn never goes idle and never winds down — today's behaviour for
        // every host, so not a regression, and a wall-clock deadline that kills a
        // long legitimate task would be worse. But an exit *is* an ending.
        const { host, manager, surface } = running('session-a');
        manager.emitStatus('thinking');
        host.detachSurface(surface);
        host.releaseWhenIdle();

        manager.emitStatus('exited');

        expect(manager.disposed).to.equal(true);
    });

    it('winds down only the orphan, never a bystander', () => {
        const orphan = running('session-a');
        const watched = running('session-b');

        orphan.host.detachSurface(orphan.surface);
        orphan.host.releaseWhenIdle();

        expect(orphan.manager.disposed).to.equal(true);
        expect(watched.manager.disposed).to.equal(false);
        expect(registry.get('session-b')).to.equal(watched.host);
    });

    it('a host with no session id still winds down — it is not reachable by id', () => {
        const host = registry.create(null);
        const manager = makeFakeManager();
        host.attachSurface(makeFakeSurface());
        host.attachManager(manager);

        host.detachSurface();
        host.releaseWhenIdle();

        expect(manager.disposed).to.equal(true);
        expect(registry.size).to.equal(0);
    });
});
