/**
 * Test Output Evaluator
 * 
 * Invokes the judge skill to evaluate test outputs and returns structured scores
 * @module evaluator
 */

const { spawn } = require('child_process');
const path = require('path');

/**
 * @typedef {Object} EvaluationResult
 * @property {number} score - Overall score (0-10)
 * @property {string} status - 'pass', 'fail', or 'evaluation_error'
 * @property {string} feedback - Detailed feedback from judge
 * @property {Object} [breakdown] - Optional component scores
 * @property {string} [error] - Error message if evaluation failed
 */

/**
 * Invoke the judge skill via Copilot CLI
 * @param {string} testName - Name of the test scenario
 * @param {string} testOutput - The test output to evaluate
 * @param {string} expectedCriteria - Evaluation criteria/notes
 * @returns {Promise<Object>} - Raw judge response
 */
async function invokeJudgeSkill(testName, testOutput, expectedCriteria) {
  return new Promise((resolve, reject) => {
    // Prepare the prompt for the judge skill
    const judgePrompt = `
Evaluate this test output for the test: "${testName}"

Expected Criteria:
${expectedCriteria}

Test Output:
${testOutput}

Please provide a score from 0-10 and detailed feedback on:
- Whether expected functionality was demonstrated
- Quality of visualization and user feedback
- Response formatting and clarity
- Any issues or deficiencies

Return your evaluation as JSON with this structure:
{
  "score": <number 0-10>,
  "feedback": "<detailed feedback>",
  "breakdown": {
    "functionality": <0-10>,
    "visualization": <0-10>,
    "formatting": <0-10>
  }
}
`.trim();

    let stdout = '';
    let stderr = '';

    // Invoke copilot CLI with judge skill
    const copilot = spawn('copilot', ['--skill', 'judge-test-output', judgePrompt], {
      shell: true,
      env: { ...process.env }
    });

    copilot.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    copilot.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    copilot.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Judge skill invocation failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Try to extract JSON from the response
        const jsonMatch = stdout.match(/\{[\s\S]*"score"[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          resolve(result);
        } else {
          reject(new Error(`No valid JSON found in judge response: ${stdout}`));
        }
      } catch (error) {
        reject(new Error(`Failed to parse judge response: ${error.message}\nOutput: ${stdout}`));
      }
    });

    copilot.on('error', (error) => {
      reject(new Error(`Failed to spawn copilot process: ${error.message}`));
    });
  });
}

/**
 * Evaluate test output using the judge skill
 * @param {Object} testData - Test data to evaluate
 * @param {string} testData.name - Test name
 * @param {string} testData.output - Test output to evaluate
 * @param {string} testData.evaluationNotes - Expected criteria
 * @returns {Promise<EvaluationResult>} - Evaluation result with score and feedback
 */
async function evaluateTestOutput(testData) {
  try {
    const { name, output, evaluationNotes } = testData;

    if (!output || output.trim().length === 0) {
      return {
        score: 0,
        status: 'evaluation_error',
        feedback: 'No output to evaluate',
        error: 'Empty or missing test output'
      };
    }

    // Invoke the judge skill
    const judgeResult = await invokeJudgeSkill(name, output, evaluationNotes);

    // Validate the response
    if (typeof judgeResult.score !== 'number') {
      throw new Error('Invalid score in judge response');
    }

    // Normalize score to 0-10 range
    const normalizedScore = Math.max(0, Math.min(10, judgeResult.score));

    return {
      score: normalizedScore,
      status: normalizedScore >= 7.0 ? 'pass' : 'fail',
      feedback: judgeResult.feedback || 'No feedback provided',
      breakdown: judgeResult.breakdown || {}
    };

  } catch (error) {
    console.error(`Evaluation error for test "${testData.name}":`, error.message);
    
    return {
      score: 0,
      status: 'evaluation_error',
      feedback: 'Evaluation could not be completed',
      error: error.message
    };
  }
}

/**
 * Evaluate multiple test outputs in batch
 * @param {Array<Object>} testDataArray - Array of test data objects
 * @returns {Promise<Array<EvaluationResult>>} - Array of evaluation results
 */
async function evaluateTestOutputs(testDataArray) {
  const results = [];
  
  for (const testData of testDataArray) {
    console.log(`Evaluating: ${testData.name}...`);
    const result = await evaluateTestOutput(testData);
    results.push({
      testName: testData.name,
      ...result
    });
  }
  
  return results;
}

module.exports = {
  evaluateTestOutput,
  evaluateTestOutputs
};
