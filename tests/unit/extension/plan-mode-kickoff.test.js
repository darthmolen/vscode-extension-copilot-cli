/**
 * Tests for plan mode kickoff message construction.
 *
 * TDD: these tests are written BEFORE the implementation.
 * They must FAIL until extractPlanHeading() and buildKickoffMessage() are implemented.
 *
 * Pure functions extracted to src/extension/utils/planModeUtils.ts.
 */

const assert = require('assert');

// Import from compiled output (requires npm run compile-tests first)
const { extractPlanHeading, buildKickoffMessage } = require('../../../out/extension/utils/planModeUtils');

describe('extractPlanHeading()', function () {
    it('extracts heading from standard plan content', function () {
        assert.strictEqual(extractPlanHeading('# My Plan\n\nSome content'), 'My Plan');
    });

    it('extracts heading after leading blank lines', function () {
        assert.strictEqual(extractPlanHeading('  \n# Heading\nstuff'), 'Heading');
    });

    it('returns null when no heading exists', function () {
        assert.strictEqual(extractPlanHeading('No heading here'), null);
    });

    it('ignores ## subheadings (only matches single #)', function () {
        assert.strictEqual(extractPlanHeading('## Subheading only'), null);
    });

    it('returns null for empty string', function () {
        assert.strictEqual(extractPlanHeading(''), null);
    });

    it('returns first heading when multiple exist', function () {
        assert.strictEqual(extractPlanHeading('# First\n# Second'), 'First');
    });

    it('trims whitespace from heading text', function () {
        assert.strictEqual(extractPlanHeading('#   Spaced Heading   \nContent'), 'Spaced Heading');
    });

    it('returns null for # with no text after it', function () {
        assert.strictEqual(extractPlanHeading('# \nContent'), null);
    });
});

describe('buildKickoffMessage()', function () {
    it('uses heading as first line when provided', function () {
        const msg = buildKickoffMessage('My Plan', '/path/plan.md');
        const firstLine = msg.split('\n')[0];
        assert.strictEqual(firstLine, 'My Plan');
    });

    it('includes plan path in message', function () {
        const msg = buildKickoffMessage('My Plan', '/path/plan.md');
        assert.ok(msg.includes('/path/plan.md'), 'Message should contain plan path');
    });

    it('uses fallback when heading is null', function () {
        const msg = buildKickoffMessage(null, '/path/plan.md');
        const firstLine = msg.split('\n')[0];
        assert.strictEqual(firstLine, 'Plan Implementation');
    });

    it('includes task execution instruction', function () {
        const msg = buildKickoffMessage('My Plan', '/path/plan.md');
        assert.ok(msg.includes('Start with the first incomplete task'), 'Should include task instruction');
    });
});
