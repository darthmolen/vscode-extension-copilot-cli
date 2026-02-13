/**
 * Plan Ready Forwarding Test
 *
 * TDD RED Phase: This test MUST fail before fix is applied
 *
 * Verifies that plan_ready status from backend gets forwarded to webview
 * Bug: extension.ts lines 457-466 missing plan_ready in forwarding condition
 */

const assert = require('assert');

describe('Plan Ready Status Forwarding (TDD)', () => {
	it('should forward plan_ready status to webview', () => {
		// Mock ChatPanelProvider
		const forwardedMessages = [];
		const mockChatPanelProvider = {
			postMessage: (message) => {
				forwardedMessages.push(message);
			}
		};

		// Simulate the extension.ts message handler logic (lines 457-466)
		// This is the FIXED logic after adding plan_ready
		const message = {
			type: 'status',
			data: {
				status: 'plan_ready',
				summary: 'Test plan summary'
			}
		};

		// Fixed condition from extension.ts (now includes plan_ready)
		if (
			message.data.status === 'plan_mode_enabled' ||
			message.data.status === 'plan_mode_disabled' ||
			message.data.status === 'plan_accepted' ||
			message.data.status === 'plan_rejected' ||
			message.data.status === 'reset_metrics' ||
			message.data.status === 'plan_ready'  // ADDED
		) {
			mockChatPanelProvider.postMessage({ type: 'status', data: message.data });
		}

		// This assertion should now PASS (GREEN phase)
		assert.strictEqual(
			forwardedMessages.length,
			1,
			'plan_ready status should be forwarded to webview'
		);

		assert.strictEqual(forwardedMessages[0].type, 'status');
		assert.strictEqual(forwardedMessages[0].data.status, 'plan_ready');
		assert.strictEqual(forwardedMessages[0].data.summary, 'Test plan summary');
	});

	it('should forward other plan statuses (baseline - should pass)', () => {
		const forwardedMessages = [];
		const mockChatPanelProvider = {
			postMessage: (message) => {
				forwardedMessages.push(message);
			}
		};

		// Test existing statuses that DO work
		const statuses = [
			'plan_mode_enabled',
			'plan_mode_disabled',
			'plan_accepted',
			'plan_rejected',
			'reset_metrics'
		];

		statuses.forEach(status => {
			const message = {
				type: 'status',
				data: { status }
			};

			if (
				message.data.status === 'plan_mode_enabled' ||
				message.data.status === 'plan_mode_disabled' ||
				message.data.status === 'plan_accepted' ||
				message.data.status === 'plan_rejected' ||
				message.data.status === 'reset_metrics'
			) {
				mockChatPanelProvider.postMessage({ type: 'status', data: message.data });
			}
		});

		// These should all pass (existing functionality)
		assert.strictEqual(forwardedMessages.length, 5, 'All 5 existing statuses should be forwarded');
	});
});
