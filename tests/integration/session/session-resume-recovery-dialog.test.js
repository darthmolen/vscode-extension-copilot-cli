/**
 * Tests for session resume recovery dialog
 *
 * TDD Phase 3: User Recovery Dialog
 * Tests the user-facing dialog that appears when retries fail
 */

const assert = require('assert');

// Simple mock function helper to replace node:test mock
function createMockFn(impl) {
    const calls = [];
    const fn = function (...args) {
        calls.push({ arguments: args });
        if (impl) return impl.apply(this, args);
    };
    fn.mock = {
        calls,
        resetCalls() { calls.length = 0; },
        mockImplementation(newImpl) { impl = newImpl; }
    };
    return fn;
}

// Mock vscode module for testing
const mockVscode = {
    window: {
        showWarningMessage: createMockFn()
    }
};

describe('Session Recovery Dialog', () => {
    let showSessionRecoveryDialog;

    before(async () => {
        const mod = await import('../../../out/authUtils.js');
        showSessionRecoveryDialog = mod.showSessionRecoveryDialog;
    });

    beforeEach(() => {
        // Reset mock between tests
        mockVscode.window.showWarningMessage.mock.resetCalls();
    });

    describe('message content based on error type', () => {
        it('should show "Previous session not found" for session_expired', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Start New Session')
            );

            const result = await showSessionRecoveryDialog(mockVscode,
                'abc123-session-id',
                'session_expired',
                1,
                new Error('Session not found')
            );

            const call = mockVscode.window.showWarningMessage.mock.calls[0];
            assert.match(call.arguments[0], /previous session not found/i);
            assert.strictEqual(result, 'new');
        });

        it('should show "Cannot connect to Copilot CLI" for network_timeout', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Start New Session')
            );

            await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'network_timeout',
                3,
                new Error('connect ECONNREFUSED 127.0.0.1:8080')
            );

            const call = mockVscode.window.showWarningMessage.mock.calls[0];
            assert.match(call.arguments[0], /cannot connect/i);
        });

        it('should show "Failed to resume session" for unknown errors', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Start New Session')
            );

            await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'unknown',
                3,
                new Error('Something unexpected')
            );

            const call = mockVscode.window.showWarningMessage.mock.calls[0];
            assert.match(call.arguments[0], /failed to resume/i);
        });

        it('should include attempt count in details', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Start New Session')
            );

            await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'network_timeout',
                3,
                new Error('Network error')
            );

            const call = mockVscode.window.showWarningMessage.mock.calls[0];
            const options = call.arguments[1];
            assert.match(options.detail, /3 attempt/i);
        });

        it('should include error message in details', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Start New Session')
            );

            await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'network_timeout',
                3,
                new Error('Network connection failed')
            );

            const call = mockVscode.window.showWarningMessage.mock.calls[0];
            const options = call.arguments[1];
            assert.match(options.detail, /network connection failed/i);
        });

        it('should truncate long session IDs in message', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Start New Session')
            );

            await showSessionRecoveryDialog(mockVscode,
                'very-long-session-id-that-should-be-truncated-123456',
                'session_expired',
                1,
                new Error('Session not found')
            );

            const call = mockVscode.window.showWarningMessage.mock.calls[0];
            const options = call.arguments[1];
            // Should show truncated ID (first 8 chars + ...)
            assert.match(options.detail, /very-lon\.\.\./);
        });
    });

    describe('user choice handling', () => {
        it('should return "retry" when user clicks "Try Again"', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Try Again')
            );

            const result = await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'network_timeout',
                3,
                new Error('Network error')
            );

            assert.strictEqual(result, 'retry');
        });

        it('should return "new" when user clicks "Start New Session"', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Start New Session')
            );

            const result = await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'network_timeout',
                3,
                new Error('Network error')
            );

            assert.strictEqual(result, 'new');
        });

        it('should return "new" when user dismisses dialog (undefined)', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve(undefined)
            );

            const result = await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'network_timeout',
                3,
                new Error('Network error')
            );

            assert.strictEqual(result, 'new');
        });

        it('should return "new" when user presses Escape', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve(undefined)
            );

            const result = await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'session_expired',
                1,
                new Error('Session not found')
            );

            assert.strictEqual(result, 'new');
        });
    });

    describe('dialog options', () => {
        it('should show modal dialog', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Start New Session')
            );

            await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'network_timeout',
                3,
                new Error('Network error')
            );

            const call = mockVscode.window.showWarningMessage.mock.calls[0];
            const options = call.arguments[1];
            assert.strictEqual(options.modal, true);
        });

        it('should provide "Try Again" button', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Start New Session')
            );

            await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'network_timeout',
                3,
                new Error('Network error')
            );

            const call = mockVscode.window.showWarningMessage.mock.calls[0];
            const buttons = call.arguments.slice(2);
            assert.ok(buttons.includes('Try Again'));
        });

        it('should provide "Start New Session" button', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Start New Session')
            );

            await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'network_timeout',
                3,
                new Error('Network error')
            );

            const call = mockVscode.window.showWarningMessage.mock.calls[0];
            const buttons = call.arguments.slice(2);
            assert.ok(buttons.includes('Start New Session'));
        });
    });

    describe('error type specific messages', () => {
        it('should mention session deletion for session_expired', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Start New Session')
            );

            await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'session_expired',
                1,
                new Error('Session not found')
            );

            const call = mockVscode.window.showWarningMessage.mock.calls[0];
            const options = call.arguments[1];
            assert.match(options.detail, /deleted|expired/i);
        });

        it('should mention network issues for network_timeout', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Start New Session')
            );

            await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'network_timeout',
                3,
                new Error('ECONNREFUSED')
            );

            const call = mockVscode.window.showWarningMessage.mock.calls[0];
            const message = call.arguments[0];
            assert.match(message, /connect|network/i);
        });

        it('should handle session_not_ready errors', async () => {
            mockVscode.window.showWarningMessage.mock.mockImplementation(() =>
                Promise.resolve('Try Again')
            );

            await showSessionRecoveryDialog(mockVscode,
                'abc123',
                'session_not_ready',
                2,
                new Error('Client not connected')
            );

            const call = mockVscode.window.showWarningMessage.mock.calls[0];
            const message = call.arguments[0];
            // Should have a reasonable message
            assert.ok(message.length > 0);
        });
    });
});
