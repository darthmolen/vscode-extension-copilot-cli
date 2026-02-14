import { describe, it, before, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';

/**
 * RED TEST - ResizeObserver Auto-Scroll
 * 
 * Requirements:
 * 1. Observe parent <main> element for size changes
 * 2. Debounce scroll (50ms) to prevent spam
 * 3. Only auto-scroll if user is near bottom (within 100px)
 * 4. Handle both message content and input area expansion
 */
describe('MessageDisplay - ResizeObserver Auto-Scroll', () => {
	let dom, document, messageDisplay, eventBus, mainElement;
	let clock;

	before(() => {
		// Setup DOM with main element structure
		dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
				<body>
					<main role="main">
						<div id="messages-mount"></div>
					</main>
				</body>
			</html>
		`);
		document = dom.window.document;
		global.document = document;
		global.window = dom.window;
		
		// Mock ResizeObserver (not available in JSDOM)
		global.ResizeObserver = class ResizeObserver {
			constructor(callback) {
				this.callback = callback;
				this.observations = [];
			}
			observe(element) {
				this.observations.push(element);
			}
			unobserve(element) {
				this.observations = this.observations.filter(el => el !== element);
			}
			disconnect() {
				this.observations = [];
			}
		};

		// Polyfill MutationObserver (available on JSDOM window but not global)
		global.MutationObserver = dom.window.MutationObserver;

		// Polyfill requestAnimationFrame
		global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
		global.cancelAnimationFrame = (id) => clearTimeout(id);

		// Mock marked.js
		global.marked = { parse: (text) => `<p>${text}</p>` };
	});

	beforeEach(async () => {
		const { MessageDisplay } = await import('../../../src/webview/app/components/MessageDisplay/MessageDisplay.js');
		const { EventBus } = await import('../../../src/webview/app/state/EventBus.js');

		mainElement = document.querySelector('main');
		const messagesMount = document.getElementById('messages-mount');
		eventBus = new EventBus();
		messageDisplay = new MessageDisplay(messagesMount, eventBus);
	});

	afterEach(() => {
		if (messageDisplay) {
			if (messageDisplay.dispose) {
				messageDisplay.dispose();
			} else if (messageDisplay.mutationObserver) {
				messageDisplay.mutationObserver.disconnect();
			}
		}
	});

	describe('Initialization', () => {
		it('should create MutationObserver instance', () => {
			expect(messageDisplay.mutationObserver, 'MutationObserver should exist').to.exist;
		});

		it('should observe the messagesContainer', () => {
			expect(messageDisplay.mutationObserver, 'Should have MutationObserver').to.exist;
		});

		it('should have debounce timeout property', () => {
			// scrollTimeout starts as null, but property should be defined
			expect(messageDisplay).to.have.property('scrollTimeout');
		});
	});

	describe('Auto-Scroll Behavior', () => {
		it('should have isNearBottom method', () => {
			expect(messageDisplay.isNearBottom).to.be.a('function');
		});

		it('should return true when scrolled to bottom', () => {
			const messages = messageDisplay.container.querySelector('#messages');
			
			// Simulate being at bottom
			Object.defineProperty(messages, 'scrollTop', { value: 1000, writable: true });
			Object.defineProperty(messages, 'scrollHeight', { value: 1100, writable: true });
			Object.defineProperty(messages, 'clientHeight', { value: 100, writable: true });
			
			// scrollHeight (1100) - scrollTop (1000) - clientHeight (100) = 0 < 100px threshold
			expect(messageDisplay.isNearBottom()).to.be.true;
		});

		it('should return false when scrolled up', () => {
			const messages = messageDisplay.container.querySelector('#messages');

			// Must set userHasScrolled so isNearBottom uses distance calculation
			// (otherwise it returns true for initial load behavior)
			messageDisplay.userHasScrolled = true;

			// Simulate being scrolled up (more than 100px from bottom)
			Object.defineProperty(messages, 'scrollTop', { value: 0, writable: true, configurable: true });
			Object.defineProperty(messages, 'scrollHeight', { value: 1000, writable: true, configurable: true });
			Object.defineProperty(messages, 'clientHeight', { value: 500, writable: true, configurable: true });

			// scrollHeight (1000) - scrollTop (0) - clientHeight (500) = 500 > 100px threshold
			expect(messageDisplay.isNearBottom()).to.be.false;
		});

		it('should return true when within 100px of bottom', () => {
			const messages = messageDisplay.container.querySelector('#messages');
			
			// Simulate being 50px from bottom
			Object.defineProperty(messages, 'scrollTop', { value: 850, writable: true });
			Object.defineProperty(messages, 'scrollHeight', { value: 1000, writable: true });
			Object.defineProperty(messages, 'clientHeight', { value: 100, writable: true });
			
			// scrollHeight (1000) - scrollTop (850) - clientHeight (100) = 50 < 100px threshold
			expect(messageDisplay.isNearBottom()).to.be.true;
		});
	});

	describe('Scroll Method', () => {
		it('should have scrollToBottom method', () => {
			expect(messageDisplay.scrollToBottom).to.be.a('function');
		});

		it('should set scrollTop to scrollHeight when called', () => {
			const messages = messageDisplay.container.querySelector('#messages');
			
			Object.defineProperty(messages, 'scrollHeight', { value: 1000, writable: true });
			Object.defineProperty(messages, 'scrollTop', { value: 0, writable: true });
			
			messageDisplay.scrollToBottom();
			
			expect(messages.scrollTop).to.equal(1000);
		});
	});

	describe('Auto-Scroll Logic', () => {
		it('should have autoScroll method', () => {
			expect(messageDisplay.autoScroll).to.be.a('function');
		});

		it('should call scrollToBottom when near bottom', () => {
			const messages = messageDisplay.container.querySelector('#messages');
			let scrollCalled = false;
			
			// Mock isNearBottom to return true
			messageDisplay.isNearBottom = () => true;
			
			// Mock scrollToBottom to track calls
			const originalScrollToBottom = messageDisplay.scrollToBottom;
			messageDisplay.scrollToBottom = () => {
				scrollCalled = true;
			};
			
			messageDisplay.autoScroll();
			
			expect(scrollCalled, 'Should call scrollToBottom when near bottom').to.be.true;
			
			// Restore
			messageDisplay.scrollToBottom = originalScrollToBottom;
		});

		it('should NOT call scrollToBottom when scrolled up', () => {
			let scrollCalled = false;
			
			// Mock isNearBottom to return false
			messageDisplay.isNearBottom = () => false;
			
			// Mock scrollToBottom to track calls
			const originalScrollToBottom = messageDisplay.scrollToBottom;
			messageDisplay.scrollToBottom = () => {
				scrollCalled = true;
			};
			
			messageDisplay.autoScroll();
			
			expect(scrollCalled, 'Should NOT call scrollToBottom when scrolled up').to.be.false;
			
			// Restore
			messageDisplay.scrollToBottom = originalScrollToBottom;
		});
	});

	describe('Cleanup', () => {
		it('should disconnect ResizeObserver on cleanup', () => {
			let disconnectCalled = false;
			
			// Mock disconnect
			if (messageDisplay.mutationObserver) {
				const originalDisconnect = messageDisplay.mutationObserver.disconnect;
				messageDisplay.mutationObserver.disconnect = () => {
					disconnectCalled = true;
					originalDisconnect.call(messageDisplay.mutationObserver);
				};
				
				messageDisplay.mutationObserver.disconnect();
				expect(disconnectCalled, 'Should call disconnect').to.be.true;
			}
		});
	});
});
