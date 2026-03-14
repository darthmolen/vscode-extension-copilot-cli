/**
 * TDD tests for Phase 4: session.task_complete UI rendering
 *
 * RED phase: Tests FAIL because MessageDisplay doesn't handle task:complete yet.
 *
 * Covers:
 * 1. task:complete event renders a task-complete styled element
 * 2. summary text is displayed when present
 * 3. icon/label is shown
 * 4. Renders gracefully when summary is undefined
 */

const assert = require('assert');
const { createComponentDOM, cleanupComponentDOM } = require('../../helpers/jsdom-component-setup');

describe('MessageDisplay - task:complete event', function () {
	let dom, eventBus, messageDisplay;

	beforeEach(function () {
		dom = createComponentDOM();
		global.marked = undefined;

		const { EventBus } = require('../../../src/webview/app/state/EventBus.js');
		eventBus = new EventBus();

		const { MessageDisplay } = require('../../../src/webview/app/components/MessageDisplay/MessageDisplay.js');
		const container = document.getElementById('messages-mount');
		messageDisplay = new MessageDisplay(container, eventBus);
	});

	afterEach(function () {
		cleanupComponentDOM(dom);
	});

	it('renders a task-complete element when task:complete fires', function () {
		eventBus.emit('task:complete', { summary: undefined });

		const el = messageDisplay.messagesContainer.querySelector('.message-display__item--task-complete');
		assert.ok(el, 'task-complete element must exist in messages container');
	});

	it('shows a checkmark or task-complete label', function () {
		eventBus.emit('task:complete', { summary: undefined });

		const el = messageDisplay.messagesContainer.querySelector('.message-display__item--task-complete');
		assert.ok(el, 'task-complete element must exist');
		assert.ok(
			/✓|✔|task complete/i.test(el.textContent),
			`Expected icon/label in: ${el.textContent}`
		);
	});

	it('displays summary text when provided', function () {
		eventBus.emit('task:complete', { summary: 'All 12 tests pass.' });

		const el = messageDisplay.messagesContainer.querySelector('.message-display__item--task-complete');
		assert.ok(el, 'task-complete element must exist');
		assert.ok(el.textContent.includes('All 12 tests pass.'), `Expected summary in: ${el.textContent}`);
	});

	it('renders gracefully when summary is undefined', function () {
		eventBus.emit('task:complete', { summary: undefined });

		const el = messageDisplay.messagesContainer.querySelector('.message-display__item--task-complete');
		assert.ok(el, 'task-complete element must exist');
		assert.ok(!el.textContent.includes('undefined'), 'Must not render literal "undefined"');
	});
});
