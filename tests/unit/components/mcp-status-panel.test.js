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

	describe('source badges (imported / copilot)', () => {
		it('shows "imported" badge for VS Code-imported servers', () => {
			panel.show([{ name: 'vscode-fs', rawKey: 'vscode-fs', type: 'imported', status: 'configured', toolCount: 0, tools: [] }]);
			const badge = container.querySelector('[data-server="vscode-fs"] .mcp-status-type-badge');
			expect(badge.textContent.trim()).to.equal('imported');
			expect(badge.classList.contains('mcp-status-type-badge--imported')).to.be.true;
		});

		it('shows "copilot" badge for Copilot-configured servers', () => {
			panel.show([{ name: 'github', rawKey: 'github', type: 'copilot', status: 'configured', toolCount: 0, tools: [] }]);
			const badge = container.querySelector('[data-server="github"] .mcp-status-type-badge');
			expect(badge.textContent.trim()).to.equal('copilot');
			expect(badge.classList.contains('mcp-status-type-badge--copilot')).to.be.true;
		});
	});

	describe('read-only indicator', () => {
		it('marks non-user rows (managed/imported/copilot) read-only', () => {
			panel.show([
				{ name: 'm', rawKey: '_copilotcli_m', type: 'managed', status: 'connected', toolCount: 1, tools: [] },
				{ name: 'i', rawKey: 'i', type: 'imported', status: 'configured', toolCount: 0, tools: [] },
				{ name: 'c', rawKey: 'c', type: 'copilot', status: 'configured', toolCount: 0, tools: [] },
			]);
			for (const key of ['_copilotcli_m', 'i', 'c']) {
				const row = container.querySelector(`[data-server="${key}"]`);
				expect(row.querySelector('.mcp-status-readonly'), `${key} should be read-only`).to.exist;
			}
		});

		it('does not mark user rows read-only', () => {
			panel.show([{ name: 'u', rawKey: 'u', type: 'user', status: 'configured', toolCount: 0, tools: [] }]);
			const row = container.querySelector('[data-server="u"]');
			expect(row.querySelector('.mcp-status-readonly')).to.not.exist;
		});
	});

	describe('Add Server form', () => {
		it('renders an Add Server button in the header', () => {
			panel.show(TEST_SERVERS);
			expect(container.querySelector('.mcp-add-btn')).to.exist;
		});

		it('shows the form when Add is clicked', () => {
			panel.show(TEST_SERVERS);
			container.querySelector('.mcp-add-btn').click();
			expect(container.querySelector('.mcp-form')).to.exist;
			expect(container.querySelector('.mcp-form-name')).to.exist;
		});

		it('shows the command field for stdio and hides url', () => {
			panel.show(TEST_SERVERS);
			container.querySelector('.mcp-add-btn').click();
			expect(container.querySelector('.mcp-form-command').closest('.mcp-form-row').style.display).to.not.equal('none');
			expect(container.querySelector('.mcp-form-url').closest('.mcp-form-row').style.display).to.equal('none');
		});

		it('toggles to url field when http type selected', () => {
			panel.show(TEST_SERVERS);
			container.querySelector('.mcp-add-btn').click();
			const httpRadio = container.querySelector('input[name="mcp-type"][value="http"]');
			httpRadio.checked = true;
			httpRadio.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
			expect(container.querySelector('.mcp-form-url').closest('.mcp-form-row').style.display).to.not.equal('none');
			expect(container.querySelector('.mcp-form-command').closest('.mcp-form-row').style.display).to.equal('none');
		});

		it('does not emit onAction and shows an error for invalid (empty name) submit', () => {
			let called = false;
			panel.onAction = () => { called = true; };
			panel.show(TEST_SERVERS);
			container.querySelector('.mcp-add-btn').click();
			container.querySelector('.mcp-form-command').value = 'npx';
			container.querySelector('.mcp-form-save').click();
			expect(called).to.equal(false);
			expect(container.querySelector('.mcp-form-error').textContent.trim()).to.not.equal('');
		});

		it('emits onAction with an add payload for a valid stdio submit', () => {
			let payload = null;
			panel.onAction = (p) => { payload = p; };
			panel.show(TEST_SERVERS);
			container.querySelector('.mcp-add-btn').click();
			container.querySelector('.mcp-form-name').value = 'myserver';
			container.querySelector('.mcp-form-command').value = 'npx';
			container.querySelector('.mcp-form-args').value = '-y\nsome-pkg';
			container.querySelector('.mcp-form-save').click();
			expect(payload).to.not.equal(null);
			expect(payload.action).to.equal('add');
			expect(payload.name).to.equal('myserver');
			expect(payload.config.command).to.equal('npx');
			expect(payload.config.args).to.deep.equal(['-y', 'some-pkg']);
			expect(payload.config.type).to.equal('stdio');
			expect(payload.config.tools).to.deep.equal(['*']);
		});

		it('parses comma-separated args (and trims) as well as newlines', () => {
			let payload = null;
			panel.onAction = (p) => { payload = p; };
			panel.show(TEST_SERVERS);
			container.querySelector('.mcp-add-btn').click();
			container.querySelector('.mcp-form-name').value = 'srv';
			container.querySelector('.mcp-form-command').value = 'npx';
			container.querySelector('.mcp-form-args').value = '-y, some-pkg , --flag';
			container.querySelector('.mcp-form-save').click();
			expect(payload.config.args).to.deep.equal(['-y', 'some-pkg', '--flag']);
		});

		it('parses mixed newline + comma args', () => {
			let payload = null;
			panel.onAction = (p) => { payload = p; };
			panel.show(TEST_SERVERS);
			container.querySelector('.mcp-add-btn').click();
			container.querySelector('.mcp-form-name').value = 'srv';
			container.querySelector('.mcp-form-command').value = 'npx';
			container.querySelector('.mcp-form-args').value = '-y, pkg\n--flag';
			container.querySelector('.mcp-form-save').click();
			expect(payload.config.args).to.deep.equal(['-y', 'pkg', '--flag']);
		});

		it('handleActionResult surfaces errors back into the form', () => {
			panel.show(TEST_SERVERS);
			container.querySelector('.mcp-add-btn').click();
			panel.handleActionResult({ success: false, action: 'add', name: 'x', errors: ['boom'] });
			expect(container.querySelector('.mcp-form-error').textContent).to.include('boom');
		});
	});

	describe('Row actions (user servers only)', () => {
		it('renders Edit and Remove buttons for user rows', () => {
			panel.show(TEST_SERVERS);
			const row = container.querySelector('[data-server="filesystem"]');
			expect(row.querySelector('.mcp-row-edit')).to.exist;
			expect(row.querySelector('.mcp-row-remove')).to.exist;
		});

		it('does not render Edit/Remove for managed rows', () => {
			panel.show(TEST_SERVERS);
			const row = container.querySelector('[data-server="_copilotcli_playwright"]');
			expect(row.querySelector('.mcp-row-edit')).to.not.exist;
			expect(row.querySelector('.mcp-row-remove')).to.not.exist;
		});

		it('emits a remove action when Remove is clicked', () => {
			let payload = null;
			panel.onAction = (p) => { payload = p; };
			dom.window.confirm = () => true;
			panel.show(TEST_SERVERS);
			container.querySelector('[data-server="filesystem"] .mcp-row-remove').click();
			expect(payload).to.deep.include({ action: 'remove', name: 'filesystem' });
		});

		it('opens a prefilled form when Edit is clicked', () => {
			panel.show([{ name: 'fs', rawKey: 'fs', type: 'user', status: 'configured', toolCount: 0, tools: [],
				config: { type: 'stdio', command: 'npx', args: ['-y', 'pkg'] } }]);
			container.querySelector('[data-server="fs"] .mcp-row-edit').click();
			expect(container.querySelector('.mcp-form-name').value).to.equal('fs');
			expect(container.querySelector('.mcp-form-command').value).to.equal('npx');
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
