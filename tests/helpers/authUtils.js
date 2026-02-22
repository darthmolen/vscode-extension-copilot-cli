/**
 * Authentication utility functions for Copilot CLI
 * CommonJS version for mocha test compatibility
 */

/**
 * Classify error type based on error message patterns
 */
function classifySessionError(error) {
    const msg = error.message.toLowerCase();

    // Authentication error patterns
    if (msg.includes('auth') ||
        msg.includes('unauthorized') ||
        msg.includes('not authenticated') ||
        msg.includes('authentication') ||
        msg.includes('login required') ||
        msg.includes('not logged in') ||
        msg.includes('invalid token') ||
        msg.includes('expired token') ||
        msg.includes('403') ||
        msg.includes('401')) {
        return 'authentication';
    }

    // Session expired/not found patterns
    if (msg.includes('session not found') ||
        msg.includes('expired') ||
        msg.includes('invalid session')) {
        return 'session_expired';
    }

    // CLI version mismatch patterns
    if (msg.includes('copilot cli v') && msg.includes('not compatible')) {
        return 'cli_version';
    }

    // Network error patterns
    if (msg.includes('network') ||
        msg.includes('econnrefused') ||
        msg.includes('enotfound') ||
        msg.includes('timeout')) {
        return 'network';
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
