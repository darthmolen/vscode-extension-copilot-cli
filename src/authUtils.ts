/**
 * Authentication utility functions for Copilot CLI
 * 
 * These functions handle authentication error detection and environment variable checking.
 * Extracted from SDKSessionManager for testability.
 */

export type ErrorType = 'authentication' | 'session_expired' | 'session_not_ready' | 'network_timeout' | 'unknown';

export interface EnvVarCheckResult {
    hasEnvVar: boolean;
    source?: string;
}

/**
 * Circuit breaker state for session resume retries
 */
export interface CircuitBreakerState {
    attempts: number;
    maxAttempts: number;
    lastError: Error | null;
}

/**
 * Helper function to sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Classify error type based on error message patterns
 * 
 * This classification drives the circuit breaker retry logic:
 * - session_expired: Skip retries (session is gone, cannot recover)
 * - authentication: Fail fast (auth must be fixed externally)
 * - session_not_ready: Retry with backoff (CLI may be starting)
 * - network_timeout: Retry with backoff (transient network issue)
 * - unknown: Retry with backoff (cautious approach)
 * 
 * Pattern Priority Order (checked top to bottom):
 * 1. Session expired (most specific - includes 'session' keyword)
 * 2. Authentication errors (critical - requires user action)
 * 3. Client not ready (retriable - temporary state)
 * 4. Network timeouts (retriable - transient failures)
 * 5. Unknown (fallback - default to retry)
 * 
 * @param error - The error to classify
 * @returns ErrorType indicating the category of error
 */
export function classifySessionError(error: Error): ErrorType {
    const msg = error.message.toLowerCase();
    
    // 1. Session expired/not found patterns (check first - most specific)
    //    Session doesn't exist anymore or was deleted
    //    NOT retriable - session is permanently gone
    if ((msg.includes('not found') && msg.includes('session')) || 
        (msg.includes('invalid') && msg.includes('session')) ||
        msg.includes('session does not exist')) {
        return 'session_expired';
    }
    
    // 2. Authentication error patterns
    //    Based on SDK error messages when CLI is not authenticated
    //    NOT retriable - requires user to login via gh auth login
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
    //    RETRIABLE - CLI may still be starting up or connecting
    if (msg.includes('not connected') || 
        msg.includes('not ready')) {
        return 'session_not_ready';
    }
    
    // 4. Network error patterns  
    //    RETRIABLE - transient network issues, connection drops
    if (msg.includes('network') || 
        msg.includes('econnrefused') ||
        msg.includes('etimedout') ||
        msg.includes('enotfound') ||
        msg.includes('timeout')) {
        return 'network_timeout';
    }
    
    // 5. Unknown error type
    //    Default to retriable to avoid losing sessions prematurely
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

/**
 * Circuit breaker for session resume with retry logic
 * 
 * Implements smart retry with exponential backoff:
 * - Retries up to 3 times for retriable errors
 * - Skips retries for session_expired (session deleted)
 * - Fails fast for authentication errors
 * - Uses exponential backoff: 1s, 2s, 4s
 * 
 * @param sessionId - The session ID to resume
 * @param resumeFn - Function that attempts to resume the session
 * @param logger - Optional logger for debug output
 * @returns The resumed session
 * @throws Error if all retries fail or non-retriable error occurs
 */
export async function attemptSessionResumeWithRetry<T>(
    sessionId: string,
    resumeFn: () => Promise<T>,
    logger?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void }
): Promise<T> {
    const breaker: CircuitBreakerState = {
        attempts: 0,
        maxAttempts: 3,
        lastError: null
    };
    
    while (breaker.attempts < breaker.maxAttempts) {
        try {
            breaker.attempts++;
            logger?.info(`[Resume] Attempt ${breaker.attempts}/${breaker.maxAttempts} for session ${sessionId.substring(0, 8)}...`);
            
            const result = await resumeFn();
            logger?.info('[Resume] ✅ Success');
            return result;
            
        } catch (error) {
            breaker.lastError = error as Error;
            const errorType = classifySessionError(error as Error);
            
            logger?.warn(`[Resume] Attempt ${breaker.attempts} failed: ${errorType} - ${(error as Error).message}`);
            
            // Don't retry if session is expired - it's permanently gone
            if (errorType === 'session_expired') {
                logger?.info('[Resume] Session expired, no retries');
                throw error;
            }
            
            // Don't retry auth errors - requires external action
            if (errorType === 'authentication') {
                logger?.error('[Resume] Auth error, failing fast');
                throw error;
            }
            
            // For retriable errors, wait before retry (if not last attempt)
            if (breaker.attempts < breaker.maxAttempts) {
                // Exponential backoff: 2^(attempt-1) * 1000ms
                // attempt 1: 2^0 * 1000 = 1s
                // attempt 2: 2^1 * 1000 = 2s
                // attempt 3: would be 2^2 * 1000 = 4s, but we don't wait after last attempt
                const backoffMs = Math.pow(2, breaker.attempts - 1) * 1000;
                logger?.info(`[Resume] Waiting ${backoffMs}ms before retry...`);
                await sleep(backoffMs);
            } else {
                // Max attempts reached
                logger?.warn(`[Resume] All ${breaker.maxAttempts} attempts failed`);
                throw error;
            }
        }
    }
    
    // Should never reach here, but TypeScript needs this
    throw breaker.lastError || new Error('Resume failed after max attempts');
}
