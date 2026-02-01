/**
 * Quick test to verify defineTool works with SDK
 */

const { defineTool } = require('@github/copilot-sdk');

console.log('Testing defineTool...\n');

// Test 1: Create a simple tool
const testTool = defineTool('test_tool', {
    description: 'A test tool',
    parameters: {
        type: 'object',
        properties: {
            input: { type: 'string' }
        },
        required: ['input']
    },
    handler: async (args) => {
        return `Received: ${args.input}`;
    }
});

console.log('Tool created:', testTool);
console.log('Tool name:', testTool.name);
console.log('Tool has handler:', typeof testTool.handler === 'function');
console.log('Tool structure:', JSON.stringify({
    name: testTool.name,
    description: testTool.description,
    hasParameters: !!testTool.parameters,
    hasHandler: typeof testTool.handler === 'function'
}, null, 2));

// Test handler
console.log('\nTesting handler...');
testTool.handler({ input: 'hello' }).then(result => {
    console.log('Handler result:', result);
    console.log('\n✅ defineTool works correctly!');
}).catch(err => {
    console.error('❌ Handler error:', err);
});
