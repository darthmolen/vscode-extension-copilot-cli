/**
 * ChatSessionHost routes its manager's events to its own surface (v3.13.0 Task 5)
 *
 * `wireManagerEvents` closes over the module-level `chatProvider`, so every manager
 * event in the window lands on the sidebar no matter which session produced it.
 * With one session that is invisible. With two it is the bug: a tab's output would
 * stream into the sidebar.
 *
 * These tests are the reason the task exists — two hosts, two managers, two
 * surfaces, and nothing crosses. Neither the manager nor the surface is a real
 * one: the host declares only the slice it touches, so a fake satisfies it.
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

/** Every manager event the host subscribes to, as a fake emitter. */
const MANAGER_EVENTS = [
    'onDidReceiveOutput',
    'onDidReceiveReasoning',
    'onDidReceiveError',
    'onDidMessageDelta',
    'onDidReceiveReasoningDelta',
    'onDidTaskComplete'
];

function makeFakeManager() {
    const handlers = {};
    const manager = { disposedSubscriptions: 0 };
    for (const event of MANAGER_EVENTS) {
        manager[event] = (handler) => {
            handlers[event] = handler;
            // Disposing really stops delivery, as `vscode.EventEmitter` does. A
            // fake that merely counted the dispose would let a "we unsubscribed"
            // assertion pass while events still arrived.
            return {
                dispose: () => {
                    if (handlers[event] !== handler) { return; }
                    delete handlers[event];
                    manager.disposedSubscriptions++;
                }
            };
        };
    }
    // Emitting to nobody is a real state (post-dispose), not a test error.
    manager.emit = (event, payload) => handlers[event]?.(payload);
    manager.isSubscribed = (event) => Boolean(handlers[event]);
    return manager;
}

function makeFakeSurface() {
    const calls = [];
    const record = (name) => (...args) => calls.push({ name, args });
    return {
        calls,
        addAssistantMessage: record('addAssistantMessage'),
        addReasoningMessage: record('addReasoningMessage'),
        sendMessageDelta: record('sendMessageDelta'),
        sendReasoningDelta: record('sendReasoningDelta'),
        sendTaskComplete: record('sendTaskComplete'),
        setThinking: record('setThinking'),
        names: function () { return this.calls.map(c => c.name); }
    };
}

describe('ChatSessionHost — manager event routing', () => {
    let registry;

    beforeEach(() => {
        registry = new ChatSessionRegistry({
            workspace: new WorkspaceRuntimeState(),
            logger: silentLogger
        });
    });

    function attachedHost(sessionId) {
        const host = registry.create(sessionId);
        const manager = makeFakeManager();
        const surface = makeFakeSurface();
        host.attachSurface(surface);
        host.attachManager(manager);
        return { host, manager, surface };
    }

    it('sends assistant output to its own surface and stops the spinner', () => {
        const { manager, surface } = attachedHost('session-a');

        manager.emit('onDidReceiveOutput', { content: 'hello', messageId: 'm1' });

        expect(surface.calls[0]).to.deep.equal({
            name: 'addAssistantMessage', args: ['hello', 'm1']
        });
        expect(surface.names()).to.include('setThinking');
    });

    it('never delivers one session output to another session surface', () => {
        const a = attachedHost('session-a');
        const b = attachedHost('session-b');

        a.manager.emit('onDidReceiveOutput', { content: 'for A only', messageId: 'm1' });

        expect(a.surface.names()).to.include('addAssistantMessage');
        expect(b.surface.calls).to.have.lengthOf(0);
    });

    it('routes streaming deltas to the surface that owns the stream', () => {
        const a = attachedHost('session-a');
        const b = attachedHost('session-b');

        a.manager.emit('onDidMessageDelta', { messageId: 'm1', deltaContent: 'tok' });
        b.manager.emit('onDidReceiveReasoningDelta', { reasoningId: 'r1', deltaContent: 'think' });

        expect(a.surface.names()).to.deep.equal(['sendMessageDelta']);
        expect(b.surface.names()).to.deep.equal(['sendReasoningDelta']);
    });

    it('renders an error as an assistant message on its own surface', () => {
        const { surface } = (() => {
            const attached = attachedHost('session-a');
            attached.manager.emit('onDidReceiveError', 'boom');
            return attached;
        })();

        expect(surface.calls[0].name).to.equal('addAssistantMessage');
        expect(surface.calls[0].args[0]).to.contain('boom');
    });

    it('subscribes to every manager event it claims to route', () => {
        const { manager } = attachedHost('session-a');

        for (const event of MANAGER_EVENTS) {
            expect(manager.isSubscribed(event), event).to.equal(true);
        }
    });

    /**
     * A host outlives its managers: `startSession` builds a fresh
     * `SDKSessionManager` on every restart and session switch, while the sidebar's
     * host persists for the window. Re-attaching must replace the wiring, not add
     * to it — otherwise each restart doubles every message on screen.
     */
    it('stops routing the old manager when a new one is attached', () => {
        const host = registry.create('session-a');
        const surface = makeFakeSurface();
        host.attachSurface(surface);
        const first = makeFakeManager();
        const second = makeFakeManager();
        host.attachManager(first);

        host.attachManager(second);

        expect(first.disposedSubscriptions).to.equal(MANAGER_EVENTS.length);
        first.emit('onDidReceiveOutput', { content: 'from the dead manager', messageId: 'm0' });
        expect(surface.calls).to.have.lengthOf(0);

        second.emit('onDidReceiveOutput', { content: 'live', messageId: 'm1' });
        expect(surface.names()).to.deep.equal(['addAssistantMessage', 'setThinking']);
    });

    it('unsubscribes from the manager when the host is disposed', () => {
        const { host, manager } = attachedHost('session-a');

        registry.disposeHost(host);

        expect(manager.disposedSubscriptions).to.equal(MANAGER_EVENTS.length);
    });

    it('drops events once disposed rather than writing to a dead surface', () => {
        const { host, manager, surface } = attachedHost('session-a');
        registry.disposeHost(host);

        manager.emit('onDidReceiveOutput', { content: 'too late', messageId: 'm1' });

        expect(surface.calls).to.have.lengthOf(0);
    });
});
