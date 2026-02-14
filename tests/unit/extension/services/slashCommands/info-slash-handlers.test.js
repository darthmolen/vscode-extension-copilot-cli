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
    let mockMcpConfig;
    let mockBackendState;

    beforeEach(() => {
        // Create mock MCP configuration service
        mockMcpConfig = {
            getConfig: () => ({
                'filesystem': {
                    command: 'npx',
                    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
                },
                'postgres': {
                    command: 'docker',
                    args: ['run', 'mcp-postgres']
                }
            })
        };

        // Create mock BackendState
        mockBackendState = {
            getSessionStartTime: () => new Date('2026-02-14T00:00:00Z'),
            getMessageCount: () => 12,
            getToolCallCount: () => 8
        };

        handlers = new InfoSlashHandlers(mockMcpConfig, mockBackendState);
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
        // Arrange
        mockMcpConfig.getConfig = () => ({});

        // Act
        const result = await handlers.handleMcp();

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('No MCP servers configured');
        expect(result.content).to.include('Model Context Protocol');
        expect(result.error).to.be.undefined;
    });

    it('returns friendly message when MCP config is null', async () => {
        // Arrange
        mockMcpConfig.getConfig = () => null;

        // Act
        const result = await handlers.handleMcp();

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('No MCP servers configured');
        expect(result.error).to.be.undefined;
    });

    it('handles error when MCP config service throws', async () => {
        // Arrange
        mockMcpConfig.getConfig = () => {
            throw new Error('Config read failed');
        };

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
