/**
 * TDD test: Double SDK Event Subscription Bug (v3.7.2)
 *
 * Bug: createSessionWithModelFallback injects onEvent into the session config
 * AND setupSessionEventHandlers calls session.on() — two subscriptions on the
 * same session, causing every event to fire _handleSDKEvent twice.
 *
 * Reproduces in plan mode (createSessionWithModelFallback always used) and
 * in any work session that falls back via createSessionWithModelFallback.
 *
 * Fix: Remove onEvent from createSessionWithModelFallback. session.on() (in
 * setupSessionEventHandlers) is the canonical, lifecycle-managed subscription.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('../../helpers/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

const assert = require('assert');

describe('SDK Event Subscription — no double registration', function () {
    this.timeout(10000);

    let SDKSessionManager;

    before(function () {
        try {
            const mod = require('../../../out/sdkSessionManager.js');
            SDKSessionManager = mod.SDKSessionManager;
        } catch (e) {
            console.log('Module not compiled, skipping:', e.message);
            this.skip();
        }
    });

    /**
     * Core regression test: when createSessionWithModelFallback is called
     * followed by setupSessionEventHandlers (as setActiveSession does), the
     * _handleSDKEvent handler must fire exactly once per event — not twice.
     */
    it('_handleSDKEvent fires exactly once per event after createSession + setupSessionEventHandlers', async function () {
        // Spy: count _handleSDKEvent invocations
        const handledEvents = [];

        // The session mock: capture the handler registered via session.on()
        let sessionOnHandler = null;
        const mockSession = {
            on: (handler) => {
                sessionOnHandler = handler;
                return () => {}; // disposable unsubscribe
            }
        };

        // The client mock: capture the config passed to createSession (to get onEvent)
        let capturedConfig = null;
        const mockClient = {
            createSession: async (config) => {
                capturedConfig = config;
                return mockSession;
            }
        };

        // Minimal context for createSessionWithModelFallback + setupSessionEventHandlers
        const ctx = {
            client: mockClient,
            session: null,
            config: { streaming: true },
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
            _sessionSub: {
                get value() { return this._v; },
                set value(v) {
                    if (this._v && typeof this._v.dispose === 'function') {
                        this._v.dispose();
                    }
                    this._v = v;
                },
                _v: null
            },
            // Track _handleSDKEvent calls
            _handleSDKEvent: function (event) {
                handledEvents.push(event);
            },
            isModelUnsupportedError: () => false,
            modelCapabilitiesService: null,
            attachClientLifecycleListeners: () => {},
        };

        // Step 1: createSessionWithModelFallback (as enablePlanMode does)
        const session = await SDKSessionManager.prototype.createSessionWithModelFallback.call(
            ctx,
            { model: undefined }
        );

        // Step 2: setActiveSession → assigns session + calls setupSessionEventHandlers
        ctx.session = session;
        SDKSessionManager.prototype.setupSessionEventHandlers.call(ctx);

        // Verify session.on() was registered
        assert.ok(sessionOnHandler, 'session.on() must have been called to register a handler');

        // Step 3: Emit ONE event via session.on() handler (the SDK runtime path)
        const testEvent = { type: 'assistant.message', data: { content: 'hello' } };
        sessionOnHandler(testEvent);

        // Step 4: Also emit via onEvent if it was injected into createSession config
        // (this is the bug: if onEvent was set, it fires a second time here)
        if (capturedConfig && typeof capturedConfig.onEvent === 'function') {
            capturedConfig.onEvent(testEvent);
        }

        // ASSERTION: handler must fire exactly once
        // RED: fails when onEvent is injected (2 invocations)
        // GREEN: passes after onEvent is removed (1 invocation)
        assert.strictEqual(
            handledEvents.length,
            1,
            `_handleSDKEvent should fire exactly once per event, but fired ${handledEvents.length} times. ` +
            `This indicates createSessionWithModelFallback is injecting onEvent in addition to ` +
            `setupSessionEventHandlers registering session.on() — creating a double subscription.`
        );
    });

    /**
     * Explicit check: createSessionWithModelFallback must NOT inject onEvent
     * into the session config. The session.on() path is the only subscription.
     */
    it('createSessionWithModelFallback does NOT inject onEvent into the session config', async function () {
        let capturedConfig = null;
        const mockSession = { on: () => () => {} };
        const mockClient = {
            createSession: async (config) => {
                capturedConfig = config;
                return mockSession;
            }
        };

        const ctx = {
            client: mockClient,
            session: null,
            config: { streaming: true },
            logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
            _sessionSub: { value: null },
            _handleSDKEvent: () => {},
            isModelUnsupportedError: () => false,
            modelCapabilitiesService: null,
            attachClientLifecycleListeners: () => {},
        };

        await SDKSessionManager.prototype.createSessionWithModelFallback.call(
            ctx,
            { model: undefined }
        );

        assert.ok(capturedConfig, 'createSession must have been called');
        assert.strictEqual(
            capturedConfig.onEvent,
            undefined,
            'onEvent must NOT be present in the config passed to client.createSession(). ' +
            'Use session.on() in setupSessionEventHandlers instead.'
        );
    });

    /**
     * Verify session.on() IS called exactly once by setupSessionEventHandlers.
     */
    it('setupSessionEventHandlers calls session.on() exactly once', function () {
        let onCallCount = 0;
        const mockSession = {
            on: (handler) => {
                onCallCount++;
                return () => {};
            }
        };

        const ctx = {
            session: mockSession,
            _sessionSub: {
                get value() { return this._v; },
                set value(v) { this._v = v; },
                _v: null
            },
            _handleSDKEvent: () => {},
        };

        SDKSessionManager.prototype.setupSessionEventHandlers.call(ctx);

        assert.strictEqual(onCallCount, 1, 'session.on() should be called exactly once');
    });
});
