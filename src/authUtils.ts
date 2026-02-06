/**
 * Authentication utility functions for Copilot CLI
 * 
 * These functions handle authentication error detection and environment variable checking.
 * Extracted from SDKSessionManager for testability.
 */

export type ErrorType = 'authentication' | 'session_expired' | 'network' | 'unknown';

export interface EnvVarCheckResult {
    hasEnvVar: boolean;
    source?: string;
}

/**
 * Classify error type based on error message patterns
 * Helps distinguish authentication errors from other failures
 * 
 * @param error - The error to classify
 * @returns ErrorType indicating the category of error
 */
export function classifySessionError(error: Error): ErrorType {
    const msg = error.message.toLowerCase();
    
    // Authentication error patterns
    // Based on SDK error messages when CLI is not authenticated
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
 * Returns info about which var is set (if any)
 * 
 * Priority order (per SDK docs):
 * 1. COPILOT_GITHUB_TOKEN (highest)
 * 2. GH_TOKEN
 * 3. GITHUB_TOKEN (lowest)
 * 
 * @returns Object with hasEnvVar flag and source variable name
 */
export function checkAuthEnvVars(): EnvVarCheckResult {
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
