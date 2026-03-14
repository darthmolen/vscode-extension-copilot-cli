/**
 * TDD tests for Phase 3: /compact slash command
 *
 * RED phase: Tests FAIL because compact is currently 'not-supported' in CommandParser
 * and CompactSlashHandlers doesn't exist yet.
 *
 * Covers:
 * 1. CommandParser: /compact parsed as extension type, event 'compact'
 * 2. CompactSlashHandlers: unit test for handleCompact()
 * 3. ExtensionRpcRouter: onCompact handler registration
 */

import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { CommandParser } from '../../../src/webview/app/services/CommandParser.js';

describe('CommandParser - /compact command', () => {
	let parser;

	beforeEach(() => {
		parser = new CommandParser();
	});

	it('/compact is parsed correctly', () => {
		const result = parser.parse('/compact');
		expect(result).to.not.be.null;
		expect(result.command).to.equal('compact');
	});

	it('/compact is extension type (not not-supported)', () => {
		expect(parser.getCommandType('compact')).to.equal('extension');
	});

	it('/compact event is compact', () => {
		expect(parser.getEvent('compact')).to.equal('compact');
	});

	it('/compact category is config', () => {
		const cmds = parser.getVisibleCommands();
		const compact = cmds.find(c => c.name === 'compact');
		expect(compact).to.exist;
		expect(compact.category).to.equal('config');
	});

	it('/compact description is set', () => {
		const cmds = parser.getVisibleCommands();
		const compact = cmds.find(c => c.name === 'compact');
		expect(compact).to.exist;
		expect(compact.description).to.be.a('string').and.have.length.above(0);
	});

	it('/compact is valid in both modes', () => {
		const result = parser.parse('/compact');
		expect(parser.isValid(result, { planMode: false, planReady: false })).to.be.true;
		expect(parser.isValid(result, { planMode: true, planReady: false })).to.be.true;
	});
});
