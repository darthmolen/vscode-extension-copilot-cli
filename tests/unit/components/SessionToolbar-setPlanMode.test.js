/**
 * TDD Test for SessionToolbar.setPlanMode() method
 *
 * Fixes: TypeError: sessionToolbar.setPlanMode is not a function
 *
 * TDD Process:
 * RED: Test failed - method didn't exist
 * GREEN: Added setPlanMode() method - test passes
 */

const assert = require('assert');
const { JSDOM } = require('jsdom');

describe('SessionToolbar.setPlanMode()', () => {
	let dom, document, sessionToolbar, container;

	beforeEach(() => {
		// Setup DOM environment
		dom = new JSDOM(`<!DOCTYPE html><div id="container"></div>`);
		document = dom.window.document;
		global.document = document;
		global.window = dom.window;

		container = document.getElementById('container');
	});

	afterEach(() => {
		if (sessionToolbar && typeof sessionToolbar.destroy === 'function') {
			sessionToolbar.destroy();
		}
		delete global.document;
		delete global.window;
	});

	it('should have setPlanMode method', async () => {
		const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

		sessionToolbar = new SessionToolbar(container);

		assert.strictEqual(typeof sessionToolbar.setPlanMode, 'function',
			'SessionToolbar should have setPlanMode method');
	});

	it('should update planMode property when setPlanMode called', async () => {
		const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

		sessionToolbar = new SessionToolbar(container);

		sessionToolbar.setPlanMode(true);
		assert.strictEqual(sessionToolbar.planMode, true, 'planMode should be set to true');

		sessionToolbar.setPlanMode(false);
		assert.strictEqual(sessionToolbar.planMode, false, 'planMode should be set to false');
	});
});
