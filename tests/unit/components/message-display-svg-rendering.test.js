const assert = require('assert');
const { createComponentDOM, cleanupComponentDOM } = require('../../helpers/jsdom-component-setup');

describe('MessageDisplay SVG Rendering', function () {
	let dom;
	let eventBus;
	let messageDisplay;

	beforeEach(function () {
		dom = createComponentDOM();

		const { EventBus } = require('../../../src/webview/app/state/EventBus.js');
		eventBus = new EventBus();

		const { MessageDisplay } = require('../../../src/webview/app/components/MessageDisplay/MessageDisplay.js');
		const container = document.getElementById('messages-mount');
		messageDisplay = new MessageDisplay(container, eventBus);
	});

	afterEach(function () {
		cleanupComponentDOM(dom);
	});

	describe('SVG code block rendering', function () {
		it('should render SVG code blocks as inline SVG images', function () {
			const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>';

			eventBus.emit('message:add', {
				role: 'assistant',
				content: '```svg\n' + svgContent + '\n```',
				timestamp: Date.now()
			});

			const messages = messageDisplay.messagesContainer.querySelectorAll('.message-display__item');
			assert.strictEqual(messages.length, 1);

			// Should have an SVG render container instead of just a code block
			const svgContainer = messages[0].querySelector('.svg-render');
			assert.ok(svgContainer, 'should have a .svg-render container');

			// The container should contain the actual SVG
			const svgEl = svgContainer.querySelector('svg');
			assert.ok(svgEl, 'should contain an actual <svg> element');
		});

		it('should render inline <svg> tags in assistant messages', function () {
			const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><circle cx="50" cy="50" r="40" fill="blue"/></svg>';

			eventBus.emit('message:add', {
				role: 'assistant',
				content: 'Here is a diagram:\n\n' + svgContent,
				timestamp: Date.now()
			});

			const messages = messageDisplay.messagesContainer.querySelectorAll('.message-display__item');
			const svgContainer = messages[0].querySelector('.svg-render');
			assert.ok(svgContainer, 'should have a .svg-render container for inline SVG');
		});

		it('should not render SVG in user messages', function () {
			const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="red"/></svg>';

			eventBus.emit('message:add', {
				role: 'user',
				content: svgContent,
				timestamp: Date.now()
			});

			const messages = messageDisplay.messagesContainer.querySelectorAll('.message-display__item');
			const svgContainer = messages[0].querySelector('.svg-render');
			assert.strictEqual(svgContainer, null, 'should NOT render SVG in user messages');
		});

		it('should preserve text content around SVG blocks', function () {
			const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="red"/></svg>';

			eventBus.emit('message:add', {
				role: 'assistant',
				content: 'Before text\n\n```svg\n' + svgContent + '\n```\n\nAfter text',
				timestamp: Date.now()
			});

			const messages = messageDisplay.messagesContainer.querySelectorAll('.message-display__item');
			const content = messages[0].querySelector('.message-content');
			const textContent = content.textContent;

			assert.ok(textContent.includes('Before text'), 'should keep text before SVG');
			assert.ok(textContent.includes('After text'), 'should keep text after SVG');
		});

		it('should handle multiple SVG blocks in one message', function () {
			const svg1 = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect fill="red"/></svg>';
			const svg2 = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect fill="blue"/></svg>';

			eventBus.emit('message:add', {
				role: 'assistant',
				content: '```svg\n' + svg1 + '\n```\n\n```svg\n' + svg2 + '\n```',
				timestamp: Date.now()
			});

			const messages = messageDisplay.messagesContainer.querySelectorAll('.message-display__item');
			const svgContainers = messages[0].querySelectorAll('.svg-render');
			assert.strictEqual(svgContainers.length, 2, 'should render both SVG blocks');
		});

		it('should constrain SVG width to message bubble', function () {
			const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect fill="red"/></svg>';

			eventBus.emit('message:add', {
				role: 'assistant',
				content: '```svg\n' + svgContent + '\n```',
				timestamp: Date.now()
			});

			const messages = messageDisplay.messagesContainer.querySelectorAll('.message-display__item');
			const svgContainer = messages[0].querySelector('.svg-render');
			assert.ok(svgContainer, 'should have svg-render container');

			// The SVG should have max-width styling
			const svgEl = svgContainer.querySelector('svg');
			if (svgEl) {
				// The style should constrain the width
				assert.ok(
					svgEl.style.maxWidth === '100%' || svgContainer.style.maxWidth === '100%',
					'SVG or container should have max-width: 100%'
				);
			}
		});
	});
});
