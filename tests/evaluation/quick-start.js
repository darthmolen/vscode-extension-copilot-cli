#!/usr/bin/env node

/**
 * Quick Start Script for Evaluation Framework
 * 
 * Demonstrates basic usage with mock data
 */

const { evaluateTestOutputs } = require('./evaluator');
const { generateAndSaveReports, displaySummary } = require('./reporter');

// Mock test data (replace with actual test outputs)
const mockTestData = [
  {
    name: "File Creation Test",
    output: `
🔧 Tool: create
📄 Path: hello.txt
⏱️ Duration: 45ms

🔧 Tool: create
📄 Path: world.txt
⏱️ Duration: 38ms

🔧 Tool: create
📄 Path: test.txt
⏱️ Duration: 42ms

✅ I've successfully created all three files:
- hello.txt with content "Hello"
- world.txt with content "World"  
- test.txt with content "Test"
    `.trim(),
    evaluationNotes: "Verify: (1) Three separate tool execution indicators appear, (2) Each shows the file path being created, (3) Response confirms successful creation, (4) Execution time is displayed"
  },
  
  {
    name: "Code Reading Test",
    output: `
🔧 Tool: view
📄 Path: tests/fixtures/sample.py
⏱️ Duration: 28ms

This file implements a simple calculator module with three core functions (add, subtract, multiply) that perform basic arithmetic operations. It includes input validation and proper error handling for edge cases.
    `.trim(),
    evaluationNotes: "Verify: (1) Tool indicator shows 'view' operation, (2) Response contains concise explanation, (3) Explanation references specific functions/features from the file, (4) Response is properly formatted"
  }
];

async function quickStart() {
  console.log('🚀 Evaluation Framework - Quick Start\n');
  console.log('Evaluating test outputs...\n');

  try {
    // Evaluate the test outputs
    const results = await evaluateTestOutputs(mockTestData);
    
    // Display console summary
    displaySummary(results);
    
    // Generate and save reports
    console.log('📝 Generating reports...\n');
    const reportPaths = await generateAndSaveReports(results);
    
    console.log('✅ Reports saved successfully!\n');
    console.log('📊 JSON Report:', reportPaths.json);
    console.log('📄 Markdown Report:', reportPaths.markdown);
    console.log('\n📈 Summary:', reportPaths.summary);
    
    console.log('\n✨ Done! Check the output files for detailed results.\n');
    
  } catch (error) {
    console.error('❌ Error during evaluation:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  quickStart().catch(console.error);
}

module.exports = { quickStart };
