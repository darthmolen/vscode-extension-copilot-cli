/**
 * SDKSessionManager ← CopilotClientProvider (spine S4)
 *
 * The manager built and tore down the CopilotClient itself. S4 moves that to a
 * provider so the client lifecycle stops colliding with the session/event region
 * of this file, and so N managers can share one CLI process.
 *
 * Ownership is the contract Lane B consumes: a manager GIVEN a provider is a
 * consumer and must not stop it, or the first sidebar/tab to close would kill
 * every other session's client. A manager that built its own owns it.
 *
 * `stop()` is exercised by prototype-call — the pattern already used in
 * sdk-event-subscription-double.test.js — because reaching it through `start()`
 * would spawn a real CLI.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { withoutVscode } = require('../../helpers/without-vscode');
const { createFakeHost } = require('../../helpers/fake-host');

const MANAGER_PATH = path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js');
const PROVIDER_PATH = path.join(__dirname, '../../..', 'out', 'extension', 'services', 'CopilotClientProvider.js');

const { CopilotClientProvider } = require(PROVIDER_PATH);
const { SDKSessionManager } = require(MANAGER_PATH);

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** Records whether the manager tried to tear the provider down. */
function fakeProvider() {
    return {
        stopCalls: 0,
        current: { id: 'live-client' },
        async get() { return this.current; },
        async recreate() { return this.current; },
        async stop() { this.stopCalls++; this.current = null; },
        ensureListenersAttached() {}
    };
}

/** The minimum `this` for a prototype-called stop(). */
function stopContext(over = {}) {
    return {
        logger: silentLogger,
        _sessionSub: { value: undefined },
        session: null,
        sessionId: 'abc',
        toolExecutions: new Map(),
        fileSnapshotService: { cleanupAllSnapshots() {} },
        _onDidChangeStatus: { fire() {} },
        ...over
    };
}

function newProvider() {
    return new CopilotClientProvider({
        logger: silentLogger,
        workingDirectory: '/tmp/workspace',
        resolveCliPath: () => '/tmp/cli/copilot',
        useYolo: () => false,
        createClient: () => ({ async start() {}, async stop() {} })
    });
}

describe('SDKSessionManager — client provider ownership (S4)', () => {
    it('stops the provider it owns', async () => {
        const provider = fakeProvider();

        await SDKSessionManager.prototype.stop.call(
            stopContext({ clientProvider: provider, ownsClientProvider: true })
        );

        expect(provider.stopCalls, 'an owned provider must be stopped').to.equal(1);
    });

    it('does not stop a provider that was injected', async () => {
        const provider = fakeProvider();

        await SDKSessionManager.prototype.stop.call(
            stopContext({ clientProvider: provider, ownsClientProvider: false })
        );

        expect(provider.stopCalls, 'stopped a shared provider').to.equal(0);
    });

    it('leaves a shared client usable after one manager stops', async () => {
        const provider = fakeProvider();
        const live = provider.current;

        await SDKSessionManager.prototype.stop.call(
            stopContext({ clientProvider: provider, ownsClientProvider: false })
        );

        expect(provider.current, 'shared client was torn down').to.equal(live);
    });

    it('still clears its own session state when stopping as a consumer', async () => {
        const provider = fakeProvider();
        const ctx = stopContext({ clientProvider: provider, ownsClientProvider: false });

        await SDKSessionManager.prototype.stop.call(ctx);

        expect(ctx.sessionId, 'session state must be cleared regardless of ownership').to.equal(null);
    });
});

/**
 * `recreateClient()` is the only production-reachable behaviour S4 changed —
 * four live connection-recovery call sites drive it. (`restart()`, the other
 * stop-and-replace path, has no callers; every real `stop()` is followed by a
 * brand-new manager.) So this is the delegation that actually has to be right.
 */
describe('SDKSessionManager — client recreation (S4)', () => {
    /** Records call order across both collaborators, so ordering can be asserted. */
    function recreateContext() {
        const order = [];
        const replacement = { id: 'replacement-client' };
        return {
            order,
            replacement,
            // Built on the REAL prototype: `recreateClient` delegates to `adoptClient`,
            // and an object literal leaves that undefined — the method under test then
            // fails with `not a function`, which reads like the feature being missing
            // rather than the fake being incomplete.
            ctx: Object.assign(Object.create(SDKSessionManager.prototype), {
                logger: silentLogger,
                client: { id: 'dead-client' },
                modelCapabilitiesService: {
                    clearCache() { order.push('clearCache'); },
                    async initialize() { order.push('initialize'); }
                },
                clientProvider: {
                    async recreate() { order.push('recreate'); return replacement; }
                }
            })
        };
    }

    it('replaces its client with the provider’s new one', async () => {
        const { ctx, replacement } = recreateContext();

        await SDKSessionManager.prototype.recreateClient.call(ctx);

        expect(ctx.client, 'kept the dead client').to.equal(replacement);
    });

    it('clears the model-capabilities cache', async () => {
        const { ctx, order } = recreateContext();

        await SDKSessionManager.prototype.recreateClient.call(ctx);

        expect(order).to.include('clearCache');
    });

    /**
     * Capabilities are per-client and the provider's onClientStarted hook
     * re-initializes them during recreate(). Clearing afterwards would wipe the
     * fresh values and leave the cache empty; clearing before is what makes the
     * replacement's own capabilities land.
     */
    it('clears the cache before recreating, not after', async () => {
        const { ctx, order } = recreateContext();

        await SDKSessionManager.prototype.recreateClient.call(ctx);

        expect(order).to.deep.equal(['clearCache', 'recreate', 'initialize']);
    });
});

describe('SDKSessionManager — client provider construction (S4)', () => {
    it('uses an injected provider rather than building its own', () => {
        const injected = newProvider();

        const manager = withoutVscode(() =>
            new SDKSessionManager({}, false, undefined, undefined, createFakeHost(), injected)
        );

        expect(manager.clientProvider).to.equal(injected);
    });

    it('builds its own provider when none is injected', () => {
        const manager = withoutVscode(() =>
            new SDKSessionManager({}, false, undefined, undefined, createFakeHost())
        );

        expect(manager.clientProvider).to.be.an.instanceOf(CopilotClientProvider);
    });
});
