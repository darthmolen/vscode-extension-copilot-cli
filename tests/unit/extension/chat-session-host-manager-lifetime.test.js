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
    const noop = () => ({ dispose() {} });
    return new Proxy({
        name,
        calls,
        disposed: false,
        stop: async () => { calls.push('stop'); },
        dispose() { this.disposed = true; calls.push('dispose'); }
    }, {
        get: (target, prop) => prop in target
            ? target[prop]
            : (typeof prop === 'string' && prop.startsWith('onDid') ? noop : (typeof prop === 'string' ? async () => {} : undefined))
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

    it('drops the previous manager\'s window subscriptions when a new one is attached', () => {
        const host = registry.create('session-a');
        let disposed = 0;
        host.attachManager(makeFakeManager('first'));
        host.ownManagerSubscription({ dispose: () => { disposed++; } });

        host.attachManager(makeFakeManager('second'));

        expect(disposed, 'a restart left the old session\'s window handlers registered').to.equal(1);
    });
});
