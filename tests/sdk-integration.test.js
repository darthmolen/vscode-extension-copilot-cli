/**
 * SDK Integration Test Harness
 * Tests the Copilot SDK integration without requiring VS Code
 */

const path = require('path');
const fs = require('fs');

// Mock VS Code API for testing
global.vscode = {
    workspace: {
        getConfiguration: () => ({
            get: (key, defaultValue) => {
                const config = {
                    'cliPath': 'copilot',
                    'yoloMode': true,
                    'model': 'claude-3-5-sonnet-20241022'
                };
                return config[key] !== undefined ? config[key] : defaultValue;
            }
        })
    },
    EventEmitter: class EventEmitter {
        constructor() {
            this.listeners = [];
        }
        fire(data) {
            this.listeners.forEach(listener => listener(data));
        }
        event(listener) {
            this.listeners.push(listener);
        }
    }
};

// Create a simple logger
class TestLogger {
    info(...args) { console.log('[INFO]', ...args); }
    debug(...args) { console.log('[DEBUG]', ...args); }
    error(...args) { console.error('[ERROR]', ...args); }
}

async function testSDKSession() {
    console.log('='.repeat(60));
    console.log('SDK Integration Test');
    console.log('='.repeat(60));
    
    try {
        // Import SDKSessionManager
        const { SDKSessionManager } = require('../dist/extension.js');
        
        console.log('\n✅ SDKSessionManager loaded');
        
        // Create instance
        const logger = new TestLogger();
        const config = {
            model: 'claude-3-5-sonnet-20241022',
            yoloMode: true
        };
        
        const manager = new SDKSessionManager(logger, config);
        console.log('✅ SDKSessionManager instance created');
        
        // Track events
        const events = [];
        manager.onMessage((event) => {
            events.push(event);
            console.log(`\n📨 Event: ${event.type}`);
            
            if (event.type === 'tool_start') {
                console.log(`   🔧 Tool: ${event.data.toolName}`);
            } else if (event.type === 'tool_complete') {
                const duration = ((event.data.endTime - event.data.startTime) / 1000).toFixed(2);
                console.log(`   ✅ Tool: ${event.data.toolName} (${duration}s)`);
            } else if (event.type === 'message') {
                const preview = event.data.content.substring(0, 100);
                console.log(`   💬 ${preview}${event.data.content.length > 100 ? '...' : ''}`);
            } else if (event.type === 'status') {
                console.log(`   📊 Status: ${event.data.status}`);
            }
        });
        
        // Start session
        console.log('\n🚀 Starting session...');
        await manager.start();
        console.log('✅ Session started');
        
        // Send test message
        const testPrompt = 'Create a simple hello.txt file with "Hello, World!" in it, then read it back to me.';
        console.log(`\n📤 Sending message: "${testPrompt}"`);
        
        const startTime = Date.now();
        await manager.sendMessage(testPrompt);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log(`\n✅ Message completed in ${duration}s`);
        
        // Wait a bit for any remaining events
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Print summary
        console.log('\n' + '='.repeat(60));
        console.log('Test Summary');
        console.log('='.repeat(60));
        console.log(`Total events: ${events.length}`);
        
        const eventCounts = events.reduce((acc, e) => {
            acc[e.type] = (acc[e.type] || 0) + 1;
            return acc;
        }, {});
        
        console.log('\nEvent breakdown:');
        Object.entries(eventCounts).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
        });
        
        // Find tool executions
        const toolStarts = events.filter(e => e.type === 'tool_start');
        const toolCompletes = events.filter(e => e.type === 'tool_complete');
        
        console.log(`\nTool executions: ${toolStarts.length} started, ${toolCompletes.length} completed`);
        toolCompletes.forEach(e => {
            const duration = ((e.data.endTime - e.data.startTime) / 1000).toFixed(2);
            console.log(`  ✅ ${e.data.toolName}: ${duration}s`);
        });
        
        // Stop session
        console.log('\n🛑 Stopping session...');
        await manager.stop();
        console.log('✅ Session stopped');
        
        console.log('\n✅ All tests passed!');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run tests
if (require.main === module) {
    testSDKSession()
        .then(() => {
            console.log('\n✅ Test harness completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Test harness failed:', error);
            process.exit(1);
        });
}

module.exports = { testSDKSession };
