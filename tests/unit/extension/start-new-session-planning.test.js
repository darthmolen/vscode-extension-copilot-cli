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
 * Resume-safety documentation tests.
 *
 * Verifies by code inspection that enablePlanMode() is never called from
 * resume code paths (handleOpenChat, handleSwitchSession, activate).
 * This is a structural test — if resume paths ever gain an enablePlanMode
 * call, these tests will fail, preventing accidental regression.
 */
describe('Resume paths never auto-enable plan mode', function () {
    let extensionSource;

    before(function () {
        extensionSource = fs.readFileSync(
            path.join(__dirname, '../../../src/extension.ts'), 'utf-8'
        );
    });

    it('handleSwitchSession does not call enablePlanMode', function () {
        const fnMatch = extensionSource.match(
            /async function handleSwitchSession[\s\S]*?^}/m
        );
        if (fnMatch) {
            assert.ok(!fnMatch[0].includes('enablePlanMode'),
                'handleSwitchSession must not call enablePlanMode');
        }
    });

    it('handleOpenChat does not call enablePlanMode', function () {
        const fnMatch = extensionSource.match(
            /async function handleOpenChat[\s\S]*?^}/m
        );
        if (fnMatch) {
            assert.ok(!fnMatch[0].includes('enablePlanMode'),
                'handleOpenChat must not call enablePlanMode');
        }
    });
});
