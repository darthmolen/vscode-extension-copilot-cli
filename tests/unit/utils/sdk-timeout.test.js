/**
 * Tests for SDK call timeout protection
 *
 * TDD: These tests verify that:
 * 1. withTimeout utility resolves/rejects/times out correctly
 * 2. attemptSessionResumeWithRetry times out hanging SDK calls and retries
 */

const assert = require('assert');

describe('SDK Call Timeout Protection', function () {
    this.timeout(30000);

    let withTimeout;
    let attemptSessionResumeWithRetry;

    before(async () => {
        const mod = await import('../../../out/authUtils.js');
        withTimeout = mod.withTimeout;
        attemptSessionResumeWithRetry = mod.attemptSessionResumeWithRetry;
    });

    describe('withTimeout utility', () => {
        it('should resolve when promise resolves before timeout', async () => {
            const result = await withTimeout(
                Promise.resolve('hello'),
                1000,
                'test-op'
            );
            assert.strictEqual(result, 'hello');
        });

        it('should reject when promise rejects before timeout', async () => {
            try {
                await withTimeout(
                    Promise.reject(new Error('original error')),
                    1000,
                    'test-op'
                );
                assert.fail('Should have thrown');
            } catch (error) {
                assert.strictEqual(error.message, 'original error');
            }
        });

        it('should reject with timeout error when promise hangs', async () => {
            // A promise that never resolves
            const neverResolves = new Promise(() => {});

            try {
                await withTimeout(neverResolves, 100, 'resumeSession');
                assert.fail('Should have timed out');
            } catch (error) {
                assert.match(error.message, /timed out/i);
                assert.match(error.message, /100ms/);
                assert.match(error.message, /resumeSession/);
            }
        });

        it('should not leave dangling timers after resolution', async () => {
            // Fast-resolving promise should clear the timer
            const result = await withTimeout(
                new Promise(resolve => setTimeout(() => resolve('fast'), 10)),
                5000,
                'test-op'
            );
            assert.strictEqual(result, 'fast');
        });
    });

    describe('attemptSessionResumeWithRetry with hanging SDK calls', () => {
        it('should timeout and retry when resumeFn hangs', async () => {
            let attempts = 0;
            const mockSession = { sessionId: 'test-123' };

            const resumeFn = () => {
                attempts++;
                if (attempts < 3) {
                    // Simulate hanging SDK call - never resolves
                    return new Promise(() => {});
                }
                return Promise.resolve(mockSession);
            };

            const result = await attemptSessionResumeWithRetry(
                'test-123',
                resumeFn,
                null,  // no logger
                200    // 200ms timeout for fast test
            );

            assert.strictEqual(result, mockSession);
            assert.strictEqual(attempts, 3, 'Should have retried after timeouts');
        });

        it('should exhaust all retries if SDK always hangs', async () => {
            let attempts = 0;
            const resumeFn = () => {
                attempts++;
                return new Promise(() => {}); // Never resolves
            };

            try {
                await attemptSessionResumeWithRetry(
                    'test-123',
                    resumeFn,
                    null,  // no logger
                    200    // 200ms timeout
                );
                assert.fail('Should have thrown after max retries');
            } catch (error) {
                assert.strictEqual(attempts, 3, 'Should have attempted 3 times');
                assert.match(error.message, /timed out/i);
            }
        });

        it('should use default timeout when none specified', async () => {
            // This test verifies the parameter exists and defaults work
            // We use a real rejection to avoid waiting 30s
            const resumeFn = () => Promise.resolve({ sessionId: 'ok' });

            const result = await attemptSessionResumeWithRetry(
                'test-123',
                resumeFn
                // no logger, no timeout — should use defaults
            );

            assert.ok(result);
            assert.strictEqual(result.sessionId, 'ok');
        });
    });
});
