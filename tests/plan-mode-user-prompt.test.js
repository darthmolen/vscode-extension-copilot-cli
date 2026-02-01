/**
 * Plan Mode User Prompt Test
 * Tests that plan mode can handle a user prompt without errors
 * Timeout: 120 seconds
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
        console.log('[DEBUG]', ...args); 
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
    getInstance() { return this; }
}

const testLogger = new TestLogger();

// Mock Logger module
const Logger = {
    getInstance: () => testLogger
};

// Inject logger into global before loading the module
global.Logger = Logger;

// Load the compiled TypeScript module
const SDKSessionManager = require('../out/sdkSessionManager').SDKSessionManager;

async function runTest() {
    console.log('=== Plan Mode User Prompt Test ===\n');
    
    const context = {
        globalStorageUri: { fsPath: path.join(__dirname, '.test-storage') }
    };
    
    // Clean up temp directory
    if (fs.existsSync(context.globalStorageUri.fsPath)) {
        fs.rmSync(context.globalStorageUri.fsPath, { recursive: true, force: true });
    }
    fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });

    let manager;
    let testPassed = false;
    let responseReceived = false;
    
    try {
        // Create session manager
        manager = new SDKSessionManager(
            context,
            { yolo: true },
            false // Don't resume
        );

        // Listen for messages
        manager.onMessage((message) => {
            console.log(`[Message] Type: ${message.type}`);
            if (message.type === 'output') {
                console.log(`[Output] ${message.data}`);
                responseReceived = true;
            } else if (message.type === 'error') {
                console.error(`[Error] ${message.data}`);
            } else if (message.type === 'status') {
                console.log(`[Status] ${JSON.stringify(message.data)}`);
            }
        });

        // Start session
        console.log('Starting session...');
        await manager.start();
        console.log('Session started');

        // Enable plan mode
        console.log('\nEnabling plan mode...');
        await manager.enablePlanMode();
        console.log('Plan mode enabled');

        // Send a simple user prompt
        console.log('\nSending user prompt...');
        const userPrompt = 'List the available tools in plan mode';
        await manager.sendMessage(userPrompt);
        console.log('User prompt sent');

        // Wait for response with timeout
        console.log('\nWaiting for response (120s timeout)...');
        const timeout = 120000; // 120 seconds
        const startTime = Date.now();
        
        while (!responseReceived && (Date.now() - startTime) < timeout) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            process.stdout.write('.');
        }
        console.log('\n');

        if (responseReceived) {
            console.log('✅ Response received within timeout');
            testPassed = true;
        } else {
            console.log('❌ Timeout: No response received within 120 seconds');
        }

        // Check logs for errors
        const errorLogs = testLogger.logs.filter(log => log.level === 'error');
        if (errorLogs.length > 0) {
            console.log('\n❌ Errors found in logs:');
            errorLogs.forEach(log => console.log(`  - ${log.message}`));
            testPassed = false;
        }

        // Check for duplicate tool errors
        const duplicateToolErrors = testLogger.logs.filter(log => 
            log.message.includes('Tool names must be unique') ||
            log.message.includes('duplicate')
        );
        if (duplicateToolErrors.length > 0) {
            console.log('\n❌ Duplicate tool errors found:');
            duplicateToolErrors.forEach(log => console.log(`  - ${log.message}`));
            testPassed = false;
        }

        // Print tool configuration logs
        const toolConfigLogs = testLogger.logs.filter(log => 
            log.message.includes('[Plan Mode] Tool Configuration') ||
            log.message.includes('[Plan Mode]   Custom tools') ||
            log.message.includes('[Plan Mode]   Available tools')
        );
        if (toolConfigLogs.length > 0) {
            console.log('\n📋 Tool Configuration:');
            toolConfigLogs.forEach(log => console.log(`  ${log.message}`));
        }

    } catch (error) {
        console.error('❌ Test failed with error:', error.message);
        console.error('Stack:', error.stack);
        testPassed = false;
    } finally {
        // Cleanup
        if (manager) {
            await manager.stop();
        }
        
        // Clean up temp directory
        if (fs.existsSync(context.globalStorageUri.fsPath)) {
            fs.rmSync(context.globalStorageUri.fsPath, { recursive: true, force: true });
        }
    }

    console.log('\n=== Test Summary ===');
    console.log(`Result: ${testPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Total logs: ${testLogger.logs.length}`);
    console.log(`Errors: ${testLogger.logs.filter(l => l.level === 'error').length}`);
    console.log(`Warnings: ${testLogger.logs.filter(l => l.level === 'warn').length}`);
    
    // Exit with appropriate code
    process.exit(testPassed ? 0 : 1);
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
    process.exit(1);
});

runTest();
