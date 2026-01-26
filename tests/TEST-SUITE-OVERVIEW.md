# Test Suite Architecture Overview

This document provides a high-level overview of the comprehensive test suite architecture for the VS Code Copilot CLI Extension.

## Table of Contents

- [Architecture Diagram](#architecture-diagram)
- [Component Responsibilities](#component-responsibilities)
- [Data Flow](#data-flow)
- [Extending the Test Suite](#extending-the-test-suite)
- [Best Practices](#best-practices)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          TEST ORCHESTRATOR                          │
│                    (comprehensive-test.js)                          │
└────────────┬────────────────────────────────────────────┬───────────┘
             │                                            │
             │ Setup Phase                                │ Execution Phase
             ▼                                            ▼
    ┌────────────────┐                          ┌──────────────────┐
    │  Verification  │                          │    Scenarios     │
    │ verify-setup.js│                          │  scenarios.js    │
    └────────────────┘                          └────────┬─────────┘
             │                                           │
             │ Validates:                                │ Defines:
             │ • Copilot CLI                             │ • Test prompts
             │ • Extension build                         │ • Expected tools
             │ • MCP server                              │ • Success criteria
             │ • Output directory                        │
             │                                           │
             ▼                                           ▼
    ┌────────────────────────────────────────────────────────────────┐
    │                    SDK SESSION MANAGER                          │
    │              (src/sdk/SDKSessionManager.ts)                    │
    └────────────┬───────────────────────────────────────────────────┘
                 │
                 │ Manages:
                 │ • Copilot CLI process
                 │ • Event streaming
                 │ • Tool execution tracking
                 │
                 ▼
    ┌────────────────────────────────────────────────────────────────┐
    │                    COPILOT CLI + SDK                            │
    │         (GitHub Copilot with MCP Server integration)            │
    └────────────┬───────────────────────────────────────────────────┘
                 │
                 │ Executes:
                 │ • Built-in tools (view, create, edit, bash, etc.)
                 │ • MCP tools (via test MCP server)
                 │
                 ▼
    ┌─────────────────────┬──────────────────┬──────────────────────┐
    │                     │                  │                      │
    │   Test Fixtures     │   MCP Server     │   Event Capture      │
    │  fixtures/*.{py,    │  mcp-server/     │  (tool_start,        │
    │   md,cs}            │  server.js       │   tool_complete,     │
    │                     │  tools.json      │   message, status)   │
    └─────────────────────┴──────────────────┴──────────┬───────────┘
                                                         │
                                                         ▼
    ┌────────────────────────────────────────────────────────────────┐
    │                   EVALUATION FRAMEWORK                          │
    │                    (evaluation/)                                │
    └────────────┬───────────────────────────────────────────────────┘
                 │
                 │ Components:
                 │
    ┌────────────┼────────────┬──────────────┬──────────────────────┐
    │            │            │              │                      │
    │  Evaluator │  Criteria  │  Judge Skill │     Reporter         │
    │ evaluator. │ criteria.  │ (copilot     │   reporter.js        │
    │ js         │ js         │  --skill     │                      │
    │            │            │  judge)      │                      │
    │ Coordinates│ Defines:   │ Provides:    │ Generates:           │
    │ evaluation │ • Quality  │ • Automated  │ • JSON results       │
    │ process    │   metrics  │   scoring    │ • Markdown reports   │
    │            │ • Success  │ • Component  │ • Summary stats      │
    │            │   thresholds│  analysis   │                      │
    └────────────┴────────────┴──────────────┴──────────┬───────────┘
                                                         │
                                                         ▼
    ┌────────────────────────────────────────────────────────────────┐
    │                      TEST REPORTS                               │
    │                     (output/)                                   │
    │                                                                 │
    │  • test-results-YYYYMMDD-HHMMSS.json  (raw data)               │
    │  • test-report-YYYYMMDD-HHMMSS.md     (readable report)        │
    └─────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

### 1. Test Orchestrator (`comprehensive-test.js`)

**Purpose**: Main entry point that coordinates the entire test execution.

**Responsibilities**:
- Initialize SDK Session Manager
- Load test scenarios
- Execute each scenario in sequence
- Capture events and responses
- Invoke evaluation framework
- Generate final reports

**Key Functions**:
```javascript
async function main() {
  // Setup phase
  await setupOutputDirectory();
  await initializeSDKSession();
  
  // Execution phase
  for (scenario of scenarios) {
    const result = await runScenario(scenario);
    results.push(result);
  }
  
  // Evaluation phase
  const evaluated = await evaluateResults(results);
  
  // Reporting phase
  await generateReports(evaluated);
}
```

### 2. Scenarios (`scenarios.js`)

**Purpose**: Define test cases with expected behavior.

**Structure**:
```javascript
{
  name: "Test Name",           // Display name
  description: "What it tests", // Purpose
  prompt: "User prompt",        // Input to agent
  expectedTools: ["tool1"],     // Tools that should execute
  evaluationNotes: "Criteria"   // What makes it successful
}
```

**Current Scenarios**: 8 scenarios covering file ops, markdown, code analysis, MCP integration.

### 3. SDK Session Manager (`src/sdk/SDKSessionManager.ts`)

**Purpose**: Bridge between tests and Copilot CLI.

**Responsibilities**:
- Start/stop Copilot CLI process
- Stream events (tool_start, tool_complete, message, status)
- Handle tool execution tracking
- Manage session lifecycle

**Event Types**:
- `status` - Session state changes
- `tool_start` - Tool execution begins
- `tool_complete` - Tool execution ends (with duration)
- `message` - Agent response content
- `error` - Error conditions

### 4. MCP Server (`mcp-server/`)

**Purpose**: Provide mock Model Context Protocol tools for testing.

**Components**:
- `server.js` - MCP server implementation (stdio protocol)
- `tools.json` - Tool definitions and schemas

**Test Tools**:
```json
{
  "get_test_data": "Returns mock data by key",
  "validate_format": "Validates JSON structure",
  "process_list": "Processes lists with operations"
}
```

### 5. Test Fixtures (`fixtures/`)

**Purpose**: Sample files for read/analyze scenarios.

**Files**:
- `sample.py` - Python code with functions
- `content.md` - Markdown with tables
- `BrokenClass.cs` - C# with intentional bugs
- `implementation-plan.md` - Project planning document

### 6. Evaluation Framework (`evaluation/`)

**Purpose**: Automated quality assessment of test results.

**Components**:

#### `evaluator.js`
- Coordinates evaluation process
- Calls judge skill for scoring
- Aggregates results

#### `criteria.js`
- Defines quality metrics
- Tool execution accuracy
- Response completeness
- Formatting quality

#### `reporter.js`
- Generates JSON output (machine-readable)
- Generates Markdown reports (human-readable)
- Calculates statistics

#### Judge Skill Integration
- Uses `copilot --skill judge-test-output`
- Provides 0-10 quality score
- Component-level feedback
- Improvement recommendations

### 7. Verification (`verify-setup.js`)

**Purpose**: Pre-flight checks before running tests.

**Validates**:
- ✅ Copilot CLI installed and accessible
- ✅ Extension compiled (`dist/extension.js` exists)
- ✅ MCP server can start
- ✅ Test fixtures present
- ✅ Output directory exists

---

## Data Flow

### Execution Flow

```
1. SETUP
   ├─ verify-setup validates environment
   ├─ comprehensive-test loads scenarios
   └─ SDK Session Manager starts Copilot CLI

2. EXECUTION (for each scenario)
   ├─ Send prompt to Copilot
   ├─ Capture events:
   │  ├─ tool_start → Record tool name, timestamp
   │  ├─ tool_complete → Record duration
   │  ├─ message → Capture response content
   │  └─ status → Track session state
   └─ Store raw result

3. EVALUATION
   ├─ For each result:
   │  ├─ Compare actual tools vs expected tools
   │  ├─ Call judge skill with:
   │  │  ├─ Scenario description
   │  │  ├─ Response content
   │  │  ├─ Evaluation criteria
   │  │  └─ Tool execution data
   │  └─ Receive quality score + feedback
   └─ Aggregate all evaluations

4. REPORTING
   ├─ Generate JSON report (test-results-*.json)
   │  ├─ Raw test data
   │  ├─ Evaluation scores
   │  └─ Full event logs
   └─ Generate Markdown report (test-report-*.md)
      ├─ Executive summary
      ├─ Per-scenario breakdowns
      ├─ Quality scores and feedback
      └─ Recommendations
```

### Event Capture Flow

```
Copilot CLI Process
    │
    │ (stdio stream)
    ▼
SDK Session Manager
    │
    │ (event emitters)
    ▼
Event Handlers in comprehensive-test.js
    │
    ├─ tool_start → tools.push({ name, startTime })
    ├─ tool_complete → tools[i].duration = time
    ├─ message → responseContent += chunk
    └─ status → Update state
    │
    ▼
Test Result Object
    {
      scenario: {...},
      tools: [...],
      responseContent: "...",
      duration: 12.5,
      timestamp: "..."
    }
    │
    ▼
Evaluation Framework
```

---

## Extending the Test Suite

### Adding a New Test Scenario

**Step 1**: Add to `scenarios.js`

```javascript
{
  name: "Database Query Test",
  description: "Tests database interaction via MCP tool",
  prompt: "Query the test database for user records with id > 100",
  expectedTools: ["db_query"],
  evaluationNotes: "Verify: (1) Correct SQL generated, (2) Results displayed in table format, (3) Error handling for invalid queries"
}
```

**Step 2**: Add fixtures if needed

```bash
# Create test data file
echo '{"users": [...]}' > tests/fixtures/test-db.json
```

**Step 3**: Run the test

```bash
npm run test:comprehensive
```

The new scenario automatically integrates with the existing framework.

### Adding a New MCP Tool

**Step 1**: Define in `mcp-server/tools.json`

```json
{
  "name": "db_query",
  "description": "Execute SQL queries on test database",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sql": { "type": "string", "description": "SQL query" }
    },
    "required": ["sql"]
  }
}
```

**Step 2**: Implement in `mcp-server/server.js`

```javascript
case 'db_query':
  const { sql } = args;
  // Execute query logic
  return {
    content: [{
      type: "text",
      text: JSON.stringify(results, null, 2)
    }]
  };
```

**Step 3**: Use in scenario (see above)

### Adding Custom Evaluation Criteria

**Step 1**: Add to `evaluation/criteria.js`

```javascript
module.exports = {
  // Existing criteria...
  
  databaseInteraction: {
    weight: 1.0,
    description: "Database queries are correct and safe",
    checks: [
      "SQL syntax is valid",
      "No SQL injection vulnerabilities",
      "Results formatted clearly"
    ]
  }
};
```

**Step 2**: Reference in scenario's `evaluationNotes`

### Creating Custom Report Formats

**Step 1**: Extend `evaluation/reporter.js`

```javascript
function generateCustomReport(results) {
  // Your custom format
  return customFormatted;
}

module.exports = {
  generateJSONReport,
  generateMarkdownReport,
  generateCustomReport  // Add new export
};
```

**Step 2**: Call from `comprehensive-test.js`

```javascript
const customReport = reporter.generateCustomReport(evaluatedResults);
fs.writeFileSync('output/custom-report.html', customReport);
```

---

## Best Practices

### Test Design

**DO**:
- ✅ Keep scenarios focused on one capability
- ✅ Use descriptive names and clear evaluation notes
- ✅ Include both positive and edge case scenarios
- ✅ Test tool chains (multiple tools in sequence)
- ✅ Validate both tool execution AND response quality

**DON'T**:
- ❌ Mix multiple unrelated capabilities in one scenario
- ❌ Use vague evaluation criteria
- ❌ Skip expected tools (always list them)
- ❌ Assume MCP server is running (it auto-starts)

### Fixture Management

**DO**:
- ✅ Use realistic sample data
- ✅ Include intentional bugs/issues in test fixtures (for bug detection tests)
- ✅ Keep fixtures small and focused
- ✅ Document what each fixture tests

**DON'T**:
- ❌ Use production data
- ❌ Create huge fixtures (slows tests)
- ❌ Modify fixtures between test runs

### Evaluation

**DO**:
- ✅ Provide detailed evaluation notes for each scenario
- ✅ Check both tool execution and response content
- ✅ Use the judge skill for consistent scoring
- ✅ Review failed scenarios to improve prompts

**DON'T**:
- ❌ Rely solely on automated scores (review reports)
- ❌ Ignore tool execution mismatches
- ❌ Skip verification of edge cases

### Troubleshooting

**When tests fail**:

1. **Check setup first**:
   ```bash
   npm run test:verify
   ```

2. **Review the specific scenario**:
   - Open `tests/output/test-report-*.md`
   - Find the failed scenario
   - Check tool execution vs expected tools
   - Read judge feedback

3. **Debug MCP tools**:
   ```bash
   # Run MCP server standalone
   node tests/mcp-server/server.js
   # Send test request via stdin
   ```

4. **Enable verbose logging**:
   ```javascript
   // In comprehensive-test.js
   const DEBUG = true;
   ```

### CI/CD Integration

**Recommended workflow**:

```yaml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Build extension
        run: npm run compile
      
      - name: Verify setup
        run: npm run test:verify
      
      - name: Run comprehensive tests
        run: npm run test:comprehensive
      
      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-reports
          path: tests/output/*.md
      
      - name: Check test results
        run: |
          # Parse JSON results for pass/fail
          node -e "
            const results = require('./tests/output/test-results-latest.json');
            const avgScore = results.overallScore;
            if (avgScore < 7.0) {
              console.error('Tests failed: average score below threshold');
              process.exit(1);
            }
          "
```

### Performance Optimization

**For faster test execution**:

1. **Parallel execution** (future enhancement):
   ```javascript
   // Run independent scenarios in parallel
   await Promise.all(scenarios.map(runScenario));
   ```

2. **Selective testing**:
   ```bash
   # Run specific scenario
   node tests/comprehensive-test.js --scenario "File Creation"
   ```

3. **Cache fixtures**:
   - MCP server responses can be cached
   - Reduces network/processing overhead

### Security Considerations

**When adding MCP tools**:
- ⚠️ Never expose real credentials or APIs
- ⚠️ Validate all inputs in MCP tools
- ⚠️ Keep test MCP server isolated (stdio only, no network)
- ⚠️ Review MCP tool implementations for injection vulnerabilities

**When using fixtures**:
- ⚠️ No sensitive data in fixtures (they're committed to git)
- ⚠️ Use synthetic/mock data only
- ⚠️ Sanitize any real data before adding to fixtures

---

## Related Documentation

- **[README.md](./README.md)** - Quick start and usage guide
- **[COMPREHENSIVE-TEST.md](./COMPREHENSIVE-TEST.md)** - Detailed test suite documentation
- **[evaluation/README.md](./evaluation/README.md)** - Evaluation framework details
- **[QUICKREF-COMPREHENSIVE.md](./QUICKREF-COMPREHENSIVE.md)** - Command reference

---

## Questions or Issues?

If you encounter issues:

1. Check [Troubleshooting](./README.md#troubleshooting) section
2. Run `npm run test:verify` to validate setup
3. Review test reports in `tests/output/`
4. Check MCP server logs if MCP tests fail
5. Open an issue with:
   - Test command used
   - Error output
   - Test report (if generated)

---

**Last Updated**: Phase 7 - Final Documentation
