/**
 * Tests for UI Event Handlers
 * 
 * These tests verify extracted event handler functions work correctly.
 * Each test imports ACTUAL production code and tests it with JSDOM.
 */

import { expect } from 'chai';
import { createTestDOM, cleanupTestDOM } from '../helpers/jsdom-setup.js';
import { handleReasoningToggle } from '../../src/webview/handlers/ui-handlers.js';

describe('UI Event Handlers', () => {
	let dom;
	
	afterEach(() => {
		cleanupTestDOM(dom);
	});
	
	describe('handleReasoningToggle', () => {
		it('should hide reasoning messages when unchecked', () => {
			dom = createTestDOM(`
				<div id="container">
					<div class="message reasoning" style="display: block;">Reasoning 1</div>
					<div class="message user">User message</div>
					<div class="message reasoning" style="display: block;">Reasoning 2</div>
				</div>
			`);
			
			const container = document.getElementById('container');
			
			// Call handler to hide reasoning
			const result = handleReasoningToggle(false, container);
			
			// Verify all reasoning messages are hidden
			const reasoningMsgs = container.querySelectorAll('.message.reasoning');
			expect(reasoningMsgs).to.have.length(2);
			expect(reasoningMsgs[0].style.display).to.equal('none');
			expect(reasoningMsgs[1].style.display).to.equal('none');
			
			// Verify return value
			expect(result).to.equal(false);
		});
		
		it('should show reasoning messages when checked', () => {
			dom = createTestDOM(`
				<div id="container">
					<div class="message reasoning" style="display: none;">Reasoning 1</div>
					<div class="message user">User message</div>
					<div class="message reasoning" style="display: none;">Reasoning 2</div>
				</div>
			`);
			
			const container = document.getElementById('container');
			
			// Call handler to show reasoning
			const result = handleReasoningToggle(true, container);
			
			// Verify all reasoning messages are visible
			const reasoningMsgs = container.querySelectorAll('.message.reasoning');
			expect(reasoningMsgs).to.have.length(2);
			expect(reasoningMsgs[0].style.display).to.equal('block');
			expect(reasoningMsgs[1].style.display).to.equal('block');
			
			// Verify return value
			expect(result).to.equal(true);
		});
		
		it('should not affect non-reasoning messages', () => {
			dom = createTestDOM(`
				<div id="container">
					<div class="message user" style="display: block;">User message</div>
					<div class="message reasoning" style="display: block;">Reasoning</div>
					<div class="message assistant" style="display: block;">Assistant message</div>
				</div>
			`);
			
			const container = document.getElementById('container');
			
			// Hide reasoning
			handleReasoningToggle(false, container);
			
			// Verify only reasoning message is affected
			const userMsg = container.querySelector('.message.user');
			const assistantMsg = container.querySelector('.message.assistant');
			expect(userMsg.style.display).to.equal('block');
			expect(assistantMsg.style.display).to.equal('block');
		});
		
		it('should handle empty container gracefully', () => {
			dom = createTestDOM('<div id="container"></div>');
			const container = document.getElementById('container');
			
			// Should not throw
			const result = handleReasoningToggle(true, container);
			expect(result).to.equal(true);
		});
	});
});
