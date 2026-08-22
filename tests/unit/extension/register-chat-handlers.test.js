/**
 * registerChatHandlers — the surface-agnostic RPC wiring (v3.13.0 Task 2)
 *
 * These replace a string-match assertion in model-switch-rpc.test.js that read
 * chatViewProvider.ts and checked `source.includes('onSwitchModel')`. That test
 * broke when the handler moved here, but it was never verifying behaviour — it
 * would have passed on a comment. Per CLAUDE.md, a string match is deleted
 * rather than propped up, and replaced with something that exercises the code.
 *
 * The property that matters most is the last one: handlers must land on the
 * router they were given. `ExtensionRpcRouter.registerHandler` is last-one-wins
 * per message type, so a shared router between the sidebar and a tab would mean
 * whichever registered last silently owns every message.
 */

const { describe, it, after } = require('mocha');
const { expect } = require('chai');
const path = require('path');

/**
 * The handlers need `vscode` both at load time and at call time — registration
 * constructs the slash-command services — so the mock has to stay installed for
 * the duration of this file.
 *
 * Unlike the ~10 files CLAUDE.md names as the cause of this suite's cross-file
 * flake, this one **restores the patch in `after()`** rather than leaving it in
 * place for every file that follows.
 */
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'vscode') { return require('../../helpers/vscode-mock'); }
    return originalRequire.apply(this, arguments);
};
after(() => { Module.prototype.require = originalRequire; });

const { registerChatHandlers } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'rpc', 'registerChatHandlers.js')
);

/**
 * Records every `onX(handler)` call. A Proxy rather than a hand-written double
 * because the router exposes ~80 registration methods and enumerating them here
 * would just be a second copy of the contract.
 */
function recordingRouter() {
    const registered = new Map();
    const proxy = new Proxy({ registered }, {
        get(target, prop) {
            if (prop === 'registered') { return registered; }
            return (handler) => {
                registered.set(String(prop), handler);
                return { dispose() {} };
            };
        }
    });
    return proxy;
}

function makeContext(rpcRouter) {
    const noopEmitter = () => ({ fire() {}, event() { return { dispose() {} }; }, dispose() {} });
    return {
        rpcRouter,
        reg: (d) => d,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        sendDedup: { lastMessage: undefined, lastTime: 0 },
        currentWorkspacePath: '/tmp/workspace',
        customAgentsService: {},
        infoHandlers: undefined,
        codeReviewHandlers: undefined,
        notSupportedHandlers: undefined,
        mcpConfigService: undefined,
        cliPassthroughService: undefined,
        cliCapability: null,
        buildAndSendMcpStatus: async () => {},
        handleMcpServerAction: async () => {},
        _handleFilePicker: async () => {},
        _handlePastedImage: async () => {},
        _handleSaveMermaidImage: async () => {},
        _onDidReceiveUserMessage: noopEmitter(),
        _onDidRequestAbort: noopEmitter(),
        _onDidRequestViewPlan: noopEmitter(),
        _onDidBecomeReady: noopEmitter(),
        _onDidRequestSwitchModel: noopEmitter(),
        _onDidRequestRenameSession: noopEmitter(),
        _onDidRequestForkSession: noopEmitter(),
        _onDidRequestNewSession: noopEmitter(),
        _onDidRequestSwitchSession: noopEmitter(),
        _onDidRequestCompact: noopEmitter(),
        _onDidSelectAgent: noopEmitter(),
        _onDidRequestReloadAgents: noopEmitter(),
    };
}

describe('registerChatHandlers', () => {
    it('registers the switchModel handler', () => {
        const router = recordingRouter();
        registerChatHandlers(makeContext(router));
        expect(router.registered.has('onSwitchModel')).to.equal(true);
        expect(router.registered.get('onSwitchModel')).to.be.a('function');
    });

    it('registers the core conversation handlers', () => {
        const router = recordingRouter();
        registerChatHandlers(makeContext(router));
        for (const name of ['onReady', 'onSendMessage', 'onAbortMessage', 'onForkSession', 'onSwitchSession', 'onNewSession']) {
            expect(router.registered.has(name), `missing ${name}`).to.equal(true);
        }
    });

    it('registers a substantial handler set, not a handful', () => {
        const router = recordingRouter();
        registerChatHandlers(makeContext(router));
        // Guards against a partial extraction silently dropping registrations.
        // 33 distinct handlers at extraction time; a partial extraction shows up here.
        expect(router.registered.size).to.equal(33);
    });

    it('registers on the router it is given, never a shared one', () => {
        // The reason surfaces cannot share a router: registerHandler is
        // last-one-wins per type.
        const first = recordingRouter();
        const second = recordingRouter();
        registerChatHandlers(makeContext(first));
        registerChatHandlers(makeContext(second));

        expect(first.registered.size).to.equal(second.registered.size);
        expect(first.registered.get('onSwitchModel'))
            .to.not.equal(second.registered.get('onSwitchModel'));
    });

    /**
     * Defect C, as a test (v3.13.0 P3 step 1).
     *
     * Plan mode arrived here with its surface fully known — one router per surface,
     * closed over one `sessionHost` — and then `executeCommand('…togglePlanMode')`
     * threw that identity away on the very next line, so the command handler read
     * the module-level `sessionManager` and drove whichever session started last.
     * Typing `/plan` in a tab toggled the sidebar.
     *
     * A resolver would be machinery to reconstruct what we chose to discard. The
     * fix is to stop discarding it, and these assert that: the signal must reach
     * *this* context's host and no other.
     */
    describe('plan-mode signals reach the surface\'s own session', () => {
        function hostSpy() {
            const calls = [];
            return {
                calls,
                enablePlanMode: async () => { calls.push('enablePlanMode'); },
                disablePlanMode: async () => { calls.push('disablePlanMode'); },
                acceptPlan: async () => { calls.push('acceptPlan'); },
                rejectPlan: async () => { calls.push('rejectPlan'); }
            };
        }

        function wire(host) {
            const router = recordingRouter();
            const ctx = makeContext(router);
            ctx.sessionHost = host;
            registerChatHandlers(ctx);
            return router;
        }

        it('togglePlanMode enables and disables this host, never another', async () => {
            const a = hostSpy();
            const b = hostSpy();
            const routerA = wire(a);
            wire(b);

            await routerA.registered.get('onTogglePlanMode')({ enabled: true });
            await routerA.registered.get('onTogglePlanMode')({ enabled: false });

            expect(a.calls).to.deep.equal(['enablePlanMode', 'disablePlanMode']);
            expect(b.calls, 'the other surface\'s session was toggled').to.have.lengthOf(0);
        });

        it('acceptPlan reaches this host, never another', async () => {
            const a = hostSpy();
            const b = hostSpy();
            const routerA = wire(a);
            wire(b);

            await routerA.registered.get('onAcceptPlan')();

            expect(a.calls).to.deep.equal(['acceptPlan']);
            expect(b.calls).to.have.lengthOf(0);
        });

        it('rejectPlan reaches this host, never another', async () => {
            const a = hostSpy();
            const b = hostSpy();
            const routerA = wire(a);
            wire(b);

            await routerA.registered.get('onRejectPlan')();

            expect(a.calls).to.deep.equal(['rejectPlan']);
            expect(b.calls).to.have.lengthOf(0);
        });

        it('new session and switch session leave as this surface\'s own signals', () => {
            // Not `executeCommand`. The command handler cannot know which surface
            // asked, which is why the dropdown in a tab switched the sidebar.
            const fired = [];
            const router = recordingRouter();
            const ctx = makeContext(router);
            ctx._onDidRequestNewSession = { fire: () => fired.push(['new']) };
            ctx._onDidRequestSwitchSession = { fire: (id) => fired.push(['switch', id]) };
            registerChatHandlers(ctx);

            router.registered.get('onNewSession')();
            router.registered.get('onSwitchSession')({ sessionId: 'session-a' });

            expect(fired).to.deep.equal([['new'], ['switch', 'session-a']]);
        });

        it('a surface with no host at all does not throw', async () => {
            const router = recordingRouter();
            registerChatHandlers(makeContext(router));
            await router.registered.get('onTogglePlanMode')({ enabled: true });
            await router.registered.get('onAcceptPlan')();
            await router.registered.get('onRejectPlan')();
        });
    });
});
