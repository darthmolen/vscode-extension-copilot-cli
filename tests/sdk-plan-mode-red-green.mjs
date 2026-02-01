/**
 * RED/GREEN Test: Plan Mode Tool Configuration
 * 
 * Tests the actual behavior of custom tools + availableTools in plan mode scenario.
 * 
 * Setup:
 * - 2 custom tools: update_work_plan, task (restricted to explore)
 * - Planning tools via availableTools: view, grep, glob
 * 
 * GREEN test (should work):
 *   - Custom tools + availableTools specified
 *   - Result: update_work_plan (custom) + task (custom) + view + grep + glob
 *   - No duplicate because SDK's built-in 'task' is NOT included
 * 
 * RED test (should fail):
 *   - Custom tools + NO availableTools
 *   - Result: update_work_plan (custom) + task (custom) + ALL SDK tools (including task)
 *   - DUPLICATE 'task' → API error: "Tool names must be unique"
 */

import { CopilotClient, defineTool } from '@github/copilot-sdk';
import { z } from 'zod';

console.log('=== Plan Mode Tool Configuration: RED/GREEN Test ===\n');

// Define the 2 custom tools for plan mode
const customTools = [
    // Tool 1: update_work_plan
    defineTool('update_work_plan', {
        description: 'Update the implementation plan for the work session',
        parameters: z.object({
            content: z.string().describe('The complete plan content in markdown format')
        }),
        handler: ({ content }) => {
            console.log(`[update_work_plan called] Plan updated: ${content.substring(0, 50)}...`);
            return 'Plan updated successfully!';
        }
    }),
    
    // Tool 2: Restricted task (only allows explore)
    defineTool('task', {
        description: 'Dispatch exploration tasks (restricted to agent_type="explore" only)',
        parameters: z.object({
            agent_type: z.enum(['explore']).describe('Must be "explore"'),
            description: z.string().describe('Short description of the task'),
            prompt: z.string().describe('The exploration prompt')
        }),
        handler: ({ agent_type, description, prompt }) => {
            if (agent_type !== 'explore') {
                return 'Error: Only agent_type="explore" is allowed in plan mode';
            }
            console.log(`[task called] Exploring: ${description}`);
            return `Exploration task dispatched: ${prompt.substring(0, 50)}...`;
        }
    })
];

// Available planning tools (SDK tools we want to allow)
// NOTE: Custom tools are ALWAYS available - availableTools only controls SDK built-in tools
const planningTools = ['view', 'grep', 'glob', 'web_fetch', 'report_intent'];

const client = new CopilotClient({
    cliPath: 'copilot',
    useStdio: true,
    autoStart: true
});

async function testGreen() {
    console.log('🟢 GREEN TEST: Custom tools + availableTools');
    console.log('━'.repeat(60));
    console.log('Configuration:');
    console.log('  tools: [update_work_plan, task] (custom)');
    console.log(`  availableTools: ${JSON.stringify(planningTools)}`);
    console.log('Expected: Should work without duplicate errors\n');
    
    try {
        const session = await client.createSession({
            tools: customTools,
            availableTools: planningTools
        });
        
        console.log(`✓ Session created: ${session.sessionId}`);
        console.log('  No error during session creation');
        
        // Send a prompt that would use multiple tools
        console.log('\nSending test prompt...');
        const prompt = `What tools are available to you? List them all.`;
        
        const result = await session.sendAndWait({ prompt });
        
        console.log('✓ Message completed successfully');
        console.log(`  Response length: ${result?.data.content?.length || 0} chars`);
        console.log(`  Response preview: ${result?.data.content?.substring(0, 150)}...`);
        
        await session.destroy();
        
        console.log('\n✅ GREEN TEST PASSED');
        console.log('   Plan mode works correctly with availableTools\n');
        
        return true;
        
    } catch (error) {
        console.error('❌ GREEN TEST FAILED');
        console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
        console.error('   This should NOT happen - green test should pass\n');
        return false;
    }
}

async function testRed() {
    console.log('🔴 RED TEST: Custom tools + NO availableTools');
    console.log('━'.repeat(60));
    console.log('Configuration:');
    console.log('  tools: [update_work_plan, task] (custom)');
    console.log('  availableTools: NOT SPECIFIED');
    console.log('Expected: Should FAIL with "Tool names must be unique"\n');
    
    try {
        const session = await client.createSession({
            tools: customTools
            // NO availableTools - SDK will include all built-in tools
        });
        
        console.log(`✓ Session created: ${session.sessionId}`);
        console.log('  No error during session creation (validation happens later)');
        
        // Send a message to trigger API call where duplicates are validated
        console.log('\nSending test message to trigger tool validation...');
        const result = await session.sendAndWait({ 
            prompt: 'List the available tools' 
        });
        
        console.log('❌ RED TEST FAILED (unexpectedly succeeded)');
        console.log(`   Response: ${result?.data.content?.substring(0, 150)}...`);
        console.log('   Expected duplicate error but message succeeded');
        console.log('   This means our assumption is WRONG\n');
        
        await session.destroy();
        
        return false;
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        if (errorMsg.includes('Tool names must be unique')) {
            console.log('✅ RED TEST PASSED (failed as expected)');
            console.log(`   Error: ${errorMsg}`);
            console.log('   This confirms: Custom "task" + SDK "task" = DUPLICATE');
            console.log('   Proves: Custom tools do NOT override SDK tools\n');
            return true;
        } else {
            console.log('❓ RED TEST UNEXPECTED ERROR');
            console.log(`   Error: ${errorMsg}`);
            console.log('   Not the duplicate error we expected\n');
            return false;
        }
    }
}

async function runTests() {
    try {
        const greenPassed = await testGreen();
        
        console.log('━'.repeat(60));
        console.log();
        
        const redPassed = await testRed();
        
        console.log('━'.repeat(60));
        console.log('SUMMARY');
        console.log('━'.repeat(60));
        
        if (greenPassed && redPassed) {
            console.log('✅ Both tests passed as expected');
            console.log('\nConclusions:');
            console.log('  1. availableTools prevents duplicate tool errors');
            console.log('  2. Without availableTools, custom tools clash with SDK tools');
            console.log('  3. Custom tools do NOT override SDK tools with same name');
            console.log('\nFix for plan mode:');
            console.log('  Use availableTools to whitelist only needed SDK tools');
            console.log('  Exclude any SDK tool that has a custom version');
            process.exit(0);
        } else if (!greenPassed && redPassed) {
            console.log('⚠️  Green failed, Red passed');
            console.log('  availableTools approach has issues - investigate further');
            process.exit(1);
        } else if (greenPassed && !redPassed) {
            console.log('⚠️  Green passed, Red failed');
            console.log('  Our assumption about duplicates may be wrong');
            console.log('  SDK might handle duplicates differently than expected');
            process.exit(1);
        } else {
            console.log('❌ Both tests failed');
            console.log('  Need to investigate SDK behavior further');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('Fatal test error:', error);
        process.exit(1);
    } finally {
        await client.stop();
    }
}

runTests();
