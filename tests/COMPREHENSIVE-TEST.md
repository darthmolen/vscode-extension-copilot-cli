# Comprehensive Test Suite

## Overview

The comprehensive test suite (`comprehensive-test.js`) is a complete integration test that validates the VS Code Copilot CLI Extension v2 SDK integration.

It orchestrates:
- **8 test scenarios** covering different extension capabilities
- **Event capture** of tool executions and responses
- **Automated evaluation** using the judge skill
- **Comprehensive reporting** (JSON and Markdown)

## Quick Start

### Prerequisites

1. **GitHub Copilot CLI** must be installed and authenticated:
   ```bash
   copilot --version
   ```

2. **Extension must be compiled**:
   ```bash
   npm run compile
   ```

3. **Judge skill** (optional but recommended for automated evaluation):
   - The test will use `copilot --skill judge-test-output` for evaluation
   - If judge skill is not available, manual evaluation can be done from the test outputs

### Running the Test Suite

**Easy way (using npm script):**
```bash
npm run test:comprehensive
```

**Direct way:**
```bash
node tests/comprehensive-test.js
```

## What It Tests

### Test Scenarios

1. **File Creation Test** - Multiple file operations
2. **Code Reading Test** - File reading and explanation
3. **Markdown Rendering Test** - Complex markdown content
4. **Code Fix Test** - Bug detection without modification
5. **Plan Analysis Test** - Document summarization
6. **Mixed Content Test** - Code + explanation rendering
7. **Tool Chain Test** - Sequential tool execution
8. **MCP Integration Test** - Model Context Protocol tools

### What Gets Measured

For each test:
- ✅ **Tools executed** (names, count, duration)
- 📝 **Response content** (full output)
- ⏱️ **Execution time** (per test)
- 📊 **Quality score** (0-10 from judge)
- 🔍 **Detailed feedback** (component breakdown)

## Test Output

### Console Output

During execution, you'll see:

```
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║     COPILOT CLI EXTENSION V2 - COMPREHENSIVE TEST        ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

📦 SETUP PHASE

✅ Output directory: /path/to/tests/output
🔧 Initializing SDK Session Manager...
✅ SDKSessionManager created
🚀 Starting Copilot SDK session...
✅ Session started successfully

🧪 TEST EXECUTION PHASE

Running 8 test scenarios...

[1/8] File Creation Test
============================================================
📝 Running: File Creation Test
   Tests file creation tool execution and visual feedback
============================================================
📤 Prompt: "Create 3 files: hello.txt with 'Hello'..."

   🔧 Tool started: create
   ✅ Tool completed: create (0.45s)
   🔧 Tool started: create
   ✅ Tool completed: create (0.38s)
   ...

✅ Completed in 2.34s
   Tools executed: 3
   Events captured: 12

   🔧 Tools:
      ✅ create (0.45s)
      ✅ create (0.38s)
      ✅ create (0.41s)

[2/8] Code Reading Test
...

📊 EVALUATION PHASE

🔍 Evaluating 8 test(s)...

Evaluating: File Creation Test...
Evaluating: Code Reading Test...
...

========================================
           TEST SUMMARY
========================================
Total Tests:   8
Passed:        7 ✅
Failed:        1 ❌
Errors:        0 ⚠️
Pass Rate:     87.5%
========================================

💾 Saving reports...
✅ Reports saved to:
   JSON: /path/to/tests/output/test-results-2024-01-25T12-00-00.json
   Markdown: /path/to/tests/output/test-report-2024-01-25T12-00-00.md

📄 FINAL SUMMARY

────────────────────────────────────────────────────────
Total Tests:      8
Passed:           7 ✅
Failed:           1 ❌
Errors:           0 ⚠️
Pass Rate:        87.5%
Average Score:    8.2/10
────────────────────────────────────────────────────────

📁 Reports saved to:
   JSON:     /path/to/tests/output/test-results-2024-01-25T12-00-00.json
   Markdown: /path/to/tests/output/test-report-2024-01-25T12-00-00.md

🧹 CLEANUP PHASE

Stopping SDK session...
✅ Session stopped

✅ Test suite completed successfully!
```

### Generated Reports

#### JSON Report (`test-results-*.json`)

```json
{
  "timestamp": "2024-01-25T12:00:00.000Z",
  "summary": {
    "total": 8,
    "passed": 7,
    "failed": 1,
    "errors": 0
  },
  "results": [
    {
      "testName": "File Creation Test",
      "score": 9.2,
      "status": "pass",
      "feedback": "Excellent execution...",
      "breakdown": {
        "functionality": 9.5,
        "visualization": 9.0,
        "formatting": 9.0
      }
    },
    ...
  ]
}
```

#### Markdown Report (`test-report-*.md`)

Contains:
- Summary table (pass/fail/error counts)
- Overall status
- Results table (all tests with scores)
- Detailed breakdown per test
- Component scores
- Detailed feedback from judge

See `tests/evaluation/sample-report.md` for an example.

## Exit Codes

- `0` - Success (pass rate ≥ 80%)
- `1` - Failure (pass rate < 80% or critical error)

## Configuration Options

### Modifying Test Behavior

Edit `comprehensive-test.js` to customize:

```javascript
const config = {
  model: 'claude-3-5-sonnet-20241022',  // Change model
  yoloMode: true,                        // Auto-approve all tools
  allowAllTools: true                    // Allow all tool types
};
```

### Adding New Scenarios

Edit `tests/scenarios.js`:

```javascript
{
  name: "My New Test",
  description: "What this test validates",
  prompt: "The prompt to send to Copilot",
  expectedTools: ["tool1", "tool2"],
  evaluationNotes: "Verify: (1) Thing 1, (2) Thing 2..."
}
```

### Adjusting Evaluation

Edit pass threshold in `tests/evaluation/criteria.js`:

```javascript
const PASS_THRESHOLD = 7.0;  // Default: 7.0/10
```

## Troubleshooting

### "copilot command not found"

Install GitHub Copilot CLI:
```bash
gh extension install github/gh-copilot
```

### "Judge skill invocation failed"

The judge skill is optional. Tests will still run, but evaluation scores may be unavailable. Check:
```bash
copilot --skill judge-test-output "test input"
```

### "SDKSessionManager not found"

Rebuild the extension:
```bash
npm run compile
```

### Session hangs or times out

- Check if `copilot` CLI is responsive: `copilot --version`
- Increase wait times in the test if needed
- Check console output for error messages

### Tests fail but manual execution works

- The test environment may differ from VS Code
- Check `vscode` mock in `comprehensive-test.js`
- Verify configuration settings match extension settings

## Development

### Running Individual Phases

You can import and use individual components:

```javascript
const scenarios = require('./scenarios');
const { evaluateTestOutput } = require('./evaluation');

// Run specific scenario
const scenario = scenarios[0];
// ... run test ...

// Evaluate specific output
const result = await evaluateTestOutput({
  name: scenario.name,
  output: "test output here",
  evaluationNotes: scenario.evaluationNotes
});
```

### Debugging

Enable detailed logging:

```javascript
class TestLogger {
  debug(...args) { console.log('[DEBUG]', ...args); } // Uncomment
}
```

Watch events in real-time:

```javascript
manager.onMessage((event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  eventCapture.captureEvent(event);
});
```

## Files Structure

```
tests/
├── comprehensive-test.js      ← Main orchestrator
├── scenarios.js               ← Test scenarios
├── evaluation/
│   ├── index.js              ← Evaluation framework entry
│   ├── evaluator.js          ← Judge skill integration
│   ├── reporter.js           ← Report generation
│   └── criteria.js           ← Scoring criteria
├── output/                   ← Generated reports
│   ├── test-results-*.json
│   └── test-report-*.md
└── fixtures/                 ← Test data files
    ├── sample.py
    ├── content.md
    └── ...
```

## Next Steps

After running tests:

1. **Review reports** in `tests/output/`
2. **Check failed tests** - see detailed feedback
3. **Iterate on issues** - fix bugs or update tests
4. **Update scenarios** - add new test cases as needed
5. **CI/CD integration** - add to your pipeline

## Tips

- Run comprehensive tests before releases
- Keep scenarios updated with new features
- Review judge feedback for quality insights
- Use pass rate trends to track progress
- Failed tests often reveal UX issues
