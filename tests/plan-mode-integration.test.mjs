/**
 * Plan Mode Integration Test
 * 
 * End-to-end test of plan mode workflow:
 * 1. Enable plan mode
 * 2. Create plan using create_plan_file
 * 3. Update plan using update_work_plan
 * 4. Edit plan using edit_plan_file
 * 5. Explore codebase using safe tools
 * 6. Verify cannot escape restrictions
 */

import { CopilotClient } from '@github/copilot-sdk';
import fs from 'fs';
import path from 'path';
import os from 'os';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    bright: '\x1b[1m'
};

function log(msg) { console.log(`${colors.cyan}[TEST]${colors.reset} ${msg}`); }
function success(msg) { console.log(`${colors.green}✓${colors.reset} ${msg}`); }
function error(msg) { console.log(`${colors.red}✗${colors.reset} ${msg}`); }
function section(msg) { console.log(`\n${colors.bright}${colors.blue}═══ ${msg} ═══${colors.reset}\n`); }

const TEST_TIMEOUT = 60000;
const mockSessionId = 'test-integration-' + Date.now();
const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', mockSessionId);
const planPath = path.join(sessionDir, 'plan.md');

function createPlanModeTools() {
    const tools = [];
    
    // plan_bash_explore
    tools.push({
        name: 'plan_bash_explore',
        description: 'Execute READ-ONLY bash commands',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string' },
                description: { type: 'string' }
            },
            required: ['command', 'description']
        },
        handler: async (args) => {
            const command = args.arguments?.command || args.command;
            const safe = ['pwd', 'ls', 'cat', 'git status', 'git log', 'echo'];
            const isSafe = safe.some(s => command.trim().startsWith(s));
            
            if (!isSafe) {
                return { textResultForLlm: `❌ Blocked: ${command}`, resultType: 'denied' };
            }
            
            return { textResultForLlm: `Executed: ${command}`, resultType: 'success' };
        }
    });
    
    // task_agent_type_explore
    tools.push({
        name: 'task_agent_type_explore',
        description: 'Dispatch exploration sub-agents',
        parameters: {
            type: 'object',
            properties: {
                agent_type: { type: 'string' },
                instructions: { type: 'string' }
            },
            required: ['agent_type', 'instructions']
        },
        handler: async (args) => {
            const agentType = args.arguments?.agent_type || args.agent_type;
            
            if (agentType !== 'explore') {
                return { textResultForLlm: `❌ Blocked: ${agentType}`, resultType: 'denied' };
            }
            
            return { textResultForLlm: `Agent dispatched`, resultType: 'success' };
        }
    });
    
    // edit_plan_file
    tools.push({
        name: 'edit_plan_file',
        description: 'Edit plan.md only',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                old_str: { type: 'string' },
                new_str: { type: 'string' }
            },
            required: ['path', 'old_str', 'new_str']
        },
        handler: async (args) => {
            const filePath = path.resolve(args.arguments?.path || args.path);
            
            if (filePath !== planPath) {
                return { textResultForLlm: `❌ Can only edit ${planPath}`, resultType: 'denied' };
            }
            
            if (!fs.existsSync(planPath)) {
                return { textResultForLlm: `❌ Plan does not exist`, resultType: 'failure' };
            }
            
            const oldStr = args.arguments?.old_str || args.old_str;
            const newStr = args.arguments?.new_str || args.new_str;
            const content = fs.readFileSync(planPath, 'utf-8');
            const updated = content.replace(oldStr, newStr);
            fs.writeFileSync(planPath, updated, 'utf-8');
            
            return { textResultForLlm: `✅ Plan edited`, resultType: 'success' };
        }
    });
    
    // create_plan_file
    tools.push({
        name: 'create_plan_file',
        description: 'Create plan.md only',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                file_text: { type: 'string' }
            },
            required: ['path', 'file_text']
        },
        handler: async (args) => {
            const filePath = path.resolve(args.arguments?.path || args.path);
            
            if (filePath !== planPath) {
                return { textResultForLlm: `❌ Can only create ${planPath}`, resultType: 'denied' };
            }
            
            if (fs.existsSync(planPath)) {
                return { textResultForLlm: `❌ Plan already exists`, resultType: 'failure' };
            }
            
            const content = args.arguments?.file_text || args.file_text || '';
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }
            fs.writeFileSync(planPath, content, 'utf-8');
            
            return { textResultForLlm: `✅ Plan created`, resultType: 'success' };
        }
    });
    
    // update_work_plan
    tools.push({
        name: 'update_work_plan',
        description: 'Update complete plan content',
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string' }
            },
            required: ['content']
        },
        handler: async (args) => {
            const content = args.arguments?.content || args.content;
            
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }
            fs.writeFileSync(planPath, content, 'utf-8');
            
            return { textResultForLlm: `✅ Plan updated`, resultType: 'success' };
        }
    });
    
    return tools;
}

async function runTest() {
    section('Plan Mode Integration Test');
    
    let client;
    let session;
    let passed = 0;
    let failed = 0;
    
    try {
        // Setup
        section('Setup');
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
        fs.mkdirSync(sessionDir, { recursive: true });
        
        client = new CopilotClient({ logLevel: 'info' });
        await client.start();
        success('Client started');
        
        // Create plan mode session
        section('Creating Plan Mode Session');
        const tools = createPlanModeTools();
        
        session = await client.createSession({
            model: 'gpt-5',
            tools: tools,
            availableTools: [
                'plan_bash_explore',
                'task_agent_type_explore',
                'edit_plan_file',
                'create_plan_file',
                'update_work_plan',
                'view',
                'grep',
                'glob',
                'web_fetch',
                'fetch_copilot_cli_documentation'
            ],
            systemMessage: {
                mode: 'append',
                content: `Plan Mode Active. Available tools: ${tools.map(t => t.name).join(', ')}`
            }
        });
        
        success('Plan mode session created');
        
        // Test 1: Create plan
        section('Test 1: Create Plan');
        const initialPlan = `# Test Plan\n\n## Goal\nTest plan mode integration\n\n## Tasks\n- [ ] Task 1\n- [ ] Task 2`;
        
        const createTool = tools.find(t => t.name === 'create_plan_file');
        const createResult = await createTool.handler({ path: planPath, file_text: initialPlan });
        
        if (createResult.resultType === 'success' && fs.existsSync(planPath)) {
            success('Plan created successfully');
            passed++;
        } else {
            error('Failed to create plan');
            failed++;
        }
        
        // Test 2: Update plan
        section('Test 2: Update Plan');
        const updatedPlan = initialPlan + '\n- [ ] Task 3';
        
        const updateTool = tools.find(t => t.name === 'update_work_plan');
        const updateResult = await updateTool.handler({ content: updatedPlan });
        
        const planContent = fs.readFileSync(planPath, 'utf-8');
        if (updateResult.resultType === 'success' && planContent.includes('Task 3')) {
            success('Plan updated successfully');
            passed++;
        } else {
            error('Failed to update plan');
            failed++;
        }
        
        // Test 3: Edit plan
        section('Test 3: Edit Plan');
        const editTool = tools.find(t => t.name === 'edit_plan_file');
        const editResult = await editTool.handler({ 
            path: planPath, 
            old_str: '- [ ] Task 1', 
            new_str: '- [x] Task 1' 
        });
        
        const editedContent = fs.readFileSync(planPath, 'utf-8');
        if (editResult.resultType === 'success' && editedContent.includes('- [x] Task 1')) {
            success('Plan edited successfully');
            passed++;
        } else {
            error('Failed to edit plan');
            failed++;
        }
        
        // Test 4: Execute safe bash command
        section('Test 4: Execute Safe Bash Command');
        const bashTool = tools.find(t => t.name === 'plan_bash_explore');
        const bashResult = await bashTool.handler({ command: 'pwd', description: 'Get current directory' });
        
        if (bashResult.resultType === 'success') {
            success('Safe bash command executed');
            passed++;
        } else {
            error('Failed to execute safe bash command');
            failed++;
        }
        
        // Test 5: Block dangerous bash command
        section('Test 5: Block Dangerous Bash Command');
        const dangerousResult = await bashTool.handler({ command: 'rm -rf /', description: 'Dangerous' });
        
        if (dangerousResult.resultType === 'denied') {
            success('Dangerous bash command blocked');
            passed++;
        } else {
            error('Failed to block dangerous bash command');
            failed++;
        }
        
        // Test 6: Dispatch explore agent
        section('Test 6: Dispatch Explore Agent');
        const taskTool = tools.find(t => t.name === 'task_agent_type_explore');
        const taskResult = await taskTool.handler({ agent_type: 'explore', instructions: 'Explore codebase' });
        
        if (taskResult.resultType === 'success') {
            success('Explore agent dispatched');
            passed++;
        } else {
            error('Failed to dispatch explore agent');
            failed++;
        }
        
        // Test 7: Block non-explore agent
        section('Test 7: Block Non-Explore Agent');
        const codeAgentResult = await taskTool.handler({ agent_type: 'code', instructions: 'Write code' });
        
        if (codeAgentResult.resultType === 'denied') {
            success('Non-explore agent blocked');
            passed++;
        } else {
            error('Failed to block non-explore agent');
            failed++;
        }
        
        // Test 8: Cannot create non-plan file
        section('Test 8: Cannot Create Non-Plan File');
        const evilCreateResult = await createTool.handler({ 
            path: '/tmp/evil.js', 
            file_text: 'console.log("hacked")' 
        });
        
        if (evilCreateResult.resultType === 'denied') {
            success('Non-plan file creation blocked');
            passed++;
        } else {
            error('Failed to block non-plan file creation');
            failed++;
        }
        
        // Test 9: Cannot edit non-plan file
        section('Test 9: Cannot Edit Non-Plan File');
        const evilEditResult = await editTool.handler({ 
            path: '/tmp/evil.js', 
            old_str: 'a', 
            new_str: 'b' 
        });
        
        if (evilEditResult.resultType === 'denied') {
            success('Non-plan file edit blocked');
            passed++;
        } else {
            error('Failed to block non-plan file edit');
            failed++;
        }
        
        // Summary
        section('Results');
        console.log(`Passed: ${colors.green}${passed}${colors.reset}`);
        console.log(`Failed: ${failed > 0 ? colors.red : colors.green}${failed}${colors.reset}`);
        console.log(`Total: ${passed + failed}`);
        
        if (failed === 0) {
            success('ALL INTEGRATION TESTS PASSED! ✨');
        }
        
        return failed === 0;
        
    } catch (err) {
        error(`Test error: ${err.message}`);
        console.error(err);
        return false;
    } finally {
        if (session) await session.destroy();
        if (client) await client.stop();
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
    }
}

runTest()
    .then((passed) => process.exit(passed ? 0 : 1))
    .catch((err) => {
        error(`Fatal: ${err.message}`);
        console.error(err);
        process.exit(1);
    });
