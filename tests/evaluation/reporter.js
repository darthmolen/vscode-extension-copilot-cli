/**
 * Test Report Generator
 * 
 * Generates markdown and JSON reports from evaluation results
 * @module reporter
 */

const fs = require('fs').promises;
const path = require('path');
const { isPassing, interpretScore, getStatusEmoji } = require('./criteria');

/**
 * Generate a markdown test report
 * @param {Array<Object>} testResults - Array of test results with evaluations
 * @returns {string} - Formatted markdown report
 */
function generateReport(testResults) {
  const timestamp = new Date().toISOString();
  const totalTests = testResults.length;
  const passedTests = testResults.filter(r => r.status === 'pass').length;
  const failedTests = testResults.filter(r => r.status === 'fail').length;
  const errorTests = testResults.filter(r => r.status === 'evaluation_error').length;
  
  const scores = testResults
    .filter(r => r.status !== 'evaluation_error')
    .map(r => r.score);
  const averageScore = scores.length > 0 
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
    : 'N/A';

  let report = `# Test Evaluation Report

**Generated:** ${timestamp}

## Summary

| Metric | Value |
|--------|-------|
| Total Tests | ${totalTests} |
| Passed | ${passedTests} ✅ |
| Failed | ${failedTests} ❌ |
| Errors | ${errorTests} ⚠️ |
| Pass Rate | ${totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0}% |
| Average Score | ${averageScore}/10 |

`;

  // Overall status
  const overallStatus = passedTests === totalTests ? '✅ ALL TESTS PASSED' :
                       passedTests === 0 ? '❌ ALL TESTS FAILED' :
                       '⚠️ PARTIAL SUCCESS';
  
  report += `**Overall Status:** ${overallStatus}\n\n`;

  // Results table
  report += `## Test Results\n\n`;
  report += `| Test | Status | Score | Rating |\n`;
  report += `|------|--------|-------|--------|\n`;

  testResults.forEach(result => {
    const statusIcon = getStatusEmoji(result.score);
    const rating = interpretScore(result.score);
    const scoreDisplay = result.status === 'evaluation_error' ? 'N/A' : `${result.score.toFixed(1)}/10`;
    
    report += `| ${result.testName} | ${statusIcon} ${result.status} | ${scoreDisplay} | ${rating} |\n`;
  });

  // Detailed breakdown
  report += `\n## Detailed Results\n\n`;

  testResults.forEach((result, index) => {
    report += `### ${index + 1}. ${result.testName}\n\n`;
    report += `**Status:** ${getStatusEmoji(result.score)} ${result.status.toUpperCase()}\n\n`;
    
    if (result.status !== 'evaluation_error') {
      report += `**Score:** ${result.score.toFixed(1)}/10 (${interpretScore(result.score)})\n\n`;
      
      // Component breakdown if available
      if (result.breakdown && Object.keys(result.breakdown).length > 0) {
        report += `**Component Scores:**\n`;
        for (const [component, score] of Object.entries(result.breakdown)) {
          report += `- ${component.charAt(0).toUpperCase() + component.slice(1)}: ${score.toFixed(1)}/10\n`;
        }
        report += `\n`;
      }
      
      report += `**Feedback:**\n${result.feedback}\n\n`;
    } else {
      report += `**Error:** ${result.error}\n\n`;
    }
    
    report += `---\n\n`;
  });

  // Footer
  report += `## Notes\n\n`;
  report += `- Tests are evaluated using the judge skill\n`;
  report += `- Pass threshold: 7.0/10\n`;
  report += `- Scores range from 0 (complete failure) to 10 (perfect execution)\n`;

  return report;
}

/**
 * Save test results to JSON file
 * @param {Array<Object>} testResults - Test results to save
 * @param {string} outputDir - Directory to save results
 * @returns {Promise<string>} - Path to saved file
 */
async function saveResultsJSON(testResults, outputDir) {
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const filename = `test-results-${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  const output = {
    timestamp: new Date().toISOString(),
    summary: {
      total: testResults.length,
      passed: testResults.filter(r => r.status === 'pass').length,
      failed: testResults.filter(r => r.status === 'fail').length,
      errors: testResults.filter(r => r.status === 'evaluation_error').length
    },
    results: testResults
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(output, null, 2));

  return filepath;
}

/**
 * Save markdown report to file
 * @param {string} reportContent - Markdown report content
 * @param {string} outputDir - Directory to save report
 * @returns {Promise<string>} - Path to saved file
 */
async function saveReportMarkdown(reportContent, outputDir) {
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const filename = `test-report-${timestamp}.md`;
  const filepath = path.join(outputDir, filename);

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(filepath, reportContent);

  return filepath;
}

/**
 * Generate and save complete test report (both JSON and Markdown)
 * @param {Array<Object>} testResults - Test results to report on
 * @param {string} [outputDir] - Output directory (defaults to tests/output)
 * @returns {Promise<Object>} - Paths to saved files
 */
async function generateAndSaveReports(testResults, outputDir = null) {
  const baseDir = outputDir || path.join(__dirname, '..', 'output');

  // Generate markdown report
  const markdownReport = generateReport(testResults);

  // Save both formats
  const jsonPath = await saveResultsJSON(testResults, baseDir);
  const mdPath = await saveReportMarkdown(markdownReport, baseDir);

  return {
    json: jsonPath,
    markdown: mdPath,
    summary: {
      total: testResults.length,
      passed: testResults.filter(r => r.status === 'pass').length,
      failed: testResults.filter(r => r.status === 'fail').length,
      errors: testResults.filter(r => r.status === 'evaluation_error').length
    }
  };
}

/**
 * Display report summary to console
 * @param {Array<Object>} testResults - Test results to summarize
 */
function displaySummary(testResults) {
  const total = testResults.length;
  const passed = testResults.filter(r => r.status === 'pass').length;
  const failed = testResults.filter(r => r.status === 'fail').length;
  const errors = testResults.filter(r => r.status === 'evaluation_error').length;

  console.log('\n========================================');
  console.log('           TEST SUMMARY');
  console.log('========================================');
  console.log(`Total Tests:   ${total}`);
  console.log(`Passed:        ${passed} ✅`);
  console.log(`Failed:        ${failed} ❌`);
  console.log(`Errors:        ${errors} ⚠️`);
  console.log(`Pass Rate:     ${total > 0 ? ((passed / total) * 100).toFixed(1) : 0}%`);
  console.log('========================================\n');
}

module.exports = {
  generateReport,
  saveResultsJSON,
  saveReportMarkdown,
  generateAndSaveReports,
  displaySummary
};
