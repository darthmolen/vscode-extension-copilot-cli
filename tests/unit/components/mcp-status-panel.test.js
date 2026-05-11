import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { MCPStatusPanel } from '../../../src/webview/app/components/MCPStatusPanel/MCPStatusPanel.js';

const TEST_SERVERS = [
	{ name: 'playwright', rawKey: '_copilotcli_playwright', type: 'managed',
		status: 'connected', toolCount: 47, tools: [] },
	{ name: 'filesystem', rawKey: 'filesystem', type: 'user',
		status: 'configured', toolCount: 0, tools: [] },
	{ name: 'postgres', rawKey: 'postgres', type: 'user',
		status: 'failed', toolCount: 0, tools: [], error: 'ECONNREFUSED' },
];

describe('MCPStatusPanel Component', () => {
	let dom, container, panel;

	beforeEach(() => {
		dom = new JSDOM('<!DOCTYPE html><div id="mount"></div>');
		global.document = dom.window.document;
		global.window   = dom.window;
		container = document.getElementById('mount');
		panel = new MCPStatusPanel(container);
	});

	describe('Initial state', () => {
		it('is hidden by default', () => {
			expect(container.querySelector('.mcp-status-panel').style.display).to.equal('none');
		});

		it('can be constructed (smoke test)', () => {
			expect(panel).to.exist;
			expect(typeof panel.show).to.equal('function');
			expect(typeof panel.hide).to.equal('function');
			expect(typeof panel.isVisible).to.equal('function');
		});
	});

	describe('show(servers)', () => {
		it('becomes visible', () => {
			panel.show(TEST_SERVERS);
			expect(container.querySelector('.mcp-status-panel').style.display).to.not.equal('none');
		});

		it('renders a row per server', () => {
			panel.show(TEST_SERVERS);
			const rows = container.querySelectorAll('.mcp-status-server-row');
			expect(rows).to.have.length(3);
		});

		it('shows 🟢 for connected servers', () => {
			panel.show(TEST_SERVERS);
			const row = container.querySelector('[data-server="_copilotcli_playwright"]');
			expect(row.querySelector('.mcp-status-icon').textContent).to.equal('🟢');
		});

		it('shows 🟡 for configured-but-not-connected servers', () => {
			panel.show(TEST_SERVERS);
			const row = container.querySelector('[data-server="filesystem"]');
			expect(row.querySelector('.mcp-status-icon').textContent).to.equal('🟡');
		});

		it('shows 🔴 for failed servers', () => {
			panel.show(TEST_SERVERS);
			const row = container.querySelector('[data-server="postgres"]');
			expect(row.querySelector('.mcp-status-icon').textContent).to.equal('🔴');
		});

		it('shows tool count for connected servers', () => {
			panel.show(TEST_SERVERS);
			const row = container.querySelector('[data-server="_copilotcli_playwright"]');
			expect(row.querySelector('.mcp-status-tools').textContent.trim()).to.include('47 tools');
		});

		it('shows "not connected yet" for configured servers', () => {
			panel.show(TEST_SERVERS);
			const row = container.querySelector('[data-server="filesystem"]');
			expect(row.querySelector('.mcp-status-tools').textContent.trim()).to.include('not connected yet');
		});

		it('shows error text for failed servers', () => {
			panel.show(TEST_SERVERS);
			const row = container.querySelector('[data-server="postgres"]');
			expect(row.querySelector('.mcp-status-tools').textContent.trim()).to.include('ECONNREFUSED');
		});

		it('shows type badge as "managed" for managed servers', () => {
			panel.show(TEST_SERVERS);
			const row = container.querySelector('[data-server="_copilotcli_playwright"]');
			const badge = row.querySelector('.mcp-status-type-badge');
			expect(badge.textContent.trim()).to.equal('managed');
			expect(badge.classList.contains('mcp-status-type-badge--managed')).to.be.true;
		});

		it('shows type badge as "user" for user servers', () => {
			panel.show(TEST_SERVERS);
			const row = container.querySelector('[data-server="filesystem"]');
			const badge = row.querySelector('.mcp-status-type-badge');
			expect(badge.textContent.trim()).to.equal('user');
			expect(badge.classList.contains('mcp-status-type-badge--user')).to.be.true;
		});

		it('renders close button in header', () => {
			panel.show(TEST_SERVERS);
			expect(container.querySelector('.mcp-status-close-btn')).to.exist;
		});

		it('shows "No MCP servers configured" for empty array', () => {
			panel.show([]);
			const empty = container.querySelector('.mcp-status-empty');
			expect(empty).to.exist;
			expect(empty.textContent.trim()).to.include('No MCP servers configured');
		});

		it('shows singular "tool" for 1 tool', () => {
			panel.show([{ name: 'test', rawKey: 'test', type: 'user', status: 'connected', toolCount: 1, tools: [] }]);
			const row = container.querySelector('[data-server="test"]');
			const text = row.querySelector('.mcp-status-tools').textContent.trim();
			expect(text).to.equal('1 tool');
		});
	});

	describe('hide()', () => {
		it('hides the panel', () => {
			panel.show(TEST_SERVERS);
			panel.hide();
			expect(container.querySelector('.mcp-status-panel').style.display).to.equal('none');
		});
	});

	describe('isVisible()', () => {
		it('returns false when hidden', () => {
			expect(panel.isVisible()).to.be.false;
		});

		it('returns true after show()', () => {
			panel.show(TEST_SERVERS);
			expect(panel.isVisible()).to.be.true;
		});

		it('returns false after hide()', () => {
			panel.show(TEST_SERVERS);
			panel.hide();
			expect(panel.isVisible()).to.be.false;
		});
	});

	describe('Close button', () => {
		it('hides panel when close button clicked', () => {
			panel.show(TEST_SERVERS);
			container.querySelector('.mcp-status-close-btn').click();
			expect(container.querySelector('.mcp-status-panel').style.display).to.equal('none');
		});

		it('calls onClose callback when close button clicked', () => {
			let called = false;
			panel.onClose = () => { called = true; };
			panel.show(TEST_SERVERS);
			container.querySelector('.mcp-status-close-btn').click();
			expect(called).to.be.true;
		});

		it('does not throw if onClose is null', () => {
			panel.onClose = null;
			panel.show(TEST_SERVERS);
			expect(() => container.querySelector('.mcp-status-close-btn').click()).to.not.throw();
		});
	});

	describe('unknown status (older CLI fallback)', () => {
		it('renders ⚪ icon and "unavailable" label for unknown servers', () => {
			panel.show([{
				name: 'playwright',
				rawKey: '_copilotcli_playwright',
				type: 'managed',
				status: 'unknown',
				toolCount: 0,
				tools: []
			}]);
			const row = container.querySelector('[data-server="_copilotcli_playwright"]');
			expect(row).to.exist;
			const icon = row.querySelector('.mcp-status-icon');
			expect(icon.textContent).to.equal('⚪');
			const tools = row.querySelector('.mcp-status-tools');
			expect(tools.textContent.toLowerCase()).to.include('unavailable');
		});
	});
});
