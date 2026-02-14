import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { InputArea } from '../../../src/webview/app/components/InputArea/InputArea.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

describe('InputArea - Slash Command Panel Integration', () => {
	let dom, container, eventBus, inputArea;

	beforeEach(() => {
		dom = new JSDOM('<!DOCTYPE html><div id="input-mount"></div>');
		global.document = dom.window.document;
		global.window = dom.window;
		global.MutationObserver = class { observe() {} disconnect() {} };
		container = document.getElementById('input-mount');
		eventBus = new EventBus();
		inputArea = new InputArea(container, eventBus);
	});

	function typeInTextarea(text) {
		const textarea = container.querySelector('#messageInput');
		textarea.value = text;
		textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
	}

	function pressKey(key) {
		const textarea = container.querySelector('#messageInput');
		textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
	}

	describe('Panel mount point', () => {
		it('should have a slash-command-mount element in the DOM', () => {
			const mount = container.querySelector('#slash-command-mount');
			expect(mount).to.exist;
		});
	});

	describe('Panel show/hide on / input', () => {
		it('should show panel when / typed as first character', () => {
			typeInTextarea('/');

			const panel = container.querySelector('.slash-command-panel');
			expect(panel).to.exist;
			expect(panel.style.display).to.not.equal('none');
		});

		it('should hide panel when / is deleted (empty textarea)', () => {
			typeInTextarea('/');
			typeInTextarea('');

			const panel = container.querySelector('.slash-command-panel');
			expect(panel.style.display).to.equal('none');
		});

		it('should not show panel when / typed mid-text', () => {
			typeInTextarea('hello /plan');

			const panel = container.querySelector('.slash-command-panel');
			expect(panel.style.display).to.equal('none');
		});

		it('should hide panel on Escape key', () => {
			typeInTextarea('/');
			pressKey('Escape');

			const panel = container.querySelector('.slash-command-panel');
			expect(panel.style.display).to.equal('none');
		});
	});

	describe('Command selection', () => {
		it('should insert /command into textarea when command selected', () => {
			typeInTextarea('/');

			// Click the first command item
			const item = container.querySelector('.slash-command-item');
			expect(item).to.exist;
			item.click();

			const textarea = container.querySelector('#messageInput');
			const commandName = item.dataset.command;
			expect(textarea.value).to.equal(`/${commandName} `);
		});

		it('should hide panel after command selected', () => {
			typeInTextarea('/');

			const item = container.querySelector('.slash-command-item');
			item.click();

			const panel = container.querySelector('.slash-command-panel');
			expect(panel.style.display).to.equal('none');
		});
	});

	describe('Placeholder text', () => {
		it('should mention slash commands in active placeholder', () => {
			// Simulate session active
			inputArea.handleSessionActive(true);

			const textarea = container.querySelector('#messageInput');
			expect(textarea.placeholder).to.include('/');
		});
	});
});
