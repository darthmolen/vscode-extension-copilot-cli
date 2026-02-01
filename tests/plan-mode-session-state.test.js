/**
 * Plan Mode Session State Integration Test
 * Tests that work session persists and event handlers work after plan mode exit
 * Uses real SDK (not mocked)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

// Mock the 'vscode' module BEFORE any imports
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'vscode') {
        return global.vscode;
    }
    return originalRequire.apply(this, arguments);
};

// Mock VS Code API
global.vscode = {
    workspace: {
        workspaceFolders: [{ uri: { fsPath: __dirname } }],
        getConfiguration: (section) => ({
            get: (key, defaultValue) => {
                if (section === 'copilotCLI') {
                    const config = {
                        'cliPath': 'copilot',
                        'yoloMode': false,
                        'model': 'gpt-4o'
                    };
                    return config[key] !== undefined ? config[key] : defaultValue;
                }
                return defaultValue;
            }
        })
    },
    EventEmitter: class EventEmitter {
        constructor() {
            this.listeners = [];
            this.event = this.event.bind(this);
        }
        fire(data) {
            this.listeners.forEach(listener => listener(data));
        }
        event(listener) {
            this.listeners.push(listener);
            return { dispose: () => {
                const index = this.listeners.indexOf(listener);
                if (index > -1) this.listeners.splice(index, 1);
            }};
        }
        dispose() {
            this.listeners = [];
        }
    },
    Uri: {
        file: (path) => ({ fsPath: path })
    },
    window: {
        showInformationMessage: () => {},
        showErrorMessage: () => {},
        showWarningMessage: () => {},
        createOutputChannel: () => ({
            appendLine: () => {},
            show: () => {},
            dispose: () => {}
        })
    },
    commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: () => Promise.resolve()
    }
};

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
        // console.log('[DEBUG]', ...args);  // Comment out for less noise
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
    const tempDir = path.join(__dirname, 'output', 'plan-mode-session-test');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    
    return {
        extensionPath: path.join(__dirname, '..'),
        globalStorageUri: {
            fsPath: tempDir
        },
        subscriptions: []
    };
}

// Test state
let testResults = [];

function recordTest(name, passed, details = '') {
    testResults.push({ name, passed, details });
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${name}${details ? ': ' + details : ''}`);
}

async function runSessionStateTests() {
    console.log('='.repeat(70));
    console.log('Plan Mode Session State Tests');
    console.log('Testing session persistence and event handler management');
    console.log('='.repeat(70));
    
    let sessionManager = null;
    let capturedEvents = [];
    
    try {
        // Import compiled module
        const extensionModule = require('../dist/extension.js');
        const SDKSessionManager = extensionModule.SDKSessionManager;
        
        // Set up test logger
        if (extensionModule.Logger && typeof extensionModule.Logger.setInstance === 'function') {
            extensionModule.Logger.setInstance(new TestLogger());
        }
        
        // Create test context
        const context = createMockContext();
        
        console.log('\n📋 Test 1: Work session ID persists through plan mode');
        sessionManager = new SDKSessionManager(context, { allowAll: true }, false);
        
        // Capture events
        sessionManager.onMessage((event) => {
            capturedEvents.push(event);
        });
        
        await sessionManager.start();
        const workSessionId = sessionManager.getSessionId();
        console.log(`   Initial work session ID: ${workSessionId}`);
        
        await sessionManager.enablePlanMode();
        const planSessionId = sessionManager.getSessionId();
        console.log(`   Plan session ID: ${planSessionId}`);
        
        // Verify work session ID is preserved internally
        const workSessionIdAfterPlan = sessionManager.workSessionId;
        recordTest('Work session ID preserved', workSessionIdAfterPlan === workSessionId, 
                  `${workSessionId} -> ${workSessionIdAfterPlan}`);
        
        await sessionManager.disablePlanMode();
        const resumedSessionId = sessionManager.getSessionId();
        console.log(`   Resumed session ID: ${resumedSessionId}`);
        
        recordTest('Session ID restored after plan mode exit', resumedSessionId === workSessionId,
                  `Expected ${workSessionId}, got ${resumedSessionId}`);
        
        console.log('\n📋 Test 2: Mode transitions correctly');
        const modeAfterExit = sessionManager.getCurrentMode();
        recordTest('Mode is "work" after exit', modeAfterExit === 'work', `Mode: ${modeAfterExit}`);
        
        console.log('\n📋 Test 3: Status events emitted');
        const planEnabledEvent = capturedEvents.find(e => 
            e.type === 'status' && e.data?.status === 'plan_mode_enabled'
        );
        recordTest('plan_mode_enabled event emitted', !!planEnabledEvent);
        
        const planDisabledEvent = capturedEvents.find(e => 
            e.type === 'status' && e.data?.status === 'plan_mode_disabled'
        );
        recordTest('plan_mode_disabled event emitted', !!planDisabledEvent);
        
        if (planEnabledEvent) {
            recordTest('plan_mode_enabled has workSessionId', 
                      !!planEnabledEvent.data.workSessionId,
                      planEnabledEvent.data.workSessionId);
        }
        
        if (planDisabledEvent) {
            recordTest('plan_mode_disabled has workSessionId',
                      !!planDisabledEvent.data.workSessionId,
                      planDisabledEvent.data.workSessionId);
        }
        
        console.log('\n📋 Test 4: Event handlers not duplicated');
        // Test that event handlers are properly cleaned up and not doubled
        
        // Track how many times each event fires
        let eventCounts = { output: 0, tool: 0, usage: 0 };
        const countingListener = (event) => {
            if (event.type === 'output') eventCounts.output++;
            if (event.type === 'tool') eventCounts.tool++;
            if (event.type === 'usage') eventCounts.usage++;
        };
        
        sessionManager.onMessage(countingListener);
        
        // Clear previous events
        capturedEvents = [];
        eventCounts = { output: 0, tool: 0, usage: 0 };
        
        try {
            await sessionManager.sendMessage('Say "hello test" and nothing else');
            
            // Check for response
            const hasResponse = capturedEvents.some(e => e.type === 'output');
            recordTest('Received response after plan mode exit', hasResponse);
            
            // Check for errors
            const hasError = capturedEvents.some(e => 
                e.type === 'error' || 
                (e.type === 'output' && e.data?.includes('does not exist'))
            );
            recordTest('No session errors after plan mode exit', !hasError);
            
            // Check event counts - if handlers were doubled, we'd see 2x events
            console.log(`   Event counts: output=${eventCounts.output}, tool=${eventCounts.tool}, usage=${eventCounts.usage}`);
            
            // We should get exactly 1 output event (or maybe a few, but not DOUBLED)
            // If we see like 6 or 8 (multiples of 2), handlers are doubled
            const seemsDoubled = eventCounts.output > 0 && eventCounts.output % 2 === 0 && eventCounts.output >= 4;
            recordTest('Event handlers not duplicated', !seemsDoubled, 
                      `Got ${eventCounts.output} output events${seemsDoubled ? ' (DOUBLED!)' : ''}`);
            
        } catch (error) {
            recordTest('Messages work after plan mode exit', false, error.message);
        }
        
        console.log('\n📋 Test 5: Accept plan flow');
        await sessionManager.stop();
        sessionManager = new SDKSessionManager(context, { allowAll: true }, false);
        capturedEvents = [];
        sessionManager.onMessage((event) => capturedEvents.push(event));
        
        await sessionManager.start();
        const workId2 = sessionManager.getSessionId();
        
        await sessionManager.enablePlanMode();
        await sessionManager.acceptPlan();
        
        const idAfterAccept = sessionManager.getSessionId();
        recordTest('Accept plan restores work session', idAfterAccept === workId2);
        
        const acceptEvent = capturedEvents.find(e =>
            e.type === 'status' && e.data?.status === 'plan_accepted'
        );
        recordTest('plan_accepted event emitted', !!acceptEvent);
        
        console.log('\n📋 Test 6: Reject plan flow');
        await sessionManager.stop();
        sessionManager = new SDKSessionManager(context, { allowAll: true }, false);
        capturedEvents = [];
        sessionManager.onMessage((event) => capturedEvents.push(event));
        
        await sessionManager.start();
        const workId3 = sessionManager.getSessionId();
        
        await sessionManager.enablePlanMode();
        await sessionManager.rejectPlan();
        
        const idAfterReject = sessionManager.getSessionId();
        recordTest('Reject plan restores work session', idAfterReject === workId3);
        
        const rejectEvent = capturedEvents.find(e =>
            e.type === 'status' && e.data?.status === 'plan_rejected'
        );
        recordTest('plan_rejected event emitted', !!rejectEvent);
        
        console.log('\n📋 Cleanup');
        await sessionManager.stop();
        
    } catch (error) {
        console.error('\n❌ Test suite error:', error);
        recordTest('Test suite execution', false, error.message);
    } finally {
        if (sessionManager) {
            try {
                await sessionManager.stop();
            } catch (e) {
                console.warn('Error stopping session:', e.message);
            }
        }
    }
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('Test Results Summary');
    console.log('='.repeat(70));
    
    const passed = testResults.filter(t => t.passed).length;
    const failed = testResults.filter(t => !t.passed).length;
    const total = testResults.length;
    
    console.log(`\nTotal: ${total} | Passed: ${passed} | Failed: ${failed}`);
    
    if (failed > 0) {
        console.log('\nFailed tests:');
        testResults.filter(t => !t.passed).forEach(t => {
            console.log(`  ❌ ${t.name}: ${t.details}`);
        });
    }
    
    console.log('\n' + '='.repeat(70));
    
    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runSessionStateTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
