/**
 * SessionToolbar Component Tests
 *
 * Tests for session dropdown, new session button, view plan button,
 * and plan mode buttons (enter/accept/reject).
 *
 * Following RED-GREEN-REFACTOR TDD:
 * - These tests should FAIL initially (module not found)
 * - After creating SessionToolbar.js, they should PASS
 */

const assert = require('assert');
const { JSDOM } = require('jsdom');

describe('SessionToolbar Component', () => {
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

	describe('Component Creation', () => {
		it('should create SessionToolbar instance', async () => {
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);

			assert.ok(sessionToolbar, 'SessionToolbar should be created');
			assert.ok(container.querySelector('.session-toolbar'), 'Should render toolbar container');
		});
	});

	describe('Session Dropdown', () => {
		it('should create session dropdown element', async () => {
			// RED: This will fail until SessionToolbar is created
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);

			const dropdown = container.querySelector('#sessionDropdown');
			assert.ok(dropdown, 'Session dropdown should exist');
			assert.equal(dropdown.tagName, 'SELECT', 'Should be a select element');
		});

		it('should populate dropdown with sessions', async () => {
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);

			const sessions = [
				{ id: 'session-1', label: 'Session 1' },
				{ id: 'session-2', label: 'Session 2' }
			];

			sessionToolbar.updateSessions(sessions, 'session-1');

			const dropdown = container.querySelector('#sessionDropdown');
			assert.equal(dropdown.options.length, 2, 'Should have 2 options');
			assert.equal(dropdown.value, 'session-1', 'Should select current session');
		});

		it('should emit switchSession event when selection changes', async () => {
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);

			const sessions = [
				{ id: 'session-1', label: 'Session 1' },
				{ id: 'session-2', label: 'Session 2' }
			];

			sessionToolbar.updateSessions(sessions, 'session-1');

			let emittedSessionId = null;
			sessionToolbar.on('switchSession', (sessionId) => {
				emittedSessionId = sessionId;
			});

			const dropdown = container.querySelector('#sessionDropdown');
			dropdown.value = 'session-2';
			dropdown.dispatchEvent(new dom.window.Event('change'));

			assert.equal(emittedSessionId, 'session-2', 'Should emit switchSession with new session ID');
		});
	});

	describe('New Session Button', () => {
		it('should create new session button', async () => {
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);

			const btn = container.querySelector('#newSessionBtn');
			assert.ok(btn, 'New session button should exist');
			assert.equal(btn.textContent.trim(), '+', 'Button should show + icon');
		});

		it('should emit newSession event when clicked', async () => {
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);

			let eventEmitted = false;
			sessionToolbar.on('newSession', () => {
				eventEmitted = true;
			});

			const btn = container.querySelector('#newSessionBtn');
			btn.click();

			assert.ok(eventEmitted, 'Should emit newSession event');
		});
	});

	describe('View Plan Button', () => {
		it('should create view plan button', async () => {
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);

			const btn = container.querySelector('#viewPlanBtn');
			assert.ok(btn, 'View plan button should exist');
			assert.ok(btn.textContent.includes('\uD83D\uDCCB'), 'Button should show plan icon');
		});

		it('should be disabled by default when no plan file exists', async () => {
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);

			const btn = container.querySelector('#viewPlanBtn');
			assert.ok(btn.disabled, 'Button should be disabled initially');
			assert.ok(btn.classList.contains('disabled'), 'Button should have disabled class');
		});

		it('should be enabled when plan file exists', async () => {
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);
			sessionToolbar.setPlanFileExists(true);

			const btn = container.querySelector('#viewPlanBtn');
			assert.ok(!btn.disabled, 'Button should be enabled');
			assert.ok(!btn.classList.contains('disabled'), 'Button should not have disabled class');
		});

		it('should be disabled when plan file does not exist', async () => {
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);
			sessionToolbar.setPlanFileExists(true);
			sessionToolbar.setPlanFileExists(false);

			const btn = container.querySelector('#viewPlanBtn');
			assert.ok(btn.disabled, 'Button should be disabled');
			assert.ok(btn.classList.contains('disabled'), 'Button should have disabled class');
		});

		it('should emit viewPlan event when clicked (if enabled)', async () => {
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);
			sessionToolbar.setPlanFileExists(true);

			let eventEmitted = false;
			sessionToolbar.on('viewPlan', () => {
				eventEmitted = true;
			});

			const btn = container.querySelector('#viewPlanBtn');
			btn.click();

			assert.ok(eventEmitted, 'Should emit viewPlan event');
		});
	});

	describe('Event Emitter Interface', () => {
		it('should support on() for event listeners', async () => {
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);

			assert.equal(typeof sessionToolbar.on, 'function', 'Should have on() method');
		});

		it('should support off() for removing listeners', async () => {
			const { SessionToolbar } = await import('../../../src/webview/app/components/SessionToolbar/SessionToolbar.js');

			sessionToolbar = new SessionToolbar(container);

			assert.equal(typeof sessionToolbar.off, 'function', 'Should have off() method');
		});
	});
});
