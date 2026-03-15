/**
 * TDD tests for /agent slash command (Phase 12)
 *
 * The /agent command sets a sticky active agent for the session.
 * It must be an 'extension' type command (currently 'passthrough').
 *
 * RED phase: Tests fail because /agent is currently passthrough type.
 */

import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { CommandParser } from '../../../src/webview/app/services/CommandParser.js';

describe('CommandParser - /agent command', () => {
	let parser;

	beforeEach(() => {
		parser = new CommandParser();
	});

	it('/agent is parsed correctly', () => {
		const result = parser.parse('/agent');
		expect(result).to.not.be.null;
		expect(result.command).to.equal('agent');
	});

	it('/agent reviewer parses the agent name as args', () => {
		const result = parser.parse('/agent reviewer');
		expect(result).to.not.be.null;
		expect(result.command).to.equal('agent');
		expect(result.args).to.deep.equal(['reviewer']);
	});

	it('/agent with no args is valid (clears active agent)', () => {
		const result = parser.parse('/agent');
		expect(result.args).to.deep.equal([]);
	});

	it('/agent is extension type (not passthrough)', () => {
		const result = parser.parse('/agent');
		expect(parser.getCommandType(result.command)).to.equal('extension');
	});

	it('/agent event is selectAgent', () => {
		const result = parser.parse('/agent');
		expect(parser.getEvent(result.command)).to.equal('selectAgent');
	});

	it('/agent is valid regardless of plan mode', () => {
		const result = parser.parse('/agent reviewer');
		expect(parser.isValid(result, { planMode: false, planReady: false })).to.be.true;
		expect(parser.isValid(result, { planMode: true, planReady: false })).to.be.true;
	});

	it('/agent unknown-name is valid syntactically (validation in handler)', () => {
		const result = parser.parse('/agent unknown-name');
		expect(result).to.not.be.null;
		expect(result.command).to.equal('agent');
		expect(result.args[0]).to.equal('unknown-name');
	});
});
