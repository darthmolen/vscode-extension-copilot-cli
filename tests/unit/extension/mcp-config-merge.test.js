/**
 * Unit tests for MCPConfigurationService.getMergedMCPServers
 *
 * Verifies the merge of user-defined MCP servers (from copilotCLI.mcpServers)
 * with extension-managed MCP servers (from ManagedMCPRegistry). Both must
 * coexist; user config cannot override managed entries because managed keys
 * use the reserved `_copilotcli_*` namespace.
 *
 * TDD: RED → GREEN → REFACTOR
 */

const Module = require('module');
const assert = require('assert');

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('../../helpers/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

describe('MCPConfigurationService.getMergedMCPServers', function () {
    this.timeout(5000);

    let MCPConfigurationService;
    let service;

    before(function () {
        try {
            const mod = require('../../../out/extension/services/mcpConfigurationService.js');
            MCPConfigurationService = mod.MCPConfigurationService;
        } catch (e) {
            console.log('Module not yet compiled, skipping:', e.message);
            this.skip();
        }
    });

    beforeEach(() => {
        service = new MCPConfigurationService('/home/user/workspace');
    });

    it('returns managed servers when user config is empty', () => {
        const userConfig = {};
        const managed = {
            _copilotcli_playwright: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.74'] },
        };

        const result = service.getMergedMCPServers(userConfig, managed);

        assert.ok(result._copilotcli_playwright, 'managed entry must be present');
        assert.strictEqual(result._copilotcli_playwright.command, 'npx');
    });

    it('preserves user-defined entries alongside managed entries', () => {
        const userConfig = {
            'my-custom-server': { command: 'node', args: ['./my-server.js'] },
        };
        const managed = {
            _copilotcli_playwright: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.74'] },
        };

        const result = service.getMergedMCPServers(userConfig, managed);

        assert.ok(result['my-custom-server'], 'user entry preserved');
        assert.ok(result._copilotcli_playwright, 'managed entry preserved');
    });

    it("user's `playwright` entry coexists with `_copilotcli_playwright` (different keys)", () => {
        const userConfig = {
            playwright: { command: 'node', args: ['./custom-playwright.js'] },
        };
        const managed = {
            _copilotcli_playwright: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.74'] },
        };

        const result = service.getMergedMCPServers(userConfig, managed);

        assert.strictEqual(result.playwright.command, 'node', "user's playwright should be intact");
        assert.strictEqual(result._copilotcli_playwright.command, 'npx', 'managed playwright should be intact');
        assert.ok(result.playwright !== result._copilotcli_playwright, 'they should be distinct entries');
    });

    it('filters disabled user entries (preserves existing semantics)', () => {
        const userConfig = {
            'enabled-server': { enabled: true, command: 'cmd1' },
            'disabled-server': { enabled: false, command: 'cmd2' },
        };
        const managed = {};

        const result = service.getMergedMCPServers(userConfig, managed);

        assert.ok(result['enabled-server'], 'enabled user entry kept');
        assert.ok(!result['disabled-server'], 'disabled user entry filtered');
    });

    it('expands ${workspaceFolder} in user config (preserves existing semantics)', () => {
        const userConfig = {
            'my-server': {
                command: '${workspaceFolder}/bin/server',
                args: ['--root', '${workspaceFolder}/data'],
            },
        };
        const managed = {};

        const result = service.getMergedMCPServers(userConfig, managed);

        assert.strictEqual(result['my-server'].command, '/home/user/workspace/bin/server');
        assert.strictEqual(result['my-server'].args[1], '/home/user/workspace/data');
    });

    it('managed entries take precedence if a user (mistakenly) reserves a _copilotcli_ key', () => {
        // Defense in depth: even if someone tries to inject into the managed namespace,
        // the registry's authoritative value wins.
        const userConfig = {
            _copilotcli_playwright: { command: 'evil', args: ['rm', '-rf', '/'] },
        };
        const managed = {
            _copilotcli_playwright: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.74'] },
        };

        const result = service.getMergedMCPServers(userConfig, managed);

        assert.strictEqual(result._copilotcli_playwright.command, 'npx',
            'managed entry must win over any user entry in the reserved namespace');
    });

    it('handles both empty inputs gracefully', () => {
        const result = service.getMergedMCPServers({}, {});
        assert.deepStrictEqual(result, {});
    });
});
