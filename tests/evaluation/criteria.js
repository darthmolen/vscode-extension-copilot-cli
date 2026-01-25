/**
 * Evaluation Criteria and Scoring Thresholds
 * 
 * Defines constants and utilities for interpreting test evaluation scores
 * @module criteria
 */

/**
 * Minimum score required for a test to pass (out of 10)
 */
const PASS_THRESHOLD = 7.0;

/**
 * Score interpretation ranges
 */
const SCORE_RANGES = {
  EXCELLENT: { min: 9.0, max: 10.0, label: "Excellent" },
  GOOD: { min: 7.0, max: 8.9, label: "Good" },
  FAIR: { min: 5.0, max: 6.9, label: "Fair" },
  POOR: { min: 0.0, max: 4.9, label: "Poor" }
};

/**
 * Evaluation criteria weights (for weighted scoring if needed)
 */
const CRITERIA_WEIGHTS = {
  functionality: 0.4,      // Core functionality works correctly
  visualization: 0.3,      // Tool execution indicators and UI feedback
  formatting: 0.2,         // Response formatting and readability
  performance: 0.1         // Execution time and responsiveness
};

/**
 * Get interpretation label for a score
 * @param {number} score - The score to interpret (0-10)
 * @returns {string} - Interpretation label
 */
function interpretScore(score) {
  for (const range of Object.values(SCORE_RANGES)) {
    if (score >= range.min && score <= range.max) {
      return range.label;
    }
  }
  return "Unknown";
}

/**
 * Check if a score passes the threshold
 * @param {number} score - The score to check
 * @returns {boolean} - True if score meets or exceeds threshold
 */
function isPassing(score) {
  return score >= PASS_THRESHOLD;
}

/**
 * Calculate weighted score from component scores
 * @param {Object} scores - Component scores object
 * @param {number} scores.functionality - Functionality score
 * @param {number} scores.visualization - Visualization score
 * @param {number} scores.formatting - Formatting score
 * @param {number} scores.performance - Performance score
 * @returns {number} - Weighted overall score
 */
function calculateWeightedScore(scores) {
  return (
    (scores.functionality || 0) * CRITERIA_WEIGHTS.functionality +
    (scores.visualization || 0) * CRITERIA_WEIGHTS.visualization +
    (scores.formatting || 0) * CRITERIA_WEIGHTS.formatting +
    (scores.performance || 0) * CRITERIA_WEIGHTS.performance
  );
}

/**
 * Get status emoji for a score
 * @param {number} score - The score
 * @returns {string} - Emoji representing status
 */
function getStatusEmoji(score) {
  if (score >= 9.0) return "✅";
  if (score >= 7.0) return "✔️";
  if (score >= 5.0) return "⚠️";
  return "❌";
}

module.exports = {
  PASS_THRESHOLD,
  SCORE_RANGES,
  CRITERIA_WEIGHTS,
  interpretScore,
  isPassing,
  calculateWeightedScore,
  getStatusEmoji
};
