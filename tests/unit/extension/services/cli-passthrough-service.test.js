/**
 * Tests for CLIPassthroughService
 * Task 5: CLI Terminal Passthrough Service
 */

const { expect } = require('chai');
const path = require('path');

describe('CLIPassthroughService', () => {
    let CLIPassthroughService;

    before(async () => {
        const modulePath = path.join(__dirname, '../../../../out/extension/services/CLIPassthroughService.js');
        const module = require(modulePath);
        CLIPassthroughService = module.CLIPassthroughService;
    });

    let service;
    let mockTerminals = [];
    let mockVscode;

    beforeEach(() => {
        // Reset mock terminals
        mockTerminals = [];

        // Mock VS Code API
        mockVscode = {
            window: {
                createTerminal: (options) => {
                    const terminal = {
                        name: options.name || 'Terminal',
                        cwd: options.cwd,
                        shown: false,
                        sentText: [],
                        show: function() { this.shown = true; },
                        sendText: function(text) { this.sentText.push(text); },
                        dispose: function() { /* cleanup */ }
                    };
                    mockTerminals.push(terminal);
                    return terminal;
                },
                terminals: mockTerminals
            }
        };

        service = new CLIPassthroughService(mockVscode);
    });

    describe('Instruction Messages', () => {
        it('should return instruction for /delegate command', () => {
            const instruction = service.getInstructionMessage('delegate');
            expect(instruction).to.equal('The `/delegate` command opens GitHub Copilot coding agent in a new PR. Opening terminal...');
        });

        it('should return instruction for /agent command', () => {
            const instruction = service.getInstructionMessage('agent');
            expect(instruction).to.equal('The `/agent` command lets you select specialized agents (refactoring, code-review, etc.). Opening terminal...');
        });

        it('should return instruction for /skills command', () => {
            const instruction = service.getInstructionMessage('skills');
            expect(instruction).to.equal('The `/skills` command manages custom scripts and resources. Opening terminal...');
        });

        it('should return instruction for /plugin command', () => {
            const instruction = service.getInstructionMessage('plugin');
            expect(instruction).to.equal('The `/plugin` command installs extensions from the marketplace. Opening terminal...');
        });

        it('should return instruction for /login command', () => {
            const instruction = service.getInstructionMessage('login');
            expect(instruction).to.equal('Opening terminal to authenticate with GitHub Copilot...');
        });

        it('should return instruction for /logout command', () => {
            const instruction = service.getInstructionMessage('logout');
            expect(instruction).to.equal('Opening terminal to log out of GitHub Copilot...');
        });

        it('should return generic instruction for unknown command', () => {
            const instruction = service.getInstructionMessage('unknown');
            expect(instruction).to.equal('Opening Copilot CLI in terminal...');
        });
    });

    describe('Terminal Creation', () => {
        it('should create terminal with correct name', () => {
            const result = service.openCLI('/delegate', 'session-123', '/workspace');

            expect(mockTerminals).to.have.length(1);
            expect(mockTerminals[0].name).to.equal('Copilot CLI');
        });

        it('should create terminal with workspace path as cwd', () => {
            const result = service.openCLI('/agent', 'session-456', '/my/workspace');

            expect(mockTerminals[0].cwd).to.equal('/my/workspace');
        });

        it('should show terminal after creation', () => {
            const result = service.openCLI('/skills', 'session-789', '/workspace');

            expect(mockTerminals[0].shown).to.be.true;
        });

        it('should reuse existing Copilot CLI terminal if available', () => {
            // First call creates terminal
            service.openCLI('/delegate', 'session-1', '/workspace');
            expect(mockTerminals).to.have.length(1);

            // Second call reuses terminal
            service.openCLI('/agent', 'session-1', '/workspace');
            expect(mockTerminals).to.have.length(1);
        });
    });

    describe('Command Execution', () => {
        it('should send copilot command with --resume flag', () => {
            const result = service.openCLI('/delegate', 'session-abc-123', '/workspace');

            const sentCommands = mockTerminals[0].sentText;
            expect(sentCommands).to.include.members(['copilot --resume session-abc-123']);
        });

        it('should send initial command after base command', () => {
            const result = service.openCLI('/delegate my task', 'session-123', '/workspace');

            const sentCommands = mockTerminals[0].sentText;
            expect(sentCommands).to.have.length(2);
            expect(sentCommands[0]).to.equal('copilot --resume session-123');
            expect(sentCommands[1]).to.equal('/delegate my task');
        });

        it('should handle command without arguments', () => {
            const result = service.openCLI('/agent', 'session-123', '/workspace');

            const sentCommands = mockTerminals[0].sentText;
            expect(sentCommands[1]).to.equal('/agent');
        });

        it('should handle multi-word command arguments', () => {
            const result = service.openCLI('/skills add my-skill', 'session-123', '/workspace');

            const sentCommands = mockTerminals[0].sentText;
            expect(sentCommands[1]).to.equal('/skills add my-skill');
        });
    });

    describe('Return Values', () => {
        it('should return success true and instruction message', () => {
            const result = service.openCLI('/delegate', 'session-123', '/workspace');

            expect(result.success).to.be.true;
            expect(result.instruction).to.equal('The `/delegate` command opens GitHub Copilot coding agent in a new PR. Opening terminal...');
        });

        it('should return correct instruction for each command', () => {
            const delegateResult = service.openCLI('/delegate', 'session-123', '/workspace');
            expect(delegateResult.instruction).to.include('coding agent');

            const agentResult = service.openCLI('/agent', 'session-123', '/workspace');
            expect(agentResult.instruction).to.include('specialized agents');

            const skillsResult = service.openCLI('/skills', 'session-123', '/workspace');
            expect(skillsResult.instruction).to.include('custom scripts');
        });
    });

    describe('Error Handling', () => {
        it('should handle missing sessionId gracefully', () => {
            const result = service.openCLI('/delegate', null, '/workspace');

            expect(result.success).to.be.false;
            expect(result.error).to.include('sessionId');
        });

        it('should handle missing workspacePath gracefully', () => {
            const result = service.openCLI('/delegate', 'session-123', null);

            expect(result.success).to.be.false;
            expect(result.error).to.include('workspacePath');
        });

        it('should handle terminal creation failure', () => {
            // Override mock to throw error
            mockVscode.window.createTerminal = () => {
                throw new Error('Terminal creation failed');
            };

            service = new CLIPassthroughService(mockVscode);
            const result = service.openCLI('/delegate', 'session-123', '/workspace');

            expect(result.success).to.be.false;
            expect(result.error).to.include('Terminal creation failed');
        });
    });
});
