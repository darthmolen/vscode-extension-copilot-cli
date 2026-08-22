/**
 * Tests for startNewSessionInPlanning configuration.
 *
 * TDD: these tests are written BEFORE the implementation.
 * They must FAIL until shouldAutoEnablePlanMode() is implemented.
 *
 * shouldAutoEnablePlanMode() is a pure function extracted to
 * src/extension/utils/planModeUtils.ts so it can be tested without vscode.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Import from compiled output (requires npm run compile-tests first)
const { shouldAutoEnablePlanMode } = require('../../../out/extension/utils/planModeUtils');

describe('shouldAutoEnablePlanMode()', function () {
    it('returns true when config value is true', function () {
        assert.strictEqual(shouldAutoEnablePlanMode(true), true);
    });

    it('returns false when config value is false', function () {
        assert.strictEqual(shouldAutoEnablePlanMode(false), false);
    });

    it('returns false when config value is undefined (default/unset)', function () {
        assert.strictEqual(shouldAutoEnablePlanMode(undefined), false);
    });

    it('returns false when config value is null', function () {
        assert.strictEqual(shouldAutoEnablePlanMode(null), false);
    });
});

/**
 * The "Resume paths never auto-enable plan mode" scans that lived here were deleted
 * 2026-08-22. They read `src/extension.ts`, regex-matched two function bodies out of
 * it, and asserted the text did not contain `enablePlanMode`.
 *
 * They had a worse flaw than string matching. Both were shaped
 * `if (fnMatch) { assert.ok(...) }` — so when the regex failed to find the function
 * at all, the test **passed silently**. Rename or reshape either handler and the
 * guard evaporates without a word, which is the opposite of what a regression test
 * is for.
 *
 * The property they gestured at — resuming a session must not silently put it into
 * plan mode — is real. It is not asserted anywhere now, and asserting it needs a
 * live session rather than a regex, so it belongs in the live-verification list
 * rather than in a test that cannot fail.
 */
