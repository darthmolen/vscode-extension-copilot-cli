const assert = require('assert');
const { bootstrapCliBundle } = require('../../../out/extension/services/cliBundleBootstrap');

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

describe('bootstrapCliBundle', () => {
    it('returns resolved + capability when bundle succeeds', async () => {
        const fakeBundle = {
            ensureBundled: async () => ({
                cliPath: '/path/copilot',
                cliVersion: '1.0.44',
                source: 'local',
                satisfiesPeerDep: true,
                sdkPeerRange: '^1.0.36-0'
            })
        };
        const out = await bootstrapCliBundle(fakeBundle, noopLogger, { showWarningMessage: () => Promise.resolve() });
        assert.strictEqual(out.resolved.cliPath, '/path/copilot');
        assert.strictEqual(out.capability.cliVersion, '1.0.44');
        assert.strictEqual(out.capability.satisfiesSdkPeerDep, true);
    });

    it('shows warning when peer-dep not satisfied', async () => {
        const messages = [];
        const fakeBundle = {
            ensureBundled: async () => ({
                cliPath: '/old',
                cliVersion: '1.0.5',
                source: 'system',
                satisfiesPeerDep: false,
                sdkPeerRange: '^1.0.36-0'
            })
        };
        const fakeWindow = {
            showWarningMessage: (msg) => { messages.push(msg); return Promise.resolve(); }
        };
        await bootstrapCliBundle(fakeBundle, noopLogger, fakeWindow);
        assert.strictEqual(messages.length, 1, 'should show one warning');
        assert.ok(messages[0].includes('1.0.5'), `message should include CLI version, got: ${messages[0]}`);
        assert.ok(messages[0].includes('1.0.36'), `message should include peer-dep range, got: ${messages[0]}`);
    });

    it('does NOT show warning when peer-dep satisfied', async () => {
        const messages = [];
        const fakeBundle = {
            ensureBundled: async () => ({
                cliPath: '/x',
                cliVersion: '1.0.44',
                source: 'managed',
                satisfiesPeerDep: true,
                sdkPeerRange: '^1.0.36-0'
            })
        };
        const fakeWindow = { showWarningMessage: (msg) => { messages.push(msg); return Promise.resolve(); } };
        await bootstrapCliBundle(fakeBundle, noopLogger, fakeWindow);
        assert.strictEqual(messages.length, 0);
    });
});
