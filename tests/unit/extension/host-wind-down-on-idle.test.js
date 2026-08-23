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
 * **Two busy signals, and the stricter one wins where it exists.** Lane A shipped
 * `onDidBecomeIdle` on a non-replaying `SignalEmitter` — `session.idle` filtered to
 * session-level events, so a *sub-agent* going quiet cannot fire it while the
 * parent is still working. Where a manager offers it, that is what the countdown
 * waits for. Where it does not, the host falls back to the turn status it already
 * routes (`thinking` / `ready`), which is blind to background agents and attached
 * shells. See `cross-talk:planning/cross-talk/B-to-A-03-session-idle-for-wind-down.md`.
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

/**
 * A manager whose status stream the test drives by hand, and which **does not**
 * offer `onDidBecomeIdle`.
 *
 * The exclusion is load-bearing and was found the hard way: the `onDid*` catch-all
 * below happily invented an `onDidBecomeIdle`, so the host believed every fake
 * reported true idleness and the turn-status fallback stopped being exercised at
 * all. A fake that answers a question it was never taught is the same defect as a
 * fake that lies — it just fails on the branch nobody looked at.
 */
function makeFakeManager() {
    let statusHandler = () => {};
    const noop = () => ({ dispose() {} });
    const manager = new Proxy({
        disposed: false,
        dispose() { this.disposed = true; },
        onDidChangeStatus: (handler) => { statusHandler = handler; return { dispose() {} }; },
        emitStatus: (status) => statusHandler({ status })
    }, {
        get: (target, prop) => {
            if (prop in target) { return target[prop]; }
            // The whole point of this fake: it cannot report true idleness.
            if (prop === 'onDidBecomeIdle') { return undefined; }
            if (typeof prop === 'string' && prop.startsWith('onDid')) { return noop; }
            return typeof prop === 'string' ? async () => {} : undefined;
        }
    });
    return manager;
}

function makeFakeSurface() {
    return new Proxy({}, { get: () => () => {} });
}

/** A manager that also offers Lane A's stricter idle signal. */
function makeIdleAwareManager() {
    let idleHandler = null;
    const base = makeFakeManager();
    // Wrapped rather than assigned: the base is a Proxy that denies this key on
    // purpose, so a plain assignment would be swallowed.
    return new Proxy(base, {
        get: (target, prop) => {
            if (prop === 'onDidBecomeIdle') {
                return (handler) => { idleHandler = handler; return { dispose() {} }; };
            }
            if (prop === 'emitIdle') {
                return () => idleHandler && idleHandler();
            }
            return target[prop];
        },
        set: (target, prop, value) => { target[prop] = value; return true; }
    });
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

    describe('with a manager that reports true idleness', () => {
        function idleAware(sessionId) {
            const host = registry.create(sessionId);
            const manager = makeIdleAwareManager();
            const surface = makeFakeSurface();
            host.attachSurface(surface);
            host.attachManager(manager);
            return { host, manager, surface };
        }

        it('waits for the idle signal, not for the turn to end', () => {
            // The gap turn status cannot see: the assistant's turn ended, but a
            // background agent or an attached shell is still running. Winding down
            // there kills work the user only stopped watching.
            const { host, manager, surface } = idleAware('session-a');
            manager.emitStatus('thinking');
            host.detachSurface(surface);
            host.releaseWhenIdle();

            manager.emitStatus('ready');

            expect(manager.disposed, 'wound down on turn-end while the session was still busy')
                .to.equal(false);

            manager.emitIdle();

            expect(manager.disposed).to.equal(true);
        });

        it('winds down at once when the session was already idle', () => {
            const { host, manager, surface } = idleAware('session-a');
            manager.emitStatus('thinking');
            manager.emitIdle();

            host.detachSurface(surface);
            host.releaseWhenIdle();

            expect(manager.disposed).to.equal(true);
        });

        it('treats a session that has never worked as idle', () => {
            // Nothing has been asked of it, so there is no turn to wait for and no
            // idle signal will ever arrive.
            const { host, manager, surface } = idleAware('session-a');

            host.detachSurface(surface);
            host.releaseWhenIdle();

            expect(manager.disposed).to.equal(true);
        });

        it('a reattach before the signal cancels the countdown', () => {
            const { host, manager, surface } = idleAware('session-a');
            manager.emitStatus('thinking');
            host.detachSurface(surface);
            host.releaseWhenIdle();

            host.attachSurface(makeFakeSurface());
            manager.emitIdle();

            expect(manager.disposed).to.equal(false);
        });

        it('an exit still ends it, signal or no signal', () => {
            const { host, manager, surface } = idleAware('session-a');
            manager.emitStatus('thinking');
            host.detachSurface(surface);
            host.releaseWhenIdle();

            manager.emitStatus('exited');

            expect(manager.disposed).to.equal(true);
        });

        it('does not carry idleness across a manager swap', () => {
            // A new manager has said nothing yet. Inheriting the last one's quiet
            // would arm a countdown against a session that may be working.
            const host = registry.create('session-a');
            const first = makeIdleAwareManager();
            const surface = makeFakeSurface();
            host.attachSurface(surface);
            host.attachManager(first);
            first.emitStatus('thinking');
            first.emitIdle();

            const second = makeIdleAwareManager();
            host.attachManager(second);
            second.emitStatus('thinking');
            host.detachSurface(surface);
            host.releaseWhenIdle();

            expect(second.disposed, 'a fresh manager inherited the old one\'s state').to.equal(false);
            second.emitIdle();
            expect(second.disposed).to.equal(true);
        });
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
