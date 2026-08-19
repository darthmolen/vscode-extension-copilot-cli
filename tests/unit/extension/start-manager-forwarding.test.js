/**
 * C2, the other half — the composition root must not drop what the host asked for.
 *
 * `ChatSessionHost.ensureStarted()` calls `startManager({ sessionId, resume })`.
 * A zero-argument closure satisfies that type in TypeScript, which is exactly why
 * `startManager: async () => resumeAndStartSession(context)` shipped and silently
 * discarded both fields. Types could not catch it, so behaviour has to.
 */

const assert = require('assert');
const { createStartManager } = require('../../../out/extension/session/startManager');

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

function managerFor(sessionId) {
    return { isRunning: () => true, getSessionId: () => sessionId };
}

describe('createStartManager()', function () {
    it('forwards the host\'s session id to the resume path', async function () {
        const seen = [];
        const start = createStartManager({
            resumeAndStart: async (request) => { seen.push(request); },
            getManager: () => managerFor('wanted'),
            logger: noopLogger
        });

        await start({ sessionId: 'wanted', resume: true, fresh: false, host: undefined });

        assert.deepStrictEqual(seen, [{ sessionId: 'wanted', fresh: false, host: undefined }]);
    });

    it('forwards the host itself, so bootstrap knows which one started', async function () {
        const seen = [];
        const host = { handle: 'host#7' };
        const start = createStartManager({
            resumeAndStart: async (request) => { seen.push(request); },
            getManager: () => managerFor('wanted'),
            logger: noopLogger
        });

        await start({ sessionId: 'wanted', resume: true, host });

        assert.strictEqual(seen[0].host, host,
            'without it, a fresh session with no id yet cannot be traced to its host');
    });

    it('forwards a null session id as null, not as absent', async function () {
        const seen = [];
        const start = createStartManager({
            resumeAndStart: async (request) => { seen.push(request); },
            getManager: () => managerFor('fresh-id'),
            logger: noopLogger
        });

        await start({ sessionId: null, resume: false, fresh: true, host: undefined });

        assert.deepStrictEqual(seen, [{ sessionId: null, fresh: true, host: undefined }]);
    });

    it('returns the manager the resume path produced', async function () {
        const manager = managerFor('wanted');
        const start = createStartManager({
            resumeAndStart: async () => {},
            getManager: () => manager,
            logger: noopLogger
        });

        assert.strictEqual(await start({ sessionId: 'wanted', resume: true }), manager);
    });

    it('fails when no manager materialised', async function () {
        const start = createStartManager({
            resumeAndStart: async () => {},
            getManager: () => null,
            logger: noopLogger
        });

        await assert.rejects(
            start({ sessionId: null, resume: false }),
            /failed to start/i
        );
    });

    it('uses the manager the resume path produced, not whatever the global points at now', async function () {
        // Found live on a window reload. Two starts run concurrently — a restored
        // tab's fresh session and the sidebar's ambient resume — and both assign to
        // the module-level handle. Reading it back after the await gives whichever
        // finished last, so both hosts adopted one session id and a real CLI session
        // was orphaned. The started manager has to travel back by return value.
        const mine = managerFor('mine');
        const someoneElses = managerFor('someone-elses');
        const start = createStartManager({
            resumeAndStart: async () => mine,
            getManager: () => someoneElses,
            logger: noopLogger
        });

        assert.strictEqual(await start({ sessionId: null, resume: false, fresh: true }), mine);
    });

    it('falls back to the window handle when the resume path started nothing', async function () {
        // The reuse case: nothing new was started, and the running manager is the
        // right answer.
        const running_ = managerFor('already-running');
        const start = createStartManager({
            resumeAndStart: async () => undefined,
            getManager: () => running_,
            logger: noopLogger
        });

        assert.strictEqual(await start({ sessionId: 'already-running', resume: true }), running_);
    });

    it('refuses the manager that was ALREADY running when a new session was asked for', async function () {
        // The tab defect. `openNew` asks for a fresh session; if the resume path
        // declines to start one, `getManager()` hands back the sidebar's manager
        // and the new host attaches to it — two hosts on one manager, both
        // surfaces rendering every token. The session-id check below cannot see
        // it, because a fresh request names no session to compare against.
        const alreadyRunning = managerFor('the-sidebars-session');
        const start = createStartManager({
            resumeAndStart: async () => {},
            getManager: () => alreadyRunning,
            logger: noopLogger
        });

        await assert.rejects(
            start({ sessionId: null, resume: false, fresh: true }),
            /new session/i,
            'handing back the running manager mirrors an existing conversation into the new tab'
        );
    });

    it('accepts a genuinely new manager for a fresh request', async function () {
        const before = managerFor('the-sidebars-session');
        const after = managerFor('brand-new');
        let current = before;
        const start = createStartManager({
            resumeAndStart: async () => { current = after; },
            getManager: () => current,
            logger: noopLogger
        });

        assert.strictEqual(await start({ sessionId: null, resume: false, fresh: true }), after);
    });

    it('accepts a fresh manager when nothing was running at all', async function () {
        let current = null;
        const start = createStartManager({
            resumeAndStart: async () => { current = managerFor('brand-new'); },
            getManager: () => current,
            logger: noopLogger
        });

        assert.strictEqual((await start({ sessionId: null, resume: false, fresh: true })).getSessionId(), 'brand-new');
    });

    it('refuses a manager for a DIFFERENT session than the one asked for', async function () {
        const start = createStartManager({
            resumeAndStart: async () => {},
            getManager: () => managerFor('somethingElse'),
            logger: noopLogger
        });

        await assert.rejects(
            start({ sessionId: 'wanted', resume: true }),
            /wanted/,
            'handing back another session\'s manager wires the surface to the wrong conversation'
        );
    });

    it('accepts a manager that has not adopted an id yet', async function () {
        const manager = managerFor(null);
        const start = createStartManager({
            resumeAndStart: async () => {},
            getManager: () => manager,
            logger: noopLogger
        });

        assert.strictEqual(await start({ sessionId: null, resume: false }), manager);
    });
});
