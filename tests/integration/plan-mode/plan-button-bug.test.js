import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';

/**
 * RED TEST - Plan Button Click Does Nothing
 * 
 * Bug: Clicking "Enter Planning" button has no effect
 * Expected: Should emit 'enterPlanMode' event via EventBus
 * Expected: main.js should call rpc.enterPlanMode()
 */
describe('Plan Button Bug - Click Does Nothing', () => {
	let dom, document, inputArea, eventBus, container;

	beforeEach(async () => {
		// Setup DOM
		dom = new JSDOM(`<!DOCTYPE html><div id="input-area-mount"></div>`);
		document = dom.window.document;
		global.document = document;
		global.window = dom.window;

		// Import components
		const { InputArea } = await import('../../../src/webview/app/components/InputArea/InputArea.js');
		const { EventBus } = await import('../../../src/webview/app/state/EventBus.js');

		container = document.getElementById('input-area-mount');
		eventBus = new EventBus();
		inputArea = new InputArea(container, eventBus);
	});

	describe('RED - Demonstrate Bug', () => {
		it('should have Enter Planning button in DOM', () => {
			const planButton = container.querySelector('#enterPlanModeBtn');
			expect(planButton, 'Enter Planning button should exist').to.exist;
			expect(planButton.title).to.equal('Enter Planning');
		});

		it('should emit enterPlanMode event when button clicked', (done) => {
			const planButton = container.querySelector('#enterPlanModeBtn');
			expect(planButton, 'Button must exist').to.exist;

			// Listen for event
			eventBus.on('enterPlanMode', () => {
				done(); // Test passes if event fires
			});

			// Click button
			planButton.click();

			// If event doesn't fire, test will timeout and fail
		});

		it('should call rpc.enterPlanMode() when event fires', (done) => {
			// Mock RPC
			const rpcCalls = [];
			global.rpc = {
				enterPlanMode: () => {
					rpcCalls.push('enterPlanMode');
					return Promise.resolve();
				}
			};

			// Simulate main.js listener
			eventBus.on('enterPlanMode', async () => {
				await global.rpc.enterPlanMode();
				expect(rpcCalls).to.include('enterPlanMode');
				done();
			});

			// Click button
			const planButton = container.querySelector('#enterPlanModeBtn');
			planButton.click();
		});
	});

	describe('Accept Plan Button', () => {
		it('should have Accept Plan button in DOM', () => {
			const acceptButton = container.querySelector('#acceptPlanBtn');
			expect(acceptButton, 'Accept Plan button should exist').to.exist;
			expect(acceptButton.title).to.equal('Accept Plan');
		});

		it('should emit acceptPlan event when button clicked', (done) => {
			const acceptButton = container.querySelector('#acceptPlanBtn');
			expect(acceptButton, 'Button must exist').to.exist;

			eventBus.on('acceptPlan', () => {
				done();
			});

			acceptButton.click();
		});
	});

	describe('Reject Plan Button', () => {
		it('should have Reject Plan button in DOM', () => {
			const rejectButton = container.querySelector('#rejectPlanBtn');
			expect(rejectButton, 'Reject Plan button should exist').to.exist;
			expect(rejectButton.title).to.equal('Reject Plan');
		});

		it('should emit rejectPlan event when button clicked', (done) => {
			const rejectButton = container.querySelector('#rejectPlanBtn');
			expect(rejectButton, 'Button must exist').to.exist;

			eventBus.on('rejectPlan', () => {
				done();
			});

			rejectButton.click();
		});
	});
});
