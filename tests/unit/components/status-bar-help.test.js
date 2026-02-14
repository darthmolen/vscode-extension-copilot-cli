import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { StatusBar } from '../../../src/webview/app/components/StatusBar/StatusBar.js';

describe('StatusBar - Help Icon', () => {
	let dom, container, statusBar;

	beforeEach(() => {
		dom = new JSDOM('<!DOCTYPE html><div id="metrics-mount"></div>');
		global.document = dom.window.document;
		global.window = dom.window;
		container = document.getElementById('metrics-mount');
		statusBar = new StatusBar(container);
	});

	it('should render a help icon button', () => {
		const helpBtn = container.querySelector('.help-icon');

		expect(helpBtn).to.exist;
		expect(helpBtn.tagName).to.equal('BUTTON');
	});

	it('should have a tooltip mentioning /help', () => {
		const helpBtn = container.querySelector('.help-icon');

		expect(helpBtn.title).to.include('/help');
	});

	it('should emit showHelp event when clicked', () => {
		let helpFired = false;
		statusBar.on('showHelp', () => { helpFired = true; });

		const helpBtn = container.querySelector('.help-icon');
		helpBtn.click();

		expect(helpFired).to.be.true;
	});

	it('should position help icon before metrics', () => {
		const statusBarEl = container.querySelector('.status-bar');
		const children = Array.from(statusBarEl.children);
		const helpBtn = container.querySelector('.help-icon');
		const usageGroup = container.querySelector('.usage-group');

		const helpIndex = children.indexOf(helpBtn);
		const usageIndex = children.indexOf(usageGroup);

		expect(helpIndex).to.be.lessThan(usageIndex);
	});
});
