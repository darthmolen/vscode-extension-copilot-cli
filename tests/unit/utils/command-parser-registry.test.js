import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { CommandParser } from '../../../src/webview/app/services/CommandParser.js';

describe('CommandParser - Command Registry (TDD RED Phase)', () => {
	let parser;

	beforeEach(() => {
		parser = new CommandParser();
	});

	describe('Extension Commands (10 total)', () => {
		it('recognizes /plan as extension command', () => {
			expect(parser.getCommandType('plan')).to.equal('extension');
		});

		it('recognizes /exit as extension command', () => {
			expect(parser.getCommandType('exit')).to.equal('extension');
		});

		it('recognizes /accept as extension command', () => {
			expect(parser.getCommandType('accept')).to.equal('extension');
		});

		it('recognizes /reject as extension command', () => {
			expect(parser.getCommandType('reject')).to.equal('extension');
		});

		it('recognizes /review as extension command', () => {
			expect(parser.getCommandType('review')).to.equal('extension');
		});

		it('recognizes /diff as extension command', () => {
			expect(parser.getCommandType('diff')).to.equal('extension');
		});

		it('recognizes /mcp as extension command', () => {
			expect(parser.getCommandType('mcp')).to.equal('extension');
		});

		it('recognizes /usage as extension command', () => {
			expect(parser.getCommandType('usage')).to.equal('extension');
		});

		it('recognizes /help as extension command', () => {
			expect(parser.getCommandType('help')).to.equal('extension');
		});

		it('recognizes /model as extension command', () => {
			expect(parser.getCommandType('model')).to.equal('extension');
		});
	});

	describe('CLI Passthrough Commands (6 total)', () => {
		it('recognizes /delegate as passthrough command', () => {
			expect(parser.getCommandType('delegate')).to.equal('passthrough');
		});

		it('recognizes /agent as passthrough command', () => {
			expect(parser.getCommandType('agent')).to.equal('passthrough');
		});

		it('recognizes /skills as passthrough command', () => {
			expect(parser.getCommandType('skills')).to.equal('passthrough');
		});

		it('recognizes /plugin as passthrough command', () => {
			expect(parser.getCommandType('plugin')).to.equal('passthrough');
		});

		it('recognizes /login as passthrough command', () => {
			expect(parser.getCommandType('login')).to.equal('passthrough');
		});

		it('recognizes /logout as passthrough command', () => {
			expect(parser.getCommandType('logout')).to.equal('passthrough');
		});
	});

	describe('Not Supported Commands (25 total)', () => {
		const notSupportedCommands = [
			// Session management
			'clear', 'new', 'resume', 'rename', 'session',
			// Context & files
			'add-dir', 'list-dirs', 'cwd', 'cd', 'context', 'compact',
			// Advanced config
			'lsp', 'theme', 'terminal-setup', 'init',
			// Permissions
			'allow-all', 'yolo', 'reset-allowed-tools',
			// User management
			'user',
			// Other utility
			'feedback', 'share', 'experimental', 'ide', 'quit'
		];

		notSupportedCommands.forEach((command) => {
			it(`recognizes /${command} as not-supported command`, () => {
				expect(parser.getCommandType(command)).to.equal('not-supported');
			});
		});
	});

	describe('Unknown Commands', () => {
		it('returns null for unknown command', () => {
			expect(parser.getCommandType('foobar')).to.be.null;
		});

		it('returns null for empty string', () => {
			expect(parser.getCommandType('')).to.be.null;
		});

		it('returns null for undefined', () => {
			expect(parser.getCommandType(undefined)).to.be.null;
		});
	});

	describe('Helper Methods', () => {
		it('isExtensionCommand returns true for extension commands', () => {
			expect(parser.isExtensionCommand('review')).to.be.true;
			expect(parser.isExtensionCommand('diff')).to.be.true;
		});

		it('isExtensionCommand returns false for non-extension commands', () => {
			expect(parser.isExtensionCommand('delegate')).to.be.false;
			expect(parser.isExtensionCommand('clear')).to.be.false;
		});

		it('isPassthroughCommand returns true for passthrough commands', () => {
			expect(parser.isPassthroughCommand('delegate')).to.be.true;
			expect(parser.isPassthroughCommand('login')).to.be.true;
		});

		it('isPassthroughCommand returns false for non-passthrough commands', () => {
			expect(parser.isPassthroughCommand('review')).to.be.false;
			expect(parser.isPassthroughCommand('clear')).to.be.false;
		});

		it('isNotSupportedCommand returns true for not-supported commands', () => {
			expect(parser.isNotSupportedCommand('clear')).to.be.true;
			expect(parser.isNotSupportedCommand('user')).to.be.true;
		});

		it('isNotSupportedCommand returns false for supported commands', () => {
			expect(parser.isNotSupportedCommand('review')).to.be.false;
			expect(parser.isNotSupportedCommand('delegate')).to.be.false;
		});
	});

	describe('Command Metadata', () => {
		it('returns instruction for passthrough commands', () => {
			const instruction = parser.getInstruction('delegate');
			expect(instruction).to.be.a('string');
			expect(instruction).to.include('GitHub Copilot coding agent');
		});

		it('returns null for non-passthrough commands', () => {
			expect(parser.getInstruction('review')).to.be.null;
			expect(parser.getInstruction('clear')).to.be.null;
		});
	});
});
