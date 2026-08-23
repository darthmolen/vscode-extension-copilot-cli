/**
 * SDKSessionManager — the todos signal (IN-3 §4c.5).
 *
 * `session.todos_changed` is how the CLI says the agent's plan changed. The SDK is
 * explicit that it carries nothing: *"Signal-only event: the agent's todos or
 * todo_deps table was written to. No payload — clients should call
 * `session.plan.readSqlTodosWithDependencies()` to fetch the current state."*
 *
 * So this is signal → fetch → emit, not signal → emit, and the fetch is the part that
 * can fail: it reads a SQL table the SDK itself calls "best-effort", where every
 * column is optional.
 *
 * Nothing consumed this event before. It is added for the ACP agent, which turns it
 * into ACP's `plan` update — the one thing a host has for showing a checklist.
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

describe('SDKSessionManager — session.todos_changed (IN-3 §4c.5)', function () {
    this.timeout(10000);

    let SDKSessionManager;
    before(function () {
        SDKSessionManager = require(path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js')).SDKSessionManager;
    });

    let fired;
    let rows;
    let dependencies;
    let readCalls;

    let errors;

    /**
     * A `this` built on the REAL prototype, so `_handleSDKEvent` reaches the real
     * `readTodos`. A plain object literal does not: the handler's call to
     * `this.readTodos()` throws `not a function`, the manager's own catch logs it and
     * swallows it, and every assertion here fails for a reason that looks like the
     * feature being missing. Which is how this test first failed after the feature
     * was written.
     *
     * `errors` exists for the same reason — a silent error logger let that hide.
     */
    function context(over = {}) {
        return Object.assign(Object.create(SDKSessionManager.prototype), {
            logger: { info() {}, warn() {}, error: m => errors.push(m), debug() {} },
            _onDidUpdateTodos: { fire: e => fired.push(e) },
            session: {
                rpc: {
                    plan: {
                        readSqlTodosWithDependencies: async () => {
                            readCalls += 1;
                            return { rows, dependencies };
                        }
                    }
                }
            },
            ...over
        });
    }

    const signal = ctx => SDKSessionManager.prototype._handleSDKEvent.call(
        ctx ?? context(), { type: 'session.todos_changed', data: {} });

    /** The emitter is async — it fetches first — so tests wait for it rather than guess. */
    const settle = () => new Promise(r => setImmediate(() => setImmediate(r)));

    beforeEach(function () {
        fired = [];
        errors = [];
        readCalls = 0;
        rows = [{ id: 't1', title: 'Write the test', status: 'completed' }];
        dependencies = [];
    });

    it('fetches the current todos, because the event carries none', async function () {
        signal();
        await settle();

        assert.deepStrictEqual(errors, [], 'the handler errored');
        assert.strictEqual(readCalls, 1, 'never fetched the todos');
    });

    it('emits what it fetched', async function () {
        rows = [
            { id: 't1', title: 'one', status: 'completed' },
            { id: 't2', title: 'two', status: 'pending' }
        ];

        signal();
        await settle();

        assert.strictEqual(fired.length, 1);
        assert.deepStrictEqual(fired[0].todos.map(t => t.title), ['one', 'two']);
    });

    it('carries the dependency edges it asked for', async function () {
        rows = [{ id: 't1', title: 'one' }, { id: 't2', title: 'two' }];
        dependencies = [{ todoId: 't2', dependsOn: 't1' }];

        signal();
        await settle();

        assert.deepStrictEqual(fired[0].dependencies, [{ todoId: 't2', dependsOn: 't1' }]);
    });

    /**
     * The SQL table is documented as best-effort and the fetch is a live RPC. Neither
     * a failed read nor a session that has gone away should take down the event pump
     * that every other emitter shares.
     */
    it('survives a fetch that fails, without emitting', async function () {
        const ctx = context();
        ctx.session.rpc.plan.readSqlTodosWithDependencies = async () => {
            throw new Error('no todos table');
        };

        signal(ctx);
        await settle();

        assert.deepStrictEqual(fired, []);
    });

    it('survives the signal arriving with no session at all', async function () {
        const ctx = context({ session: null });

        assert.doesNotThrow(() => signal(ctx));
        await settle();
        assert.deepStrictEqual(fired, []);
    });

    /** An empty list is a real state — the agent cleared its plan — not a failure. */
    it('emits an empty list rather than nothing when the plan is cleared', async function () {
        rows = [];

        signal();
        await settle();

        assert.strictEqual(fired.length, 1);
        assert.deepStrictEqual(fired[0].todos, []);
    });
});
