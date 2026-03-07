/**
 * TDD tests for Feature 2: /rename slash command
 *
 * The /rename command should be an 'extension' type command (not 'not-supported')
 * that emits the 'renameSession' event. The CLI SDK fires session.title_changed
 * when /rename runs.
 *
 * RED phase: These tests FAIL because rename is currently 'not-supported'.
 */

import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { CommandParser } from '../../../src/webview/app/services/CommandParser.js';

describe('CommandParser - /rename command', () => {
	let parser;

	beforeEach(() => {
		parser = new CommandParser();
	});

	it('/rename is parsed correctly', () => {
		const result = parser.parse('/rename');
		expect(result).to.not.be.null;
		expect(result.command).to.equal('rename');
	});

	it('/rename with args parses the name', () => {
		const result = parser.parse('/rename My Feature Branch');
		expect(result).to.not.be.null;
		expect(result.command).to.equal('rename');
		expect(result.args).to.deep.equal(['My', 'Feature', 'Branch']);
	});

	it('/rename is extension type (not not-supported)', () => {
		const result = parser.parse('/rename');
		expect(parser.getCommandType(result.command)).to.equal('extension');
	});

	it('/rename event is renameSession', () => {
		const result = parser.parse('/rename');
		expect(parser.getEvent(result.command)).to.equal('renameSession');
	});

	it('/rename is valid in work mode (no required context)', () => {
		const result = parser.parse('/rename My Session');
		// Should be valid regardless of plan mode
		const isValid = parser.isValid(result, { planMode: false, planReady: false });
		expect(isValid).to.be.true;
	});

	it('/rename is valid in plan mode too', () => {
		const result = parser.parse('/rename My Session');
		const isValid = parser.isValid(result, { planMode: true, planReady: false });
		expect(isValid).to.be.true;
	});

	it('getCommand returns rename definition', () => {
		const type = parser.getCommandType('rename');
		const event = parser.getEvent('rename');
		expect(type).to.equal('extension');
		expect(event).to.equal('renameSession');
	});
});
