/**
 * The verbs that used to be the module-level `sessionManager` (v3.13.0 P3 step 1)
 *
 * Plan mode, stop, the model list, attachment validation and the two MCP lists all
 * reached `extension.ts`'s single `sessionManager` handle. With one surface that
 * read "the window's session"; with a tab open it reads "whichever session started
 * last", which is defect C — the tab's plan-mode toggle driving the sidebar.
 *
 * So each becomes a verb on the host, forwarding to the manager the host owns.
 * `.manager` stays `#private`: Task 5 rerouted 75 call sites through the host
 * precisely so v4.0 can swap it for an AHP session handle, and these ten must not
 * be the exception that undoes it.
 *
 * The second property is the one §8 calls the sharpest edge: a verb invoked with no
 * live session must *say so* rather than return silently. `acceptPlan` returning
 * quietly is how the wrong-session bug hid for a whole cycle.
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

/** Records commands; every `onDid*` subscription is an inert no-op. */
function makeFakeManager() {
    const calls = [];
    const noop = () => ({ dispose() {} });
    return new Proxy({
        calls,
        enablePlanMode: async () => { calls.push(['enablePlanMode']); },
        disablePlanMode: async () => { calls.push(['disablePlanMode']); },
        acceptPlan: async () => { calls.push(['acceptPlan']); },
        rejectPlan: async () => { calls.push(['rejectPlan']); },
        stop: async () => { calls.push(['stop']); },
        getPlanFilePath: () => { calls.push(['getPlanFilePath']); return '/plans/here.md'; },
        getAvailableModels: async () => { calls.push(['getAvailableModels']); return [{ id: 'gpt-5' }]; },
        validateAttachments: async (p) => { calls.push(['validateAttachments', p]); return { valid: true }; },
        listMcpServers: async () => { calls.push(['listMcpServers']); return [{ name: 'a' }]; },
        listConfiguredMcpServers: async () => { calls.push(['listConfiguredMcpServers']); return { a: {} }; },
        forkSession: async (id, opts) => { calls.push(['forkSession', id, opts]); return `${id}-fork`; }
    }, {
        get: (target, prop) => prop in target
            ? target[prop]
            : (typeof prop === 'string' && prop.startsWith('onDid') ? noop : undefined)
    });
}

/** Only the two members these verbs can reach for. */
function makeFakeSurface() {
    const said = [];
    return new Proxy({ said, addAssistantMessage: (text) => { said.push(text); } }, {
        get: (target, prop) => prop in target ? target[prop] : () => {}
    });
}

describe('ChatSessionHost — the verbs that were the global', () => {
    let registry;

    beforeEach(() => {
        registry = new ChatSessionRegistry({
            workspace: new WorkspaceRuntimeState(),
            logger: silentLogger
        });
    });

    function attached(sessionId) {
        const host = registry.create(sessionId);
        const manager = makeFakeManager();
        const surface = makeFakeSurface();
        host.attachSurface(surface);
        host.attachManager(manager);
        return { host, manager, surface };
    }

    function idle(sessionId) {
        const host = registry.create(sessionId);
        const surface = makeFakeSurface();
        host.attachSurface(surface);
        return { host, surface };
    }

    describe('each command reaches its own session and no other', () => {
        const commands = [
            ['enablePlanMode', 'enablePlanMode'],
            ['disablePlanMode', 'disablePlanMode'],
            ['acceptPlan', 'acceptPlan'],
            ['rejectPlan', 'rejectPlan'],
            ['stop', 'stop']
        ];

        for (const [verb, managerCall] of commands) {
            it(`${verb}() drives this host's manager, and never a second host's`, async () => {
                const a = attached('session-a');
                const b = attached('session-b');

                await a.host[verb]();

                expect(a.manager.calls.map(c => c[0])).to.include(managerCall);
                expect(b.manager.calls, 'the other session moved').to.have.lengthOf(0);
            });
        }
    });

    describe('each query reaches its own session and no other', () => {
        it('planFilePath() reads this host\'s manager', () => {
            const a = attached('session-a');
            const b = attached('session-b');

            expect(a.host.planFilePath()).to.equal('/plans/here.md');
            expect(b.manager.calls).to.have.lengthOf(0);
        });

        it('availableModels() reads this host\'s manager', async () => {
            const a = attached('session-a');
            const b = attached('session-b');

            expect(await a.host.availableModels()).to.deep.equal([{ id: 'gpt-5' }]);
            expect(b.manager.calls).to.have.lengthOf(0);
        });

        it('validateAttachments() passes the paths through to its own manager', async () => {
            const a = attached('session-a');
            const b = attached('session-b');

            const result = await a.host.validateAttachments(['/repo/a.ts']);

            expect(result).to.deep.equal({ valid: true });
            expect(a.manager.calls[0]).to.deep.equal(['validateAttachments', ['/repo/a.ts']]);
            expect(b.manager.calls).to.have.lengthOf(0);
        });

        it('listMcpServers() and listConfiguredMcpServers() read their own manager', async () => {
            const a = attached('session-a');
            const b = attached('session-b');

            expect(await a.host.listMcpServers()).to.deep.equal([{ name: 'a' }]);
            expect(await a.host.listConfiguredMcpServers()).to.deep.equal({ a: {} });
            expect(b.manager.calls).to.have.lengthOf(0);
        });
    });

    describe('with no live session, a command says so rather than returning silently', () => {
        const commands = ['enablePlanMode', 'disablePlanMode', 'acceptPlan', 'rejectPlan', 'stop'];

        for (const verb of commands) {
            it(`${verb}() tells its own surface`, async () => {
                const { host, surface } = idle('session-a');

                await host[verb]();

                expect(surface.said, `${verb} said nothing`).to.have.lengthOf(1);
                expect(surface.said[0]).to.match(/no active session/i);
            });
        }

        it('reports to the surface that asked, never another', async () => {
            const a = idle('session-a');
            const b = attached('session-b');

            await a.host.acceptPlan();

            expect(a.surface.said).to.have.lengthOf(1);
            expect(b.surface.said, 'the live session was told about someone else\'s failure')
                .to.have.lengthOf(0);
        });
    });

    describe('with no live session, a query answers empty rather than throwing', () => {
        it('planFilePath() is null', () => {
            expect(idle('session-a').host.planFilePath()).to.equal(null);
        });

        it('availableModels() is empty', async () => {
            expect(await idle('session-a').host.availableModels()).to.deep.equal([]);
        });

        it('validateAttachments() refuses, with a reason', async () => {
            const result = await idle('session-a').host.validateAttachments(['/repo/a.ts']);
            expect(result.valid).to.equal(false);
            expect(result.error).to.be.a('string');
        });

        it('listMcpServers() is empty and listConfiguredMcpServers() is {}', async () => {
            const { host } = idle('session-a');
            expect(await host.listMcpServers()).to.deep.equal([]);
            expect(await host.listConfiguredMcpServers()).to.deep.equal({});
        });

        it('a query does not put a message on the surface — only a gesture does', async () => {
            const { host, surface } = idle('session-a');
            host.planFilePath();
            await host.availableModels();
            await host.listMcpServers();
            expect(surface.said).to.have.lengthOf(0);
        });
    });

    /**
     * `chat-toolbar-cleanup-and-new-session-reset.md` item 4.
     *
     * `handleNewSession` cleared the *webview* DOM and nothing cleared `host.state`,
     * so the new session kept the previous transcript in memory and the next
     * `sendInit()` — a reload, a re-attach — rendered the old conversation back
     * under the new session's id.
     */
    describe('beginNewConversation', () => {
        it('leaves no transcript for the next sendInit to render', () => {
            const { host } = attached('session-a');
            host.state.setMessages([{ kind: 'user', content: 'the old conversation' }]);

            host.beginNewConversation();

            expect(host.getFullState().messages).to.have.lengthOf(0);
        });

        it('clears the plan status too, so a new session is not born mid-plan', () => {
            const { host } = attached('session-a');
            host.state.setPlanModeStatus({ enabled: true });

            host.beginNewConversation();

            expect(host.state.getPlanModeStatus()).to.equal(null);
        });

        it('keeps the host indexed under its session until a new id is adopted', () => {
            // `reset()` nulls the state's own session id; the host's must not drift
            // from it, or the registry and the surface disagree about what is showing.
            const { host } = attached('session-a');

            host.beginNewConversation();

            expect(host.sessionId).to.equal('session-a');
            expect(host.getFullState().sessionId).to.equal('session-a');
        });

        it('empties this conversation and no other', () => {
            const a = attached('session-a');
            const b = attached('session-b');
            a.host.state.setMessages([{ kind: 'user', content: 'a' }]);
            b.host.state.setMessages([{ kind: 'user', content: 'b' }]);

            a.host.beginNewConversation();

            expect(b.host.getFullState().messages).to.have.lengthOf(1);
        });
    });

    describe('fork', () => {
        it('forks its own session, and never another host\'s', async () => {
            const a = attached('session-a');
            const b = attached('session-b');

            const forkId = await a.host.fork({ sessionStateDir: '/state' });

            expect(forkId).to.equal('session-a-fork');
            expect(a.manager.calls[0]).to.deep.equal(['forkSession', 'session-a', { sessionStateDir: '/state' }]);
            expect(b.manager.calls).to.have.lengthOf(0);
        });

        it('refuses rather than forking nothing when the session is not live', async () => {
            const { host } = idle('session-a');
            expect(host.fork, 'fork is not a verb on the host').to.be.a('function');
            let thrown = null;
            try { await host.fork({ sessionStateDir: '/state' }); } catch (e) { thrown = e; }
            expect(thrown, 'a dead session forked silently').to.be.an('error');
            expect(thrown).to.not.be.an.instanceOf(TypeError);
        });

        it('refuses when the host has no session id yet', async () => {
            const host = registry.create(null);
            host.attachManager(makeFakeManager());
            expect(host.fork, 'fork is not a verb on the host').to.be.a('function');
            let thrown = null;
            try { await host.fork({ sessionStateDir: '/state' }); } catch (e) { thrown = e; }
            expect(thrown).to.be.an('error');
            expect(thrown).to.not.be.an.instanceOf(TypeError);
        });
    });

    it('stop() leaves the host restartable rather than disposed', async () => {
        const { host } = attached('session-a');
        expect(host.isLive).to.equal(true);

        await host.stop();

        expect(host.isLive).to.equal(false);
        expect(registry.get('session-a'), 'the host was thrown away, not stopped').to.equal(host);
    });
});
