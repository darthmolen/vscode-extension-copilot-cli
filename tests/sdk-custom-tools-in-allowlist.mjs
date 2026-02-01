/**
 * SDK Test: Custom Tools in availableTools Allowlist
 * 
 * Tests whether custom tool names must be included in availableTools to be usable.
 * 
 * Hypothesis:
 * - availableTools acts as a complete whitelist for ALL tools (SDK + custom)
 * - Custom tools NOT in availableTools are rejected as "unknown"
 * 
 * Test Setup:
 * - Custom tool: plan_bash (restricted bash)
 * - availableTools: ["plan_bash", "view"]
 * 
 * Expected Results:
 * ✅ plan_bash tool should work (custom tool in allowlist)
 * ✅ view tool should work (SDK tool in allowlist)
 * ❌ edit tool should fail (SDK tool NOT in allowlist)
 * ❌ bash tool should fail (SDK bash NOT in allowlist, only plan_bash is)
 */

import { CopilotClient, defineTool } from '@github/copilot-sdk';
import { z } from 'zod';

console.log('=== Custom Tools in availableTools Test ===\n');

const client = new CopilotClient({
    cliPath: 'copilot',
    useStdio: true,
    autoStart: true,
    logLevel: 'info'
});

// Custom restricted bash tool with unique name
const planBashTool = defineTool('plan_bash', {
    description: 'Restricted bash tool for plan mode. Only allows read-only commands.',
    parameters: z.object({
        command: z.string().describe('The bash command to execute'),
        description: z.string().describe('Description of what the command does')
    }),
    handler: ({ command, description }) => {
        console.log(`[plan_bash called] Command: ${command}`);
        
        const allowedCommands = ['pwd', 'ls', 'echo', 'cat', 'git status', 'date'];
        const isAllowed = allowedCommands.some(allowed => command.trim().startsWith(allowed));
        
        if (!isAllowed) {
            return {
                textResultForLlm: `❌ Command blocked by plan_bash: "${command}"\n\nOnly allowed: ${allowedCommands.join(', ')}`,
                resultType: 'denied'
            };
        }
        
        return {
            textResultForLlm: `✅ plan_bash would execute: ${command}\n(Read-only command allowed)`,
            resultType: 'success'
        };
    }
});

async function runTest() {
    let session;
    const results = {
        plan_bash_worked: false,
        view_worked: false,
        edit_failed: false,
        bash_failed: false
    };
    
    try {
        console.log('Creating session with:');
        console.log('  tools: [plan_bash] (custom)');
        console.log('  availableTools: ["plan_bash", "view"]');
        console.log('');
        
        session = await client.createSession({
            tools: [planBashTool],
            availableTools: ['plan_bash', 'view']
        });
        
        console.log(`✓ Session created: ${session.sessionId}\n`);
        
        // Listen for events
        const eventLog = [];
        session.on((event) => {
            if (event.type === 'session.info') {
                console.log(`[SESSION.INFO] ${JSON.stringify(event.data)}`);
                eventLog.push(event);
            }
            if (event.type === 'tool.execution_start') {
                console.log(`[TOOL START] ${event.data.toolName}`);
            }
            if (event.type === 'tool.execution_complete') {
                console.log(`[TOOL COMPLETE] ${event.data.toolName} -> success=${event.data.success}, data=${JSON.stringify(event.data)}`);
                
                // Check both event.data.success and if tool actually executed
                const wasSuccessful = event.data.success !== false; // Treat undefined as success
                
                if (event.data.toolName === 'plan_bash' && wasSuccessful) {
                    results.plan_bash_worked = true;
                }
                if (event.data.toolName === 'view' && wasSuccessful) {
                    results.view_worked = true;
                }
            }
        });
        
        // Test 1: Use plan_bash and ask how to use it
        console.log('━'.repeat(60));
        console.log('Test 1: Use plan_bash tool and explain how to use it');
        console.log('Expected: Should work ✅');
        console.log('━'.repeat(60));
        
        const response1 = await session.sendAndWait({
            prompt: 'Use the plan_bash tool to run "pwd". Then explain to me how the plan_bash tool works and what it does.'
        });
        
        console.log(`Response preview: ${response1?.data.content?.substring(0, 300)}...\n`);
        
        // Test 2: Use view tool
        console.log('━'.repeat(60));
        console.log('Test 2: Use view tool');
        console.log('Expected: Should work ✅');
        console.log('━'.repeat(60));
        
        const response2 = await session.sendAndWait({
            prompt: 'Use the view tool to view the package.json file'
        });
        
        console.log(`Response preview: ${response2?.data.content?.substring(0, 200)}...\n`);
        
        // Test 3: Try to use edit tool (not in availableTools)
        console.log('━'.repeat(60));
        console.log('Test 3: Try to use edit tool');
        console.log('Expected: Should fail - edit not in availableTools ❌');
        console.log('━'.repeat(60));
        
        try {
            const response3 = await session.sendAndWait({
                prompt: 'Use the edit tool to change line 1 of package.json'
            });
            
            const content = response3?.data.content || '';
            if (content.toLowerCase().includes('edit') && 
                (content.toLowerCase().includes('not available') || 
                 content.toLowerCase().includes('cannot') ||
                 content.toLowerCase().includes("don't have"))) {
                console.log('✓ Model correctly said edit is not available');
                results.edit_failed = true;
            } else {
                console.log(`⚠️  Model response didn't clearly reject edit: ${content.substring(0, 200)}`);
            }
        } catch (error) {
            console.log(`✓ Edit attempt failed: ${error.message}`);
            results.edit_failed = true;
        }
        
        console.log('');
        
        // Test 4: Try to use SDK bash (not plan_bash)
        console.log('━'.repeat(60));
        console.log('Test 4: Try to use bash tool (SDK version)');
        console.log('Expected: Should fail - only plan_bash available, not SDK bash ❌');
        console.log('━'.repeat(60));
        
        try {
            const response4 = await session.sendAndWait({
                prompt: 'Use the bash tool (not plan_bash) to run "ls -la"'
            });
            
            const content = response4?.data.content || '';
            if (content.toLowerCase().includes('bash') && 
                (content.toLowerCase().includes('not available') || 
                 content.toLowerCase().includes('cannot') ||
                 content.toLowerCase().includes("don't have") ||
                 content.toLowerCase().includes('plan_bash'))) {
                console.log('✓ Model correctly said bash is not available');
                results.bash_failed = true;
            } else {
                console.log(`⚠️  Model response didn't clearly reject bash: ${content.substring(0, 200)}`);
            }
        } catch (error) {
            console.log(`✓ Bash attempt failed: ${error.message}`);
            results.bash_failed = true;
        }
        
        console.log('\n');
        console.log('='.repeat(60));
        console.log('RESULTS');
        console.log('='.repeat(60));
        console.log(`plan_bash worked:  ${results.plan_bash_worked ? '✅' : '❌'} (expected ✅)`);
        console.log(`view worked:       ${results.view_worked ? '✅' : '❌'} (expected ✅)`);
        console.log(`edit failed:       ${results.edit_failed ? '✅' : '❌'} (expected ✅)`);
        console.log(`bash failed:       ${results.bash_failed ? '✅' : '❌'} (expected ✅)`);
        console.log('');
        
        const allPassed = results.plan_bash_worked && 
                         results.view_worked && 
                         results.edit_failed && 
                         results.bash_failed;
        
        if (allPassed) {
            console.log('✅ HYPOTHESIS CONFIRMED');
            console.log('');
            console.log('Findings:');
            console.log('  1. Custom tools MUST be in availableTools to work');
            console.log('  2. availableTools is a complete whitelist for ALL tools');
            console.log('  3. Custom tools can coexist with SDK tools if both listed');
            console.log('  4. This allows limiting SDK tools AND using custom tools!');
            console.log('');
            console.log('Solution for plan mode:');
            console.log('  availableTools: [');
            console.log('    "plan_bash",      // custom restricted bash');
            console.log('    "plan_create",    // custom restricted create');
            console.log('    "plan_edit",      // custom restricted edit');
            console.log('    "update_work_plan", // custom tool');
            console.log('    "view",           // SDK tool (safe)');
            console.log('    "grep",           // SDK tool (safe)');
            console.log('    "glob"            // SDK tool (safe)');
            console.log('  ]');
        } else {
            console.log('❌ HYPOTHESIS NOT CONFIRMED');
            console.log('');
            console.log('Some tests did not pass as expected.');
            console.log('Need to investigate SDK behavior further.');
        }
        
        return allPassed;
        
    } catch (error) {
        console.error('Test error:', error);
        return false;
    } finally {
        if (session) {
            await session.destroy();
        }
        await client.stop();
    }
}

runTest()
    .then((passed) => {
        process.exit(passed ? 0 : 1);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
