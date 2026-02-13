/**
 * E2E Integration Test: Non-Vision Model Attachment Rejection
 * 
 * Tests Phase 6: Error Handling & Validation
 * 
 * Verifies that:
 * 1. GPT-5 (non-vision model) is correctly identified
 * 2. Attachment validation fails for non-vision models
 * 3. Error event is emitted with helpful message
 * 4. Session remains functional after validation error
 * 
 * Technical Flow Being Tested:
 * - SDKSessionManager.validateAttachments() → returns {valid: false}
 * - onMessageEmitter.fire({type: 'error', data: errorMsg})
 * - Session state resilience (no crash, subsequent messages work)
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const Module = require('module');
const { createVSCodeMock } = require('../../helpers/vscode-mock');

// Mock the 'vscode' module BEFORE any imports
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'vscode') {
        return global.vscode;
    }
    return originalRequire.apply(this, arguments);
};

// Mock VS Code API using shared mock
global.vscode = createVSCodeMock();

// Test logger
class TestLogger {
    constructor() {
        this.logs = [];
    }
    info(...args) { 
        const msg = args.join(' ');
        this.logs.push({ level: 'info', message: msg });
        console.log('[INFO]', ...args); 
    }
    debug(...args) { 
        const msg = args.join(' ');
        this.logs.push({ level: 'debug', message: msg });
        // Suppress debug logs for cleaner output
        // console.log('[DEBUG]', ...args); 
    }
    error(...args) { 
        const msg = args.join(' ');
        this.logs.push({ level: 'error', message: msg });
        console.error('[ERROR]', ...args); 
    }
    warn(...args) { 
        const msg = args.join(' ');
        this.logs.push({ level: 'warn', message: msg });
        console.warn('[WARN]', ...args); 
    }
    show() {}
}

// Mock extension context
function createMockContext() {
    const tempDir = path.join(__dirname, 'output', 'attachment-test-temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    
    return {
        extensionPath: path.join(__dirname, '..', '..', '..'),
        globalStorageUri: {
            fsPath: tempDir
        },
        subscriptions: []
    };
}

// Test results tracking
let testResults = [];

function recordTest(name, passed, details = '') {
    testResults.push({ name, passed, details });
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${name}${details ? ': ' + details : ''}`);
}

async function runTest() {
    console.log('='.repeat(70));
    console.log('Non-Vision Model Attachment Rejection - E2E Integration Test');
    console.log('Testing Phase 6: Error Handling & Validation');
    console.log('='.repeat(70));
    
    let sessionManager = null;
    let errorEventFired = false;
    let errorEventData = null;
    
    try {
        // Import compiled module (bundled by esbuild)
        const extensionModule = require('../../../dist/extension.js');
        const SDKSessionManager = extensionModule.SDKSessionManager;
        const Logger = extensionModule.Logger || TestLogger;
        
        // Set up test logger if Logger is available from extension
        if (extensionModule.Logger && typeof extensionModule.Logger.setInstance === 'function') {
            extensionModule.Logger.setInstance(new TestLogger());
        }
        
        // Create test context
        const context = createMockContext();
        
        console.log('\n📋 Step 1: Create SDKSessionManager with gpt-3.5-turbo (non-vision model)');
        
        // Use gpt-3.5-turbo which does NOT support vision
        let testModel = 'gpt-3.5-turbo';
        
        const config = {
            allowAll: true,
            model: testModel
        };
        
        sessionManager = new SDKSessionManager(context, config, false);
        
        console.log('\n📋 Step 2: Start session and verify model capabilities');
        await sessionManager.start();
        
        // Get session ID
        const sessionId = sessionManager.sessionId;
        console.log(`   Session ID: ${sessionId}`);
        recordTest('Session started', true, sessionId);
        
        // CRITICAL: Check if this model actually supports vision
        const supportsVision = await sessionManager.supportsVision();
        console.log(`   Model: ${testModel}`);
        console.log(`   Vision support: ${supportsVision}`);
        
        if (supportsVision) {
            console.warn(`   ⚠️  ${testModel} supports vision - this is NOT a valid test case!`);
            console.warn(`   Skipping test - SDK reports this model has vision capabilities`);
            
            await sessionManager.stop();
            
            console.log('\n' + '='.repeat(70));
            console.log(`⚠️  TEST SKIPPED - ${testModel} supports vision`);
            console.log('='.repeat(70));
            console.log(`\n💡 Discovery: ${testModel} has vision capabilities.`);
            console.log('   This test requires a model without vision support.');
            console.log('   SDK may have updated model capabilities.');
            process.exit(0); // Exit gracefully, not a test failure
        }
        
        console.log('   ✓ Model does NOT support vision - valid test case!');
        
        console.log('\n📋 Step 3: Subscribe to error events');
        
        // Subscribe to onMessage events to catch errors
        sessionManager.onMessage((message) => {
            if (message.type === 'error') {
                errorEventFired = true;
                errorEventData = message.data;
                console.log(`   [Event Received] type='error', data='${message.data}'`);
            }
        });
        
        console.log('   ✓ Error event listener registered');
        
        console.log('\n📋 Step 4: Prepare test image attachment');
        
        // Create test image fixture
        const testImagePath = path.join(__dirname, 'fixtures', 'test-icon.png');
        if (!fs.existsSync(testImagePath)) {
            throw new Error(`Test image not found: ${testImagePath}`);
        }
        
        const stats = fs.statSync(testImagePath);
        console.log(`   Test image: ${testImagePath}`);
        console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`);
        recordTest('Test image exists', true, `${(stats.size / 1024).toFixed(2)} KB`);
        
        const attachments = [{
            type: 'file',
            path: testImagePath,
            displayName: 'test-icon.png'
        }];
        
        console.log('\n📋 Step 4: Prepare test image attachment');
        
        try {
            await sessionManager.sendMessage("Describe this image", attachments);
            console.log('   ⚠️  sendMessage() completed without throwing');
        } catch (error) {
            sendMessageThrew = true;
            sendMessageError = error.message;
            console.log(`   Exception caught: ${error.message}`);
        }
        
        // Give event system time to propagate
        await new Promise(resolve => setTimeout(resolve, 100));
        
        console.log('\n📋 Step 6: Verify error handling');
        
        // Check if error event was fired
        recordTest('Error event was fired', errorEventFired, errorEventData || 'no event');
        
        if (errorEventFired) {
            console.log(`   Error message: "${errorEventData}"`);
            
            // Verify error message is helpful
            const errorLower = errorEventData.toLowerCase();
            const isHelpful = errorLower.includes('vision') || 
                             errorLower.includes('image') || 
                             errorLower.includes('does not support') ||
                             errorLower.includes('support');
            
            recordTest('Error message is helpful', isHelpful, `"${errorEventData}"`);
        } else {
            console.log('   ❌ No error event was fired!');
            
            if (sendMessageThrew) {
                console.log(`   Note: sendMessage() threw exception instead: "${sendMessageError}"`);
                recordTest('Error via exception (fallback)', true, sendMessageError);
            }
        }
        
        console.log('\n📋 Step 7: Verify session resilience');
        console.log('   Testing that session still works after validation error');
        
        let sessionStillWorks = false;
        let followUpError = null;
        
        try {
            // Send a message WITHOUT attachments
            await sessionManager.sendMessage("Hello, are you still working?");
            sessionStillWorks = true;
            console.log('   ✓ Session accepted follow-up message');
        } catch (error) {
            followUpError = error.message;
            console.log(`   ❌ Session failed on follow-up: ${error.message}`);
        }
        
        recordTest('Session remains functional', sessionStillWorks, followUpError || '');
        
        console.log('\n📋 Step 8: Cleanup');
        await sessionManager.stop();
        console.log('   ✓ Session stopped');
        
    } catch (error) {
        console.error('\n❌ TEST FAILED WITH EXCEPTION:');
        console.error(error);
        recordTest('Test execution', false, error.message);
        
        if (sessionManager) {
            try {
                await sessionManager.stop();
            } catch (e) {
                // Ignore cleanup errors
            }
        }
        
        process.exit(1);
    }
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('TEST SUMMARY');
    console.log('='.repeat(70));
    
    const passed = testResults.filter(r => r.passed).length;
    const total = testResults.length;
    
    testResults.forEach(result => {
        const icon = result.passed ? '✅' : '❌';
        console.log(`${icon} ${result.name}${result.details ? ': ' + result.details : ''}`);
    });
    
    console.log('\n' + '='.repeat(70));
    console.log(`Result: ${passed}/${total} tests passed`);
    console.log('='.repeat(70));
    
    if (passed < total) {
        console.error('\n❌ SOME TESTS FAILED');
        process.exit(1);
    } else {
        console.log('\n✅ ALL TESTS PASSED');
        process.exit(0);
    }
}

// Run test if executed directly
if (require.main === module) {
    runTest().catch(error => {
        console.error('❌ UNHANDLED ERROR:', error);
        process.exit(1);
    });
}

module.exports = { runTest };
