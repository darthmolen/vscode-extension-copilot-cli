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
    'onDidTaskComplete',
    'onDidStartTool',
    'onDidUpdateTool',
    'onDidCompleteTool',
    'onDidStartSubagent',
    'onDidSubagentMessage',
    'onDidCompleteSubagent',
    'onDidChangeStatus',
    'onDidProduceDiff',
    'onDidUpdateUsage'
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
        addToolExecution: record('addToolExecution'),
        updateToolExecution: record('updateToolExecution'),
        startSubagent: record('startSubagent'),
        subagentMessage: record('subagentMessage'),
        completeSubagent: record('completeSubagent'),
        setSessionActive: record('setSessionActive'),
        sendModelSwitched: record('sendModelSwitched'),
        postMessage: record('postMessage'),
        notifyDiffAvailable: record('notifyDiffAvailable'),
        names: function () { return this.calls.map(c => c.name); },
        argsFor: function (name) { return this.calls.filter(c => c.name === name).map(c => c.args); }
    };
}

describe('ChatSessionHost — manager event routing', () => {
    let registry;

    beforeEach(() => {
        registry = new ChatSessionRegistry({
            workspace: new WorkspaceRuntimeState(),
            logger: silentLogger,
            // Window-scoped and memoised in production, which is what lets the host
            // and the pop-out panels colour the same agent identically without
            // sharing a call site.
            assignSubagentColor: (agentId) => `colour-for-${agentId}`,
            // Reading the before/after files is window-scoped I/O, injected so the
            // host stays testable and free of fs.
            enrichDiff: (diffData) => ({ ...diffData, diffLines: ['+one'], diffTotalLines: 1 })
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

    describe('tools', () => {
        it('sends a starting tool to its own surface', () => {
            const a = attachedHost('session-a');
            const b = attachedHost('session-b');

            a.manager.emit('onDidStartTool', { name: 'bash', toolCallId: 't1' });

            expect(a.surface.argsFor('addToolExecution')).to.deep.equal([[{ name: 'bash', toolCallId: 't1' }]]);
            expect(b.surface.calls).to.have.lengthOf(0);
        });

        it('sends both tool updates and completions as updates', () => {
            const { manager, surface } = attachedHost('session-a');

            manager.emit('onDidUpdateTool', { toolCallId: 't1', status: 'running' });
            manager.emit('onDidCompleteTool', { toolCallId: 't1', status: 'success' });

            expect(surface.names()).to.deep.equal(['updateToolExecution', 'updateToolExecution']);
            expect(surface.argsFor('updateToolExecution')[1][0].status).to.equal('success');
        });
    });

    describe('sub-agents', () => {
        it('colours a starting sub-agent before handing it to its surface', () => {
            const { manager, surface } = attachedHost('session-a');

            manager.emit('onDidStartSubagent', { agentId: 'agent-7', agentName: 'explorer' });

            expect(surface.argsFor('startSubagent')).to.deep.equal([[{
                agentId: 'agent-7', agentName: 'explorer', color: 'colour-for-agent-7'
            }]]);
        });

        it('keeps sub-agent traffic on the surface that spawned it', () => {
            const a = attachedHost('session-a');
            const b = attachedHost('session-b');

            a.manager.emit('onDidSubagentMessage', { agentId: 'agent-7', content: 'progress' });
            a.manager.emit('onDidCompleteSubagent', { agentId: 'agent-7' });

            expect(a.surface.names()).to.deep.equal(['subagentMessage', 'completeSubagent']);
            expect(b.surface.calls).to.have.lengthOf(0);
        });
    });

    /**
     * The status switch mixes two lifetimes: what the session's surface shows, and
     * window-scoped work (status bar, toasts, the session dropdown). Only the first
     * belongs to a host — the second must stay in `extension.ts`, or a background
     * tab would rewrite the window's status bar.
     */
    describe('status', () => {
        it('drives the spinner from thinking and ready', () => {
            const { manager, surface } = attachedHost('session-a');

            manager.emit('onDidChangeStatus', { status: 'thinking' });
            manager.emit('onDidChangeStatus', { status: 'ready' });

            expect(surface.argsFor('setThinking')).to.deep.equal([[true], [false]]);
        });

        it('marks its own session inactive when the CLI exits', () => {
            const a = attachedHost('session-a');
            const b = attachedHost('session-b');

            a.manager.emit('onDidChangeStatus', { status: 'exited' });

            expect(a.surface.argsFor('setSessionActive')).to.deep.equal([[false]]);
            expect(a.host.state.isSessionActive()).to.equal(false);
            expect(b.surface.calls).to.have.lengthOf(0);
        });

        it('reports an abort on its own surface', () => {
            const { manager, surface } = attachedHost('session-a');

            manager.emit('onDidChangeStatus', { status: 'aborted' });

            expect(surface.argsFor('addAssistantMessage')[0][0]).to.contain('stopped by user');
            expect(surface.argsFor('setThinking')).to.deep.equal([[false]]);
        });

        it('adopts the replacement id when its session expires', () => {
            const { host, manager } = attachedHost('session-a');

            manager.emit('onDidChangeStatus', { status: 'session_expired', newSessionId: 'session-fresh' });

            expect(host.sessionId).to.equal('session-fresh');
            expect(registry.get('session-fresh')).to.equal(host);
            expect(registry.get('session-a')).to.equal(undefined);
        });

        it('records a model switch on its own state and tells its surface', () => {
            const { host, manager, surface } = attachedHost('session-a');

            manager.emit('onDidChangeStatus', { status: 'model_switched', model: 'claude-opus-5' });

            expect(host.state.getCurrentModel()).to.equal('claude-opus-5');
            expect(surface.argsFor('sendModelSwitched')).to.deep.equal([['claude-opus-5', true]]);
        });

        it('reports a failed model switch without recording it', () => {
            const { host, manager, surface } = attachedHost('session-a');

            manager.emit('onDidChangeStatus', { status: 'model_switch_failed', model: 'claude-opus-5' });

            expect(host.state.getCurrentModel()).to.equal(null);
            expect(surface.argsFor('sendModelSwitched')).to.deep.equal([['claude-opus-5', false]]);
        });

        it('forwards plan-mode status to its own surface', () => {
            const a = attachedHost('session-a');
            const b = attachedHost('session-b');

            a.manager.emit('onDidChangeStatus', { status: 'plan_accepted' });

            expect(a.surface.argsFor('postMessage')).to.deep.equal([
                [{ type: 'status', data: { status: 'plan_accepted' } }]
            ]);
            expect(a.surface.argsFor('setThinking')).to.deep.equal([[true]]);
            expect(b.surface.calls).to.have.lengthOf(0);
        });

        it('ignores a status that means nothing to a surface', () => {
            const { surface, manager } = attachedHost('session-a');

            manager.emit('onDidChangeStatus', { status: 'session_renamed', name: 'renamed' });

            expect(surface.calls).to.have.lengthOf(0);
        });
    });

    it('sends a diff to its own surface, enriched', () => {
        const a = attachedHost('session-a');
        const b = attachedHost('session-b');

        a.manager.emit('onDidProduceDiff', { title: 'edit', beforeUri: '/a', afterUri: '/b' });

        expect(a.surface.argsFor('notifyDiffAvailable')).to.deep.equal([[{
            title: 'edit', beforeUri: '/a', afterUri: '/b', diffLines: ['+one'], diffTotalLines: 1
        }]]);
        expect(b.surface.calls).to.have.lengthOf(0);
    });

    it('sends token usage to its own surface', () => {
        const { manager, surface } = attachedHost('session-a');

        manager.emit('onDidUpdateUsage', { currentTokens: 10, tokenLimit: 100 });

        expect(surface.argsFor('postMessage')).to.deep.equal([[{
            type: 'usage_info', data: { currentTokens: 10, tokenLimit: 100 }
        }]]);
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
