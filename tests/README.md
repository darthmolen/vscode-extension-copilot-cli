# Integration Tests

This folder contains integration tests for the VS Code Copilot CLI extension.

## Running Tests

### SDK Integration Test

Tests the Copilot SDK integration without requiring VS Code:

```bash
# Build the extension first
npm run compile

# Run the test
node tests/sdk-integration.test.js
```

This test will:
1. Load the SDKSessionManager
2. Create a session with the Copilot SDK
3. Send a test message that uses tools
4. Track all events (tool executions, messages, status)
5. Display a summary of what happened

### What You'll See

The test outputs:
- 📨 Event notifications as they happen
- 🔧 Tool start events with tool names
- ✅ Tool completion events with duration
- 💬 Message content previews
- 📊 Summary with event counts and tool execution times

### Example Output

```
============================================================
SDK Integration Test
============================================================

✅ SDKSessionManager loaded
✅ SDKSessionManager instance created

🚀 Starting session...
✅ Session started

📤 Sending message: "Create a simple hello.txt file..."

📨 Event: status
   📊 Status: ready

📨 Event: tool_start
   🔧 Tool: create

📨 Event: tool_complete
   ✅ Tool: create (0.12s)

📨 Event: tool_start
   🔧 Tool: view

📨 Event: tool_complete
   ✅ Tool: view (0.08s)

📨 Event: message
   💬 I've created the file...

✅ Message completed in 3.45s

============================================================
Test Summary
============================================================
Total events: 6

Event breakdown:
  status: 1
  tool_start: 2
  tool_complete: 2
  message: 1

Tool executions: 2 started, 2 completed
  ✅ create: 0.12s
  ✅ view: 0.08s

✅ All tests passed!
```

## Adding More Tests

To add additional test scenarios, create new test files in this folder following the pattern:

```javascript
const { testSDKSession } = require('./sdk-integration.test.js');

async function testCustomScenario() {
    // Your test logic here
}

if (require.main === module) {
    testCustomScenario();
}
```

## Configuration

Tests use these default settings (can be modified in the test file):
- CLI Path: `copilot` (from PATH)
- Yolo Mode: `true`
- Model: `claude-3-5-sonnet-20241022`
