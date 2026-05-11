const assert = require('assert');
const { buildMcpServerStatusList, mergeMcpListWithConfig } = require('../../../out/extension/services/mcpStatusBuilder');

const ALL_SERVERS = {
    '_copilotcli_playwright': { command: 'npx', args: ['-y', '@playwright/mcp@0.0.74'] },
    'hello-mcp': { type: 'local', command: '/x/python', args: ['/x/server.py'] }
};

describe('buildMcpServerStatusList — fallback when status events unsupported', () => {
    it('marks unconfirmed servers as unknown (NOT configured) when capability says no MCP status events', () => {
        const capability = { supportsMcpStatusEvents: () => false };
        const servers = buildMcpServerStatusList(ALL_SERVERS, /* knownTools */ {}, /* knownStatuses */ {}, capability);

        const playwright = servers.find(s => s.name === 'playwright');
        const hello = servers.find(s => s.name === 'hello-mcp');
        assert.ok(playwright, 'playwright row should be present');
        assert.ok(hello, 'hello-mcp row should be present');
        assert.strictEqual(playwright.status, 'unknown');
        assert.strictEqual(hello.status, 'unknown');
    });

    it('uses configured (NOT unknown) when capability supports status events but no event arrived yet', () => {
        const capability = { supportsMcpStatusEvents: () => true };
        const servers = buildMcpServerStatusList(ALL_SERVERS, {}, {}, capability);
        const playwright = servers.find(s => s.name === 'playwright');
        assert.strictEqual(playwright.status, 'configured');
    });

    it('strips _copilotcli_ prefix for display name; preserves rawKey', () => {
        const capability = { supportsMcpStatusEvents: () => true };
        const servers = buildMcpServerStatusList(ALL_SERVERS, {}, {}, capability);
        const playwright = servers.find(s => s.rawKey === '_copilotcli_playwright');
        assert.strictEqual(playwright.name, 'playwright');
        assert.strictEqual(playwright.type, 'managed');
        const hello = servers.find(s => s.rawKey === 'hello-mcp');
        assert.strictEqual(hello.type, 'user');
    });

    it('maps SDK not_configured to unknown (was configured)', () => {
        const capability = { supportsMcpStatusEvents: () => true };
        const knownStatuses = { '_copilotcli_playwright': 'not_configured' };
        const servers = buildMcpServerStatusList(ALL_SERVERS, {}, knownStatuses, capability);
        const playwright = servers.find(s => s.name === 'playwright');
        assert.strictEqual(playwright.status, 'unknown');
    });

    it('promotes server to connected when knownTools has entries', () => {
        const capability = { supportsMcpStatusEvents: () => true };
        const knownTools = { '_copilotcli_playwright': ['screenshot', 'navigate'] };
        const servers = buildMcpServerStatusList(ALL_SERVERS, knownTools, {}, capability);
        const playwright = servers.find(s => s.name === 'playwright');
        assert.strictEqual(playwright.status, 'connected');
        assert.strictEqual(playwright.toolCount, 2);
    });
});

describe('mergeMcpListWithConfig — live SDK data via session.rpc.mcp.list()', () => {
    it('uses connected status + live tool count when SDK reports connected', () => {
        const sdkList = [
            { name: '_copilotcli_playwright', status: 'connected', tools: [{ name: 'screenshot' }, { name: 'navigate' }, { name: 'click' }] }
        ];
        const result = mergeMcpListWithConfig(ALL_SERVERS, sdkList);
        const playwright = result.find(s => s.name === 'playwright');
        assert.strictEqual(playwright.status, 'connected');
        assert.strictEqual(playwright.toolCount, 3);
        assert.deepStrictEqual(playwright.tools, ['screenshot', 'navigate', 'click']);
    });

    it('marks SDK failed status as failed in panel', () => {
        const sdkList = [{ name: 'hello-mcp', status: 'failed', error: 'spawn ENOENT' }];
        const result = mergeMcpListWithConfig(ALL_SERVERS, sdkList);
        const hello = result.find(s => s.name === 'hello-mcp');
        assert.strictEqual(hello.status, 'failed');
        assert.strictEqual(hello.error, 'spawn ENOENT');
    });

    it('shows configured for servers in config that SDK did not report', () => {
        const sdkList = []; // SDK has nothing for any server
        const result = mergeMcpListWithConfig(ALL_SERVERS, sdkList);
        const playwright = result.find(s => s.name === 'playwright');
        // SDK responded but had no entry for this server — could be still starting
        assert.strictEqual(playwright.status, 'configured');
    });

    it('matches SDK entries by displayName when rawKey lookup misses', () => {
        const sdkList = [{ name: 'playwright', status: 'connected', tools: [{ name: 'a' }] }];
        const result = mergeMcpListWithConfig(ALL_SERVERS, sdkList);
        const playwright = result.find(s => s.name === 'playwright');
        assert.strictEqual(playwright.status, 'connected');
        assert.strictEqual(playwright.toolCount, 1);
    });

    it('accepts plain string tools as well as {name} objects', () => {
        const sdkList = [{ name: 'hello-mcp', status: 'connected', tools: ['ping', 'echo'] }];
        const result = mergeMcpListWithConfig(ALL_SERVERS, sdkList);
        const hello = result.find(s => s.name === 'hello-mcp');
        assert.strictEqual(hello.toolCount, 2);
        assert.deepStrictEqual(hello.tools, ['ping', 'echo']);
    });
});
