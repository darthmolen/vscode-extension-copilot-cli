# Evaluation Framework

Phase 5 evaluation framework for scoring test outputs using the judge skill.

## Overview

This framework provides automated evaluation of test outputs by:
1. Invoking the local Copilot judge skill
2. Parsing structured JSON responses
3. Generating comprehensive reports in JSON and Markdown formats

## Components

### `evaluator.js`
Main evaluation engine that invokes the judge skill and parses responses.

**Key Functions:**
- `evaluateTestOutput(testData)` - Evaluate a single test output
- `evaluateTestOutputs(testDataArray)` - Batch evaluate multiple tests

### `criteria.js`
Defines evaluation criteria, thresholds, and scoring utilities.

**Constants:**
- `PASS_THRESHOLD = 7.0` - Minimum score to pass
- `SCORE_RANGES` - Interpretation ranges (Excellent, Good, Fair, Poor)
- `CRITERIA_WEIGHTS` - Component weights for scoring

**Functions:**
- `interpretScore(score)` - Get label for score
- `isPassing(score)` - Check if score passes
- `getStatusEmoji(score)` - Get status emoji

### `reporter.js`
Generates and saves test reports in multiple formats.

**Key Functions:**
- `generateReport(testResults)` - Generate markdown report
- `generateAndSaveReports(testResults, outputDir)` - Save both JSON and MD
- `displaySummary(testResults)` - Console summary

## Usage

### Basic Example

```javascript
const { evaluateTestOutput } = require('./evaluation/evaluator');
const { generateAndSaveReports } = require('./evaluation/reporter');

const testData = {
  name: "File Creation Test",
  output: "Tool: create (hello.txt) - 45ms\nFile created successfully",
  evaluationNotes: "Should show tool indicator and confirm creation"
};

const result = await evaluateTestOutput(testData);
console.log(`Score: ${result.score}/10 - ${result.status}`);

// Generate reports
const reports = await generateAndSaveReports([result]);
console.log('Reports saved:', reports);
```

### Batch Evaluation

```javascript
const { evaluateTestOutputs } = require('./evaluation/evaluator');
const { generateAndSaveReports, displaySummary } = require('./evaluation/reporter');

const testOutputs = [
  { name: "Test 1", output: "...", evaluationNotes: "..." },
  { name: "Test 2", output: "...", evaluationNotes: "..." },
  // ... more tests
];

const results = await evaluateTestOutputs(testOutputs);
displaySummary(results);

const reportPaths = await generateAndSaveReports(results);
console.log('JSON:', reportPaths.json);
console.log('Markdown:', reportPaths.markdown);
```

### Integration with SDK Tests

```javascript
const scenarios = require('../scenarios');
const SDKSessionManager = require('../mcp-server/sdk-session-manager');

const sessionManager = new SDKSessionManager();
const capturedOutputs = [];

// Capture outputs during test execution
sessionManager.on('response', (content) => {
  capturedOutputs.push(content);
});

// Run scenarios...
// Then evaluate

const testData = scenarios.map((scenario, i) => ({
  name: scenario.name,
  output: capturedOutputs[i],
  evaluationNotes: scenario.evaluationNotes
}));

const results = await evaluateTestOutputs(testData);
await generateAndSaveReports(results);
```

## Output Files

All outputs are saved to `tests/output/` with timestamps:

- **JSON Results:** `test-results-YYYY-MM-DDTHH-MM-SS.json`
- **Markdown Report:** `test-report-YYYY-MM-DDTHH-MM-SS.md`

### JSON Format

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "summary": {
    "total": 8,
    "passed": 6,
    "failed": 1,
    "errors": 1
  },
  "results": [
    {
      "testName": "File Creation Test",
      "score": 8.5,
      "status": "pass",
      "feedback": "Detailed feedback...",
      "breakdown": {
        "functionality": 9.0,
        "visualization": 8.0,
        "formatting": 8.5
      }
    }
  ]
}
```

### Markdown Format

See example below for the report structure with summary table, detailed breakdowns, and statistics.

## Requirements

### Dependencies
- Node.js with `child_process` for spawning copilot CLI
- `copilot` CLI must be available in PATH
- Judge skill must be available (`--skill judge-test-output`)

### Installation
No additional npm packages required - uses Node.js built-ins only.

## Error Handling

The framework handles errors gracefully:

- **Invalid JSON from judge:** Marks test as `evaluation_error`
- **Judge skill unavailable:** Returns error status with message
- **Empty output:** Returns error status with appropriate message
- **Subprocess failures:** Captures stderr and returns error details

All errors are logged and included in the final report.

## Scoring System

**Scale:** 0-10 (decimal precision)

**Interpretation:**
- 9.0-10.0: Excellent ✅
- 7.0-8.9: Good ✔️
- 5.0-6.9: Fair ⚠️
- 0.0-4.9: Poor ❌

**Pass Threshold:** 7.0

**Components** (if provided by judge):
- Functionality (40%)
- Visualization (30%)
- Formatting (20%)
- Performance (10%)

## Examples

See `examples.js` for complete working examples of:
1. Single test evaluation
2. Batch evaluation
3. SDK integration
4. Custom output directories

Run examples:
```bash
node tests/evaluation/examples.js
```

## API Reference

### evaluateTestOutput(testData)

**Parameters:**
- `testData.name` (string) - Test name
- `testData.output` (string) - Test output to evaluate
- `testData.evaluationNotes` (string) - Expected criteria

**Returns:** Promise<EvaluationResult>
```javascript
{
  score: number,           // 0-10
  status: string,          // 'pass' | 'fail' | 'evaluation_error'
  feedback: string,        // Detailed feedback
  breakdown?: object,      // Component scores
  error?: string          // Error message if failed
}
```

### generateAndSaveReports(testResults, outputDir?)

**Parameters:**
- `testResults` (Array) - Array of evaluation results
- `outputDir` (string, optional) - Output directory (default: tests/output)

**Returns:** Promise<object>
```javascript
{
  json: string,           // Path to JSON file
  markdown: string,       // Path to markdown file
  summary: {
    total: number,
    passed: number,
    failed: number,
    errors: number
  }
}
```

## Troubleshooting

**Judge skill not found:**
- Ensure `copilot` CLI is in PATH
- Verify judge skill is available with `copilot --skill judge-test-output`

**JSON parse errors:**
- Judge output may include non-JSON text
- Framework extracts JSON using regex pattern matching
- If still failing, check judge skill output format

**Subprocess timeouts:**
- Judge skill may take time to respond
- No timeout is currently set - waits indefinitely
- Consider adding timeout if needed for production use
