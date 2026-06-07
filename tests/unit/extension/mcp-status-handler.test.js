const assert = require('assert');
const { buildMcpServerStatusList, mergeMcpListWithConfig, mergeCopilotConfigList } = require('../../../out/extension/services/mcpStatusBuilder');

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

describe('mergeCopilotConfigList — read-only servers from mcp.config.list', () => {
    const baseList = [
        { name: 'hello-mcp', rawKey: 'hello-mcp', type: 'user', status: 'connected', toolCount: 1, tools: ['ping'] },
    ];

    it('appends a copilot-source row for a server only in Copilot config', () => {
        const copilotServers = { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp' } };
        const result = mergeCopilotConfigList(baseList, copilotServers);
        const gh = result.find(s => s.name === 'github');
        assert.ok(gh, 'github row appended');
        assert.strictEqual(gh.type, 'copilot');
    });

    it('does not duplicate a server already present in the list', () => {
        const copilotServers = { 'hello-mcp': { command: 'x' } };
        const result = mergeCopilotConfigList(baseList, copilotServers);
        const helloRows = result.filter(s => s.name === 'hello-mcp');
        assert.strictEqual(helloRows.length, 1, 'no duplicate row');
        assert.strictEqual(helloRows[0].type, 'user', 'existing row unchanged');
    });

    it('returns the list unchanged when copilot servers is empty or undefined', () => {
        assert.deepStrictEqual(mergeCopilotConfigList(baseList, {}), baseList);
        assert.deepStrictEqual(mergeCopilotConfigList(baseList, undefined), baseList);
    });
});

describe('config passthrough (for the edit form)', () => {
    const capability = { supportsMcpStatusEvents: () => true };

    it('buildMcpServerStatusList includes the raw server config on each row', () => {
        const servers = buildMcpServerStatusList(ALL_SERVERS, {}, {}, capability, {});
        const hello = servers.find(s => s.rawKey === 'hello-mcp');
        assert.deepStrictEqual(hello.config, ALL_SERVERS['hello-mcp']);
    });

    it('mergeMcpListWithConfig includes the raw server config on each row', () => {
        const result = mergeMcpListWithConfig(ALL_SERVERS, [], {});
        const hello = result.find(s => s.rawKey === 'hello-mcp');
        assert.deepStrictEqual(hello.config, ALL_SERVERS['hello-mcp']);
    });
});

describe('source classification (user / imported / managed)', () => {
    const capability = { supportsMcpStatusEvents: () => true };

    it('buildMcpServerStatusList marks a key listed in sources as imported', () => {
        const sources = { 'hello-mcp': 'imported' };
        const servers = buildMcpServerStatusList(ALL_SERVERS, {}, {}, capability, sources);
        const hello = servers.find(s => s.rawKey === 'hello-mcp');
        assert.strictEqual(hello.type, 'imported');
    });

    it('buildMcpServerStatusList defaults an unlisted non-managed key to user', () => {
        const servers = buildMcpServerStatusList(ALL_SERVERS, {}, {}, capability, {});
        const hello = servers.find(s => s.rawKey === 'hello-mcp');
        assert.strictEqual(hello.type, 'user');
    });

    it('buildMcpServerStatusList keeps managed prefix as managed even if sources says otherwise', () => {
        const sources = { '_copilotcli_playwright': 'imported' };
        const servers = buildMcpServerStatusList(ALL_SERVERS, {}, {}, capability, sources);
        const pw = servers.find(s => s.rawKey === '_copilotcli_playwright');
        assert.strictEqual(pw.type, 'managed');
    });

    it('mergeMcpListWithConfig marks a key listed in sources as imported', () => {
        const sources = { 'hello-mcp': 'imported' };
        const result = mergeMcpListWithConfig(ALL_SERVERS, [], sources);
        const hello = result.find(s => s.rawKey === 'hello-mcp');
        assert.strictEqual(hello.type, 'imported');
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
