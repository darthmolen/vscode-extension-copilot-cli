/**
 * Tests for authentication error classification
 *
 * These tests verify that the enhanced error detection works correctly:
 * 1. Error classification (authentication vs. other error types)
 * 2. Environment variable detection
 */

const assert = require('assert');
const { classifySessionError, checkAuthEnvVars } = require('../../helpers/authUtils');

describe('Authentication Error Classification Tests', function () {

    describe('Authentication error patterns', function () {
        it('should classify all authentication patterns correctly', function () {
            const authPatterns = ['auth', 'unauthorized', 'not authenticated', 'authentication',
                'login required', 'not logged in', 'invalid token', 'expired token',
                '403', '401'];

            for (const pattern of authPatterns) {
                const error = new Error(`Failed: ${pattern} error occurred`);
                const errorType = classifySessionError(error);
                assert.strictEqual(errorType, 'authentication',
                    `Pattern "${pattern}" should be classified as authentication error`);
            }
        });
    });

    describe('Session expired error patterns', function () {
        it('should classify session expired patterns correctly', function () {
            const expiredPatterns = ['session not found', 'invalid session'];

            for (const pattern of expiredPatterns) {
                const error = new Error(`Failed: ${pattern}`);
                const errorType = classifySessionError(error);
                assert.strictEqual(errorType, 'session_expired',
                    `Pattern "${pattern}" should be classified as session_expired error`);
            }
        });
    });

    describe('Network error patterns', function () {
        it('should classify network patterns correctly', function () {
            const networkPatterns = ['network', 'econnrefused', 'enotfound', 'timeout'];

            for (const pattern of networkPatterns) {
                const error = new Error(`Failed: ${pattern}`);
                const errorType = classifySessionError(error);
                assert.strictEqual(errorType, 'network',
                    `Pattern "${pattern}" should be classified as network error`);
            }
        });
    });

    describe('CLI version error patterns', function () {
        it('should classify CLI version mismatch as cli_version', function () {
            const error = new Error('Copilot CLI v0.0.414 is not compatible. CLI v0.0.410+ removed --headless support.');
            const errorType = classifySessionError(error);
            assert.strictEqual(errorType, 'cli_version');
        });

        it('should classify version errors with different version numbers', function () {
            const error = new Error('Copilot CLI v0.0.410 is not compatible');
            assert.strictEqual(classifySessionError(error), 'cli_version');
        });

        it('should not classify unrelated version mentions as cli_version', function () {
            const error = new Error('API version 2.0 not supported');
            assert.notStrictEqual(classifySessionError(error), 'cli_version');
        });
    });

    describe('Unknown error classification', function () {
        it('should classify unknown errors correctly', function () {
            const error = new Error('Something completely different happened');
            const errorType = classifySessionError(error);
            assert.strictEqual(errorType, 'unknown');
        });
    });

    describe('Case insensitive matching', function () {
        it('should match authentication errors regardless of case', function () {
            const errorLower = new Error('authentication failed');
            const errorUpper = new Error('AUTHENTICATION FAILED');
            const errorMixed = new Error('AuThEnTiCaTiOn FaIlEd');

            assert.strictEqual(classifySessionError(errorLower), 'authentication');
            assert.strictEqual(classifySessionError(errorUpper), 'authentication');
            assert.strictEqual(classifySessionError(errorMixed), 'authentication');
        });
    });

    describe('Environment variable detection', function () {
        const originalEnv = {};

        beforeEach(function () {
            // Save original values
            originalEnv.COPILOT_GITHUB_TOKEN = process.env.COPILOT_GITHUB_TOKEN;
            originalEnv.GH_TOKEN = process.env.GH_TOKEN;
            originalEnv.GITHUB_TOKEN = process.env.GITHUB_TOKEN;

            // Clear all
            delete process.env.COPILOT_GITHUB_TOKEN;
            delete process.env.GH_TOKEN;
            delete process.env.GITHUB_TOKEN;
        });

        afterEach(function () {
            // Restore original values
            if (originalEnv.COPILOT_GITHUB_TOKEN !== undefined) {
                process.env.COPILOT_GITHUB_TOKEN = originalEnv.COPILOT_GITHUB_TOKEN;
            } else {
                delete process.env.COPILOT_GITHUB_TOKEN;
            }
            if (originalEnv.GH_TOKEN !== undefined) {
                process.env.GH_TOKEN = originalEnv.GH_TOKEN;
            } else {
                delete process.env.GH_TOKEN;
            }
            if (originalEnv.GITHUB_TOKEN !== undefined) {
                process.env.GITHUB_TOKEN = originalEnv.GITHUB_TOKEN;
            } else {
                delete process.env.GITHUB_TOKEN;
            }
        });

        it('should prioritize COPILOT_GITHUB_TOKEN (highest)', function () {
            process.env.COPILOT_GITHUB_TOKEN = 'test_token';
            process.env.GH_TOKEN = 'other_token';
            process.env.GITHUB_TOKEN = 'another_token';

            const result = checkAuthEnvVars();
            assert.strictEqual(result.hasEnvVar, true);
            assert.strictEqual(result.source, 'COPILOT_GITHUB_TOKEN');
        });

        it('should use GH_TOKEN when COPILOT_GITHUB_TOKEN is absent (medium priority)', function () {
            process.env.GH_TOKEN = 'test_token';
            process.env.GITHUB_TOKEN = 'another_token';

            const result = checkAuthEnvVars();
            assert.strictEqual(result.hasEnvVar, true);
            assert.strictEqual(result.source, 'GH_TOKEN');
        });

        it('should use GITHUB_TOKEN when others are absent (lowest priority)', function () {
            process.env.GITHUB_TOKEN = 'test_token';

            const result = checkAuthEnvVars();
            assert.strictEqual(result.hasEnvVar, true);
            assert.strictEqual(result.source, 'GITHUB_TOKEN');
        });

        it('should report no env vars when none are set', function () {
            const result = checkAuthEnvVars();
            assert.strictEqual(result.hasEnvVar, false);
            assert.strictEqual(result.source, undefined);
        });
    });
});
