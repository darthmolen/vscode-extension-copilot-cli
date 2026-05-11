/**
 * Unit tests for ManagedMCPRegistry
 *
 * Verifies that the extension-managed MCP server registry returns an empty
 * object (no managed servers are currently active — Playwright MCP requires
 * Chrome which needs a sudo install, so it's left to user configuration).
 *
 * The plumbing is intact: the `_copilotcli_*` namespace is reserved for
 * future managed servers that don't have external OS-level dependencies.
 */

const assert = require('assert');

const vscodeMock = require('../../helpers/vscode-mock');

describe('ManagedMCPRegistry', function () {
    this.timeout(5000);

    let ManagedMCPRegistry;

    before(function () {
        try {
            const mod = require('../../../out/extension/services/managedMCPRegistry.js');
            ManagedMCPRegistry = mod.ManagedMCPRegistry;
        } catch (e) {
            console.log('Module not yet compiled, skipping:', e.message);
            this.skip();
        }
    });

    describe('getManagedServers()', () => {
        it('returns empty object (no managed servers currently active)', () => {
            const registry = new ManagedMCPRegistry();
            const servers = registry.getManagedServers();
            assert.deepStrictEqual(servers, {});
        });

        it('returns a plain object (valid mcpServers shape)', () => {
            const registry = new ManagedMCPRegistry();
            const servers = registry.getManagedServers();
            assert.ok(servers !== null && typeof servers === 'object' && !Array.isArray(servers));
        });

        it('uses _copilotcli_ prefix on every managed key (namespace safety)', () => {
            const registry = new ManagedMCPRegistry();
            const servers = registry.getManagedServers();

            for (const key of Object.keys(servers)) {
                assert.ok(
                    key.startsWith('_copilotcli_'),
                    `managed key "${key}" must start with _copilotcli_ to prevent user-config collisions`
                );
            }
        });
    });
});
