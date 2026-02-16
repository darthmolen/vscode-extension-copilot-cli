/**
 * Console Reporter
 *
 * Human-readable terminal output for spike tool results.
 */

const ICONS = {
    info: '\u2139\uFE0F',
    success: '\u2705',
    error: '\u274C',
    warn: '\u26A0\uFE0F',
    debug: '\uD83D\uDD0D',
};

export function log(message, level = 'info') {
    const ts = new Date().toISOString().slice(11, 23);
    const icon = ICONS[level] || ICONS.info;
    console.log(`[${ts}] ${icon} ${message}`);
}

export function header(title) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  ${title}`);
    console.log('='.repeat(70));
}

export function subheader(title) {
    console.log(`\n--- ${title} ---`);
}

export function printTestStart(prompt) {
    header(`Test: ${prompt.id}`);
    log(`Category: ${prompt.category}`);
    log(`Timeout: ${prompt.timeout}ms`);
    log(`Prompt: ${prompt.prompt.slice(0, 100)}${prompt.prompt.length > 100 ? '...' : ''}`);
}

export function printTestResult(result) {
    if (result.status === 'completed') {
        log(`Completed in ${result.durationMs}ms`, 'success');
        log(`Response: ${result.responseLength} chars`);
    } else {
        log(`Failed: ${result.error}`, 'error');
    }
}

export function printStreamingAnalysis(analysis) {
    if (!analysis.valid) {
        log(`Streaming: ${analysis.reason}`, 'warn');
        return;
    }

    const level = analysis.isBatched ? 'error' : analysis.isSmooth ? 'success' : 'warn';
    subheader('Streaming Analysis');
    log(`Assessment: ${analysis.assessment}`, level);
    log(`Chunks: ${analysis.totalChunks}`);
    log(`Avg delta: ${analysis.avgDeltaMs}ms`);
    log(`Max delta: ${analysis.maxDeltaMs}ms`);
    log(`Large pauses (>5s): ${analysis.largePauses}`, analysis.largePauses > 0 ? 'warn' : 'info');
    log(`Quick bursts (<50ms): ${analysis.quickBursts}`);
}

export function printEventSummary(summary) {
    subheader('Event Summary');
    log(`Total events: ${summary.totalEvents}`);
    for (const [type, count] of Object.entries(summary.eventCounts)) {
        log(`  ${type}: ${count}`);
    }
    log(`Tool executions: ${summary.toolExecutions}`);
    log(`Response length: ${summary.responseLength} chars`);
}

export function printReport(report) {
    header('SPIKE REPORT');
    log(`SDK Version: ${report.sdkVersion}`);
    log(`Tests: ${report.totalTests}`);
    log(`Passed: ${report.passed}`, report.passed === report.totalTests ? 'success' : 'info');
    log(`Failed: ${report.failed}`, report.failed > 0 ? 'error' : 'info');
    if (report.batchedStreaming !== undefined) {
        log(`Batched streaming: ${report.batchedStreaming}`, report.batchedStreaming > 0 ? 'warn' : 'success');
    }
}
