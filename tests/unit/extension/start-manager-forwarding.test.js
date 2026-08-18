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

        await start({ sessionId: 'wanted', resume: true });

        assert.deepStrictEqual(seen, [{ sessionId: 'wanted' }]);
    });

    it('forwards a null session id as null, not as absent', async function () {
        const seen = [];
        const start = createStartManager({
            resumeAndStart: async (request) => { seen.push(request); },
            getManager: () => managerFor('fresh-id'),
            logger: noopLogger
        });

        await start({ sessionId: null, resume: false });

        assert.deepStrictEqual(seen, [{ sessionId: null }]);
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
