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

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

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
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			
			assert.ok(sessionToolbar, 'SessionToolbar should be created');
			assert.ok(container.querySelector('.session-toolbar'), 'Should render toolbar container');
		});
	});
	
	describe('Session Dropdown', () => {
		it('should create session dropdown element', async () => {
			// RED: This will fail until SessionToolbar is created
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			
			const dropdown = container.querySelector('#sessionDropdown');
			assert.ok(dropdown, 'Session dropdown should exist');
			assert.equal(dropdown.tagName, 'SELECT', 'Should be a select element');
		});
		
		it('should populate dropdown with sessions', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
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
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
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
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			
			const btn = container.querySelector('#newSessionBtn');
			assert.ok(btn, 'New session button should exist');
			assert.equal(btn.textContent.trim(), '+', 'Button should show + icon');
		});
		
		it('should emit newSession event when clicked', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
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
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			
			const btn = container.querySelector('#viewPlanBtn');
			assert.ok(btn, 'View plan button should exist');
			assert.ok(btn.textContent.includes('📋'), 'Button should show plan icon');
		});
		
		it('should hide view plan button by default', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			
			const btn = container.querySelector('#viewPlanBtn');
			assert.equal(btn.style.display, 'none', 'Button should be hidden initially');
		});
		
		it('should show view plan button when workspace path is set', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			sessionToolbar.setWorkspacePath('/path/to/workspace');
			
			const btn = container.querySelector('#viewPlanBtn');
			assert.notEqual(btn.style.display, 'none', 'Button should be visible');
		});
		
		it('should emit viewPlan event when clicked', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			
			let eventEmitted = false;
			sessionToolbar.on('viewPlan', () => {
				eventEmitted = true;
			});
			
			const btn = container.querySelector('#viewPlanBtn');
			btn.click();
			
			assert.ok(eventEmitted, 'Should emit viewPlan event');
		});
	});
	
	describe('Plan Mode Buttons', () => {
		it('should create enter plan mode button', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			
			const btn = container.querySelector('#enterPlanModeBtn');
			assert.ok(btn, 'Enter plan mode button should exist');
		});
		
		it('should create accept plan button', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			
			const btn = container.querySelector('#acceptPlanBtn');
			assert.ok(btn, 'Accept plan button should exist');
		});
		
		it('should create reject plan button', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			
			const btn = container.querySelector('#rejectPlanBtn');
			assert.ok(btn, 'Reject plan button should exist');
		});
		
		it('should show enter button and hide accept/reject in work mode', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			sessionToolbar.setPlanMode(false);
			
			const enterBtn = container.querySelector('#enterPlanModeBtn');
			const acceptBtn = container.querySelector('#acceptPlanBtn');
			const rejectBtn = container.querySelector('#rejectPlanBtn');
			
			assert.equal(enterBtn.style.display, 'inline-block', 'Enter button should be visible');
			assert.equal(acceptBtn.style.display, 'none', 'Accept button should be hidden');
			assert.equal(rejectBtn.style.display, 'none', 'Reject button should be hidden');
		});
		
		it('should hide enter button and show accept/reject in plan mode', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			sessionToolbar.setPlanMode(true);
			
			const enterBtn = container.querySelector('#enterPlanModeBtn');
			const acceptBtn = container.querySelector('#acceptPlanBtn');
			const rejectBtn = container.querySelector('#rejectPlanBtn');
			
			assert.equal(enterBtn.style.display, 'none', 'Enter button should be hidden');
			assert.equal(acceptBtn.style.display, 'inline-block', 'Accept button should be visible');
			assert.equal(rejectBtn.style.display, 'inline-block', 'Reject button should be visible');
		});
		
		it('should emit togglePlanMode event when enter button clicked', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			
			let emittedValue = null;
			sessionToolbar.on('togglePlanMode', (enabled) => {
				emittedValue = enabled;
			});
			
			const btn = container.querySelector('#enterPlanModeBtn');
			btn.click();
			
			assert.equal(emittedValue, true, 'Should emit togglePlanMode with true');
		});
		
		it('should emit acceptPlan event when accept button clicked', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			sessionToolbar.setPlanMode(true);
			
			let eventEmitted = false;
			sessionToolbar.on('acceptPlan', () => {
				eventEmitted = true;
			});
			
			const btn = container.querySelector('#acceptPlanBtn');
			btn.click();
			
			assert.ok(eventEmitted, 'Should emit acceptPlan event');
		});
		
		it('should emit rejectPlan event when reject button clicked', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			sessionToolbar.setPlanMode(true);
			
			let eventEmitted = false;
			sessionToolbar.on('rejectPlan', () => {
				eventEmitted = true;
			});
			
			const btn = container.querySelector('#rejectPlanBtn');
			btn.click();
			
			assert.ok(eventEmitted, 'Should emit rejectPlan event');
		});
	});
	
	describe('Event Emitter Interface', () => {
		it('should support on() for event listeners', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			
			assert.equal(typeof sessionToolbar.on, 'function', 'Should have on() method');
		});
		
		it('should support off() for removing listeners', async () => {
			const { SessionToolbar } = await import('../src/webview/app/components/SessionToolbar/SessionToolbar.js');
			
			sessionToolbar = new SessionToolbar(container);
			
			assert.equal(typeof sessionToolbar.off, 'function', 'Should have off() method');
		});
	});
});
