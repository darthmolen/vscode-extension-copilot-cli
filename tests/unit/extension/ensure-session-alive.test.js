/**
 * Tests for ensureSessionAlive() — session health check for plan mode exit.
 *
 * Uses abort() as a lightweight liveness check instead of resumeSession(),
 * which causes server-side event doubling on already-active sessions.
 */

const assert = require('assert');

// Import from compiled output (requires npm run compile-tests first)
const { ensureSessionAlive } = require('../../../out/sessionErrorUtils');

describe('ensureSessionAlive()', function () {
    it('returns existing session when abort succeeds', async function () {
        const mockSession = { sessionId: 'abc-123', abort: async () => {} };
        const createSessionFn = async () => { throw new Error('should not be called'); };

        const result = await ensureSessionAlive(mockSession, createSessionFn);

        assert.strictEqual(result.session, mockSession);
        assert.strictEqual(result.sessionId, 'abc-123');
        assert.strictEqual(result.wasRecreated, false);
    });

    it('creates new session when abort throws "Session not found"', async function () {
        const newSession = { sessionId: 'new-456' };
        const mockSession = {
            sessionId: 'abc-123',
            abort: async () => { throw new Error('Session not found: abc-123'); }
        };
        const createSessionFn = async () => newSession;

        const result = await ensureSessionAlive(mockSession, createSessionFn);

        assert.strictEqual(result.session, newSession);
        assert.strictEqual(result.sessionId, 'new-456');
        assert.strictEqual(result.wasRecreated, true);
    });

    it('propagates non-expired errors without calling createSessionFn', async function () {
        const mockSession = {
            sessionId: 'abc-123',
            abort: async () => { throw new Error('Network timeout'); }
        };
        let createCalled = false;
        const createSessionFn = async () => { createCalled = true; return {}; };

        await assert.rejects(
            () => ensureSessionAlive(mockSession, createSessionFn),
            (err) => err.message === 'Network timeout'
        );
        assert.strictEqual(createCalled, false);
    });
});
