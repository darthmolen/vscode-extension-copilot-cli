import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { SlashCommandPanel } from '../../../src/webview/app/components/SlashCommandPanel/SlashCommandPanel.js';

const TEST_COMMANDS = [
	{ name: 'plan', description: 'Enter plan mode', category: 'plan' },
	{ name: 'exit', description: 'Exit plan mode', category: 'plan' },
	{ name: 'review', description: 'View plan content', category: 'code' },
	{ name: 'mcp', description: 'MCP server config', category: 'config' },
	{ name: 'delegate', description: 'GitHub Copilot agent', category: 'cli' },
];

const CATEGORY_LABELS = {
	plan: 'Plan Mode',
	code: 'Code & Review',
	config: 'Configuration',
	cli: 'CLI (terminal)',
};

describe('SlashCommandPanel Component', () => {
	let dom, container, panel;

	beforeEach(() => {
		dom = new JSDOM('<!DOCTYPE html><div id="mount"></div>');
		global.document = dom.window.document;
		global.window = dom.window;
		container = document.getElementById('mount');
		panel = new SlashCommandPanel(container);
	});

	describe('Initial State', () => {
		it('should be hidden by default', () => {
			const panelEl = container.querySelector('.slash-command-panel');

			expect(panelEl).to.exist;
			expect(panelEl.style.display).to.equal('none');
		});
	});

	describe('show()', () => {
		it('should become visible when show() called', () => {
			panel.show(TEST_COMMANDS);

			const panelEl = container.querySelector('.slash-command-panel');
			expect(panelEl.style.display).to.not.equal('none');
		});

		it('should render category headers', () => {
			panel.show(TEST_COMMANDS);

			const headers = container.querySelectorAll('.slash-command-group-label');
			const headerTexts = Array.from(headers).map(h => h.textContent);

			expect(headerTexts).to.include('Plan Mode');
			expect(headerTexts).to.include('Code & Review');
			expect(headerTexts).to.include('Configuration');
			expect(headerTexts).to.include('CLI (terminal)');
		});

		it('should render command items with name and description', () => {
			panel.show(TEST_COMMANDS);

			const items = container.querySelectorAll('.slash-command-item');
			expect(items).to.have.length(5);

			const firstItem = items[0];
			const name = firstItem.querySelector('.slash-command-name');
			const desc = firstItem.querySelector('.slash-command-desc');

			expect(name.textContent).to.equal('/plan');
			expect(desc.textContent).to.equal('Enter plan mode');
		});

		it('should group commands by category', () => {
			panel.show(TEST_COMMANDS);

			const groups = container.querySelectorAll('.slash-command-group');
			expect(groups).to.have.length(4); // plan, code, config, cli

			// First group should be Plan Mode with 2 commands
			const firstGroupItems = groups[0].querySelectorAll('.slash-command-item');
			expect(firstGroupItems).to.have.length(2);
		});
	});

	describe('hide()', () => {
		it('should hide when hide() called', () => {
			panel.show(TEST_COMMANDS);
			panel.hide();

			const panelEl = container.querySelector('.slash-command-panel');
			expect(panelEl.style.display).to.equal('none');
		});
	});

	describe('Command Selection', () => {
		it('should call onSelect with command name when item clicked', () => {
			let selectedCommand = null;
			panel.onSelect = (name) => { selectedCommand = name; };

			panel.show(TEST_COMMANDS);

			const firstItem = container.querySelector('.slash-command-item');
			firstItem.click();

			expect(selectedCommand).to.equal('plan');
		});

		it('should call onSelect with correct command for non-first item', () => {
			let selectedCommand = null;
			panel.onSelect = (name) => { selectedCommand = name; };

			panel.show(TEST_COMMANDS);

			const items = container.querySelectorAll('.slash-command-item');
			items[2].click(); // 'review' (3rd item)

			expect(selectedCommand).to.equal('review');
		});
	});
});
