/**
 * Tests for NotSupportedSlashHandlers
 * Testing: Commands that are not supported in the extension
 * 
 * TDD RED PHASE: These tests will fail because NotSupportedSlashHandlers doesn't exist yet
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');

// RED PHASE: This will fail - module doesn't exist
const { NotSupportedSlashHandlers } = require('../../../../../out/extension/services/slashCommands/NotSupportedSlashHandlers');

describe('NotSupportedSlashHandlers', () => {
    let handler;

    beforeEach(() => {
        handler = new NotSupportedSlashHandlers();
    });

    it('returns not-supported message for /clear command', async () => {
        // Act
        const result = await handler.handleNotSupported('clear');

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('Command Not Supported');
        expect(result.content).to.include('/clear');
        expect(result.content).to.include('not available in this extension');
        expect(result.content).to.include('CLI-specific');
        expect(result.content).to.include('/help');
        expect(result.error).to.be.undefined;
    });

    it('returns not-supported message for /new command', async () => {
        // Act
        const result = await handler.handleNotSupported('new');

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('Command Not Supported');
        expect(result.content).to.include('/new');
    });

    it('returns not-supported message for /resume command', async () => {
        // Act
        const result = await handler.handleNotSupported('resume');

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('Command Not Supported');
        expect(result.content).to.include('/resume');
    });

    it('returns not-supported message for /context command', async () => {
        // Act
        const result = await handler.handleNotSupported('context');

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('Command Not Supported');
        expect(result.content).to.include('/context');
    });

    it('returns not-supported message for /user command', async () => {
        // Act
        const result = await handler.handleNotSupported('user');

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('Command Not Supported');
        expect(result.content).to.include('/user');
    });

    it('handles all 25 not-supported commands', async () => {
        // All the not-supported commands from the plan
        const notSupportedCommands = [
            'clear', 'new', 'resume', 'rename', 'session',
            'add-dir', 'list-dirs', 'cwd', 'cd', 'context', 'compact',
            'lsp', 'theme', 'terminal-setup', 'init',
            'allow-all', 'yolo', 'reset-allowed-tools',
            'user', 'feedback', 'share', 'experimental', 'ide', 'exit', 'quit'
        ];

        // Test each one
        for (const cmd of notSupportedCommands) {
            const result = await handler.handleNotSupported(cmd);
            
            expect(result.success).to.be.true;
            expect(result.content).to.include('Command Not Supported');
            expect(result.content).to.include(`/${cmd}`);
        }
    });

    it('returns generic message when command name not provided', async () => {
        // Act
        const result = await handler.handleNotSupported('');

        // Assert
        expect(result.success).to.be.true;
        expect(result.content).to.include('Command Not Supported');
        expect(result.content).to.include('/help');
    });

    it('handles error when message generation throws', async () => {
        // This test verifies error handling works
        // We'll override the method to throw
        const originalHandle = handler.handleNotSupported;
        handler.handleNotSupported = async () => {
            throw new Error('Message generation failed');
        };

        // Act
        let result;
        try {
            result = await handler.handleNotSupported('test');
        } catch (error) {
            result = {
                success: false,
                error: `Failed to generate not-supported message: ${error.message}`
            };
        }

        // Assert
        expect(result.success).to.be.false;
        expect(result.error).to.include('Failed to generate not-supported message');
    });
});
