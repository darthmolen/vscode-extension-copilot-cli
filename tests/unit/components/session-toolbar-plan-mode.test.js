import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { SessionToolbar } from '../../../src/webview/app/components/SessionToolbar/SessionToolbar.js';

describe('SessionToolbar - Plan Mode Sessions', () => {
	let dom, container, toolbar;

	beforeEach(() => {
		dom = new JSDOM(`<!DOCTYPE html><div id="toolbar-container"></div>`);
		global.document = dom.window.document;
		global.window = dom.window;
		container = document.getElementById('toolbar-container');
		toolbar = new SessionToolbar(container);
	});

	it('should display plan session as selected when switching to plan mode', () => {
		// Initial state: work session selected
		toolbar.updateSessions([
			{ id: 'abc123', label: 'abc123 (Feb 14)' }
		], 'abc123');

		const dropdown = container.querySelector('#sessionDropdown');
		expect(dropdown.value).to.equal('abc123');

		// Plan mode: session list updated with plan session
		toolbar.updateSessions([
			{ id: 'abc123', label: 'abc123 (Feb 14)' },
			{ id: 'abc123-plan', label: 'abc123-plan (Feb 14)' }
		], 'abc123-plan');

		expect(dropdown.value).to.equal('abc123-plan');
	});

	it('should revert to work session when plan mode exits', () => {
		// In plan mode
		toolbar.updateSessions([
			{ id: 'abc123', label: 'abc123 (Feb 14)' },
			{ id: 'abc123-plan', label: 'abc123-plan (Feb 14)' }
		], 'abc123-plan');

		const dropdown = container.querySelector('#sessionDropdown');
		expect(dropdown.value).to.equal('abc123-plan');

		// Plan mode exits — revert to work session
		toolbar.updateSessions([
			{ id: 'abc123', label: 'abc123 (Feb 14)' }
		], 'abc123');

		expect(dropdown.value).to.equal('abc123');
	});

	it('should include plan session option in dropdown during plan mode', () => {
		toolbar.updateSessions([
			{ id: 'abc123', label: 'abc123 (Feb 14)' },
			{ id: 'abc123-plan', label: 'abc123-plan (Feb 14)' }
		], 'abc123-plan');

		const dropdown = container.querySelector('#sessionDropdown');
		const options = Array.from(dropdown.querySelectorAll('option'));
		const planOption = options.find(o => o.value === 'abc123-plan');

		expect(planOption, 'Plan session should be in dropdown options').to.exist;
		expect(planOption.selected).to.be.true;
	});
});
