/**
 * Tests for InfoSlashHandlers
 * Testing: /mcp, /usage, /help commands
 * 
 * TDD RED PHASE: These tests will fail because InfoSlashHandlers doesn't exist yet
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');

// RED PHASE: This will fail - module doesn't exist
const { InfoSlashHandlers } = require('../../../../../out/extension/services/slashCommands/InfoSlashHandlers');

describe('InfoSlashHandlers - /mcp command', () => {
    let handlers;
    let getMcpServers;
    let mockBackendState;

    beforeEach(() => {
        // Getter function returning MCP server map (new API)
        getMcpServers = () => ({
            'filesystem': {
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
            },
            'postgres': {
                command: 'docker',
                args: ['run', 'mcp-postgres']
            }
        });

        // Create mock BackendState
        mockBackendState = {
            getSessionStartTime: () => new Date('2026-02-14T00:00:00Z'),
            getMessageCount: () => 12,
            getToolCallCount: () => 8
        };

        handlers = new InfoSlashHandlers(getMcpServers, mockBackendState);
    });

    it('returns MCP configuration when servers are configured', async () => {
        // Act
        const result = await handlers.handleMcp();

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('MCP Server Configuration');
        expect(result.content).to.include('2 server(s) configured');
        expect(result.content).to.include('filesystem');
        expect(result.content).to.include('postgres');
        expect(result.content).to.include('```json');
        expect(result.error).to.be.undefined;
    });

    it('returns friendly message when no MCP servers configured', async () => {
        // Arrange - override getter to return empty map
        handlers = new InfoSlashHandlers(() => ({}), mockBackendState);

        // Act
        const result = await handlers.handleMcp();

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('No MCP servers configured');
        expect(result.content).to.include('Model Context Protocol');
        expect(result.error).to.be.undefined;
    });

    it('returns friendly message when MCP config is null', async () => {
        // Arrange - getter returns null (treated as empty)
        handlers = new InfoSlashHandlers(() => null, mockBackendState);

        // Act
        const result = await handlers.handleMcp();

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('No MCP servers configured');
        expect(result.error).to.be.undefined;
    });

    it('handles error when MCP config service throws', async () => {
        // Arrange - getter throws
        handlers = new InfoSlashHandlers(() => {
            throw new Error('Config read failed');
        }, mockBackendState);

        // Act
        const result = await handlers.handleMcp();

        // Assert
        expect(result.success).to.be.false;
        expect(result.error).to.include('Failed to load MCP configuration');
        expect(result.error).to.include('Config read failed');
    });
});

describe('InfoSlashHandlers - /usage command', () => {
    let handlers;
    let mockMcpConfig;
    let mockBackendState;

    beforeEach(() => {
        mockMcpConfig = {
            getConfig: () => ({})
        };

        mockBackendState = {
            getSessionStartTime: () => new Date('2026-02-14T01:00:00Z'),
            getMessageCount: () => 12,
            getToolCallCount: () => 8
        };

        handlers = new InfoSlashHandlers(mockMcpConfig, mockBackendState);
    });

    it('returns usage metrics when session is active', async () => {
        // Mock current time to calculate duration
        const mockNow = new Date('2026-02-14T01:08:35Z'); // 8 minutes 35 seconds later
        const originalDateNow = Date.now;
        Date.now = () => mockNow.getTime();

        // Act
        const result = await handlers.handleUsage();

        // Restore
        Date.now = originalDateNow;

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('Session Usage');
        expect(result.content).to.include('Started');
        expect(result.content).to.include('Duration');
        expect(result.content).to.include('8m 35s'); // 8 minutes 35 seconds
        expect(result.content).to.include('Messages sent');
        expect(result.content).to.include('12');
        expect(result.content).to.include('Tool calls');
        expect(result.content).to.include('8');
        expect(result.error).to.be.undefined;
    });

    it('handles session duration less than 1 minute', async () => {
        // Mock current time to calculate duration
        const mockNow = new Date('2026-02-14T01:00:42Z'); // 42 seconds later
        const originalDateNow = Date.now;
        Date.now = () => mockNow.getTime();

        // Act
        const result = await handlers.handleUsage();

        // Restore
        Date.now = originalDateNow;

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('0m 42s');
    });

    it('returns friendly message when no active session', async () => {
        // Arrange
        mockBackendState.getSessionStartTime = () => null;

        // Act
        const result = await handlers.handleUsage();

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('No active session');
        expect(result.content).to.include('Start a conversation');
        expect(result.error).to.be.undefined;
    });

    it('handles session start time as timestamp number (production reality)', async () => {
        // PRODUCTION REALITY: getSessionStartTime returns a number, not a Date
        mockBackendState.getSessionStartTime = () => 1739487600000; // 2026-02-14T01:00:00Z as timestamp

        // Mock current time (8 minutes 35 seconds later)
        const originalDateNow = Date.now;
        Date.now = () => 1739488115000; // 2026-02-14T01:08:35Z as timestamp

        // Act
        const result = await handlers.handleUsage();

        // Restore
        Date.now = originalDateNow;

        // Debug: Log the error if test fails
        if (!result.success) {
            console.log('ERROR:', result.error);
        }

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('Session Usage');
        expect(result.content).to.include('8m 35s');
        expect(result.error).to.be.undefined;
    });

    it('handles error when backendState throws', async () => {
        // Arrange
        mockBackendState.getSessionStartTime = () => {
            throw new Error('State read failed');
        };

        // Act
        const result = await handlers.handleUsage();

        // Assert
        expect(result.success).to.be.false;
        expect(result.error).to.include('Failed to load usage metrics');
        expect(result.error).to.include('State read failed');
    });
});

describe('InfoSlashHandlers - /help command', () => {
    let handlers;
    let mockMcpConfig;
    let mockBackendState;

    beforeEach(() => {
        mockMcpConfig = {
            getConfig: () => ({})
        };

        mockBackendState = {
            getSessionStartTime: () => new Date(),
            getMessageCount: () => 0,
            getToolCallCount: () => 0
        };

        handlers = new InfoSlashHandlers(mockMcpConfig, mockBackendState);
    });

    it('returns all commands when no argument provided', async () => {
        // Act
        const result = await handlers.handleHelp();

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('Available Commands');
        expect(result.content).to.include('Plan Mode');
        expect(result.content).to.include('/plan');
        expect(result.content).to.include('/exit');
        expect(result.content).to.include('/accept');
        expect(result.content).to.include('/reject');
        expect(result.content).to.include('Code & Review');
        expect(result.content).to.include('/review');
        expect(result.content).to.include('/diff');
        expect(result.content).to.include('Configuration');
        expect(result.content).to.include('/mcp');
        expect(result.content).to.include('/usage');
        expect(result.content).to.include('/version');
        expect(result.content).to.include('/help');
        expect(result.content).to.include('CLI Passthrough');
        expect(result.content).to.include('/delegate');
        expect(result.content).to.include('/agent');
        expect(result.content).to.include('Type /help <command>');
        expect(result.error).to.be.undefined;
    });

    it('returns specific help for /review command', async () => {
        // Act
        const result = await handlers.handleHelp('review');

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('/review');
        expect(result.content).to.include('Show Plan Content');
        expect(result.content).to.include('Usage:');
        expect(result.content).to.include('plan.md');
        expect(result.error).to.be.undefined;
    });

    it('returns specific help for /diff command', async () => {
        // Act
        const result = await handlers.handleHelp('diff');

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('/diff');
        expect(result.content).to.include('Diff Viewer');
        expect(result.content).to.include('<file1> <file2>');
        expect(result.content).to.include('Example:');
        expect(result.error).to.be.undefined;
    });

    it('returns specific help for /mcp command', async () => {
        // Act
        const result = await handlers.handleHelp('mcp');

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('/mcp');
        expect(result.content).to.include('MCP Configuration');
        expect(result.content).to.include('Model Context Protocol');
        expect(result.error).to.be.undefined;
    });

    it('returns error for unknown command', async () => {
        // Act
        const result = await handlers.handleHelp('unknown');

        // Assert
        expect(result.success).to.be.false;
        expect(result.error).to.include('Unknown command');
        expect(result.error).to.include('/unknown');
        expect(result.error).to.include('/help');
    });

    it('handles error when help generation throws', async () => {
        // Arrange - override handleHelp to throw
        const originalHandleHelp = handlers.handleHelp;
        handlers.handleHelp = async () => {
            throw new Error('Help system crashed');
        };

        // Act
        let result;
        try {
            result = await handlers.handleHelp();
        } catch (error) {
            result = {
                success: false,
                error: `Failed to load help: ${error.message}`
            };
        }

        // Assert
        expect(result.success).to.be.false;
        expect(result.error).to.include('Failed to load help');
    });
});

describe('InfoSlashHandlers - /mcp with null getter (regression: Bug 2)', () => {
    let mockBackendState;

    beforeEach(() => {
        mockBackendState = {
            getSessionStartTime: () => null,
            getMessageCount: () => 0,
            getToolCallCount: () => 0
        };
    });

    it('should NOT throw when getMcpServers is null', async () => {
        const handlers = new InfoSlashHandlers(null, mockBackendState);

        const result = await handlers.handleMcp();

        expect(result.success).to.be.true;
        expect(result.content).to.include('not available');
        expect(result.error).to.be.undefined;
    });

    it('should call getMcpServers getter when provided', async () => {
        let called = false;
        const getter = () => { called = true; return {}; };
        const handlers = new InfoSlashHandlers(getter, mockBackendState);

        await handlers.handleMcp();

        expect(called).to.be.true;
    });

    it('should return server count when getter returns servers', async () => {
        const getter = () => ({
            'filesystem': { command: 'npx', args: [] },
            '_copilotcli_playwright': { command: 'npx', args: [] }
        });
        const handlers = new InfoSlashHandlers(getter, mockBackendState);

        const result = await handlers.handleMcp();

        expect(result.success).to.be.true;
    });
});

describe('InfoSlashHandlers - /version command', () => {
    let mockBackendState;

    beforeEach(() => {
        mockBackendState = {
            getSessionStartTime: () => Date.now() - 60000,
            getMessageCount: () => 5,
            getToolCallCount: () => 2
        };
    });

    it('returns extension, SDK, and CLI versions when all info provided', async () => {
        const fakeCapability = {
            cliVersion: '1.0.44',
            satisfiesSdkPeerDep: true,
            sdkPeerRange: '^1.0.36-0',
            sourceLabel: 'managed'
        };
        const versionInfo = { extensionVersion: '3.8.0', sdkVersion: '0.3.0' };
        const handlers = new InfoSlashHandlers(null, mockBackendState, fakeCapability, versionInfo);

        const result = await handlers.handleVersion();

        expect(result.success).to.be.true;
        expect(result.content).to.include('Version Info');
        expect(result.content).to.include('3.8.0');
        expect(result.content).to.include('0.3.0');
        expect(result.content).to.include('1.0.44');
        expect(result.content).to.include('managed');
        expect(result.error).to.be.undefined;
    });

    it('shows checkmark when CLI satisfies SDK peer dep', async () => {
        const fakeCapability = {
            cliVersion: '1.0.44',
            satisfiesSdkPeerDep: true,
            sdkPeerRange: '^1.0.36-0',
            sourceLabel: 'managed'
        };
        const handlers = new InfoSlashHandlers(null, mockBackendState, fakeCapability, { extensionVersion: '3.8.0', sdkVersion: '0.3.0' });

        const result = await handlers.handleVersion();

        expect(result.success).to.be.true;
        expect(result.content).to.include('✅');
        expect(result.content).to.not.include('❌');
        expect(result.error).to.be.undefined;
    });

    it('shows warning when CLI does NOT satisfy SDK peer dep', async () => {
        const fakeCapability = {
            cliVersion: '1.0.5',
            satisfiesSdkPeerDep: false,
            sdkPeerRange: '^1.0.36-0',
            sourceLabel: 'system'
        };
        const handlers = new InfoSlashHandlers(null, mockBackendState, fakeCapability, { extensionVersion: '3.8.0', sdkVersion: '0.3.0' });

        const result = await handlers.handleVersion();

        expect(result.success).to.be.true;
        expect(result.content).to.include('❌');
        expect(result.content).to.include('1.0.5');
        expect(result.content).to.include('^1.0.36-0');
        expect(result.error).to.be.undefined;
    });

    it('works when no CLI capability available (e.g. before session start)', async () => {
        const handlers = new InfoSlashHandlers(null, mockBackendState, null, { extensionVersion: '3.8.0', sdkVersion: '0.3.0' });

        const result = await handlers.handleVersion();

        expect(result.success).to.be.true;
        expect(result.content).to.include('Version Info');
        expect(result.content).to.include('3.8.0');
        expect(result.content).to.include('0.3.0');
        expect(result.error).to.be.undefined;
    });

    it('works when no version info provided at all', async () => {
        const handlers = new InfoSlashHandlers(null, mockBackendState);

        const result = await handlers.handleVersion();

        expect(result.success).to.be.true;
        expect(result.content).to.include('Version Info');
        expect(result.error).to.be.undefined;
    });
});

describe('InfoSlashHandlers - /usage includes CLI version when capability provided', () => {
    let mockBackendState;

    beforeEach(() => {
        mockBackendState = {
            getSessionStartTime: () => Date.now() - 60000,
            getMessageCount: () => 5,
            getToolCallCount: () => 2
        };
    });

    it('includes CLI version and source when capability provided and peer-dep satisfied', async () => {
        const fakeCapability = {
            cliVersion: '1.0.44',
            satisfiesSdkPeerDep: true,
            sdkPeerRange: '^1.0.36-0',
            sourceLabel: 'local'
        };
        const handlers = new InfoSlashHandlers(null, mockBackendState, fakeCapability);
        const result = await handlers.handleUsage();
        expect(result.success).to.be.true;
        expect(result.content).to.match(/CLI version[^\n]*1\.0\.44/);
        expect(result.content).to.match(/local/);
        expect(result.content).to.match(/satisfies/i);
    });

    it('shows clear warning when CLI does not satisfy SDK peer-dep', async () => {
        const fakeCapability = {
            cliVersion: '1.0.5',
            satisfiesSdkPeerDep: false,
            sdkPeerRange: '^1.0.36-0',
            sourceLabel: 'system'
        };
        const handlers = new InfoSlashHandlers(null, mockBackendState, fakeCapability);
        const result = await handlers.handleUsage();
        expect(result.success).to.be.true;
        expect(result.content).to.match(/1\.0\.5/);
        expect(result.content).to.match(/DOES NOT satisfy/i);
        expect(result.content).to.match(/\^1\.0\.36-0/);
    });

    it('omits CLI version section when no capability provided', async () => {
        const handlers = new InfoSlashHandlers(null, mockBackendState);
        const result = await handlers.handleUsage();
        expect(result.success).to.be.true;
        expect(result.content).to.not.match(/CLI version/i);
    });
});
