/**
 * Session error utility functions for Copilot CLI
 * CommonJS version for mocha test compatibility
 *
 * IMPORTANT: This must mirror src/sessionErrorUtils.ts exactly.
 * Same order, same patterns, same return values.
 */

/**
 * Classify error type based on error message patterns
 */
function classifySessionError(error) {
    const msg = error.message.toLowerCase();

    // 0. CLI version mismatch (check first - fail fast)
    if (msg.includes('copilot cli v') && msg.includes('not compatible')) {
        return 'cli_version';
    }

    // 1. Session expired/not found patterns
    if ((msg.includes('not found') && msg.includes('session')) ||
        (msg.includes('invalid') && msg.includes('session')) ||
        msg.includes('session does not exist') ||
        (msg.includes('session') && (msg.includes('expired') || msg.includes('deleted')))) {
        return 'session_expired';
    }

    // 2. Authentication error patterns
    if (msg.includes('auth') ||
        msg.includes('unauthorized') ||
        msg.includes('not authenticated') ||
        msg.includes('authentication') ||
        msg.includes('login required') ||
        msg.includes('not logged in') ||
        msg.includes('token') ||
        msg.includes('403') ||
        msg.includes('401')) {
        return 'authentication';
    }

    // 3. Client not ready patterns
    if (msg.includes('not connected') ||
        msg.includes('not ready')) {
        return 'session_not_ready';
    }

    // 3b. Connection closed / transport dead patterns
    if (msg.includes('connection is closed') ||
        msg.includes('connection is disposed') ||
        msg.includes('transport closed') ||
        msg.includes('write after end') ||
        msg.includes('socket hang up')) {
        return 'connection_closed';
    }

    // 4. Network error patterns
    if (msg.includes('network') ||
        msg.includes('econnrefused') ||
        msg.includes('etimedout') ||
        msg.includes('enotfound') ||
        msg.includes('timeout')) {
        return 'network_timeout';
    }

    return 'unknown';
}

/**
 * Check if authentication environment variables are set
 */
function checkAuthEnvVars() {
    // Check in priority order (per SDK docs)
    if (process.env.COPILOT_GITHUB_TOKEN) {
        return { hasEnvVar: true, source: 'COPILOT_GITHUB_TOKEN' };
    }
    if (process.env.GH_TOKEN) {
        return { hasEnvVar: true, source: 'GH_TOKEN' };
    }
    if (process.env.GITHUB_TOKEN) {
        return { hasEnvVar: true, source: 'GITHUB_TOKEN' };
    }

    return { hasEnvVar: false };
}

module.exports = { classifySessionError, checkAuthEnvVars };
