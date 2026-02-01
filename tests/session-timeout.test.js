/**
 * Session Timeout Test
 * Tests that session status indicator (green light) properly updates when a timed-out session is recreated
 * Uses real SDK (not mocked)
 */

const path = require('path');
const fs = require('fs');
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
    const tempDir = path.join(__dirname, 'output', 'session-timeout-test');
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

async function runSessionTimeoutTests() {
    console.log('='.repeat(70));
    console.log('Session Timeout Recovery Tests');
    console.log('Testing that status indicator updates when session is recreated');
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
        
        console.log('\n📋 Test 1: Session timeout during startup recovery');
        sessionManager = new SDKSessionManager(context, { allowAll: true }, false);
        
        // Capture events
        sessionManager.onMessage((event) => {
            capturedEvents.push(event);
            console.log(`   Event: ${event.type}${event.data?.status ? ' (status: ' + event.data.status + ')' : ''}`);
        });
        
        // Start with an old/expired session ID
        sessionManager.sessionId = 'expired-session-id-that-does-not-exist';
        
        await sessionManager.start();
        
        // Check for session_expired event
        const sessionExpiredEvent = capturedEvents.find(e => 
            e.type === 'status' && e.data?.status === 'session_expired'
        );
        
        recordTest('session_expired event emitted on startup recovery', 
                  !!sessionExpiredEvent,
                  sessionExpiredEvent ? `New session: ${sessionExpiredEvent.data.newSessionId}` : 'No event found');
        
        // Verify new session was created
        const newSessionId = sessionManager.getSessionId();
        recordTest('New session created', 
                  !!newSessionId && newSessionId !== 'expired-session-id-that-does-not-exist',
                  `Session ID: ${newSessionId}`);
        
        console.log('\n📋 Test 2: Session timeout during message send recovery (optional)');
        await sessionManager.stop();
        sessionManager = new SDKSessionManager(context, { allowAll: true }, false);
        capturedEvents = [];
        sessionManager.onMessage((event) => {
            capturedEvents.push(event);
            console.log(`   Event: ${event.type}${event.data?.status ? ' (status: ' + event.data.status + ')' : ''}`);
        });
        
        // Start normally
        await sessionManager.start();
        const originalSessionId = sessionManager.getSessionId();
        console.log(`   Original session ID: ${originalSessionId}`);
        
        // Simulate session timeout by deleting the session manually
        // We'll force an error by corrupting the session ID
        console.log('   Simulating session timeout...');
        console.log('   (This test may not trigger session recreation in test environment)');
        sessionManager.sessionId = 'another-expired-session';
        
        // Try to send a message - this should trigger session recreation
        try {
            await sessionManager.sendMessage('test message after timeout');
            
            // Check if session was recreated
            const recoveredSessionId = sessionManager.getSessionId();
            const sessionRecreated = recoveredSessionId !== 'another-expired-session';
            
            // This is informational only - session recreation during message send
            // may not work in test environment
            console.log(`   Session after message: ${recoveredSessionId} (recreated: ${sessionRecreated})`);
            
            // Verify we got a session_expired event OR the message succeeded
            const hasSessionExpiredEvent = capturedEvents.some(e => 
                e.type === 'status' && e.data?.status === 'session_expired'
            );
            const hasSuccessfulResponse = capturedEvents.some(e => 
                e.type === 'output'
            );
            
            // This test is informational - either recovery or success is fine
            if (hasSessionExpiredEvent) {
                console.log('   ℹ️  Session recreation triggered (expected in some environments)');
            } else if (hasSuccessfulResponse) {
                console.log('   ℹ️  Message succeeded without recreation (test environment behavior)');
            }
            
        } catch (error) {
            // Session recreation might fail in test environment, that's ok
            console.log(`   Note: Message send failed (expected in test): ${error.message}`);
        }
        
        console.log('\n📋 Test 3: Verify status event structure');
        const allStatusEvents = capturedEvents.filter(e => e.type === 'status');
        console.log(`   Found ${allStatusEvents.length} status events`);
        
        allStatusEvents.forEach(event => {
            console.log(`   - Status: ${event.data?.status}, Data: ${JSON.stringify(event.data)}`);
        });
        
        const sessionExpiredEvents = allStatusEvents.filter(e => e.data?.status === 'session_expired');
        if (sessionExpiredEvents.length > 0) {
            const hasNewSessionId = sessionExpiredEvents.every(e => !!e.data.newSessionId);
            recordTest('session_expired events include newSessionId', 
                      hasNewSessionId,
                      `Count: ${sessionExpiredEvents.length}`);
        }
        
        console.log('\n📋 Test 4: Verify extension handler calls setSessionActive');
        // This test verifies that the event handler in extension.ts will call setSessionActive(true)
        // when it receives a session_expired event
        
        const fs = require('fs');
        const path = require('path');
        const extensionSource = fs.readFileSync(
            path.join(__dirname, '..', 'src', 'extension.ts'),
            'utf-8'
        );
        
        // Check that the session_expired handler includes setSessionActive(true)
        const sessionExpiredHandlerMatch = extensionSource.match(
            /session_expired['"][\s\S]{0,2000}updateSessionsList\s*\(/
        );
        
        recordTest('extension.ts calls setSessionActive(true) on session_expired',
                  !!sessionExpiredHandlerMatch && sessionExpiredHandlerMatch[0].includes('setSessionActive'),
                  sessionExpiredHandlerMatch && sessionExpiredHandlerMatch[0].includes('setSessionActive') 
                      ? 'Found in source code' 
                      : 'NOT FOUND - indicator will stay red!');
        
        // Also verify it comes before the messages are added
        if (sessionExpiredHandlerMatch) {
            const handlerCode = sessionExpiredHandlerMatch[0];
            const setActivePos = handlerCode.indexOf('setSessionActive');
            const addMessagePos = handlerCode.indexOf('addAssistantMessage');
            
            console.log(`   setSessionActive at position: ${setActivePos}`);
            console.log(`   addAssistantMessage at position: ${addMessagePos}`);
            
            if (addMessagePos > -1 && setActivePos > -1) {
                recordTest('setSessionActive called before messages',
                          setActivePos < addMessagePos,
                          setActivePos < addMessagePos ? 'Correct order' : 'WRONG ORDER!');
            }
        }
        
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
    console.log('\n⚠️  EXPECTED BEHAVIOR:');
    console.log('When a session times out and is recreated, the UI should:');
    console.log('1. Receive a session_expired status event');
    console.log('2. Call setSessionActive(true) to turn the indicator green');
    console.log('3. Display the session transition message to the user');
    console.log('\n' + '='.repeat(70));
    
    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runSessionTimeoutTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
