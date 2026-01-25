# Comprehensive Test Suite - Quick Reference

## Run Tests

```bash
# Verify setup first
node tests/verify-setup.js

# Run all tests
npm run test:comprehensive

# Direct execution
node tests/comprehensive-test.js
```

## Expected Results

```
✅ 8 test scenarios executed
📊 Automated evaluation via judge skill
📄 Reports in tests/output/
   - test-results-*.json
   - test-report-*.md
```

## Pass Criteria

- **Pass threshold**: 7.0/10 per test
- **Success**: ≥80% pass rate (exit code 0)
- **Failure**: <80% pass rate (exit code 1)

## Test Scenarios

1. File Creation Test
2. Code Reading Test
3. Markdown Rendering Test
4. Code Fix Test
5. Plan Analysis Test
6. Mixed Content Test
7. Tool Chain Test
8. MCP Integration Test

## Output Example

```
🧪 TEST EXECUTION PHASE
Running 8 test scenarios...

[1/8] File Creation Test
✅ Completed in 2.34s
   Tools executed: 3
   🔧 create (0.45s)
   🔧 create (0.38s)
   🔧 create (0.41s)

📊 EVALUATION PHASE
Evaluating: File Creation Test... (Score: 9.2/10)

📄 FINAL SUMMARY
Total Tests:      8
Passed:           7 ✅
Failed:           1 ❌
Pass Rate:        87.5%
Average Score:    8.2/10
```

## Configuration

Edit `comprehensive-test.js`:

```javascript
const config = {
  model: 'claude-3-5-sonnet-20241022',
  yoloMode: true,
  allowAllTools: true
};
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "copilot command not found" | Install: `gh extension install github/gh-copilot` |
| "SDKSessionManager not found" | Run: `npm run compile` |
| "Judge skill failed" | Optional - tests will run without evaluation |
| Session hangs | Check: `copilot --version` works |

## Files

```
tests/
├── comprehensive-test.js      ← Main runner
├── verify-setup.js            ← Pre-flight check
├── COMPREHENSIVE-TEST.md      ← Full docs
├── PHASE-6-SUMMARY.md         ← Implementation details
└── output/                    ← Generated reports
```

## Documentation

- **Full guide**: `tests/COMPREHENSIVE-TEST.md`
- **Implementation**: `tests/PHASE-6-SUMMARY.md`
- **This reference**: `tests/QUICKREF-COMPREHENSIVE.md`

## Exit Codes

- `0` = Success (≥80% pass rate)
- `1` = Failure (<80% pass or error)

---

**Status**: ✅ Phase 6 Complete - Ready to Use
