const assert = require('assert');
const { parseCliVersion } = require('../../../out/utilities/cliVersion');

describe('parseCliVersion', () => {
    it('extracts semver from "1.0.44" output', () => {
        assert.strictEqual(parseCliVersion('1.0.44'), '1.0.44');
    });

    it('extracts semver from multi-line CLI output', () => {
        assert.strictEqual(parseCliVersion('GitHub Copilot CLI v1.0.44\n'), '1.0.44');
    });

    it('returns null for non-version output', () => {
        assert.strictEqual(parseCliVersion('no version here'), null);
    });

    it('extracts semver with leading whitespace', () => {
        assert.strictEqual(parseCliVersion('   1.0.5\n'), '1.0.5');
    });
});
