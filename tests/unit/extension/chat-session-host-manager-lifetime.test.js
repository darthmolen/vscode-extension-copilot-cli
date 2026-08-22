/**
 * A manager lives and dies with its host (v3.13.0 P3 §4.3)
 *
 * `deactivate` disposed one module-level manager — the last-started session — so
 * every other host's CLI leaked. Already true on a session switch; one worse per
 * tab. And `wireManagerEvents` registered ~10 window-scoped handlers *per manager*
 * into `context.subscriptions`, which is extension-lifetime storage: a set leaked
 * per switch, another per tab.
 *
 * Both are the same mistake — a manager's lifetime pinned to the window rather
 * than to the conversation that owns it.
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

function makeFakeManager(name = 'm') {
    const calls = [];
    /** Live listeners per event, so a test can count them and fire them. */
    const listeners = new Map();
    const subscribe = (event) => (handler) => {
        const set = listeners.get(event) ?? new Set();
        set.add(handler);
        listeners.set(event, set);
        return { dispose: () => set.delete(handler) };
    };
    return new Proxy({
        name,
        calls,
        disposed: false,
        subscriberCount: (event) => listeners.get(event)?.size ?? 0,
        emit: (event, payload) => [...(listeners.get(event) ?? [])].forEach(fn => fn(payload)),
        stop: async () => { calls.push('stop'); },
        dispose() { this.disposed = true; calls.push('dispose'); }
    }, {
        get: (target, prop) => {
            if (prop in target) { return target[prop]; }
            if (prop === 'onDidBecomeIdle') { return undefined; }
            if (typeof prop === 'string' && prop.startsWith('onDid')) { return subscribe(prop); }
            return typeof prop === 'string' ? async () => {} : undefined;
        }
    });
}

describe('ChatSessionHost — manager lifetime', () => {
    let registry;

    beforeEach(() => {
        registry = new ChatSessionRegistry({
            workspace: new WorkspaceRuntimeState(),
            logger: silentLogger
        });
    });

    it('disposes its manager when the host is disposed', () => {
        const host = registry.create('session-a');
        const manager = makeFakeManager();
        host.attachManager(manager);

        registry.disposeHost(host);

        expect(manager.disposed, 'the CLI session outlived its host').to.equal(true);
    });

    it('disposeAll() reaches every host\'s manager, not just the last one started', () => {
        const a = makeFakeManager('a');
        const b = makeFakeManager('b');
        registry.create('session-a').attachManager(a);
        registry.create('session-b').attachManager(b);

        registry.disposeAll();

        expect(a.disposed).to.equal(true);
        expect(b.disposed).to.equal(true);
    });

    it('disposeAll() reaches a host that never got a session id', () => {
        const manager = makeFakeManager();
        registry.create(null).attachManager(manager);

        registry.disposeAll();

        expect(manager.disposed).to.equal(true);
    });

    it('disposes the manager it is replacing — nothing else holds it', () => {
        // With the module-level handle gone, the host is a manager's sole owner.
        // Replacing without disposing leaks a live CLI session per restart.
        const host = registry.create('session-a');
        const first = makeFakeManager('first');
        const second = makeFakeManager('second');

        host.attachManager(first);
        host.attachManager(second);

        expect(first.disposed).to.equal(true);
        expect(second.disposed).to.equal(false);
    });

    it('re-attaching the same manager does not dispose it', () => {
        const host = registry.create('session-a');
        const manager = makeFakeManager();

        host.attachManager(manager);
        host.attachManager(manager);

        expect(manager.disposed).to.equal(false);
    });

    it('detachManager() keeps the manager alive — a session switch depends on it', () => {
        const host = registry.create('session-a');
        const manager = makeFakeManager();
        host.attachManager(manager);

        host.detachManager();

        expect(manager.disposed).to.equal(false);
    });

    it('disposing one host leaves another host\'s manager running', () => {
        const a = registry.create('session-a');
        const b = registry.create('session-b');
        const managerA = makeFakeManager('a');
        const managerB = makeFakeManager('b');
        a.attachManager(managerA);
        b.attachManager(managerB);

        registry.disposeHost(a);

        expect(managerA.disposed).to.equal(true);
        expect(managerB.disposed, 'a bystander session was torn down').to.equal(false);
    });

    it('holds the window-scoped subscriptions its manager needs, and drops them with it', () => {
        // `wireManagerEvents` used to push these into `context.subscriptions`,
        // which lives as long as the extension does.
        const host = registry.create('session-a');
        let disposed = 0;
        host.ownManagerSubscription({ dispose: () => { disposed++; } });

        registry.disposeHost(host);

        expect(disposed).to.equal(1);
    });

    /**
     * The regression this file exists to prevent, found live (2026-08-22).
     *
     * **Two places attach the manager, and on one path they overlap.**
     * `wireManagerEvents` calls `attachManager` and *then* registers ~9
     * window-scoped handlers against the host. `ChatSessionHost.ensureStarted()`
     * then calls `attachManager` again with the very same manager, because
     * `startManager`'s contract is "hand back the manager and the host attaches it".
     *
     * The second call tore down and rebuilt the routing — harmless for the host's
     * own subscriptions, which it re-adds — and **released every window-scoped
     * subscription**, which it does not.
     *
     * Proven across two UAT logs. A session started through `handleNewSession`
     * (direct `startCLISession`, no `ensureStarted`) logged its window handlers on
     * every tool call; a session started through a tab's `ensureStarted` logged
     * **zero of 71**, and `[CLI Status]` went silent after startup while 50 turns
     * ran. That is the sub-agent dock, the status bar, the MCP state, `plan_ready`
     * and the dropdown refresh, all dead for the life of the session.
     *
     * So re-attaching the *same* manager is a no-op. Anything else makes correctness
     * depend on the order two independent callers happen to run in.
     */
    describe('attaching the same manager twice', () => {
        it('keeps the window subscriptions the composition root registered', () => {
            const host = registry.create('session-a');
            const manager = makeFakeManager();
            host.attachManager(manager);
            let disposed = 0;
            host.ownManagerSubscription({ dispose: () => { disposed++; } });

            host.attachManager(manager);

            expect(disposed, 'the second attach released the window handlers').to.equal(0);
        });

        it('does not tear down and rebuild its own routing either', () => {
            const host = registry.create('session-a');
            const manager = makeFakeManager();
            host.attachManager(manager);
            const firstRound = manager.subscriberCount('onDidStartTool');

            host.attachManager(manager);

            expect(manager.subscriberCount('onDidStartTool')).to.equal(firstRound,
                're-attaching resubscribed, so a single tool event would render twice');
        });

        it('still routes after the second attach', () => {
            const host = registry.create('session-a');
            const manager = makeFakeManager();
            const seen = [];
            host.attachSurface(new Proxy({}, {
                get: (_t, prop) => (arg) => { if (prop === 'notifyToolStart') { seen.push(arg); } }
            }));
            host.attachManager(manager);
            host.attachManager(manager);

            manager.emit('onDidStartTool', { toolName: 'bash' });

            expect(seen).to.have.lengthOf(1, 'exactly one chip per tool, and at least one');
        });

        it('does not dispose the manager it is being handed again', () => {
            const host = registry.create('session-a');
            const manager = makeFakeManager();
            host.attachManager(manager);

            host.attachManager(manager);

            expect(manager.disposed).to.equal(false);
        });

        it('a genuinely different manager still replaces the old one', () => {
            const host = registry.create('session-a');
            const first = makeFakeManager('first');
            const second = makeFakeManager('second');
            host.attachManager(first);
            let disposed = 0;
            host.ownManagerSubscription({ dispose: () => { disposed++; } });

            host.attachManager(second);

            expect(first.disposed).to.equal(true);
            expect(disposed, 'the old manager\'s window handlers must not outlive it').to.equal(1);
        });
    });

    it('drops the previous manager\'s window subscriptions when a new one is attached', () => {
        const host = registry.create('session-a');
        let disposed = 0;
        host.attachManager(makeFakeManager('first'));
        host.ownManagerSubscription({ dispose: () => { disposed++; } });

        host.attachManager(makeFakeManager('second'));

        expect(disposed, 'a restart left the old session\'s window handlers registered').to.equal(1);
    });
});
