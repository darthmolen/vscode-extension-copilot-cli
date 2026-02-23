/**
 * TDD tests for mermaid toolbar features: View Source and Save Image buttons.
 *
 * Tests verify toolbar DOM structure, source toggle, data attribute storage,
 * and save event emission (synchronous behavior only).
 */

const assert = require('assert');
const { createComponentDOM, cleanupComponentDOM } = require('../../helpers/jsdom-component-setup');

/**
 * Mock marked.parse() that handles fenced code blocks.
 */
function markedWithCodeBlocks(text) {
	return text.replace(/```(\w+)\n([\s\S]*?)```/g, (_, lang, code) => {
		return `<pre><code class="language-${lang}">${code}</code></pre>`;
	}).replace(/^(?!<pre>)(.+)$/gm, '<p>$1</p>');
}

describe('MessageDisplay Mermaid Toolbar', function () {
	let dom;
	let eventBus;
	let messageDisplay;

	beforeEach(function () {
		dom = createComponentDOM();
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

	function addMermaidMessage(source) {
		source = source || 'flowchart LR\n    A[Start] --> B[End]';
		eventBus.emit('message:add', {
			role: 'assistant',
			content: '```mermaid\n' + source + '\n```',
			timestamp: Date.now()
		});
		const messages = messageDisplay.messagesContainer.querySelectorAll('.message-display__item');
		return messages[messages.length - 1];
	}

	describe('Mermaid source stored in data attribute', function () {
		it('should store mermaid source in data-mermaid-source attribute', function () {
			const source = 'flowchart LR\n    A[Start] --> B[End]';
			const msg = addMermaidMessage(source);
			const container = msg.querySelector('.mermaid-render');

			assert.ok(container, '.mermaid-render container should exist');
			assert.ok(
				container.dataset.mermaidSource.includes(source),
				'data-mermaid-source should contain the original mermaid text'
			);
		});
	});

	describe('Toolbar rendering', function () {
		it('should render a toolbar with View Source and Save buttons', function () {
			const msg = addMermaidMessage();
			const toolbar = msg.querySelector('.mermaid-toolbar');

			assert.ok(toolbar, '.mermaid-toolbar should exist');

			const sourceBtn = toolbar.querySelector('.mermaid-toolbar__source');
			const saveBtn = toolbar.querySelector('.mermaid-toolbar__save');

			assert.ok(sourceBtn, 'View Source button should exist');
			assert.ok(saveBtn, 'Save button should exist');
		});

		it('should have separate diagram and source containers', function () {
			const msg = addMermaidMessage();
			const mermaidRender = msg.querySelector('.mermaid-render');

			const diagramDiv = mermaidRender.querySelector('.mermaid-diagram');
			const sourceDiv = mermaidRender.querySelector('.mermaid-source');

			assert.ok(diagramDiv, '.mermaid-diagram container should exist');
			assert.ok(sourceDiv, '.mermaid-source container should exist');
		});

		it('should hide source view by default', function () {
			const msg = addMermaidMessage();
			const sourceDiv = msg.querySelector('.mermaid-source');

			assert.ok(
				sourceDiv.classList.contains('hidden'),
				'source view should be hidden by default'
			);
		});

		it('should show diagram by default', function () {
			const msg = addMermaidMessage();
			const diagramDiv = msg.querySelector('.mermaid-diagram');

			assert.ok(
				!diagramDiv.classList.contains('hidden'),
				'diagram should be visible by default'
			);
		});
	});

	describe('View Source toggle', function () {
		it('should show source and hide diagram when View Source is clicked', function () {
			const msg = addMermaidMessage();
			const sourceBtn = msg.querySelector('.mermaid-toolbar__source');
			const diagramDiv = msg.querySelector('.mermaid-diagram');
			const sourceDiv = msg.querySelector('.mermaid-source');

			sourceBtn.click();

			assert.ok(diagramDiv.classList.contains('hidden'), 'diagram should be hidden after click');
			assert.ok(!sourceDiv.classList.contains('hidden'), 'source should be visible after click');
		});

		it('should toggle back to diagram on second click', function () {
			const msg = addMermaidMessage();
			const sourceBtn = msg.querySelector('.mermaid-toolbar__source');
			const diagramDiv = msg.querySelector('.mermaid-diagram');
			const sourceDiv = msg.querySelector('.mermaid-source');

			sourceBtn.click(); // show source
			sourceBtn.click(); // back to diagram

			assert.ok(!diagramDiv.classList.contains('hidden'), 'diagram should be visible after toggle back');
			assert.ok(sourceDiv.classList.contains('hidden'), 'source should be hidden after toggle back');
		});
	});

	describe('Source content', function () {
		it('should contain original mermaid text in source pre', function () {
			const source = 'sequenceDiagram\n    Alice->>Bob: Hello';
			const msg = addMermaidMessage(source);
			const sourceDiv = msg.querySelector('.mermaid-source');

			assert.ok(sourceDiv.textContent.includes(source), 'source pre should contain original mermaid text');
		});
	});

	describe('Save button emits event', function () {
		it('should emit saveMermaidImage event when SVG exists and save is clicked', function () {
			const source = 'flowchart LR\n    A --> B';
			const msg = addMermaidMessage(source);
			const diagramDiv = msg.querySelector('.mermaid-diagram');

			// Inject a mock SVG (mermaid.js would do this in a real browser)
			diagramDiv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

			let emittedData = null;
			eventBus.on('saveMermaidImage', (data) => {
				emittedData = data;
			});

			const saveBtn = msg.querySelector('.mermaid-toolbar__save');
			saveBtn.click();

			assert.ok(emittedData, 'saveMermaidImage event should have been emitted');
			assert.ok(emittedData.svgContent.includes('<svg'), 'should contain SVG content');
			assert.ok(emittedData.source.includes(source), 'should contain original source');
		});

		it('should NOT emit saveMermaidImage when no SVG rendered', function () {
			const msg = addMermaidMessage();
			// Don't inject SVG — mermaid hasn't rendered yet in JSDOM

			let emitted = false;
			eventBus.on('saveMermaidImage', () => {
				emitted = true;
			});

			const saveBtn = msg.querySelector('.mermaid-toolbar__save');
			saveBtn.click();

			assert.ok(!emitted, 'should NOT emit when no SVG exists');
		});
	});
});
