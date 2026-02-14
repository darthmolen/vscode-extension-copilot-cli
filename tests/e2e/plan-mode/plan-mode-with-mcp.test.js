/**
 * Plan Mode with MCP Test
 * Reproduces the duplicate tool error that occurs when plan mode is enabled with MCP servers.
 * This test SHOULD FAIL until the duplicate tool issue is fixed.
 * 
 * Expected behavior: Test should fail with "Tool names must be unique" error
 * Root cause: Custom tools (bash, create, edit, task) conflict with SDK built-in tools
 *             when availableTools is not specified.
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

// Mock VS Code API with MCP configuration
global.vscode = {
    workspace: {
        workspaceFolders: [{ uri: { fsPath: __dirname } }],
        getConfiguration: (section) => ({
            get: (key, defaultValue) => {
                if (section === 'copilotCLI') {
                    const config = {
                        'cliPath': 'copilot',
                        'yoloMode': false,
                        'model': 'gpt-4o',
                        // MCP configuration - this is the key difference from the basic test!
                        'mcpServers': {
                            'hello-mcp': {
                                type: 'local',
                                command: path.join(__dirname, 'mcp-server/hello-mcp/venv/bin/python'),
                                args: [path.join(__dirname, 'mcp-server/hello-mcp/server.py')],
                                tools: ['*'],
                                enabled: true
                            }
                        }
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
        }),
        onDidChangeActiveTextEditor: (callback) => ({
            dispose: () => {}
        }),
        activeTextEditor: undefined
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
const SDKSessionManager = require('../../../out/sdkSessionManager').SDKSessionManager;

async function runTest() {
    console.log('=== Plan Mode with MCP - Duplicate Tool Test ===\n');
    console.log('This test reproduces the production bug where duplicate tools cause');
    console.log('"Tool names must be unique" error when MCP servers are enabled.\n');
    
    const context = {
        globalStorageUri: { fsPath: path.join(__dirname, '.test-storage-mcp') }
    };
    
    // Clean up temp directory
    if (fs.existsSync(context.globalStorageUri.fsPath)) {
        fs.rmSync(context.globalStorageUri.fsPath, { recursive: true, force: true });
    }
    fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });

    let manager;
    let testPassed = true;
    let duplicateErrorFound = false;
    
    try {
        // Create session manager
        console.log('Creating SDK Session Manager with MCP enabled...');
        manager = new SDKSessionManager(
            context,
            { yolo: true },
            false // Don't resume
        );

        // Listen for messages and errors
        manager.onMessage((message) => {
            console.log(`[Message] Type: ${message.type}`);
            if (message.type === 'error') {
                console.error(`[Error] ${message.data}`);
                if (message.data && message.data.includes('Tool names must be unique')) {
                    duplicateErrorFound = true;
                }
            }
        });

        // Start session
        console.log('Starting session...');
        await manager.start();
        console.log('✓ Session started');

        // Enable plan mode - this is where the duplicate tools are configured
        console.log('\nEnabling plan mode with MCP...');
        await manager.enablePlanMode();
        console.log('✓ Plan mode enabled');

        // Check the logs for tool configuration
        console.log(`\n📊 Total log entries: ${testLogger.logs.length}`);
        
        const toolConfigLogs = testLogger.logs.filter(log => 
            log.message.includes('tools:') || 
            log.message.includes('CUSTOM TOOLS') ||
            log.message.includes('SDK TOOLS') ||
            log.message.includes('availableTools') ||
            log.message.includes('[Plan Mode]')
        );
        
        console.log('\n📋 Tool Configuration from logs:');
        if (toolConfigLogs.length === 0) {
            console.log('  ⚠️  NO tool configuration logs found!');
            console.log('  Showing all INFO logs instead:');
            testLogger.logs.filter(l => l.level === 'info').slice(0, 20).forEach(log => 
                console.log(`  [${log.level}] ${log.message.substring(0, 120)}`)
            );
        } else {
            toolConfigLogs.forEach(log => console.log(`  ${log.message}`));
        }

        // Send a message - this triggers the actual API call where duplicates are validated
        console.log('\nSending test message (this should trigger duplicate tool error)...');
        const testMessage = 'List the available tools';
        
        try {
            await manager.sendMessage(testMessage);
            console.log('✓ Message sent (waiting for response or error)');
            
            // Wait a bit for the error to propagate
            await new Promise(resolve => setTimeout(resolve, 5000));
            
        } catch (error) {
            console.error('❌ Error during sendMessage:', error.message);
            if (error.message && error.message.includes('Tool names must be unique')) {
                duplicateErrorFound = true;
            }
        }

        // Check logs for duplicate tool errors
        const duplicateToolErrors = testLogger.logs.filter(log => 
            log.message.includes('Tool names must be unique') ||
            (log.level === 'error' && log.message.includes('duplicate'))
        );
        
        if (duplicateToolErrors.length > 0) {
            console.log('\n✅ EXPECTED ERROR FOUND - Duplicate tool errors detected:');
            duplicateToolErrors.forEach(log => console.log(`  - [${log.level.toUpperCase()}] ${log.message}`));
            duplicateErrorFound = true;
        }

        // Analysis: This test SHOULD fail with duplicate errors
        console.log('\n' + '='.repeat(60));
        console.log('TEST RESULT ANALYSIS:');
        console.log('='.repeat(60));
        
        if (duplicateErrorFound) {
            console.log('✅ TEST REPRODUCED THE BUG!');
            console.log('   The duplicate tool error occurred as expected.');
            console.log('   This confirms our hypothesis:');
            console.log('   - Custom tools: bash, create, edit, task');
            console.log('   - SDK tools: bash, create, edit, task (when availableTools not set)');
            console.log('   - Result: Duplicates cause API error');
            testPassed = true; // Test succeeded in reproducing the bug
        } else {
            console.log('❌ TEST FAILED TO REPRODUCE BUG');
            console.log('   Expected "Tool names must be unique" error but did not occur.');
            console.log('   This suggests either:');
            console.log('   1. The bug was already fixed');
            console.log('   2. Test setup doesn\'t match production environment');
            console.log('   3. Error only occurs under specific conditions');
            testPassed = false;
        }

    } catch (error) {
        console.error('\n❌ Unexpected test error:', error);
        testPassed = false;
    } finally {
        // Cleanup
        if (manager) {
            try {
                await manager.stop();
            } catch (e) {
                // Ignore cleanup errors
            }
        }
        
        // Clean up temp directory
        if (fs.existsSync(context.globalStorageUri.fsPath)) {
            fs.rmSync(context.globalStorageUri.fsPath, { recursive: true, force: true });
        }
    }

    console.log('\n' + '='.repeat(60));
    if (testPassed) {
        console.log('✅ TEST PASSED - Bug successfully reproduced');
        process.exit(0);
    } else {
        console.log('❌ TEST FAILED - Could not reproduce the bug');
        process.exit(1);
    }
}

// Run the test
runTest().catch(error => {
    console.error('Fatal test error:', error);
    process.exit(1);
});
