/**
 * SDKSessionManager — the manager initialises its own model capabilities.
 *
 * Found live, in Zed, driving the ACP agent:
 *
 *     [ERROR] [Model Capabilities] Failed to fetch model capabilities:
 *             ModelCapabilitiesService not initialized. Call initialize() first.
 *
 * The extension wires `onClientStarted: c => this.modelCapabilitiesService.initialize(c)`
 * when it builds its own provider. The ACP composition root injects a **shared**
 * provider and never wired that hook, so in the agent process the service was never
 * initialised — silently degrading model fallback, vision support, attachment
 * validation and `getAllModels`.
 *
 * Copying the hook into the ACP root would not have fixed it. With one shared provider
 * and N managers (spine S4), `onClientStarted` fires once per client while every
 * manager has its own capabilities service — so a single callback can only ever
 * initialise one of them.
 *
 * The fix is ownership: **the manager owns the service, so the manager initialises
 * it**, at the moment it adopts a client, regardless of who built the provider. That
 * also removes the second writer — the provider hook — which is what let the two get
 * out of step in the first place.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'vscode') { return require('../../helpers/vscode-mock'); }
    return originalRequire.apply(this, arguments);
};

const { describe, it, before, beforeEach } = require('mocha');
const assert = require('assert');
const path = require('path');

describe('SDKSessionManager — model capabilities follow the client', function () {
    this.timeout(10000);

    let SDKSessionManager;
    before(function () {
        SDKSessionManager = require(path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js')).SDKSessionManager;
    });

    let initialised, cleared;

    function context(over = {}) {
        return Object.assign(Object.create(SDKSessionManager.prototype), {
            logger: { info() {}, warn() {}, error() {}, debug() {} },
            modelCapabilitiesService: {
                initialize: async c => initialised.push(c),
                clearCache: () => cleared.push(true)
            },
            ...over
        });
    }

    beforeEach(function () {
        initialised = [];
        cleared = [];
    });

    it('initialises the service with the client it just adopted', async function () {
        const ctx = context();
        const client = { id: 'client-1' };

        await SDKSessionManager.prototype.adoptClient.call(ctx, client);

        assert.deepStrictEqual(initialised, [client]);
        assert.strictEqual(ctx.client, client, 'the client was not adopted');
    });

    /**
     * The regression. A provider with no `onClientStarted` is not a broken provider —
     * it is the shared one the ACP agent injects, and the manager must not depend on
     * whoever constructed it having remembered a callback.
     */
    it('does not depend on the provider having wired onClientStarted', async function () {
        const client = { id: 'shared' };
        const ctx = context({
            clientProvider: { get: async () => client }     // no onClientStarted anywhere
        });

        await SDKSessionManager.prototype.acquireClient.call(ctx);

        assert.deepStrictEqual(initialised, [client],
            'capabilities were left uninitialised, as they were in the agent process');
    });

    /**
     * Capabilities are per-client. A replacement client must not inherit the previous
     * one's cached model list, and must be initialised in its own right.
     */
    it('drops the old capabilities and initialises the replacement', async function () {
        const replacement = { id: 'client-2' };
        const ctx = context({
            clientProvider: { recreate: async () => replacement }
        });

        await SDKSessionManager.prototype.recreateClient.call(ctx);

        assert.strictEqual(cleared.length, 1, 'stale capabilities were kept');
        assert.deepStrictEqual(initialised, [replacement]);
        assert.strictEqual(ctx.client, replacement);
    });

    /**
     * Ordering, not decoration: initialising against the outgoing client and then
     * swapping would leave the service describing a client nobody is using.
     */
    it('clears before it initialises, never after', async function () {
        const order = [];
        const ctx = context({
            clientProvider: { recreate: async () => ({ id: 'c2' }) },
            modelCapabilitiesService: {
                initialize: async () => order.push('initialize'),
                clearCache: () => order.push('clear')
            }
        });

        await SDKSessionManager.prototype.recreateClient.call(ctx);

        assert.deepStrictEqual(order, ['clear', 'initialize']);
    });
});
