import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { InputArea } from '../../../src/webview/app/components/InputArea/InputArea.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

describe('InputArea - MCPStatusPanel Integration', () => {
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

	function pressKey(key) {
		const textarea = container.querySelector('#messageInput');
		textarea.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
	}

	const SERVERS = [
		{ name: 'playwright', rawKey: '_copilotcli_playwright', type: 'managed',
			status: 'configured', toolCount: 0, tools: [] }
	];

	it('has a #mcp-status-mount element', () => {
		expect(container.querySelector('#mcp-status-mount')).to.exist;
	});

	it('mcp panel is hidden by default', () => {
		const panel = container.querySelector('.mcp-status-panel');
		expect(panel).to.exist;
		expect(panel.style.display).to.equal('none');
	});

	it('showMcpStatus() makes panel visible', () => {
		inputArea.showMcpStatus(SERVERS);
		const panel = container.querySelector('.mcp-status-panel');
		expect(panel.style.display).to.not.equal('none');
	});

	it('Escape key hides mcp panel', () => {
		inputArea.showMcpStatus(SERVERS);
		pressKey('Escape');
		const panel = container.querySelector('.mcp-status-panel');
		expect(panel.style.display).to.equal('none');
	});

	it('hides mcp panel when slash command is submitted', () => {
		inputArea.showMcpStatus(SERVERS);
		const textarea = container.querySelector('#messageInput');
		textarea.value = '/mcp';
		textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
		pressKey('Enter');
		const panel = container.querySelector('.mcp-status-panel');
		expect(panel.style.display).to.equal('none');
	});

	it('hides mcp panel when regular message is sent with session active', () => {
		inputArea.handleSessionActive(true);
		inputArea.showMcpStatus(SERVERS);
		const textarea = container.querySelector('#messageInput');
		textarea.value = 'hello world';
		pressKey('Enter');
		const panel = container.querySelector('.mcp-status-panel');
		expect(panel.style.display).to.equal('none');
	});

	it('showMcpStatus() renders server rows', () => {
		inputArea.showMcpStatus(SERVERS);
		const rows = container.querySelectorAll('.mcp-status-server-row');
		expect(rows).to.have.length(1);
	});
});
