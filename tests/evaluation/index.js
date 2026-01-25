/**
 * Evaluation Framework - Main Entry Point
 * 
 * Phase 5: Automated test evaluation using judge skill
 * 
 * @module evaluation
 */

// Core evaluation functions
const { evaluateTestOutput, evaluateTestOutputs } = require('./evaluator');

// Reporting functions
const { 
  generateReport, 
  generateAndSaveReports,
  displaySummary,
  saveResultsJSON,
  saveReportMarkdown
} = require('./reporter');

// Criteria and utilities
const {
  PASS_THRESHOLD,
  SCORE_RANGES,
  CRITERIA_WEIGHTS,
  interpretScore,
  isPassing,
  calculateWeightedScore,
  getStatusEmoji
} = require('./criteria');

/**
 * Main evaluation pipeline - one-stop function
 * 
 * @param {Array<Object>} testData - Array of test outputs to evaluate
 * @param {Object} options - Configuration options
 * @param {string} [options.outputDir] - Custom output directory
 * @param {boolean} [options.showSummary=true] - Display console summary
 * @param {boolean} [options.saveReports=true] - Save report files
 * @returns {Promise<Object>} - Evaluation results and report paths
 * 
 * @example
 * const results = await evaluatePipeline([
 *   { name: "Test 1", output: "...", evaluationNotes: "..." },
 *   { name: "Test 2", output: "...", evaluationNotes: "..." }
 * ]);
 * console.log(`Pass rate: ${results.summary.passRate}%`);
 * console.log(`Reports: ${results.reportPaths.markdown}`);
 */
async function evaluatePipeline(testData, options = {}) {
  const {
    outputDir = null,
    showSummary = true,
    saveReports = true
  } = options;

  // Evaluate all tests
  console.log(`\n🔍 Evaluating ${testData.length} test(s)...\n`);
  const results = await evaluateTestOutputs(testData);

  // Display summary if requested
  if (showSummary) {
    displaySummary(results);
  }

  let reportPaths = null;
  
  // Save reports if requested
  if (saveReports) {
    console.log('💾 Saving reports...');
    reportPaths = await generateAndSaveReports(results, outputDir);
    console.log(`✅ Reports saved to:`);
    console.log(`   JSON: ${reportPaths.json}`);
    console.log(`   Markdown: ${reportPaths.markdown}\n`);
  }

  // Calculate pass rate
  const passRate = results.length > 0 
    ? ((reportPaths?.summary.passed || 0) / results.length * 100).toFixed(1)
    : 0;

  return {
    results,
    summary: {
      ...(reportPaths?.summary || {}),
      passRate: parseFloat(passRate)
    },
    reportPaths
  };
}

module.exports = {
  // Main pipeline
  evaluatePipeline,
  
  // Core functions
  evaluateTestOutput,
  evaluateTestOutputs,
  
  // Reporting
  generateReport,
  generateAndSaveReports,
  displaySummary,
  saveResultsJSON,
  saveReportMarkdown,
  
  // Criteria
  PASS_THRESHOLD,
  SCORE_RANGES,
  CRITERIA_WEIGHTS,
  interpretScore,
  isPassing,
  calculateWeightedScore,
  getStatusEmoji
};
