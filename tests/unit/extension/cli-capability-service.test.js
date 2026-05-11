const assert = require('assert');
const { CliCapabilityService } = require('../../../out/extension/services/cliCapabilityService');

const RESOLVED = (over = {}) => ({
    cliVersion: '1.0.44',
    satisfiesPeerDep: true,
    source: 'managed',
    cliPath: '/x/copilot',
    sdkPeerRange: '^1.0.36-0',
    ...over
});

describe('CliCapabilityService', () => {
    it('exposes cliVersion and satisfiesSdkPeerDep from resolved', () => {
        const c = new CliCapabilityService(RESOLVED({ cliVersion: '1.0.44', satisfiesPeerDep: true }));
        assert.strictEqual(c.cliVersion, '1.0.44');
        assert.strictEqual(c.satisfiesSdkPeerDep, true);
    });

    it('supportsMcpListRpc returns true on 1.0.36', () => {
        const c = new CliCapabilityService(RESOLVED({ cliVersion: '1.0.36' }));
        assert.strictEqual(c.supportsMcpListRpc(), true);
    });

    it('supportsMcpListRpc returns false on 1.0.5', () => {
        const c = new CliCapabilityService(RESOLVED({ cliVersion: '1.0.5', satisfiesPeerDep: false, source: 'system' }));
        assert.strictEqual(c.supportsMcpListRpc(), false);
    });

    it('supportsMcpStatusEvents returns false on 1.0.5 and true on 1.0.44', () => {
        const old = new CliCapabilityService(RESOLVED({ cliVersion: '1.0.5', satisfiesPeerDep: false, source: 'system' }));
        const fresh = new CliCapabilityService(RESOLVED({ cliVersion: '1.0.44' }));
        assert.strictEqual(old.supportsMcpStatusEvents(), false);
        assert.strictEqual(fresh.supportsMcpStatusEvents(), true);
    });

    it('exposes sourceLabel describing where CLI came from', () => {
        const local = new CliCapabilityService(RESOLVED({ source: 'local' }));
        const system = new CliCapabilityService(RESOLVED({ source: 'system' }));
        assert.strictEqual(local.sourceLabel, 'local');
        assert.strictEqual(system.sourceLabel, 'system');
    });
});
