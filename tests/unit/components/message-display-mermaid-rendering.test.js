/**
 * TDD tests for mermaid diagram rendering in assistant messages.
 *
 * Tests verify detection and container creation (synchronous).
 * Actual mermaid.js rendering requires a real browser and is tested manually.
 * Spec: planning/backlog/FEATURE-mermaid-diagram-rendering.md
 */

const assert = require('assert');
const { createComponentDOM, cleanupComponentDOM } = require('../../helpers/jsdom-component-setup');

/**
 * Mock marked.parse() that handles fenced code blocks.
 * The default mock in jsdom-component-setup wraps everything in <p>,
 * which doesn't produce <pre><code class="language-X"> elements needed
 * for mermaid detection. This mock handles ``` fences properly.
 */
function markedWithCodeBlocks(text) {
	return text.replace(/```(\w+)\n([\s\S]*?)```/g, (_, lang, code) => {
		return `<pre><code class="language-${lang}">${code}</code></pre>`;
	}).replace(/^(?!<pre>)(.+)$/gm, '<p>$1</p>');
}

describe('MessageDisplay Mermaid Rendering', function () {
	let dom;
	let eventBus;
	let messageDisplay;

	beforeEach(function () {
		dom = createComponentDOM();

		// Override the default mock marked with one that handles fenced code blocks
		global.marked = { parse: markedWithCodeBlocks };

		const { EventBus } = require('../../../src/webview/app/state/EventBus.js');
		eventBus = new EventBus();

		const { MessageDisplay } = require('../../../src/webview/app/components/MessageDisplay/MessageDisplay.js');
		const container = document.getElementById('messages-mount');
		messageDisplay = new MessageDisplay(container, eventBus);
	});

	afterEach(function () {
		cleanupComponentDOM(dom);
	});

	describe('Mermaid code block detection', function () {
		it('should detect mermaid code blocks and create .mermaid-render container', function () {
			const mermaidSource = 'flowchart LR\n    A[Start] --> B[End]';

			eventBus.emit('message:add', {
				role: 'assistant',
				content: '```mermaid\n' + mermaidSource + '\n```',
				timestamp: Date.now()
			});

			const messages = messageDisplay.messagesContainer.querySelectorAll('.message-display__item');
			assert.strictEqual(messages.length, 1);

			const mermaidContainer = messages[0].querySelector('.mermaid-render');
			assert.ok(mermaidContainer, 'should have a .mermaid-render container');

			// The container should hold the mermaid source for rendering
			assert.ok(
				mermaidContainer.textContent.includes('flowchart LR'),
				'container should contain the mermaid source text'
			);
		});

		it('should NOT render mermaid in user messages', function () {
			eventBus.emit('message:add', {
				role: 'user',
				content: '```mermaid\nflowchart LR\n    A --> B\n```',
				timestamp: Date.now()
			});

			const messages = messageDisplay.messagesContainer.querySelectorAll('.message-display__item');
			const mermaidContainer = messages[0].querySelector('.mermaid-render');
			assert.strictEqual(mermaidContainer, null, 'should NOT render mermaid in user messages');
		});

		it('should handle multiple mermaid blocks in one message', function () {
			const mermaid1 = 'flowchart LR\n    A --> B';
			const mermaid2 = 'sequenceDiagram\n    Alice->>Bob: Hello';

			eventBus.emit('message:add', {
				role: 'assistant',
				content: '```mermaid\n' + mermaid1 + '\n```\n\n```mermaid\n' + mermaid2 + '\n```',
				timestamp: Date.now()
			});

			const messages = messageDisplay.messagesContainer.querySelectorAll('.message-display__item');
			const mermaidContainers = messages[0].querySelectorAll('.mermaid-render');
			assert.strictEqual(mermaidContainers.length, 2, 'should render both mermaid blocks');
		});

		it('should preserve text around mermaid blocks', function () {
			eventBus.emit('message:add', {
				role: 'assistant',
				content: 'Before diagram\n\n```mermaid\nflowchart LR\n    A --> B\n```\n\nAfter diagram',
				timestamp: Date.now()
			});

			const messages = messageDisplay.messagesContainer.querySelectorAll('.message-display__item');
			const content = messages[0].querySelector('.message-content');
			const textContent = content.textContent;

			assert.ok(textContent.includes('Before diagram'), 'should keep text before mermaid block');
			assert.ok(textContent.includes('After diagram'), 'should keep text after mermaid block');
		});

		it('should not replace non-mermaid code blocks', function () {
			eventBus.emit('message:add', {
				role: 'assistant',
				content: '```javascript\nconst x = 1;\n```',
				timestamp: Date.now()
			});

			const messages = messageDisplay.messagesContainer.querySelectorAll('.message-display__item');
			const mermaidContainer = messages[0].querySelector('.mermaid-render');
			assert.strictEqual(mermaidContainer, null, 'should not create .mermaid-render for non-mermaid code');
		});
	});
});
