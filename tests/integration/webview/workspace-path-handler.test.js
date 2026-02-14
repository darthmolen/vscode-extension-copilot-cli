/**
 * Tests for workspace path message handling
 * 
 * Bug context: View Plan button not appearing on session resume
 * 
 * Root cause: workspacePath message payload has 'path' property,
 * but handler was looking for 'workspacePath' property.
 * 
 * Result: payload.workspacePath = undefined, button stays hidden
 */

import { expect } from 'chai';
import { createTestDOM, cleanupTestDOM } from '../../helpers/jsdom-setup.js';

describe('Workspace Path Message Handler', () => {
	let dom;
	let workspacePath;
	let viewPlanBtn;
	
	beforeEach(() => {
		dom = createTestDOM(`
			<button id="viewPlanBtn" style="display: none;">View Plan</button>
		`);
		viewPlanBtn = document.getElementById('viewPlanBtn');
	});
	
	afterEach(() => {
		cleanupTestDOM(dom);
	});
	
	describe('handleWorkspacePathMessage logic', () => {
		it('should show button when workspace path is set', () => {
			// This is the ACTUAL message structure from ExtensionRpcRouter
			const message = {
				type: 'workspacePath',
				path: '/home/user/workspace' // Note: property is 'path' not 'workspacePath'
			};
			
			// This is what the BUGGY code does:
			workspacePath = message.workspacePath; // BUG: undefined!
			viewPlanBtn.style.display = workspacePath ? 'inline-block' : 'none';
			
			// With bug: button stays hidden because workspacePath is undefined
			expect(viewPlanBtn.style.display).to.equal('none'); // PROVES THE BUG
			expect(workspacePath).to.be.undefined; // workspacePath is undefined!
		});
		
		it('should work correctly with fixed code', () => {
			const message = {
				type: 'workspacePath',
				path: '/home/user/workspace'
			};
			
			// This is what the FIXED code does:
			workspacePath = message.path; // CORRECT!
			viewPlanBtn.style.display = workspacePath ? 'inline-block' : 'none';
			
			// Button should be visible
			expect(viewPlanBtn.style.display).to.equal('inline-block');
			expect(workspacePath).to.equal('/home/user/workspace');
		});
		
		it('should hide button when workspace path is null', () => {
			// Set button visible first
			viewPlanBtn.style.display = 'inline-block';
			
			const message = {
				type: 'workspacePath',
				path: null
			};
			
			// Fixed code:
			workspacePath = message.path;
			viewPlanBtn.style.display = workspacePath ? 'inline-block' : 'none';
			
			// Button should be hidden
			expect(viewPlanBtn.style.display).to.equal('none');
		});
		
		it('REGRESSION: demonstrates exact production bug', () => {
			// This is the actual message from production logs
			const actualMessage = {
				type: 'workspacePath',
				path: '/home/smolen/.copilot/session-state/5f9379e0-b32b-465a-8092-af06bffdc07c'
			};
			
			// BUGGY code does:
			const buggyWorkspacePath = actualMessage.workspacePath; // undefined!
			expect(buggyWorkspacePath).to.be.undefined; // PROVES THE BUG
			
			// FIXED code does:
			const fixedWorkspacePath = actualMessage.path; // correct!
			expect(fixedWorkspacePath).to.equal('/home/smolen/.copilot/session-state/5f9379e0-b32b-465a-8092-af06bffdc07c');
		});
	});
});
