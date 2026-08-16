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
});
