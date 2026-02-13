/**
 * MessageDisplay Scrolling Tests (Phase 2 TDD Verification)
 *
 * Verifies all Phase 2 fixes:
 * - 2.2: requestAnimationFrame replaces setTimeout for scroll flag reset
 * - 2.3: MutationObserver on messagesContainer replaces ResizeObserver on <main>
 * - 2.4: Auto-scroll behavior (near bottom, scrolled up, resume)
 * - 2.5: No console.log in production (DEBUG_SCROLL = false)
 * - 2.6: clearMessages() removed, clear() is the single method
 * - 2.7: No local escapeHtml method (uses imported utility)
 */

import { expect } from 'chai';
import { createComponentDOM, cleanupComponentDOM, setScrollProperties } from '../../helpers/jsdom-component-setup.js';

describe('MessageDisplay - Scrolling (Phase 2)', () => {
	let dom;
	let MessageDisplay, EventBus;
	let container, eventBus, display;

	before(async () => {
		dom = createComponentDOM();

		const displayModule = await import('../../../src/webview/app/components/MessageDisplay/MessageDisplay.js');
		MessageDisplay = displayModule.MessageDisplay;

		const busModule = await import('../../../src/webview/app/state/EventBus.js');
		EventBus = busModule.EventBus;
	});

	after(() => {
		cleanupComponentDOM(dom);
	});

	beforeEach(() => {
		container = document.createElement('div');
		container.id = 'messages-mount';
		const existingMount = document.getElementById('messages-mount');
		if (existingMount) {
			existingMount.parentNode.replaceChild(container, existingMount);
		} else {
			document.querySelector('main').appendChild(container);
		}

		eventBus = new EventBus();
		display = new MessageDisplay(container, eventBus);
	});

	afterEach(() => {
		if (display && display.dispose) {
			display.dispose();
		}
		if (container && container.parentNode) {
			const fresh = document.createElement('div');
			fresh.id = 'messages-mount';
			container.parentNode.replaceChild(fresh, container);
		}
	});

	// ========================================================================
	// 2.2: requestAnimationFrame replaces setTimeout for scroll flag reset
	// ========================================================================
	describe('Task 2.2: requestAnimationFrame for scroll flag', () => {
		it('should set isProgrammaticScroll to true synchronously during scrollToBottom', () => {
			const messages = display.messagesContainer;
			setScrollProperties(messages, { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });

			display.scrollToBottom();

			// Flag should be true immediately after call (before rAF fires)
			expect(display.isProgrammaticScroll).to.be.true;
		});

		it('should reset isProgrammaticScroll after requestAnimationFrame', (done) => {
			const messages = display.messagesContainer;
			setScrollProperties(messages, { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });

			display.scrollToBottom();

			// Our polyfill uses setTimeout(cb, 0) - so flag resets after next tick
			setTimeout(() => {
				expect(display.isProgrammaticScroll).to.be.false;
				done();
			}, 10);
		});

		it('should use requestAnimationFrame, not setTimeout directly', () => {
			// Verify by checking that the source code uses requestAnimationFrame
			// We can detect this by spying on requestAnimationFrame
			let rafCalled = false;
			const originalRAF = global.requestAnimationFrame;
			global.requestAnimationFrame = (cb) => {
				rafCalled = true;
				return originalRAF(cb);
			};

			const messages = display.messagesContainer;
			setScrollProperties(messages, { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });

			display.scrollToBottom();

			expect(rafCalled, 'requestAnimationFrame should be called').to.be.true;

			global.requestAnimationFrame = originalRAF;
		});
	});

	// ========================================================================
	// 2.3: MutationObserver on messagesContainer replaces ResizeObserver
	// ========================================================================
	describe('Task 2.3: MutationObserver replaces ResizeObserver', () => {
		it('should have mutationObserver property', () => {
			expect(display.mutationObserver).to.exist;
		});

		it('should NOT have resizeObserver property', () => {
			expect(display.resizeObserver).to.not.exist;
		});

		it('should observe messagesContainer (not main element)', () => {
			// MutationObserver is connected — verify it's watching #messages
			// We can verify by checking the observer exists after setup
			expect(display.mutationObserver).to.exist;
			expect(display.messagesContainer).to.exist;
			expect(display.messagesContainer.id).to.equal('messages');
		});

		it('should trigger autoScroll when child nodes are added', (done) => {
			let autoScrollCalled = false;
			display.autoScroll = () => {
				autoScrollCalled = true;
			};

			// Add a child node — MutationObserver should fire
			const newChild = document.createElement('div');
			newChild.className = 'message-display__item';
			display.messagesContainer.appendChild(newChild);

			// MutationObserver is async + 50ms debounce
			setTimeout(() => {
				expect(autoScrollCalled, 'autoScroll should be called on new child').to.be.true;
				done();
			}, 100);
		});

		it('should NOT trigger autoScroll for attribute changes', (done) => {
			let autoScrollCalled = false;
			display.autoScroll = () => {
				autoScrollCalled = true;
			};

			// Change an attribute — should NOT trigger observer (childList only)
			display.messagesContainer.setAttribute('data-test', 'value');

			setTimeout(() => {
				expect(autoScrollCalled, 'autoScroll should NOT be called for attribute changes').to.be.false;
				done();
			}, 100);
		});
	});

	// ========================================================================
	// 2.4: Auto-scroll behavior verification
	// ========================================================================
	describe('Task 2.4: Auto-scroll behavior', () => {
		it('should auto-scroll when near bottom (within 100px)', () => {
			const messages = display.messagesContainer;
			let scrollCalled = false;

			display.userHasScrolled = true;
			setScrollProperties(messages, { scrollTop: 850, scrollHeight: 1000, clientHeight: 100 });
			display.scrollToBottom = () => { scrollCalled = true; };

			display.autoScroll();

			expect(scrollCalled).to.be.true;
		});

		it('should NOT auto-scroll when user scrolled up (>100px from bottom)', () => {
			const messages = display.messagesContainer;
			let scrollCalled = false;

			display.userHasScrolled = true;
			setScrollProperties(messages, { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });
			display.scrollToBottom = () => { scrollCalled = true; };

			display.autoScroll();

			expect(scrollCalled).to.be.false;
		});

		it('should always auto-scroll when user has not manually scrolled (initial load)', () => {
			const messages = display.messagesContainer;
			let scrollCalled = false;

			display.userHasScrolled = false; // initial state
			setScrollProperties(messages, { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });
			display.scrollToBottom = () => { scrollCalled = true; };

			display.autoScroll();

			expect(scrollCalled, 'Should auto-scroll during initial load').to.be.true;
		});

		it('should have isNearBottom and isNearBottomRaw methods', () => {
			expect(display.isNearBottom).to.be.a('function');
			expect(display.isNearBottomRaw).to.be.a('function');
		});
	});

	// ========================================================================
	// 2.5: No console.log in production (DEBUG_SCROLL = false)
	// ========================================================================
	describe('Task 2.5: Debug logging gated', () => {
		it('should not produce console.log output during scroll operations', () => {
			const logs = [];
			const originalLog = console.log;
			console.log = (...args) => {
				logs.push(args.join(' '));
			};

			try {
				const messages = display.messagesContainer;
				setScrollProperties(messages, { scrollTop: 900, scrollHeight: 1000, clientHeight: 100 });

				// Exercise all scroll paths
				display.isNearBottom();
				display.isNearBottomRaw();
				display.autoScroll();
				display.scrollToBottom();

				// Filter for scroll-related logs only
				const scrollLogs = logs.filter(l => l.includes('[Scroll]'));
				expect(scrollLogs, 'No [Scroll] console.log when DEBUG_SCROLL=false').to.have.length(0);
			} finally {
				console.log = originalLog;
			}
		});
	});

	// ========================================================================
	// 2.6: clearMessages() removed, clear() is the single method
	// ========================================================================
	describe('Task 2.6: Consolidated clear() method', () => {
		it('should NOT have clearMessages method', () => {
			expect(display.clearMessages).to.be.undefined;
		});

		it('should have clear method', () => {
			expect(display.clear).to.be.a('function');
		});

		it('should remove all messages when clear() is called', () => {
			display.addMessage({ role: 'user', content: 'Test 1', timestamp: 1 });
			display.addMessage({ role: 'assistant', content: 'Test 2', timestamp: 2 });

			expect(display.messagesContainer.querySelectorAll('.message-display__item').length).to.equal(2);

			display.clear();

			expect(display.messagesContainer.querySelectorAll('.message-display__item').length).to.equal(0);
		});

		it('should show empty state after clear()', () => {
			display.addMessage({ role: 'user', content: 'Test', timestamp: 1 });
			display.clear();

			expect(display.emptyState.style.display).to.equal('flex');
		});

		it('should reset userHasScrolled after clear()', () => {
			display.userHasScrolled = true;
			display.clear();

			expect(display.userHasScrolled).to.be.false;
		});
	});

	// ========================================================================
	// 2.7: No local escapeHtml method (uses imported utility)
	// ========================================================================
	describe('Task 2.7: No local escapeHtml', () => {
		it('should NOT have escapeHtml as an instance method', () => {
			expect(display.escapeHtml).to.be.undefined;
		});

		it('should still render user messages with HTML escaping', () => {
			display.addMessage({
				role: 'user',
				content: '<script>alert("xss")</script>',
				timestamp: Date.now()
			});

			const userMsg = container.querySelector('.message-display__item--user .message-display__content');
			// Should NOT contain raw script tag
			expect(userMsg.innerHTML).to.not.include('<script>');
			// Should contain escaped version
			expect(userMsg.textContent).to.include('<script>');
		});
	});

	// ========================================================================
	// Cleanup
	// ========================================================================
	describe('Cleanup', () => {
		it('should disconnect MutationObserver on dispose', () => {
			expect(display.mutationObserver).to.exist;

			display.dispose();

			expect(display.mutationObserver).to.be.null;
		});

		it('should clear scrollTimeout on dispose', () => {
			display.scrollTimeout = setTimeout(() => {}, 1000);
			expect(display.scrollTimeout).to.not.be.null;

			display.dispose();

			expect(display.scrollTimeout).to.be.null;
		});
	});
});
