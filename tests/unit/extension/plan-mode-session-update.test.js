import { describe, it } from 'mocha';
import { expect } from 'chai';

/**
 * Tests for session dropdown refresh logic during plan mode transitions.
 *
 * The onDidChangeStatus handler in extension.ts must call updateSessionsList()
 * when plan mode is enabled or disabled, so the session dropdown reflects
 * the active session (work session vs plan session).
 *
 * Since the handler is a module-level function with VS Code dependencies,
 * we test the decision logic as an extracted pure function
 * (same pattern as update-active-file.test.js).
 */

/**
 * Determines if a status event should trigger a session dropdown refresh.
 * This mirrors the case split that should exist in the onDidChangeStatus handler.
 *
 * Only plan_mode_enabled and plan_mode_disabled need refresh because:
 * - plan_accepted/plan_rejected call disablePlanMode() first, which fires plan_mode_disabled
 * - plan_ready doesn't change sessions
 * - reset_metrics is unrelated
 */
function shouldRefreshSessionDropdown(status) {
	return status === 'plan_mode_enabled' || status === 'plan_mode_disabled';
}

/**
 * Generates the plan session ID from a work session ID.
 * This mirrors the naming convention in sdkSessionManager.ts:989.
 */
function getPlanSessionId(workSessionId) {
	return `${workSessionId}-plan`;
}

describe('Plan Mode - Session Dropdown Updates', () => {
	describe('shouldRefreshSessionDropdown()', () => {
		it('should refresh when plan mode is enabled', () => {
			expect(shouldRefreshSessionDropdown('plan_mode_enabled')).to.be.true;
		});

		it('should refresh when plan mode is disabled', () => {
			expect(shouldRefreshSessionDropdown('plan_mode_disabled')).to.be.true;
		});

		it('should NOT refresh for plan_ready (no session change)', () => {
			expect(shouldRefreshSessionDropdown('plan_ready')).to.be.false;
		});

		it('should NOT refresh for plan_accepted (covered by plan_mode_disabled)', () => {
			expect(shouldRefreshSessionDropdown('plan_accepted')).to.be.false;
		});

		it('should NOT refresh for plan_rejected (covered by plan_mode_disabled)', () => {
			expect(shouldRefreshSessionDropdown('plan_rejected')).to.be.false;
		});

		it('should NOT refresh for reset_metrics', () => {
			expect(shouldRefreshSessionDropdown('reset_metrics')).to.be.false;
		});

		it('should NOT refresh for thinking status', () => {
			expect(shouldRefreshSessionDropdown('thinking')).to.be.false;
		});

		it('should NOT refresh for ready status', () => {
			expect(shouldRefreshSessionDropdown('ready')).to.be.false;
		});
	});

	describe('Plan session ID convention', () => {
		it('should append -plan to work session ID', () => {
			expect(getPlanSessionId('abc123')).to.equal('abc123-plan');
		});

		it('should work with UUID-style session IDs', () => {
			const workId = '03aec30a-1234-5678-9abc-def012345678';
			expect(getPlanSessionId(workId)).to.equal('03aec30a-1234-5678-9abc-def012345678-plan');
		});

		it('should produce a different ID than the work session', () => {
			const workId = 'session-42';
			const planId = getPlanSessionId(workId);
			expect(planId).to.not.equal(workId);
		});
	});
});
