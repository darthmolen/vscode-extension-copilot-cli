/**
 * A surface commands its own session (v3.13.0 Task 6 slice 2)
 *
 * Every handler in `registerChatProviderHandlers` called the module-level
 * `sessionManager`, so a message typed anywhere went to whatever session the window
 * last started — not the session that surface is showing. Invisible with one
 * surface; with a tab open it is the bug Task 7 would ship.
 *
 * The commands go through the host, and `.manager` stays private: v4.0 moves the
 * manager across a process boundary, and call sites written against a narrow
 * contract survive that move.
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

/** Records commands; every event subscription is an inert no-op. */
function makeFakeManager() {
    const calls = [];
    const noop = () => ({ dispose() {} });
    const manager = new Proxy({
        calls,
        sendMessage: (...args) => { calls.push(['sendMessage', ...args]); },
        abortMessage: async () => { calls.push(['abortMessage']); },
        switchModel: async (m) => { calls.push(['switchModel', m]); },
        compactSession: async () => { calls.push(['compactSession']); return { tokensRemoved: 1 }; },
        selectAgent: async (n) => { calls.push(['selectAgent', n]); },
        deselectAgent: async () => { calls.push(['deselectAgent']); },
        reloadAgents: async () => { calls.push(['reloadAgents']); }
    }, {
        get: (target, prop) => prop in target
            ? target[prop]
            : (typeof prop === 'string' && prop.startsWith('onDid') ? noop : undefined)
    });
    return manager;
}

describe('ChatSessionHost — commanding its session', () => {
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
        host.attachManager(manager);
        return { host, manager };
    }

    it('sends a prompt to its own session, and to no other', async () => {
        const a = attached('session-a');
        const b = attached('session-b');

        await a.host.prompt('do the thing');

        expect(a.manager.calls[0][0]).to.equal('sendMessage');
        expect(a.manager.calls[0][1]).to.equal('do the thing');
        expect(b.manager.calls).to.have.lengthOf(0);
    });

    it('passes attachments and agent through with the prompt', async () => {
        const { host, manager } = attached('session-a');
        const attachments = [{ type: 'file', path: '/repo/a.ts' }];

        await host.prompt('review this', { attachments, agentName: 'reviewer' });

        const [, text, sentAttachments, , , agentName] = manager.calls[0];
        expect(text).to.equal('review this');
        expect(sentAttachments).to.deep.equal(attachments);
        expect(agentName).to.equal('reviewer');
    });

    it('cancels without returning a promise — it is a notification, not a request', () => {
        const { host, manager } = attached('session-a');

        const returned = host.cancel();

        expect(returned).to.equal(undefined);
        expect(manager.calls).to.deep.equal([['abortMessage']]);
    });

    it('switches the model on its own session', async () => {
        const a = attached('session-a');
        const b = attached('session-b');

        await a.host.switchModel('claude-opus-5');

        expect(a.manager.calls).to.deep.equal([['switchModel', 'claude-opus-5']]);
        expect(b.manager.calls).to.have.lengthOf(0);
    });

    it('compacts its own session and hands back the result', async () => {
        const { host, manager } = attached('session-a');

        const result = await host.compact();

        expect(manager.calls).to.deep.equal([['compactSession']]);
        expect(result).to.deep.equal({ tokensRemoved: 1 });
    });

    it('selects and clears an agent through one call', async () => {
        const { host, manager } = attached('session-a');

        await host.selectAgent('explorer');
        await host.selectAgent(null);

        expect(manager.calls).to.deep.equal([['selectAgent', 'explorer'], ['deselectAgent']]);
    });

    it('reloads agents on its own session', async () => {
        const { host, manager } = attached('session-a');

        await host.reloadAgents();

        expect(manager.calls).to.deep.equal([['reloadAgents']]);
    });

    it('renames by sending the slash command the CLI expects', async () => {
        const { host, manager } = attached('session-a');

        await host.rename('a better name');

        expect(manager.calls).to.deep.equal([['sendMessage', '/rename a better name']]);
    });

    /**
     * The red path from Task 4, now reachable from a surface: the CLI never started,
     * so the host has no manager. A user can still click these buttons, and doing so
     * must not throw into a webview event handler.
     */
    describe('when the session never started', () => {
        it('ignores every command instead of throwing', async () => {
            const host = registry.create('session-a');

            expect(() => host.cancel()).to.not.throw();
            await host.prompt('anyone there?');
            await host.switchModel('claude-opus-5');
            await host.selectAgent('explorer');
            await host.reloadAgents();
            await host.rename('nope');

            expect(await host.compact()).to.equal(undefined);
        });

        it('does not report itself live', () => {
            expect(registry.create('session-a').isLive).to.equal(false);
        });
    });

    it('never exposes its manager', () => {
        const { host } = attached('session-a');

        expect(host.manager).to.equal(undefined);
    });
});
