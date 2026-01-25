/**
 * Example: How to use the Evaluation Framework
 * 
 * This file demonstrates how to integrate the evaluation framework
 * with your test scenarios and SDK session outputs.
 */

const { evaluateTestOutput, evaluateTestOutputs } = require('./evaluator');
const { generateAndSaveReports, displaySummary } = require('./reporter');
const scenarios = require('../scenarios');

// ============================================
// EXAMPLE 1: Evaluate a single test output
// ============================================

async function exampleSingleEvaluation() {
  const testData = {
    name: "File Creation Test",
    output: `
Tool execution: create (hello.txt) - 45ms
Tool execution: create (world.txt) - 38ms  
Tool execution: create (test.txt) - 42ms

I've successfully created all three files:
- hello.txt with content "Hello"
- world.txt with content "World"
- test.txt with content "Test"

All files have been created in the current directory.
    `.trim(),
    evaluationNotes: "Verify: (1) Three separate tool execution indicators appear, (2) Each shows the file path being created, (3) Response confirms successful creation, (4) Execution time is displayed"
  };

  const result = await evaluateTestOutput(testData);
  
  console.log('Score:', result.score);
  console.log('Status:', result.status);
  console.log('Feedback:', result.feedback);
  console.log('Breakdown:', result.breakdown);
}

// ============================================
// EXAMPLE 2: Evaluate multiple test outputs
// ============================================

async function exampleBatchEvaluation() {
  // Simulate test outputs for multiple scenarios
  const testOutputs = [
    {
      name: scenarios[0].name,
      output: "Tool: create (file1.txt) 45ms\nTool: create (file2.txt) 38ms\nFiles created successfully.",
      evaluationNotes: scenarios[0].evaluationNotes
    },
    {
      name: scenarios[1].name,
      output: "Tool: view (sample.py)\n\nThis file implements a simple calculator with add, subtract, multiply functions.",
      evaluationNotes: scenarios[1].evaluationNotes
    },
    {
      name: scenarios[2].name,
      output: "Tool: view (content.md)\n\n| Language | Year |\n|----------|------|\n| Python | 1991 |\n\nThis document demonstrates markdown tables.",
      evaluationNotes: scenarios[2].evaluationNotes
    }
  ];

  const results = await evaluateTestOutputs(testOutputs);
  
  // Display console summary
  displaySummary(results);
  
  // Generate and save reports
  const reportPaths = await generateAndSaveReports(results);
  
  console.log('Reports saved:');
  console.log('JSON:', reportPaths.json);
  console.log('Markdown:', reportPaths.markdown);
  
  return results;
}

// ============================================
// EXAMPLE 3: Integration with SDK Session
// ============================================

async function exampleSDKIntegration() {
  // This shows how to use with SDKSessionManager outputs
  
  const capturedOutputs = []; // This would be populated by your test runner
  
  // Assuming you've captured outputs from SDKSessionManager like:
  // sessionManager.on('response', (content) => { capturedOutputs.push(content) })
  
  scenarios.forEach((scenario, index) => {
    // Match scenario with captured output
    capturedOutputs.push({
      name: scenario.name,
      output: `[Captured output from test run would go here]`,
      evaluationNotes: scenario.evaluationNotes
    });
  });
  
  // Evaluate all
  const results = await evaluateTestOutputs(capturedOutputs);
  
  // Save reports
  await generateAndSaveReports(results);
  
  return results;
}

// ============================================
// EXAMPLE 4: Custom output directory
// ============================================

async function exampleCustomOutput() {
  const testData = [{
    name: "Custom Test",
    output: "Test output here",
    evaluationNotes: "Should work correctly"
  }];
  
  const results = await evaluateTestOutputs(testData);
  
  // Save to custom directory
  const customDir = '/path/to/custom/output';
  const reportPaths = await generateAndSaveReports(results, customDir);
  
  console.log('Saved to:', reportPaths);
}

// ============================================
// Run examples (uncomment to test)
// ============================================

if (require.main === module) {
  (async () => {
    console.log('Running evaluation framework examples...\n');
    
    // Uncomment the example you want to run:
    // await exampleSingleEvaluation();
    await exampleBatchEvaluation();
    // await exampleSDKIntegration();
  })().catch(console.error);
}

module.exports = {
  exampleSingleEvaluation,
  exampleBatchEvaluation,
  exampleSDKIntegration,
  exampleCustomOutput
};
