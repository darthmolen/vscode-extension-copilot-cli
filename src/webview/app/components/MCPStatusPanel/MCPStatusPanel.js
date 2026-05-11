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
		this.panelEl = document.createElement('div');
		this.panelEl.className = 'mcp-status-panel';
		this.panelEl.style.display = 'none';
		this.container.replaceChildren(this.panelEl);
	}

	show(servers) {
		this.panelEl.replaceChildren();
		this.panelEl.appendChild(this._buildHeader());
		if (!servers || servers.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'mcp-status-empty';
			empty.textContent = 'No MCP servers configured.';
			this.panelEl.appendChild(empty);
		} else {
			const list = document.createElement('div');
			list.className = 'mcp-status-list';
			for (const server of servers) {
				list.appendChild(this._buildRow(server));
			}
			this.panelEl.appendChild(list);
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

	_buildHeader() {
		const header = document.createElement('div');
		header.className = 'mcp-status-header';

		const title = document.createElement('span');
		title.className = 'mcp-status-title';
		title.textContent = 'MCP Servers';
		header.appendChild(title);

		const closeBtn = document.createElement('button');
		closeBtn.className = 'mcp-status-close-btn';
		closeBtn.title = 'Close';
		closeBtn.textContent = '×';
		header.appendChild(closeBtn);

		return header;
	}

	_buildRow(server) {
		const icon = STATUS_ICONS[server.status] ?? '🟡';
		const label = STATUS_LABELS[server.status] ?? server.status;
		const toolsText = server.status === 'connected' && server.toolCount > 0
			? `${server.toolCount} tool${server.toolCount !== 1 ? 's' : ''}`
			: server.error
				? `error: ${server.error}`
				: label;

		const row = document.createElement('div');
		row.className = 'mcp-status-server-row';
		row.dataset.server = server.rawKey ?? '';

		const iconEl = document.createElement('span');
		iconEl.className = 'mcp-status-icon';
		if (server.status === 'unknown') {
			iconEl.classList.add('mcp-status-icon--unknown');
		}
		iconEl.textContent = icon;
		row.appendChild(iconEl);

		const nameEl = document.createElement('span');
		nameEl.className = 'mcp-status-name';
		nameEl.textContent = server.name ?? '';
		row.appendChild(nameEl);

		const badge = document.createElement('span');
		badge.className = `mcp-status-type-badge mcp-status-type-badge--${server.type ?? ''}`;
		badge.textContent = server.type ?? '';
		row.appendChild(badge);

		const tools = document.createElement('span');
		tools.className = 'mcp-status-tools';
		tools.textContent = toolsText;
		row.appendChild(tools);

		return row;
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
