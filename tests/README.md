# Test Suite Documentation

This folder contains a comprehensive test suite for the VS Code Copilot CLI extension.

## Quick Start

```bash
# 1. Verify your setup
npm run test:verify

# 2. Run comprehensive tests
npm run test:comprehensive

# 3. Review results
cat tests/output/test-report-YYYYMMDD-HHMMSS.md
```

## Test Suite Overview

The test suite consists of:

1. **Setup Verification** (`verify-setup.js`) - Validates test environment
2. **Comprehensive Tests** (`comprehensive-test.js`) - Full integration test suite
3. **SDK Integration Test** (`sdk-integration.test.js`) - Lightweight SDK validation
4. **MCP Server** (`mcp-server/`) - Mock MCP tools for testing
5. **Fixtures** (`fixtures/`) - Sample files for test scenarios
6. **Evaluation Framework** (`evaluation/`) - Automated result analysis

## Available Test Commands

```bash
# Verify test setup (run this first)
npm run test:verify

# Run comprehensive test suite (8 scenarios with automated evaluation)
npm run test:comprehensive

# Run basic SDK integration test
npm run test:sdk

# Run all tests (alias for test:comprehensive)
npm test

# Run plan mode tests
node tests/plan-mode-safe-tools.test.mjs
node tests/plan-mode-restrictions.test.mjs
node tests/plan-mode-integration.test.mjs
```

---

## Comprehensive Test Suite

The comprehensive test suite validates all aspects of the extension with 8 test scenarios.

### Test Scenarios

| # | Scenario | Purpose | Tools Used |
|---|----------|---------|------------|
| 1 | **File Creation** | Multiple file operations & tool feedback | `create` × 3 |
| 2 | **Code Reading** | File reading & code explanation | `view` |
| 3 | **Markdown Rendering** | Complex markdown & table rendering | `view` |
| 4 | **Code Fix** | Bug detection without modification | `view` |
| 5 | **Plan Analysis** | Document summarization | `view` |
| 6 | **Mixed Content** | Code generation + explanation | inline (no tools) |
| 7 | **Tool Chain** | Sequential tool execution | `view`, `create` |
| 8 | **MCP Integration** | Model Context Protocol tools | MCP tools |

### What Gets Tested

Each scenario validates:
- ✅ **Tool execution tracking** - Correct tools called in order
- ⏱️ **Performance** - Execution time per tool and scenario
- 📝 **Response quality** - Markdown rendering, code blocks, formatting
- 🔧 **Visual feedback** - Tool indicators and status updates
- 📊 **Automated scoring** - Quality assessment (0-10) via judge skill

### Output Reports

After running `npm run test:comprehensive`, you'll find:

**JSON Report** (`tests/output/test-results-YYYYMMDD-HHMMSS.json`):
- Raw test data (tools, timing, content)
- Machine-readable for CI/CD integration

**Markdown Report** (`tests/output/test-report-YYYYMMDD-HHMMSS.md`):
- Human-readable summary
- Per-scenario breakdowns
- Overall quality scores
- Recommendations for improvements

### Reading Reports

Open the markdown report to see:

```markdown
# Test Report - 2024-01-15 14:30:45

## Overall Summary
- **Total Tests**: 8
- **Duration**: 45.2s
- **Average Score**: 8.7/10

## Scenario Results

### 1. File Creation Test ✅
- **Duration**: 3.2s
- **Tools**: create (0.5s), create (0.4s), create (0.5s)
- **Score**: 9/10
- **Feedback**: Excellent tool execution visibility...
```

### Troubleshooting

**Issue: Tests fail during setup**
```bash
# Run verification first
npm run test:verify

# Check output for missing dependencies
```

**Issue: MCP tools not working**
```bash
# MCP server starts automatically, but verify manually:
node tests/mcp-server/server.js
# Should output: MCP Test Server running on stdio
```

**Issue: No judge skill available**
- Tests will still run but won't have automated scoring
- Manual evaluation possible from test outputs
- See `tests/evaluation/README.md` for criteria

**Issue: Extension not compiled**
```bash
npm run compile
```

---

## SDK Integration Test

A lightweight test that validates basic SDK functionality without requiring VS Code.

### Running

```bash
# Build the extension first
npm run compile

# Run the test
npm run test:sdk
```

### What It Tests

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

---

## File Structure

```
tests/
├── README.md                          # This file
├── TEST-SUITE-OVERVIEW.md             # Architecture & design
├── COMPREHENSIVE-TEST.md              # Detailed test suite docs
├── comprehensive-test.js              # Main test runner
├── scenarios.js                       # Test scenario definitions
├── sdk-integration.test.js            # Basic SDK test
├── verify-setup.js                    # Setup verification script
├── fixtures/                          # Test data files
│   ├── sample.py                      # Python sample
│   ├── content.md                     # Markdown sample
│   ├── BrokenClass.cs                 # C# with bugs
│   └── implementation-plan.md         # Project plan
├── mcp-server/                        # Mock MCP server
│   ├── server.js                      # MCP server implementation
│   └── tools.json                     # Tool definitions
├── evaluation/                        # Evaluation framework
│   ├── README.md                      # Evaluation docs
│   ├── index.js                       # Main evaluator
│   ├── evaluator.js                   # Evaluation logic
│   ├── reporter.js                    # Report generation
│   ├── criteria.js                    # Quality criteria
│   └── examples.js                    # Example evaluations
└── output/                            # Test results (gitignored)
    ├── test-results-*.json            # Raw test data
    └── test-report-*.md               # Human-readable reports
```

---

## Plan Mode Tests

The extension includes specialized tests for plan mode functionality:

### Test Files
- **`plan-mode-safe-tools.test.mjs`** - Tests renamed tools with availableTools whitelist (7 tests)
- **`plan-mode-restrictions.test.mjs`** - Tests security restrictions block dangerous operations (26 tests)
- **`plan-mode-integration.test.mjs`** - End-to-end plan mode workflow tests (9 tests)
- **`sdk-plan-mode-tools.test.mjs`** - SDK integration test for plan mode tools

### What Gets Tested
- ✅ Custom restricted tools (plan_bash_explore, task_agent_type_explore, edit_plan_file, create_plan_file, update_work_plan)
- ✅ Safe SDK tools (view, grep, glob, web_fetch, fetch_copilot_cli_documentation)
- ✅ Blocked operations (dangerous bash commands, non-explore agents, non-plan file edits)
- ✅ Clear error messages for blocked operations
- ✅ Complete workflow: create plan → update → edit → accept → implement

### Running Plan Mode Tests
```bash
# Run all plan mode tests
node tests/plan-mode-restrictions.test.mjs  # 26/26 tests
node tests/plan-mode-integration.test.mjs   # 9/9 tests
node tests/plan-mode-safe-tools.test.mjs    # 7/7 tests
```

See [PLAN_MODE_FIX_SUMMARY.md](../PLAN_MODE_FIX_SUMMARY.md) in the root for implementation details.

---

## 📚 Documentation Files

This test suite includes comprehensive documentation:

### Main Documentation
- **[README.md](./README.md)** (this file) - Complete test suite guide, quick start, and reference
- **[TEST-SUITE-OVERVIEW.md](./TEST-SUITE-OVERVIEW.md)** - Architecture, component design, data flow, and extension guide
- **[COMPREHENSIVE-TEST.md](./COMPREHENSIVE-TEST.md)** - Detailed comprehensive test suite documentation
- **[QUICKREF-COMPREHENSIVE.md](./QUICKREF-COMPREHENSIVE.md)** - Quick reference for running tests

### Additional Documentation
- **[evaluation/README.md](./evaluation/README.md)** - Evaluation framework and quality criteria
- **[mcp-server/TEST-README.md](./mcp-server/TEST-README.md)** - MCP test server documentation

### Historical Plans (Completed)
Completed planning documents have been moved to `/planning/completed/`:
- `PHASE-6-COMPLETE.md` - Phase 6 completion summary
- `PHASE-6-SUMMARY.md` - Phase 6 implementation details
- `INTEGRATION-TEST-PLAN.md` - Original integration test planning

---

## Adding More Tests

### Adding a New Scenario

Edit `tests/scenarios.js`:

```javascript
{
  name: "Your Test Name",
  description: "What this tests",
  prompt: "The prompt to send to the agent",
  expectedTools: ["tool1", "tool2"],
  evaluationNotes: "What to verify: (1) First thing, (2) Second thing..."
}
```

### Creating Custom Tests

Create new test files following the pattern:

```javascript
const { testSDKSession } = require('./sdk-integration.test.js');

async function testCustomScenario() {
    // Your test logic here
}

if (require.main === module) {
    testCustomScenario();
}
```

---

## Configuration

Tests use these default settings (configurable in test files):

- **CLI Path**: `copilot` (from PATH)
- **Yolo Mode**: `true` (all permissions)
- **Model**: `claude-3-5-sonnet-20241022`
- **Output Directory**: `tests/output/`
- **MCP Server**: Auto-started on stdio

---

## CI/CD Integration

The test suite is designed for automated testing:

```yaml
# Example GitHub Actions workflow
- name: Run tests
  run: |
    npm run compile
    npm run test:verify
    npm run test:comprehensive
    
- name: Upload test reports
  uses: actions/upload-artifact@v3
  with:
    name: test-reports
    path: tests/output/*.md
```

JSON output (`test-results-*.json`) can be parsed for pass/fail status and metrics.
