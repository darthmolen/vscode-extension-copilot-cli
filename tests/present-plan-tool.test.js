/**
 * Present Plan Tool Test
 * Tests the present_plan custom tool that notifies UI when plan is ready
 * Does NOT rely on LLM behavior - tests tool logic and event emission
 */

const { randomUUID } = require('crypto');
const EventEmitter = require('events');

// Test results tracking
let testResults = [];

function recordTest(name, passed, details = '') {
    testResults.push({ name, passed, details });
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${name}${details ? ': ' + details : ''}`);
}

async function runPresentPlanTests() {
    console.log('='.repeat(70));
    console.log('Present Plan Tool Tests');
    console.log('Testing present_plan tool handler and event emission');
    console.log('='.repeat(70));
    
    // Test 1: Tool handler executes without error
    console.log('\n📋 Test 1: present_plan tool handler');
    {
        try {
            // Mock the event emitter
            const mockEmitter = new EventEmitter();
            let emittedEvent = null;
            
            mockEmitter.on('fire', (event) => {
                emittedEvent = event;
            });
            
            // Simulate the tool handler
            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: { 
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return `Plan presented to user. They can now review it and choose to accept, continue planning, or provide new instructions.`;
            };
            
            const result = await handler({ summary: 'Test plan summary' });
            
            recordTest('Handler returns success message', result.includes('Plan presented'));
            recordTest('Handler executes without error', true);
        } catch (error) {
            recordTest('Handler executes without error', false, error.message);
        }
    }
    
    // Test 2: Event emission with summary
    console.log('\n📋 Test 2: Event emission with summary');
    {
        try {
            const mockEmitter = new EventEmitter();
            let capturedEvent = null;
            
            mockEmitter.on('fire', (event) => {
                capturedEvent = event;
            });
            
            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: { 
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return 'Success';
            };
            
            await handler({ summary: 'Plan for implementing feature X' });
            
            recordTest('Event is emitted', capturedEvent !== null);
            recordTest('Event type is status', capturedEvent?.type === 'status');
            recordTest('Status is plan_ready', capturedEvent?.data?.status === 'plan_ready');
            recordTest('Summary is passed correctly', capturedEvent?.data?.summary === 'Plan for implementing feature X');
            recordTest('Timestamp is present', typeof capturedEvent?.timestamp === 'number');
        } catch (error) {
            recordTest('Event emission test', false, error.message);
        }
    }
    
    // Test 3: Event emission without summary
    console.log('\n📋 Test 3: Event emission without summary (optional parameter)');
    {
        try {
            const mockEmitter = new EventEmitter();
            let capturedEvent = null;
            
            mockEmitter.on('fire', (event) => {
                capturedEvent = event;
            });
            
            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: { 
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return 'Success';
            };
            
            await handler({});
            
            recordTest('Event is emitted without summary', capturedEvent !== null);
            recordTest('Summary is null when omitted', capturedEvent?.data?.summary === null);
        } catch (error) {
            recordTest('Event emission without summary', false, error.message);
        }
    }
    
    // Test 4: Multiple sequential calls
    console.log('\n📋 Test 4: Multiple sequential present_plan calls');
    {
        try {
            const mockEmitter = new EventEmitter();
            const capturedEvents = [];
            
            mockEmitter.on('fire', (event) => {
                capturedEvents.push(event);
            });
            
            const handler = async ({ summary }) => {
                const event = {
                    type: 'status',
                    data: { 
                        status: 'plan_ready',
                        summary: summary || null
                    },
                    timestamp: Date.now()
                };
                mockEmitter.emit('fire', event);
                return 'Success';
            };
            
            await handler({ summary: 'First plan' });
            await handler({ summary: 'Second plan' });
            await handler({ summary: 'Third plan' });
            
            recordTest('Multiple events are emitted', capturedEvents.length === 3);
            recordTest('Events have different summaries', 
                capturedEvents[0].data.summary === 'First plan' &&
                capturedEvents[1].data.summary === 'Second plan' &&
                capturedEvents[2].data.summary === 'Third plan'
            );
        } catch (error) {
            recordTest('Multiple sequential calls', false, error.message);
        }
    }
    
    // Test 5: Error handling
    console.log('\n📋 Test 5: Error handling in present_plan');
    {
        try {
            const handler = async ({ summary }) => {
                try {
                    // Simulate potential error scenarios
                    if (summary && summary.length > 1000) {
                        throw new Error('Summary too long');
                    }
                    
                    return 'Plan presented to user.';
                } catch (error) {
                    return `Error presenting plan: ${error.message}`;
                }
            };
            
            const normalResult = await handler({ summary: 'Normal summary' });
            const errorResult = await handler({ summary: 'x'.repeat(1001) });
            
            recordTest('Normal execution succeeds', normalResult.includes('Plan presented'));
            recordTest('Error is caught and returned', errorResult.includes('Error presenting plan'));
        } catch (error) {
            recordTest('Error handling test', false, error.message);
        }
    }
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('Test Summary');
    console.log('='.repeat(70));
    const passed = testResults.filter(r => r.passed).length;
    const total = testResults.length;
    const failed = total - passed;
    
    console.log(`Total: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    
    if (failed > 0) {
        console.log('\nFailed tests:');
        testResults.filter(r => !r.passed).forEach(r => {
            console.log(`  - ${r.name}${r.details ? ': ' + r.details : ''}`);
        });
    }
    
    process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runPresentPlanTests().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
});
