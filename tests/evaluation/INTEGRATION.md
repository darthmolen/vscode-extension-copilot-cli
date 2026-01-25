# Evaluation Framework - Integration Guide

## Quick Start

### 1. Basic Usage (5 minutes)

```bash
# Run the quick start example
node tests/evaluation/quick-start.js
```

This will:
- Evaluate 2 mock test outputs
- Display a console summary
- Generate JSON and Markdown reports in `tests/output/`

### 2. How to Invoke the Evaluator

#### Single Test Evaluation

```javascript
const { evaluateTestOutput } = require('./tests/evaluation/evaluator');

const result = await evaluateTestOutput({
  name: "My Test",
  output: "Test output captured from your test run...",
  evaluationNotes: "Expected behavior and criteria"
});

console.log(`Score: ${result.score}/10`);
console.log(`Status: ${result.status}`); // 'pass', 'fail', or 'evaluation_error'
console.log(`Feedback: ${result.feedback}`);
```

#### Batch Evaluation (Recommended)

```javascript
const { evaluateTestOutputs } = require('./tests/evaluation/evaluator');
const { generateAndSaveReports, displaySummary } = require('./tests/evaluation/reporter');

const testData = [
  { name: "Test 1", output: "...", evaluationNotes: "..." },
  { name: "Test 2", output: "...", evaluationNotes: "..." },
  // ... more tests
];

// Evaluate all tests
const results = await evaluateTestOutputs(testData);

// Show console summary
displaySummary(results);

// Save reports
const paths = await generateAndSaveReports(results);
console.log('Reports:', paths);
```

### 3. Integration with Test Runner

#### Option A: Integration with sdk-integration.test.js

Add to your test file:

```javascript
const { evaluateTestOutputs } = require('./evaluation/evaluator');
const { generateAndSaveReports } = require('./evaluation/reporter');
const scenarios = require('./scenarios');

// After running all tests and capturing outputs
async function evaluateResults(capturedOutputs) {
  const testData = scenarios.map((scenario, i) => ({
    name: scenario.name,
    output: capturedOutputs[i] || '',
    evaluationNotes: scenario.evaluationNotes
  }));
  
  const results = await evaluateTestOutputs(testData);
  const reports = await generateAndSaveReports(results);
  
  console.log(`\n📊 Evaluation complete: ${reports.summary.passed}/${reports.summary.total} passed`);
  console.log(`📄 Report: ${reports.markdown}`);
  
  return results;
}
```

#### Option B: Standalone Test Runner

Create `tests/run-evaluated-tests.js`:

```javascript
const { SDKSessionManager } = require('./mcp-server/sdk-session-manager');
const scenarios = require('./scenarios');
const { evaluateTestOutputs } = require('./evaluation/evaluator');
const { generateAndSaveReports, displaySummary } = require('./evaluation/reporter');

async function runTests() {
  const sessionManager = new SDKSessionManager();
  const outputs = [];
  
  // Run each scenario
  for (const scenario of scenarios) {
    console.log(`Running: ${scenario.name}...`);
    
    let output = '';
    sessionManager.on('response', (content) => {
      output += content;
    });
    
    await sessionManager.sendMessage(scenario.prompt);
    outputs.push(output);
  }
  
  // Evaluate results
  const testData = scenarios.map((s, i) => ({
    name: s.name,
    output: outputs[i],
    evaluationNotes: s.evaluationNotes
  }));
  
  const results = await evaluateTestOutputs(testData);
  displaySummary(results);
  
  const reports = await generateAndSaveReports(results);
  console.log('Reports saved:', reports);
  
  return results;
}

runTests().catch(console.error);
```

## Example Report Format

### Console Output

```
========================================
           TEST SUMMARY
========================================
Total Tests:   8
Passed:        6 ✅
Failed:        1 ❌
Errors:        1 ⚠️
Pass Rate:     75.0%
========================================
```

### Markdown Report Structure

See `tests/evaluation/sample-report.md` for a complete example.

The report includes:
1. **Summary Table** - Overview statistics and pass rate
2. **Results Table** - Quick view of all test statuses and scores
3. **Detailed Results** - Per-test breakdown with:
   - Status and overall score
   - Component scores (functionality, visualization, formatting)
   - Detailed feedback from the judge
   - Error messages (if applicable)

### JSON Output Structure

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
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
      "feedback": "Excellent execution...",
      "breakdown": {
        "functionality": 9.0,
        "visualization": 8.5,
        "formatting": 8.0
      }
    }
  ]
}
```

## Dependencies and Requirements

### Required

1. **Node.js** - Built-in modules only (no npm install needed)
   - `child_process` - For spawning copilot CLI
   - `fs.promises` - For file operations
   - `path` - For path handling

2. **Copilot CLI** - Must be available in PATH
   ```bash
   which copilot  # Should return path to copilot binary
   ```

3. **Judge Skill** - Must be available
   ```bash
   copilot --skill judge-test-output "test prompt"
   ```

### Optional

- Custom output directory (defaults to `tests/output/`)
- Environment variables for configuration (future enhancement)

## Configuration

### Scoring Thresholds

Edit `tests/evaluation/criteria.js`:

```javascript
const PASS_THRESHOLD = 7.0;  // Change pass threshold

const SCORE_RANGES = {
  EXCELLENT: { min: 9.0, max: 10.0, label: "Excellent" },
  GOOD: { min: 7.0, max: 8.9, label: "Good" },
  FAIR: { min: 5.0, max: 6.9, label: "Fair" },
  POOR: { min: 0.0, max: 4.9, label: "Poor" }
};
```

### Component Weights

If using weighted scoring:

```javascript
const CRITERIA_WEIGHTS = {
  functionality: 0.4,      // 40%
  visualization: 0.3,      // 30%
  formatting: 0.2,         // 20%
  performance: 0.1         // 10%
};
```

## Troubleshooting

### Judge Skill Not Found

**Problem:** `copilot: command not found` or skill unavailable

**Solution:**
1. Verify copilot is installed: `which copilot`
2. Check PATH includes copilot location
3. Test judge skill manually: `copilot --skill judge-test-output "test"`

### JSON Parse Errors

**Problem:** "No valid JSON found in judge response"

**Solution:**
- Judge output includes non-JSON text (normal behavior)
- Framework extracts JSON using regex pattern
- Check judge skill output manually to verify format
- Ensure judge returns object with `"score"` field

### Evaluation Errors

**Problem:** Tests marked as `evaluation_error`

**Possible causes:**
- Empty test output
- Judge skill timeout or crash
- Invalid response format from judge

**Solution:**
- Check test output is captured correctly
- Verify judge skill is working: `copilot --skill judge-test-output "test message"`
- Review error messages in generated reports

### Permission Errors

**Problem:** Cannot write to output directory

**Solution:**
```bash
mkdir -p tests/output
chmod 755 tests/output
```

## Next Steps

1. **Run Quick Start**: `node tests/evaluation/quick-start.js`
2. **Review Sample Report**: `cat tests/evaluation/sample-report.md`
3. **Check Examples**: `node tests/evaluation/examples.js`
4. **Integrate with Your Tests**: Follow Option A or B above
5. **Customize Criteria**: Edit `criteria.js` for your needs

## API Reference

See `tests/evaluation/README.md` for complete API documentation.

## Examples

See `tests/evaluation/examples.js` for working code examples:
- Single evaluation
- Batch evaluation
- SDK integration
- Custom output directories
