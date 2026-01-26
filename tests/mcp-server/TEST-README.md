# MCP Integration Test

Tests that MCP server configuration is correctly passed from VS Code settings to the Copilot SDK.

## Test Overview

This integration test verifies:
1. ✅ MCP server configuration is read from VS Code settings
2. ✅ Only enabled servers are passed to the SDK
3. ✅ Disabled servers are filtered out
4. ✅ MCP tools are available and can be called
5. ✅ The hello-mcp test server works correctly

## Prerequisites

The test uses a simple Python MCP server (`hello-mcp`) with two tools:
- `get_test_data(key)` - Returns test data
- `validate_format(content, format_type)` - Validates content format

Setup:
```bash
cd tests/mcp-server/hello-mcp
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

## Running the Test

```bash
# Make sure extension is compiled first
npm run compile

# Run the MCP integration test
node tests/mcp-integration.test.js
```

The test will:
1. Check that the hello-mcp server is available
2. Create an SDKSessionManager with MCP configuration
3. Start a session and verify MCP servers are configured
4. Send a test prompt that triggers the `get_test_data` tool
5. Verify the MCP tool executes successfully
6. Report test results

## Expected Output

```
======================================================================
MCP Configuration Integration Test
======================================================================

📋 Pre-flight Checks:
   Python: /path/to/hello-mcp/venv/bin/python
   Server: /path/to/hello-mcp/server.py
✅ MCP server files found

✅ SDKSessionManager loaded
📦 Creating SDKSessionManager instance...
✅ Instance created

🚀 Starting SDK session...
✅ Session started

📤 Sending test message to trigger MCP tools...
⏳ Waiting 15 seconds for tool execution...

🔧 Tool Execution: hello-mcp-get_test_data
   ✅ Hello-MCP tool detected!
   Args: {"key":"sample"}
   ✅ Completed in 0.00s
   Result: {"type":"sample","content":"This is sample test data",...}

🛑 Stopping session...
✅ Session stopped

======================================================================
Test Results:
======================================================================

📊 Statistics:
   Total events: 8
   Tool starts: 2
   Tool completions: 2

🔧 Tools executed:
   - report_intent
   - hello-mcp-get_test_data

✅ Test Results:
   [✓] SDKSessionManager successfully created
   [✓] Session started without errors
   [✓] MCP configuration passed to SDK
   [✓] Only enabled servers configured
   [✓] Disabled servers filtered out
   [✓] MCP tools were called (hello-mcp server working!)

======================================================================
✅ MCP INTEGRATION TEST PASSED
======================================================================
```

## Test Configuration

The test configures two MCP servers via mocked VS Code settings:

```javascript
'mcpServers': {
    'hello-mcp': {
        'type': 'local',
        'command': 'path/to/python',
        'args': ['path/to/server.py'],
        'tools': ['*'],
        'enabled': true  // This server WILL be configured
    },
    'disabled-server': {
        'type': 'local',
        'command': 'echo',
        'args': ['disabled'],
        'tools': ['*'],
        'enabled': false  // This server will be FILTERED OUT
    }
}
```

The test verifies that:
- `hello-mcp` is passed to the SDK and works
- `disabled-server` is NOT passed to the SDK

## What Gets Tested

### 1. Configuration Passthrough
- VS Code settings → `getEnabledMCPServers()` → SDK session config
- Only servers with `enabled !== false` are included

### 2. SDK Integration
- MCP servers are properly formatted for SDK
- `enabled` field is removed before passing to SDK
- SDK successfully starts MCP server processes

### 3. Tool Execution
- MCP tools are discovered by Copilot
- Tools can be called via prompts
- Tool results are returned correctly

### 4. Filtering Logic
- Disabled servers don't get started
- No errors from attempting to use disabled servers

## Troubleshooting

**Error: Python virtual environment not found**
```bash
cd tests/mcp-server/hello-mcp
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

**Error: Cannot find module 'vscode'**
- The test mocks the vscode module
- Make sure the mock is set up before requiring extension.js

**Error: MCP tools not called**
- Check that Copilot CLI is installed and authenticated
- Verify `copilot --version` works
- Check logs for MCP server startup errors

## Implementation Details

### Mock VS Code API
The test mocks the VS Code API to avoid requiring VS Code runtime:
- `vscode.workspace.getConfiguration()` - Returns test configuration
- `vscode.EventEmitter` - Event handling
- `vscode.Uri.file()` - File path handling

### Test Sequence
1. Set up VS Code mocks
2. Create mock extension context
3. Load SDKSessionManager from compiled bundle
4. Create manager with MCP configuration
5. Start session (this triggers MCP server initialization)
6. Send test prompt
7. Monitor events for MCP tool calls
8. Verify results
9. Clean up

### Success Criteria
- ✅ No errors during session start
- ✅ MCP configuration logged (if servers configured)
- ✅ MCP tools execute successfully
- ✅ Disabled servers are filtered out

## Related Files

- `tests/mcp-integration.test.js` - Test implementation
- `tests/mcp-server/hello-mcp/` - Test MCP server
- `src/sdkSessionManager.ts` - MCP configuration logic
- `package.json` - MCP server setting schema
