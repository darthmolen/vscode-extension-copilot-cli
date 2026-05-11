/**
 * MCPStatusPanel — Shows MCP server connection status above the input area.
 *
 * Triggered by the /mcp slash command. Displays each configured server
 * with its connection status icon, type badge, and tool count.
 *
 * Status icons:
 *   🟢 connected  — SDK confirmed tools available
 *   🟡 configured — in config, no SDK confirmation yet
 *   🔴 failed     — SDK reported connection error
 *   ⏳ connecting — session started, waiting for tool list
 *   ⚪ unknown    — CLI too old to report status (< 1.0.36)
 */

const STATUS_ICONS = {
	connected:  '🟢',
	configured: '🟡',
	connecting: '⏳',
	failed:     '🔴',
	unknown:    '⚪',
};

const STATUS_LABELS = {
	connected:  'connected',
	configured: 'not connected yet',
	connecting: 'connecting…',
	failed:     'error',
	unknown:    'status unavailable',
};

export class MCPStatusPanel {
	constructor(container) {
		this.container = container;
		this.onClose = null;
		this._render();
	}

	_render() {
		this.container.innerHTML = '<div class="mcp-status-panel" style="display: none;"></div>';
		this.panelEl = this.container.querySelector('.mcp-status-panel');
	}

	show(servers) {
		if (!servers || servers.length === 0) {
			this.panelEl.innerHTML = `
				<div class="mcp-status-header">
					<span class="mcp-status-title">MCP Servers</span>
					<button class="mcp-status-close-btn" title="Close">×</button>
				</div>
				<div class="mcp-status-empty">No MCP servers configured.</div>
			`;
		} else {
			const rows = servers.map(s => this._renderRow(s)).join('');
			this.panelEl.innerHTML = `
				<div class="mcp-status-header">
					<span class="mcp-status-title">MCP Servers</span>
					<button class="mcp-status-close-btn" title="Close">×</button>
				</div>
				<div class="mcp-status-list">${rows}</div>
			`;
		}
		this.panelEl.style.display = '';
		this._attachCloseHandler();
	}

	hide() {
		this.panelEl.style.display = 'none';
	}

	isVisible() {
		return this.panelEl.style.display !== 'none';
	}

	_renderRow(server) {
		const icon = STATUS_ICONS[server.status] ?? '🟡';
		const label = STATUS_LABELS[server.status] ?? server.status;
		const typeBadgeClass = `mcp-status-type-badge mcp-status-type-badge--${server.type}`;
		const toolsText = server.status === 'connected' && server.toolCount > 0
			? `${server.toolCount} tool${server.toolCount !== 1 ? 's' : ''}`
			: server.error
				? `error: ${server.error}`
				: label;

		return `
			<div class="mcp-status-server-row" data-server="${server.rawKey}">
				<span class="mcp-status-icon">${icon}</span>
				<span class="mcp-status-name">${server.name}</span>
				<span class="${typeBadgeClass}">${server.type}</span>
				<span class="mcp-status-tools">${toolsText}</span>
			</div>
		`;
	}

	_attachCloseHandler() {
		const closeBtn = this.panelEl.querySelector('.mcp-status-close-btn');
		if (closeBtn) {
			closeBtn.addEventListener('click', () => {
				this.hide();
				if (this.onClose) { this.onClose(); }
			});
		}
	}
}
