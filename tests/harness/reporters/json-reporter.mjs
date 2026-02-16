/**
 * JSON Reporter
 *
 * Machine-readable JSON output for spike tool results.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Save a report to a JSON file.
 * @param {object} report
 * @param {string} outputDir
 * @returns {string} Path to saved file
 */
export function saveReport(report, outputDir) {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `spike-report-${Date.now()}.json`;
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    return filePath;
}

/**
 * Build a report object from test results.
 * @param {object[]} results - Array of test result objects
 * @param {{ sdkVersion: string }} context
 * @returns {object}
 */
export function buildReport(results, context = {}) {
    const completed = results.filter(r => r.status === 'completed');
    const failed = results.filter(r => r.status === 'failed');
    const batched = results.filter(r => r.streamingAnalysis?.isBatched);

    return {
        timestamp: new Date().toISOString(),
        sdkVersion: context.sdkVersion || 'unknown',
        totalTests: results.length,
        passed: completed.length - batched.length,
        failed: failed.length,
        batchedStreaming: batched.length,
        results: results.map(r => ({
            id: r.id,
            category: r.category,
            status: r.status,
            durationMs: r.durationMs,
            responseLength: r.responseLength,
            streamingAnalysis: r.streamingAnalysis,
            eventSummary: r.eventSummary,
            error: r.error,
        })),
    };
}
