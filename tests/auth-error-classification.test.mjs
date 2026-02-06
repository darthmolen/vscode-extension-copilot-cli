/**
 * Tests for authentication error classification
 * 
 * These tests verify that the enhanced error detection works correctly:
 * 1. Error classification (authentication vs. other error types)
 * 2. Environment variable detection
 */

import { strict as assert } from 'assert';
import { classifySessionError, checkAuthEnvVars } from './authUtils.mjs';

// Color output helpers
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
};

function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

// Test runner
async function runTests() {
    let passed = 0;
    let failed = 0;

    log('\n======================================================================', colors.blue);
    log('Authentication Error Classification Tests');
    log('======================================================================\n', colors.blue);

    // Test: Authentication error patterns
    log('📋 Test 1: Authentication error patterns', colors.yellow);
    try {
        const authPatterns = ['auth', 'unauthorized', 'not authenticated', 'authentication', 
                              'login required', 'not logged in', 'invalid token', 'expired token', 
                              '403', '401'];
        
        for (const pattern of authPatterns) {
            const error = new Error(`Failed: ${pattern} error occurred`);
            const errorType = classifySessionError(error);
            assert.strictEqual(errorType, 'authentication', 
                `Pattern "${pattern}" should be classified as authentication error`);
        }
        log('✅ All authentication patterns detected correctly\n', colors.green);
        passed++;
    } catch (error) {
        log(`❌ FAILED: ${error.message}\n`, colors.red);
        failed++;
    }

    // Test: Session expired patterns
    log('📋 Test 2: Session expired error patterns', colors.yellow);
    try {
        const expiredPatterns = ['session not found', 'invalid session'];
        
        for (const pattern of expiredPatterns) {
            const error = new Error(`Failed: ${pattern}`);
            const errorType = classifySessionError(error);
            assert.strictEqual(errorType, 'session_expired',
                `Pattern "${pattern}" should be classified as session_expired error`);
        }
        log('✅ All session expired patterns detected correctly\n', colors.green);
        passed++;
    } catch (error) {
        log(`❌ FAILED: ${error.message}\n`, colors.red);
        failed++;
    }

    // Test: Network error patterns
    log('📋 Test 3: Network error patterns', colors.yellow);
    try {
        const networkPatterns = ['network', 'econnrefused', 'enotfound', 'timeout'];
        
        for (const pattern of networkPatterns) {
            const error = new Error(`Failed: ${pattern}`);
            const errorType = classifySessionError(error);
            assert.strictEqual(errorType, 'network',
                `Pattern "${pattern}" should be classified as network error`);
        }
        log('✅ All network error patterns detected correctly\n', colors.green);
        passed++;
    } catch (error) {
        log(`❌ FAILED: ${error.message}\n`, colors.red);
        failed++;
    }

    // Test: Unknown errors
    log('📋 Test 4: Unknown error classification', colors.yellow);
    try {
        const error = new Error('Something completely different happened');
        const errorType = classifySessionError(error);
        assert.strictEqual(errorType, 'unknown');
        log('✅ Unknown errors classified correctly\n', colors.green);
        passed++;
    } catch (error) {
        log(`❌ FAILED: ${error.message}\n`, colors.red);
        failed++;
    }

    // Test: Case insensitivity
    log('📋 Test 5: Case insensitive matching', colors.yellow);
    try {
        const errorLower = new Error('authentication failed');
        const errorUpper = new Error('AUTHENTICATION FAILED');
        const errorMixed = new Error('AuThEnTiCaTiOn FaIlEd');

        assert.strictEqual(classifySessionError(errorLower), 'authentication');
        assert.strictEqual(classifySessionError(errorUpper), 'authentication');
        assert.strictEqual(classifySessionError(errorMixed), 'authentication');
        log('✅ Case insensitive matching works\n', colors.green);
        passed++;
    } catch (error) {
        log(`❌ FAILED: ${error.message}\n`, colors.red);
        failed++;
    }

    // Environment variable tests
    const originalEnv = { ...process.env };

    // Test: COPILOT_GITHUB_TOKEN priority
    log('📋 Test 6: COPILOT_GITHUB_TOKEN priority (highest)', colors.yellow);
    try {
        process.env.COPILOT_GITHUB_TOKEN = 'test_token';
        process.env.GH_TOKEN = 'other_token';
        process.env.GITHUB_TOKEN = 'another_token';

        const result = checkAuthEnvVars();
        assert.strictEqual(result.hasEnvVar, true);
        assert.strictEqual(result.source, 'COPILOT_GITHUB_TOKEN');
        
        delete process.env.COPILOT_GITHUB_TOKEN;
        delete process.env.GH_TOKEN;
        delete process.env.GITHUB_TOKEN;
        
        log('✅ COPILOT_GITHUB_TOKEN priority correct\n', colors.green);
        passed++;
    } catch (error) {
        log(`❌ FAILED: ${error.message}\n`, colors.red);
        failed++;
    }

    // Test: GH_TOKEN priority
    log('📋 Test 7: GH_TOKEN priority (medium)', colors.yellow);
    try {
        delete process.env.COPILOT_GITHUB_TOKEN;
        process.env.GH_TOKEN = 'test_token';
        process.env.GITHUB_TOKEN = 'another_token';

        const result = checkAuthEnvVars();
        assert.strictEqual(result.hasEnvVar, true);
        assert.strictEqual(result.source, 'GH_TOKEN');
        
        delete process.env.GH_TOKEN;
        delete process.env.GITHUB_TOKEN;
        
        log('✅ GH_TOKEN priority correct\n', colors.green);
        passed++;
    } catch (error) {
        log(`❌ FAILED: ${error.message}\n`, colors.red);
        failed++;
    }

    // Test: GITHUB_TOKEN priority
    log('📋 Test 8: GITHUB_TOKEN priority (lowest)', colors.yellow);
    try {
        delete process.env.COPILOT_GITHUB_TOKEN;
        delete process.env.GH_TOKEN;
        process.env.GITHUB_TOKEN = 'test_token';

        const result = checkAuthEnvVars();
        assert.strictEqual(result.hasEnvVar, true);
        assert.strictEqual(result.source, 'GITHUB_TOKEN');
        
        delete process.env.GITHUB_TOKEN;
        
        log('✅ GITHUB_TOKEN priority correct\n', colors.green);
        passed++;
    } catch (error) {
        log(`❌ FAILED: ${error.message}\n`, colors.red);
        failed++;
    }

    // Test: No env vars
    log('📋 Test 9: No environment variables', colors.yellow);
    try {
        delete process.env.COPILOT_GITHUB_TOKEN;
        delete process.env.GH_TOKEN;
        delete process.env.GITHUB_TOKEN;

        const result = checkAuthEnvVars();
        assert.strictEqual(result.hasEnvVar, false);
        assert.strictEqual(result.source, undefined);
        log('✅ No env vars detected correctly\n', colors.green);
        passed++;
    } catch (error) {
        log(`❌ FAILED: ${error.message}\n`, colors.red);
        failed++;
    }

    // Restore environment
    process.env = { ...originalEnv };

    // Results
    log('\n======================================================================', colors.blue);
    log(`Test Results: ${passed} passed, ${failed} failed`, 
        failed === 0 ? colors.green : colors.red);
    log('======================================================================\n', colors.blue);

    process.exit(failed === 0 ? 0 : 1);
}

// Run tests
runTests().catch(error => {
    log(`\n❌ Test suite failed: ${error.message}\n`, colors.red);
    console.error(error);
    process.exit(1);
});
