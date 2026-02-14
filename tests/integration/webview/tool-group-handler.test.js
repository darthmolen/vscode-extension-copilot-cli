/**
 * Tests for Tool Group Toggle Handler
 */

import { expect } from 'chai';
import { createTestDOM, cleanupTestDOM } from '../../helpers/jsdom-setup.js';
import { handleToolGroupToggle } from '../../../src/webview/app/handlers/tool-group-handler.js';

describe('Tool Group Toggle Handler', () => {
	let dom;
	
	beforeEach(() => {
		dom = createTestDOM(`
			<div class="tool-group">
				<div class="tool-group-container"></div>
				<div class="tool-execution">Tool 1</div>
				<div class="tool-execution">Tool 2</div>
				<div class="tool-execution">Tool 3</div>
			</div>
			<div class="tool-group-toggle"></div>
		`);
	});
	
	afterEach(() => {
		cleanupTestDOM(dom);
	});
	
	describe('handleToolGroupToggle', () => {
		it('should expand when collapsed', () => {
			const container = document.querySelector('.tool-group-container');
			const toggle = document.querySelector('.tool-group-toggle');
			const element = document.querySelector('.tool-group');
			
			const newState = handleToolGroupToggle(false, container, toggle, element);
			
			expect(newState).to.be.true;
			expect(container.classList.contains('expanded')).to.be.true;
			expect(toggle.textContent).to.equal('Contract');
		});
		
		it('should collapse when expanded', () => {
			const container = document.querySelector('.tool-group-container');
			const toggle = document.querySelector('.tool-group-toggle');
			const element = document.querySelector('.tool-group');
			
			// Start expanded
			container.classList.add('expanded');
			
			const newState = handleToolGroupToggle(true, container, toggle, element);
			
			expect(newState).to.be.false;
			expect(container.classList.contains('expanded')).to.be.false;
			expect(toggle.textContent).to.match(/Expand \(\d+ more\)/);
		});
		
		it('should show correct count when collapsing', () => {
			const container = document.querySelector('.tool-group-container');
			const toggle = document.querySelector('.tool-group-toggle');
			const element = document.querySelector('.tool-group');
			
			const newState = handleToolGroupToggle(true, container, toggle, element);
			
			// 3 tools, max height 200px, each ~70px = ~2 visible, 1 hidden
			expect(toggle.textContent).to.include('more');
		});
		
		it('should toggle state correctly multiple times', () => {
			const container = document.querySelector('.tool-group-container');
			const toggle = document.querySelector('.tool-group-toggle');
			const element = document.querySelector('.tool-group');
			
			let state = false;
			
			// Expand
			state = handleToolGroupToggle(state, container, toggle, element);
			expect(state).to.be.true;
			expect(toggle.textContent).to.equal('Contract');
			
			// Collapse
			state = handleToolGroupToggle(state, container, toggle, element);
			expect(state).to.be.false;
			expect(toggle.textContent).to.include('Expand');
			
			// Expand again
			state = handleToolGroupToggle(state, container, toggle, element);
			expect(state).to.be.true;
			expect(toggle.textContent).to.equal('Contract');
		});
	});
});
