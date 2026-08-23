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
            resumeAndStart: async (request) => { seen.push(request); return managerFor('wanted'); },
            logger: noopLogger
        });

        await start({ sessionId: 'wanted', resume: true, fresh: false, host: undefined });

        assert.deepStrictEqual(seen, [{ sessionId: 'wanted', fresh: false, host: undefined }]);
    });

    it('forwards the host itself, so bootstrap knows which one started', async function () {
        const seen = [];
        const host = { handle: 'host#7' };
        const start = createStartManager({
            resumeAndStart: async (request) => { seen.push(request); return managerFor('wanted'); },
            logger: noopLogger
        });

        await start({ sessionId: 'wanted', resume: true, host });

        assert.strictEqual(seen[0].host, host,
            'without it, a fresh session with no id yet cannot be traced to its host');
    });

    it('forwards a null session id as null, not as absent', async function () {
        const seen = [];
        const start = createStartManager({
            resumeAndStart: async (request) => { seen.push(request); return managerFor('fresh-id'); },
            logger: noopLogger
        });

        await start({ sessionId: null, resume: false, fresh: true, host: undefined });

        assert.deepStrictEqual(seen, [{ sessionId: null, fresh: true, host: undefined }]);
    });

    it('returns the manager the resume path produced', async function () {
        const manager = managerFor('wanted');
        const start = createStartManager({
            resumeAndStart: async () => manager,
            logger: noopLogger
        });

        assert.strictEqual(await start({ sessionId: 'wanted', resume: true }), manager);
    });

    it('fails when no manager materialised', async function () {
        const start = createStartManager({
            resumeAndStart: async () => {},
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
            logger: noopLogger
        });

        assert.strictEqual(await start({ sessionId: null, resume: false, fresh: true }), mine);
    });

    it('never hands back a manager it did not start', async function () {
        // Was: "falls back to the window handle when the resume path started
        // nothing". That fallback is how *New Tab* attached a second host to the
        // sidebar's running manager — two surfaces rendering one conversation, and
        // the session-id check below could not see it because a fresh request names
        // no session to compare against.
        //
        // P3 gave every host its own manager, so there is no window handle left to
        // fall back to. Declining to start is now a failure said out loud rather
        // than a silent adoption of somebody else's session.
        const start = createStartManager({
            resumeAndStart: async () => undefined,
            logger: noopLogger
        });

        await assert.rejects(
            start({ sessionId: 'already-running', resume: true }),
            /failed to start/i
        );
    });

    it('fails a fresh request that produced nothing, rather than adopting a running session', async function () {
        const start = createStartManager({
            resumeAndStart: async () => {},
            logger: noopLogger
        });

        await assert.rejects(
            start({ sessionId: null, resume: false, fresh: true }),
            /failed to start/i,
            'a new tab must never end up on a conversation that was already open'
        );
    });

    it('accepts a genuinely new manager for a fresh request', async function () {
        const after = managerFor('brand-new');
        const start = createStartManager({
            resumeAndStart: async () => after,
            logger: noopLogger
        });

        assert.strictEqual(await start({ sessionId: null, resume: false, fresh: true }), after);
    });

    it('refuses a manager for a DIFFERENT session than the one asked for', async function () {
        const start = createStartManager({
            resumeAndStart: async () => managerFor('somethingElse'),
            logger: noopLogger
        });

        await assert.rejects(
            start({ sessionId: 'wanted', resume: true }),
            /wanted/,
            'handing back another session\'s manager wires the surface to the wrong conversation'
        );
    });

    it('accepts a manager that has not adopted an id yet', async function () {
        // A fresh session adopts its id moments later; refusing here would fail
        // every new conversation.
        const manager = managerFor(null);
        const start = createStartManager({
            resumeAndStart: async () => manager,
            logger: noopLogger
        });

        assert.strictEqual(await start({ sessionId: null, resume: false }), manager);
    });
});
