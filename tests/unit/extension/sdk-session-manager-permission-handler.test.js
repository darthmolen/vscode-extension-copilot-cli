/**
 * SDKSessionManager.setPermissionHandler — the seam that lets a host answer
 * permission requests instead of the manager approving them itself (IN-3 scope item 4).
 *
 * Two things have to hold at once, and they pull in opposite directions:
 *
 *   Lane B (the VS Code extension) installs no handler, and must keep the behaviour
 *   it has today — `approveAll`, plus an `onPreToolUse` hook that decides `allow`.
 *
 *   Lane A (the ACP agent) installs one, and must get the CLI's native permission
 *   requests delivered to it.
 *
 * The hook half is not a detail. A spike against the real CLI
 * (`planning/spikes/acp-agent/spike-permission-hook.mjs`, recorded in FINDINGS.md)
 * showed that with `{ permissionDecision: 'allow' }` in place the CLI emits NO
 * `permission.requested` event at all — the handler is never called, whatever it is.
 * So installing a handler must also stop the hook from pre-deciding, and doing so
 * must not change what Lane B sees.
 *
 * These call the real methods on the real prototype with a captured config, rather
 * than matching strings in the source: a source-text assertion would pass just as
 * happily against a manager that had stopped calling the method at all.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('../../helpers/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

const { describe, it, before } = require('mocha');
const assert = require('assert');
const path = require('path');

describe('SDKSessionManager — permission handler injection (IN-3)', function () {
    this.timeout(10000);

    let SDKSessionManager;

    before(function () {
        SDKSessionManager = require(path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js')).SDKSessionManager;
    });

    /** Minimal `this` for the two config-building methods, capturing what they build. */
    function contextCapturing(captured, over = {}) {
        return {
            logger: { info() {}, warn() {}, error() {}, debug() {} },
            client: {
                createSession: async config => {
                    captured.config = config;
                    return { sessionId: 's1', on: () => () => {}, destroy: async () => {} };
                },
                resumeSession: async (_id, config) => {
                    captured.config = config;
                    return { sessionId: 's1', on: () => () => {}, destroy: async () => {} };
                }
            },
            config: {},
            modelCapabilitiesService: { getAllModels: async () => [] },
            isModelUnsupportedError: () => false,
            _onDidReceiveOutput: { fire() {} },
            resolveSkillDirectories: () => [],
            host: { askSessionRecovery: async () => 'new' },
            ...over
        };
    }

    const createConfig = async over => {
        const captured = {};
        await SDKSessionManager.prototype.createSessionWithModelFallback.call(
            contextCapturing(captured, over), {});
        return captured.config;
    };

    const resumeConfig = async over => {
        const captured = {};
        await SDKSessionManager.prototype.attemptSessionResumeWithUserRecovery.call(
            contextCapturing(captured, over), 's1', {});
        return captured.config;
    };

    describe('the default is unchanged, so Lane B is untouched', function () {
        /**
         * Behaviour, not identity. The module-level `approveAll` is replaced by the
         * SDK's own inside `loadSDK()`, so an identity check would only be testing
         * how far through startup we happen to be. What must hold either side of that
         * swap is that the default approves exactly this one call — and comparing
         * against the SDK's own function makes the SDK changing its mind a red test
         * rather than a silent divergence.
         */
        it('creates a session whose default decision matches the SDK\'s approveAll', async function () {
            const sdk = await import('@github/copilot-sdk');
            const handler = (await createConfig()).onPermissionRequest;
            const req = { kind: 'shell' };
            const inv = { sessionId: 's1' };
            assert.deepStrictEqual(await handler(req, inv), sdk.approveAll(req, inv));
            assert.deepStrictEqual(await handler(req, inv), { kind: 'approve-once' });
        });

        it('resumes a session with that same default', async function () {
            const sdk = await import('@github/copilot-sdk');
            const handler = (await resumeConfig()).onPermissionRequest;
            assert.deepStrictEqual(await handler({ kind: 'shell' }, { sessionId: 's1' }),
                sdk.approveAll({ kind: 'shell' }, { sessionId: 's1' }));
        });

        /**
         * `client.ts` sets the wire flag `requestPermission: !!config.onPermissionRequest`.
         * Passing `undefined` tells the CLI that nobody will answer, and requests then
         * hang pending forever — so "no handler" must never mean "no function". This is
         * not hypothetical: the default used to be filled in by `loadSDK()`, so any
         * config built before the SDK finished loading carried `undefined`.
         */
        it('never leaves onPermissionRequest undefined, which would hang every request', async function () {
            assert.strictEqual(typeof (await createConfig()).onPermissionRequest, 'function');
            assert.strictEqual(typeof (await resumeConfig()).onPermissionRequest, 'function');
        });
    });

    describe('an injected handler replaces it, on both paths', function () {
        const injected = async () => ({ kind: 'reject' });

        it('reaches the create path', async function () {
            assert.strictEqual(
                (await createConfig({ permissionHandler: injected })).onPermissionRequest, injected);
        });

        it('reaches the resume path', async function () {
            assert.strictEqual(
                (await resumeConfig({ permissionHandler: injected })).onPermissionRequest, injected);
        });

        it('is installed by the public setter', function () {
            const manager = Object.create(SDKSessionManager.prototype);
            manager.logger = { info() {}, warn() {}, error() {}, debug() {} };
            manager.setPermissionHandler(injected);
            assert.strictEqual(manager.permissionHandler, injected);
        });
    });

    describe('the onPreToolUse hook stops pre-deciding once a handler is installed', function () {
        const hookOutput = over => {
            const ctx = {
                logger: { info() {}, warn() {}, error() {}, debug() {} },
                fileSnapshotService: { getPendingByPath: () => null, captureByPath() {} },
                ...over
            };
            const hooks = SDKSessionManager.prototype.getSessionHooks.call(ctx);
            return { ctx, output: hooks.onPreToolUse({ toolName: 'bash', toolArgs: {} }, {}) };
        };

        it('keeps deciding allow when no handler is installed (Lane B)', function () {
            assert.strictEqual(hookOutput().output.permissionDecision, 'allow');
        });

        /**
         * Withheld, not changed to 'ask'. The spike showed 'ask' does restore a
         * request but downgrades it to the generic `hook` variant, which carries only
         * a tool name and a JSON blob — no command text, no diff, no
         * canOfferSessionApproval. Returning no decision at all leaves the native
         * shell/write request intact.
         */
        it('withholds the decision entirely once a handler is installed', function () {
            const { output } = hookOutput({ permissionHandler: async () => ({ kind: 'reject' }) });
            assert.ok(!('permissionDecision' in output) || output.permissionDecision === undefined,
                `expected no permissionDecision, got ${JSON.stringify(output)}`);
            assert.notStrictEqual(output.permissionDecision, 'ask',
                "'ask' would downgrade the request to the payload-free `hook` variant");
        });

        /**
         * The hook exists for its side effect, not its verdict. If withholding the
         * decision also lost the snapshot, every inline diff in Lane B would break
         * the moment Lane A shared this code path.
         */
        it('still captures the file snapshot in both cases', function () {
            for (const over of [{}, { permissionHandler: async () => ({ kind: 'reject' }) }]) {
                const captured = [];
                const ctx = {
                    logger: { info() {}, warn() {}, error() {}, debug() {} },
                    fileSnapshotService: {
                        getPendingByPath: () => null,
                        captureByPath: (tool, p) => captured.push([tool, p])
                    },
                    ...over
                };
                const hooks = SDKSessionManager.prototype.getSessionHooks.call(ctx);
                hooks.onPreToolUse({ toolName: 'edit', toolArgs: { path: '/a.ts' } }, {});
                assert.deepStrictEqual(captured, [['edit', '/a.ts']],
                    `snapshot lost with ${JSON.stringify(Object.keys(over))}`);
            }
        });
    });
});
