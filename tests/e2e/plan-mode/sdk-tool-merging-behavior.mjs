/**
 * Bare-bones SDK Test: Tool Merging Behavior
 * 
 * This test verifies HOW the SDK/CLI actually merges tools from different sources.
 * We're testing our assumptions about:
 * 1. Do custom tools override SDK tools with the same name?
 * 2. What happens with custom tools + no availableTools?
 * 3. What happens with custom tools + availableTools?
 * 4. What happens with duplicates?
 */

import { CopilotClient, defineTool } from '@github/copilot-sdk';
import { z } from 'zod';

console.log('=== SDK Tool Merging Behavior Test ===\n');

const client = new CopilotClient({
    cliPath: 'copilot',
    useStdio: true,
    autoStart: true
});

async function runTests() {
    try {
        console.log('Test 1: Custom tool (unique name) + no availableTools');
        console.log('Expected: custom tool + all SDK built-in tools\n');
        
        const session1 = await client.createSession({
            tools: [
                defineTool('my_custom_tool', {
                    description: 'A custom tool with unique name',
                    parameters: z.object({
                        input: z.string()
                    }),
                    handler: ({ input }) => `Custom: ${input}`
                })
            ]
            // No availableTools - should get all SDK tools
        });
        
        console.log(`✓ Session 1 created: ${session1.sessionId}`);
        console.log('  tools: [my_custom_tool] (custom)');
        console.log('  availableTools: NOT SPECIFIED');
        console.log('  Expected result: my_custom_tool + view + edit + bash + create + grep + glob + task + ...\n');
        
        await session1.destroy();
        
        // ============================================================
        
        console.log('Test 2: Custom tool named "bash" + no availableTools');
        console.log('Expected: EITHER error OR one bash tool (need to see which)\n');
        
        try {
            const session2 = await client.createSession({
                tools: [
                    defineTool('bash', {
                        description: 'Custom bash tool that restricts commands',
                        parameters: z.object({
                            command: z.string()
                        }),
                        handler: ({ command }) => `Custom bash executed: ${command}`
                    })
                ]
                // No availableTools - potential duplicate with SDK's bash
            });
            
            console.log(`✓ Session 2 created: ${session2.sessionId}`);
            console.log('  tools: [bash] (custom)');
            console.log('  availableTools: NOT SPECIFIED');
            console.log('  Result: Session created successfully - will send message to check for duplicates\n');
            
            // Try to send a message to trigger tool validation
            console.log('  Sending test message...');
            const result = await session2.sendAndWait({ 
                prompt: 'List the available tools. Just list their names, nothing else.' 
            });
            
            console.log(`  ✓ Message succeeded`);
            console.log(`  Response: ${result?.data.content?.substring(0, 200)}...\n`);
            
            await session2.destroy();
            
        } catch (error) {
            console.log(`  ❌ ERROR: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.message.includes('Tool names must be unique')) {
                console.log(`  ✓ CONFIRMED: Duplicate tool names cause API error`);
                console.log(`  This proves custom tools do NOT override SDK tools\n`);
            }
        }
        
        // ============================================================
        
        console.log('Test 3: Custom tool named "bash" + availableTools whitelist');
        console.log('Expected: custom bash + only whitelisted tools (no duplicate)\n');
        
        const session3 = await client.createSession({
            tools: [
                defineTool('bash', {
                    description: 'Custom bash tool',
                    parameters: z.object({
                        command: z.string()
                    }),
                    handler: ({ command }) => `Custom: ${command}`
                })
            ],
            availableTools: ['view', 'grep', 'glob']  // Whitelist without 'bash'
        });
        
        console.log(`✓ Session 3 created: ${session3.sessionId}`);
        console.log('  tools: [bash] (custom)');
        console.log('  availableTools: ["view", "grep", "glob"]');
        console.log('  Expected result: bash (custom) + view + grep + glob ONLY\n');
        
        console.log('  Sending test message...');
        const result3 = await session3.sendAndWait({
            prompt: 'List the available tools. Just list their names.'
        });
        
        console.log(`  ✓ Message succeeded`);
        console.log(`  Response: ${result3?.data.content?.substring(0, 200)}...\n`);
        
        await session3.destroy();
        
        // ============================================================
        
        console.log('Test 4: Multiple custom tools with SDK names + no availableTools');
        console.log('Expected: API error about duplicate tools\n');
        
        try {
            const session4 = await client.createSession({
                tools: [
                    defineTool('bash', {
                        description: 'Custom bash',
                        handler: () => 'custom bash'
                    }),
                    defineTool('create', {
                        description: 'Custom create',
                        handler: () => 'custom create'
                    }),
                    defineTool('edit', {
                        description: 'Custom edit',
                        handler: () => 'custom edit'
                    })
                ]
                // No availableTools - all 3 customs clash with SDK tools
            });
            
            console.log(`✓ Session 4 created: ${session4.sessionId}`);
            console.log('  Sending test message to trigger validation...');
            
            await session4.sendAndWait({ prompt: 'What tools are available?' });
            
            console.log(`  ✓ Message succeeded - No duplicate error!`);
            console.log(`  This is unexpected... investigating why\n`);
            
            await session4.destroy();
            
        } catch (error) {
            console.log(`  ❌ ERROR: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.message.includes('Tool names must be unique')) {
                console.log(`  ✓ CONFIRMED: Multiple duplicate names cause API error\n`);
            }
        }
        
        console.log('='.repeat(60));
        console.log('TEST COMPLETE');
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('Test error:', error);
    } finally {
        await client.stop();
    }
}

runTests();
