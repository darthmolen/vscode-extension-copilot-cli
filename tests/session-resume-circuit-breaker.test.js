/**
 * Tests for session resume circuit breaker logic
 * 
 * TDD Phase 2: Circuit Breaker Core Logic
 * Tests the retry mechanism with exponential backoff
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { attemptSessionResumeWithRetry } from '../out/authUtils.js';

describe('Circuit Breaker Retry Logic', () => {
    describe('successful resume scenarios', () => {
        it('should return session on first successful attempt', async () => {
            const mockSession = { sessionId: 'test-123', status: 'active' };
            const resumeFn = mock.fn(() => Promise.resolve(mockSession));
            
            const result = await attemptSessionResumeWithRetry('test-123', resumeFn);
            
            assert.strictEqual(result, mockSession);
            assert.strictEqual(resumeFn.mock.calls.length, 1);
        });

        it('should retry and succeed on second attempt', async () => {
            let callCount = 0;
            const mockSession = { sessionId: 'test-123', status: 'active' };
            const resumeFn = mock.fn(() => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('Network error occurred');
                }
                return Promise.resolve(mockSession);
            });
            
            const result = await attemptSessionResumeWithRetry('test-123', resumeFn);
            
            assert.strictEqual(result, mockSession);
            assert.strictEqual(resumeFn.mock.calls.length, 2);
        });

        it('should retry and succeed on third attempt', async () => {
            let callCount = 0;
            const mockSession = { sessionId: 'test-123', status: 'active' };
            const resumeFn = mock.fn(() => {
                callCount++;
                if (callCount < 3) {
                    throw new Error('Request timeout after 30s');
                }
                return Promise.resolve(mockSession);
            });
            
            const result = await attemptSessionResumeWithRetry('test-123', resumeFn);
            
            assert.strictEqual(result, mockSession);
            assert.strictEqual(resumeFn.mock.calls.length, 3);
        });
    });

    describe('session expired scenarios (no retries)', () => {
        it('should skip retries for session_expired errors', async () => {
            const resumeFn = mock.fn(() => {
                throw new Error('Session not found');
            });
            
            try {
                await attemptSessionResumeWithRetry('test-123', resumeFn);
                assert.fail('Should have thrown error');
            } catch (error) {
                assert.strictEqual(resumeFn.mock.calls.length, 1);
                assert.match(error.message, /session not found/i);
            }
        });

        it('should skip retries for invalid session errors', async () => {
            const resumeFn = mock.fn(() => {
                throw new Error('Invalid session ID provided');
            });
            
            try {
                await attemptSessionResumeWithRetry('test-123', resumeFn);
                assert.fail('Should have thrown error');
            } catch (error) {
                assert.strictEqual(resumeFn.mock.calls.length, 1);
            }
        });
    });

    describe('authentication errors (fail fast)', () => {
        it('should fail fast for authentication errors', async () => {
            const resumeFn = mock.fn(() => {
                throw new Error('Unauthorized: invalid token');
            });
            
            try {
                await attemptSessionResumeWithRetry('test-123', resumeFn);
                assert.fail('Should have thrown error');
            } catch (error) {
                assert.strictEqual(resumeFn.mock.calls.length, 1);
                assert.match(error.message, /unauthorized/i);
            }
        });

        it('should fail fast for token validation errors', async () => {
            const resumeFn = mock.fn(() => {
                throw new Error('Token validation failed');
            });
            
            try {
                await attemptSessionResumeWithRetry('test-123', resumeFn);
                assert.fail('Should have thrown error');
            } catch (error) {
                assert.strictEqual(resumeFn.mock.calls.length, 1);
                assert.match(error.message, /token/i);
            }
        });
    });

    describe('network errors (retry with backoff)', () => {
        it('should retry ECONNREFUSED errors', async () => {
            let callCount = 0;
            const resumeFn = mock.fn(() => {
                callCount++;
                if (callCount < 2) {
                    throw new Error('connect ECONNREFUSED 127.0.0.1:8080');
                }
                return Promise.resolve({ sessionId: 'test-123' });
            });
            
            const result = await attemptSessionResumeWithRetry('test-123', resumeFn);
            
            assert.strictEqual(resumeFn.mock.calls.length, 2);
            assert.ok(result);
        });

        it('should retry timeout errors up to 3 times', async () => {
            const resumeFn = mock.fn(() => {
                throw new Error('Request timeout after 30s');
            });
            
            try {
                await attemptSessionResumeWithRetry('test-123', resumeFn);
                assert.fail('Should have thrown error after max retries');
            } catch (error) {
                // Should attempt 3 times before giving up
                assert.strictEqual(resumeFn.mock.calls.length, 3);
            }
        });
    });

    describe('session_not_ready errors (retry)', () => {
        it('should retry "client not connected" errors', async () => {
            let callCount = 0;
            const mockSession = { sessionId: 'test-123' };
            const resumeFn = mock.fn(() => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('Client not connected');
                }
                return Promise.resolve(mockSession);
            });
            
            const result = await attemptSessionResumeWithRetry('test-123', resumeFn);
            
            assert.strictEqual(resumeFn.mock.calls.length, 2);
            assert.strictEqual(result, mockSession);
        });

        it('should retry "CLI not ready" errors', async () => {
            let callCount = 0;
            const mockSession = { sessionId: 'test-123' };
            const resumeFn = mock.fn(() => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('CLI not ready to accept connections');
                }
                return Promise.resolve(mockSession);
            });
            
            const result = await attemptSessionResumeWithRetry('test-123', resumeFn);
            
            assert.strictEqual(resumeFn.mock.calls.length, 2);
            assert.ok(result);
        });
    });

    describe('unknown errors (retry)', () => {
        it('should retry unknown errors', async () => {
            let callCount = 0;
            const mockSession = { sessionId: 'test-123' };
            const resumeFn = mock.fn(() => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('Something unexpected happened');
                }
                return Promise.resolve(mockSession);
            });
            
            const result = await attemptSessionResumeWithRetry('test-123', resumeFn);
            
            assert.strictEqual(resumeFn.mock.calls.length, 2);
            assert.strictEqual(result, mockSession);
        });

        it('should give up after 3 failed attempts on unknown errors', async () => {
            const resumeFn = mock.fn(() => {
                throw new Error('Persistent unknown error');
            });
            
            try {
                await attemptSessionResumeWithRetry('test-123', resumeFn);
                assert.fail('Should have thrown after max retries');
            } catch (error) {
                assert.strictEqual(resumeFn.mock.calls.length, 3);
            }
        });
    });
});
