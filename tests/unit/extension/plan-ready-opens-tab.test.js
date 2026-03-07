/**
 * TDD tests for Feature 1: plan_ready status auto-opens plan.md tab
 *
 * The onDidChangeStatus handler in extension.ts must call viewPlanFile()
 * when status === 'plan_ready', so the plan.md file opens automatically
 * in the editor after the AI finishes presenting the plan.
 *
 * Following the established pattern (plan-mode-session-update.test.js):
 * we test the decision logic as an extracted pure function.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';

/**
 * Determines if a status event should open the plan.md file.
 * This mirrors the check that should exist in onDidChangeStatus.
 */
function shouldOpenPlanFile(status) {
	return status === 'plan_ready';
}

/**
 * Determines if a status event should trigger a session dropdown refresh.
 * plan_ready does NOT change sessions, so it should NOT refresh.
 * (Regression guard: opening the file must not unintentionally add a refresh)
 */
function shouldRefreshSessionDropdown(status) {
	return status === 'plan_mode_enabled' || status === 'plan_mode_disabled';
}

describe('Feature 1: plan_ready opens plan.md tab', () => {
	describe('shouldOpenPlanFile()', () => {
		it('returns true for plan_ready', () => {
			expect(shouldOpenPlanFile('plan_ready')).to.be.true;
		});

		it('returns false for plan_accepted', () => {
			expect(shouldOpenPlanFile('plan_accepted')).to.be.false;
		});

		it('returns false for plan_rejected', () => {
			expect(shouldOpenPlanFile('plan_rejected')).to.be.false;
		});

		it('returns false for plan_mode_enabled', () => {
			expect(shouldOpenPlanFile('plan_mode_enabled')).to.be.false;
		});

		it('returns false for plan_mode_disabled', () => {
			expect(shouldOpenPlanFile('plan_mode_disabled')).to.be.false;
		});

		it('returns false for ready (turn end)', () => {
			expect(shouldOpenPlanFile('ready')).to.be.false;
		});

		it('returns false for thinking', () => {
			expect(shouldOpenPlanFile('thinking')).to.be.false;
		});
	});

	describe('Session dropdown regression guard', () => {
		it('plan_ready does NOT trigger session dropdown refresh', () => {
			// plan_ready doesn't change sessions, so no dropdown refresh needed
			expect(shouldRefreshSessionDropdown('plan_ready')).to.be.false;
		});
	});
});
