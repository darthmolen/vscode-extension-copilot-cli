/**
 * TDD tests for Feature 3: Blue outline on input area in plan mode
 *
 * When plan mode is active, the input area container should have a
 * 'plan-mode-active' CSS class to show the blue outline.
 * When plan mode is deactivated, the class should be removed.
 *
 * RED phase: These tests should FAIL until InputArea.setPlanMode()
 * toggles the 'plan-mode-active' class on this.container.
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { InputArea } from '../../../src/webview/app/components/InputArea/InputArea.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

describe('InputArea - plan-mode-active CSS class (blue outline)', () => {
	let dom, document, mountPoint, eventBus, inputArea;

	beforeEach(() => {
		dom = new JSDOM(`<!DOCTYPE html><html><body><div id="input-mount"></div></body></html>`);
		document = dom.window.document;
		global.document = document;
		global.window = dom.window;

		mountPoint = document.getElementById('input-mount');
		eventBus = new EventBus();
		inputArea = new InputArea(mountPoint, eventBus);
	});

	afterEach(() => {
		delete global.document;
		delete global.window;
		inputArea = null;
	});

	it('does NOT have plan-mode-active class initially', () => {
		expect(inputArea.container.classList.contains('plan-mode-active')).to.be.false;
	});

	it('adds plan-mode-active class when plan mode enabled', () => {
		inputArea.setPlanMode(true, false);
		expect(inputArea.container.classList.contains('plan-mode-active')).to.be.true;
	});

	it('removes plan-mode-active class when plan mode disabled', () => {
		// First enable
		inputArea.setPlanMode(true, false);
		expect(inputArea.container.classList.contains('plan-mode-active')).to.be.true;

		// Then disable
		inputArea.setPlanMode(false, false);
		expect(inputArea.container.classList.contains('plan-mode-active')).to.be.false;
	});

	it('adds plan-mode-active class when plan is ready (still in plan mode)', () => {
		inputArea.setPlanMode(true, true);
		expect(inputArea.container.classList.contains('plan-mode-active')).to.be.true;
	});

	it('class is on the container element (not inner elements)', () => {
		inputArea.setPlanMode(true, false);
		// container is the root element InputArea manages
		expect(inputArea.container.classList.contains('plan-mode-active')).to.be.true;
	});
});
