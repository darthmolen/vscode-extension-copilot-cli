/**
 * SDK Plan Mode Tools Test
 * 
 * This test validates that custom tools and SDK built-in tools
 * can be used together correctly in a session.
 * 
 * It replicates our plan mode setup:
 * - Custom tools: update_work_plan, bash (restricted), create (restricted)
 * - SDK tools: view, grep, glob, web_fetch
 */

import { CopilotClient } from '@github/copilot-sdk';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Color output helpers
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(msg) {
    console.log(`${colors.cyan}[TEST]${colors.reset} ${msg}`);
}

function success(msg) {
    console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function error(msg) {
    console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function section(msg) {
    console.log(`\n${colors.bright}${colors.blue}═══ ${msg} ═══${colors.reset}\n`);
}

// Test configuration
const TEST_TIMEOUT = 60000; // 60 seconds

// Mock work session directory
const mockSessionId = 'test-work-session-' + Date.now();
const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', mockSessionId);
const planPath = path.join(sessionDir, 'plan.md');

// Create custom tools (mimicking our sdkSessionManager.ts)
function createCustomTools() {
    const tools = [];
    
    // 1. update_work_plan tool
    tools.push({
        name: 'update_work_plan',
        description: 'Update the implementation plan for the work session. Use this to document your planning, analysis, and design work.',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'The complete plan content in markdown format.'
                }
            },
            required: ['content']
        },
        handler: async (args) => {
            const content = args.arguments?.content || args.content;
            
            log(`update_work_plan called with ${content?.length || 0} bytes`);
            
            try {
                // Ensure directory exists
                if (!fs.existsSync(sessionDir)) {
                    fs.mkdirSync(sessionDir, { recursive: true });
                }
                
                // Write plan
                fs.writeFileSync(planPath, content, 'utf-8');
                
                return {
                    textResultForLlm: `Plan updated successfully! Saved to ${planPath}`,
                    resultType: 'success'
                };
            } catch (err) {
                return {
                    textResultForLlm: `Error: ${err.message}`,
                    resultType: 'failure',
                    error: err.message
                };
            }
        }
    });
    
    // 2. Restricted bash tool
    const allowedCommands = ['pwd', 'ls', 'echo', 'date'];
    
    tools.push({
        name: 'bash',
        description: 'Execute READ-ONLY bash commands. Only whitelisted commands allowed.',
        parameters: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The bash command to execute (read-only only)'
                },
                description: {
                    type: 'string',
                    description: 'Description of what the command does'
                }
            },
            required: ['command', 'description']
        },
        handler: async (args) => {
            const command = args.arguments?.command || args.command;
            
            log(`bash called: ${command}`);
            
            // Check if allowed
            const isAllowed = allowedCommands.some(allowed => command.trim().startsWith(allowed));
            
            if (!isAllowed) {
                return {
                    textResultForLlm: `❌ Command blocked: "${command}"\n\nAllowed: ${allowedCommands.join(', ')}`,
                    resultType: 'denied'
                };
            }
            
            // Execute (in real code we'd use child_process)
            return {
                textResultForLlm: `Command would execute: ${command}`,
                resultType: 'success'
            };
        }
    });
    
    // 3. Restricted create tool
    tools.push({
        name: 'create',
        description: 'Create files. In plan mode, only session plan.md can be created.',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path'
                },
                file_text: {
                    type: 'string',
                    description: 'File content'
                }
            },
            required: ['path', 'file_text']
        },
        handler: async (args) => {
            const filePath = args.arguments?.path || args.path;
            const content = args.arguments?.file_text || args.file_text || '';
            
            log(`create called: ${filePath}`);
            
            // Only allow creating the session plan
            const resolvedPath = path.resolve(filePath);
            
            if (resolvedPath !== planPath) {
                return {
                    textResultForLlm: `❌ File creation blocked!\n\nYou can ONLY create: ${planPath}\n\nYou tried: ${resolvedPath}`,
                    resultType: 'denied'
                };
            }
            
            if (fs.existsSync(planPath)) {
                return {
                    textResultForLlm: `❌ File already exists: ${planPath}\n\nUse update_work_plan instead.`,
                    resultType: 'denied'
                };
            }
            
            try {
                if (!fs.existsSync(sessionDir)) {
                    fs.mkdirSync(sessionDir, { recursive: true });
                }
                fs.writeFileSync(planPath, content, 'utf-8');
                
                return {
                    textResultForLlm: `✅ Plan file created at ${planPath}`,
                    resultType: 'success'
                };
            } catch (err) {
                return {
                    textResultForLlm: `❌ Error: ${err.message}`,
                    resultType: 'failure',
                    error: err.message
                };
            }
        }
    });
    
    return tools;
}

// Main test function
async function runTest() {
    section('SDK Plan Mode Tools Test');
    
    let client;
    let session;
    let testsPassed = 0;
    let testsFailed = 0;
    
    try {
        // Setup
        section('Setup');
        log('Creating session directory...');
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
        fs.mkdirSync(sessionDir, { recursive: true });
        success(`Session directory: ${sessionDir}`);
        
        // Create client
        log('Creating Copilot SDK client...');
        client = new CopilotClient({
            logLevel: 'info'
        });
        
        await client.start();
        success('Client started');
        
        // Prepare tools
        section('Tool Configuration');
        const customTools = createCustomTools();
        const availableTools = [
            'view',
            'grep',
            'glob',
            'web_fetch',
            'fetch_copilot_cli_documentation'
        ];
        
        log(`Custom tools: ${customTools.map(t => t.name).join(', ')}`);
        log(`Available SDK tools: ${availableTools.join(', ')}`);
        
        // Create session with both custom tools and SDK tools
        section('Creating Session');
        log('Creating session with custom tools (NO availableTools restriction)...');
        
        session = await client.createSession({
            model: 'gpt-5',
            tools: customTools,              // ✅ Custom Tool objects ONLY
            // NOTE: We do NOT use availableTools because it disables our custom tools!
            // The CLI defaults to allowing all SDK tools when availableTools is not specified
            systemMessage: {
                mode: 'append',
                content: `
**PLAN MODE TEST**

You have access to:
- Custom tools: update_work_plan, bash (restricted), create (restricted)
- SDK tools: view, grep, glob, web_fetch, and others

Your plan location: ${planPath}

For this test, create a simple plan using update_work_plan.
`
            }
        });
        
        success(`Session created: ${session.sessionId}`);
        
        // Test 1: Verify session exists
        section('Test 1: Session Created Successfully');
        if (session.sessionId) {
            success('Session has ID');
            testsPassed++;
        } else {
            error('Session missing ID');
            testsFailed++;
        }
        
        // Test 2: Try to use update_work_plan tool
        section('Test 2: Using update_work_plan Tool');
        log('Sending message to create a plan...');
        
        const planContent = `# Test Implementation Plan

## Problem
Test that our custom tools work with SDK tools.

## Approach
Use update_work_plan to create this plan.

## Tasks
- [x] Create session with custom tools
- [x] Use update_work_plan
- [ ] Verify plan was created
`;
        
        let updatePlanWorked = false;
        const eventPromise = new Promise((resolve) => {
            let timeout;
            
            session.on((event) => {
                // Log ALL events for debugging
                console.log(`[EVENT] ${event.type}:`, JSON.stringify(event.data, null, 2));
                
                if (event.type === 'tool.execution_start' && event.data.toolName === 'update_work_plan') {
                    log(`Tool execution started: ${event.data.toolName}`);
                }
                
                if (event.type === 'tool.execution_complete') {
                    log(`Tool execution complete: ${event.data.toolName} -> ${event.data.success ? 'success' : 'failure'}`);
                    
                    if (event.data.toolName === 'update_work_plan' && event.data.success) {
                        updatePlanWorked = true;
                    }
                }
                
                if (event.type === 'session.idle') {
                    clearTimeout(timeout);
                    resolve();
                }
            });
            
            timeout = setTimeout(() => {
                log('⚠️  Session idle timeout - continuing anyway');
                resolve();
            }, TEST_TIMEOUT);
        });
        
        await session.send({
            prompt: `Please use the update_work_plan tool to create a plan with this content:\n\n${planContent}`
        });
        
        await eventPromise;
        
        if (updatePlanWorked) {
            success('update_work_plan tool executed successfully');
            testsPassed++;
        } else {
            error('update_work_plan tool did not execute or failed');
            testsFailed++;
        }
        
        // Test 3: Verify plan file was created
        section('Test 3: Verify Plan File Created');
        
        if (fs.existsSync(planPath)) {
            const savedPlan = fs.readFileSync(planPath, 'utf-8');
            success('Plan file exists');
            log(`Plan content (${savedPlan.length} bytes):`);
            console.log(savedPlan.substring(0, 200) + '...');
            testsPassed++;
        } else {
            error('Plan file was not created');
            testsFailed++;
        }
        
        // Test 4: Try restricted bash command (should block)
        section('Test 4: Restricted bash Tool (Blocked Command)');
        log('Sending message to run blocked command...');
        
        let bashBlocked = false;
        const bashEventPromise = new Promise((resolve) => {
            let timeout;
            
            session.on((event) => {
                if (event.type === 'tool.execution_complete' && event.data.toolName === 'bash') {
                    const result = event.data.result;
                    if (result?.resultType === 'denied') {
                        log('Bash command was correctly blocked');
                        bashBlocked = true;
                    }
                }
                
                if (event.type === 'session.idle') {
                    clearTimeout(timeout);
                    resolve();
                }
            });
            
            timeout = setTimeout(() => resolve(), TEST_TIMEOUT);
        });
        
        await session.send({
            prompt: 'Try to run this bash command: "rm -rf /tmp/test"'
        });
        
        await bashEventPromise;
        
        if (bashBlocked) {
            success('Restricted bash correctly blocked dangerous command');
            testsPassed++;
        } else {
            error('Bash restriction did not work');
            testsFailed++;
        }
        
        // Summary
        section('Test Results');
        console.log(`\nTests Passed: ${colors.green}${testsPassed}${colors.reset}`);
        console.log(`Tests Failed: ${testsFailed > 0 ? colors.red : colors.green}${testsFailed}${colors.reset}`);
        console.log(`Total: ${testsPassed + testsFailed}\n`);
        
        if (testsFailed === 0) {
            success('ALL TESTS PASSED! ✨');
            return true;
        } else {
            error('SOME TESTS FAILED');
            return false;
        }
        
    } catch (err) {
        error(`Test error: ${err.message}`);
        console.error(err);
        return false;
    } finally {
        // Cleanup
        section('Cleanup');
        
        if (session) {
            log('Destroying session...');
            await session.destroy();
            success('Session destroyed');
        }
        
        if (client) {
            log('Stopping client...');
            await client.stop();
            success('Client stopped');
        }
        
        if (fs.existsSync(sessionDir)) {
            log('Removing test session directory...');
            fs.rmSync(sessionDir, { recursive: true, force: true });
            success('Cleanup complete');
        }
    }
}

// Run test
runTest()
    .then((passed) => {
        process.exit(passed ? 0 : 1);
    })
    .catch((err) => {
        error(`Fatal error: ${err.message}`);
        console.error(err);
        process.exit(1);
    });
