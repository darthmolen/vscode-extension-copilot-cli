/**
 * Tests for session resume error classification
 *
 * TDD Phase 1: Error Classification Enhancement
 * These tests define how different session resume errors should be classified
 */

const assert = require('assert');

describe('Session Error Classification', () => {
    let classifySessionError;

    before(async () => {
        const mod = await import('../../../out/sessionErrorUtils.js');
        classifySessionError = mod.classifySessionError;
    });

    describe('session_expired errors', () => {
        it('should classify "session not found" as session_expired', () => {
            const error = new Error('Session not found');
            const result = classifySessionError(error);
            assert.equal(result, 'session_expired');
        });

        it('should classify "invalid session" as session_expired', () => {
            const error = new Error('Invalid session ID provided');
            const result = classifySessionError(error);
            assert.equal(result, 'session_expired');
        });

        it('should classify "session does not exist" as session_expired', () => {
            const error = new Error('Session does not exist');
            const result = classifySessionError(error);
            assert.equal(result, 'session_expired');
        });
    });

    describe('session_not_ready errors', () => {
        it('should classify "client not connected" as session_not_ready', () => {
            const error = new Error('Client not connected');
            const result = classifySessionError(error);
            assert.equal(result, 'session_not_ready');
        });

        it('should classify "CLI not ready" as session_not_ready', () => {
            const error = new Error('CLI not ready to accept connections');
            const result = classifySessionError(error);
            assert.equal(result, 'session_not_ready');
        });
    });

    describe('network_timeout errors', () => {
        it('should classify "ECONNREFUSED" as network_timeout', () => {
            const error = new Error('connect ECONNREFUSED 127.0.0.1:8080');
            const result = classifySessionError(error);
            assert.equal(result, 'network_timeout');
        });

        it('should classify "network error" as network_timeout', () => {
            const error = new Error('Network error occurred');
            const result = classifySessionError(error);
            assert.equal(result, 'network_timeout');
        });

        it('should classify "timeout" as network_timeout', () => {
            const error = new Error('Request timeout after 30s');
            const result = classifySessionError(error);
            assert.equal(result, 'network_timeout');
        });

        it('should classify "ETIMEDOUT" as network_timeout', () => {
            const error = new Error('connect ETIMEDOUT');
            const result = classifySessionError(error);
            assert.equal(result, 'network_timeout');
        });
    });

    describe('authentication errors', () => {
        it('should classify "unauthorized" as authentication', () => {
            const error = new Error('Unauthorized: invalid token');
            const result = classifySessionError(error);
            assert.equal(result, 'authentication');
        });

        it('should classify "authentication failed" as authentication', () => {
            const error = new Error('Authentication failed');
            const result = classifySessionError(error);
            assert.equal(result, 'authentication');
        });

        it('should classify "invalid token" as authentication', () => {
            const error = new Error('Token validation failed');
            const result = classifySessionError(error);
            assert.equal(result, 'authentication');
        });
    });

    describe('unknown errors', () => {
        it('should classify unrecognized errors as unknown', () => {
            const error = new Error('Something completely unexpected');
            const result = classifySessionError(error);
            assert.equal(result, 'unknown');
        });

        it('should classify empty error message as unknown', () => {
            const error = new Error('');
            const result = classifySessionError(error);
            assert.equal(result, 'unknown');
        });

        it('should handle generic Error as unknown', () => {
            const error = new Error('Generic error');
            const result = classifySessionError(error);
            assert.equal(result, 'unknown');
        });
    });

    describe('case insensitivity', () => {
        it('should classify regardless of message case', () => {
            const errorLower = new Error('session not found');
            const errorUpper = new Error('SESSION NOT FOUND');
            const errorMixed = new Error('Session Not Found');

            assert.equal(classifySessionError(errorLower), 'session_expired');
            assert.equal(classifySessionError(errorUpper), 'session_expired');
            assert.equal(classifySessionError(errorMixed), 'session_expired');
        });
    });
});
