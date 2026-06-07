/**
 * MCPStatusPanel — Shows MCP server connection status above the input area, and
 * (for the extension's own `user` servers) lets the user add / edit / remove /
 * enable-disable them. Managed / imported / Copilot-configured servers are
 * read-only — the extension never writes to those sources.
 *
 * Triggered by the /mcp slash command.
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

const MANAGED_KEY_PREFIX = '_copilotcli_';

export class MCPStatusPanel {
	constructor(container) {
		this.container = container;
		this.onClose = null;
		/** Called with { action, name, config?, enabled?, originalName? }. */
		this.onAction = null;
		this._servers = [];
		this._render();
	}

	_render() {
		this.panelEl = document.createElement('div');
		this.panelEl.className = 'mcp-status-panel';
		this.panelEl.style.display = 'none';
		this.container.replaceChildren(this.panelEl);
	}

	show(servers) {
		this._servers = servers ?? [];
		this._renderList();
		this.panelEl.style.display = '';
	}

	hide() {
		this.panelEl.style.display = 'none';
	}

	isVisible() {
		return this.panelEl.style.display !== 'none';
	}

	// ---- List view -------------------------------------------------------

	_renderList() {
		this.panelEl.replaceChildren();
		this.panelEl.appendChild(this._buildHeader());
		if (!this._servers || this._servers.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'mcp-status-empty';
			empty.textContent = 'No MCP servers configured.';
			this.panelEl.appendChild(empty);
		} else {
			const list = document.createElement('div');
			list.className = 'mcp-status-list';
			for (const server of this._servers) {
				list.appendChild(this._buildRow(server));
			}
			this.panelEl.appendChild(list);
		}
		this._attachCloseHandler();
		this._attachAddHandler();
	}

	_buildHeader() {
		const header = document.createElement('div');
		header.className = 'mcp-status-header';

		const title = document.createElement('span');
		title.className = 'mcp-status-title';
		title.textContent = 'MCP Servers';
		header.appendChild(title);

		const addBtn = document.createElement('button');
		addBtn.className = 'mcp-add-btn';
		addBtn.title = 'Add MCP server';
		addBtn.textContent = '＋ Add Server';
		header.appendChild(addBtn);

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

		if (server.type === 'user') {
			row.appendChild(this._buildRowActions(server));
		} else if (server.type) {
			// Managed / imported / Copilot-configured servers are read-only.
			const lock = document.createElement('span');
			lock.className = 'mcp-status-readonly';
			lock.title = 'Read-only — configured outside this extension';
			lock.textContent = '🔒';
			row.appendChild(lock);
		}

		return row;
	}

	_buildRowActions(server) {
		const actions = document.createElement('span');
		actions.className = 'mcp-row-actions';

		const enabled = server.config?.enabled !== false;
		const toggle = document.createElement('button');
		toggle.className = 'mcp-row-toggle';
		toggle.title = enabled ? 'Disable' : 'Enable';
		toggle.textContent = enabled ? '⏸' : '▶';
		toggle.addEventListener('click', () => {
			this._emit({ action: 'setEnabled', name: server.name, enabled: !enabled });
		});
		actions.appendChild(toggle);

		const edit = document.createElement('button');
		edit.className = 'mcp-row-edit';
		edit.title = 'Edit';
		edit.textContent = '✎';
		edit.addEventListener('click', () => this._showForm(server));
		actions.appendChild(edit);

		const remove = document.createElement('button');
		remove.className = 'mcp-row-remove';
		remove.title = 'Remove';
		remove.textContent = '🗑';
		remove.addEventListener('click', () => {
			if (window.confirm(`Remove MCP server "${server.name}"?`)) {
				this._emit({ action: 'remove', name: server.name });
			}
		});
		actions.appendChild(remove);

		return actions;
	}

	// ---- Form view -------------------------------------------------------

	/** Show the add form, or the edit form when `server` is provided. */
	_showForm(server) {
		const editing = !!server;
		const cfg = server?.config ?? {};
		const type = cfg.type === 'http' || cfg.type === 'sse' ? cfg.type : 'stdio';

		this.panelEl.replaceChildren();

		const header = document.createElement('div');
		header.className = 'mcp-status-header';
		const title = document.createElement('span');
		title.className = 'mcp-status-title';
		title.textContent = editing ? `Edit ${server.name}` : 'Add MCP Server';
		header.appendChild(title);
		this.panelEl.appendChild(header);

		const form = document.createElement('div');
		form.className = 'mcp-form';

		form.appendChild(this._field('Name', this._input('mcp-form-name', server?.name ?? '')));

		// Type radios
		const typeRow = document.createElement('div');
		typeRow.className = 'mcp-form-row';
		for (const t of ['stdio', 'http', 'sse']) {
			const lbl = document.createElement('label');
			const radio = document.createElement('input');
			radio.type = 'radio';
			radio.name = 'mcp-type';
			radio.value = t;
			radio.checked = t === type;
			radio.addEventListener('change', () => this._updateTypeVisibility());
			lbl.appendChild(radio);
			lbl.appendChild(document.createTextNode(` ${t}`));
			typeRow.appendChild(lbl);
		}
		form.appendChild(typeRow);

		// stdio fields
		this._commandRow = this._field('Command', this._input('mcp-form-command', cfg.command ?? ''));
		form.appendChild(this._commandRow);
		const argsArea = document.createElement('textarea');
		argsArea.className = 'mcp-form-args';
		argsArea.placeholder = 'one per line or comma-separated';
		argsArea.value = Array.isArray(cfg.args) ? cfg.args.join('\n') : '';
		this._argsRow = this._field('Arguments', argsArea);
		form.appendChild(this._argsRow);

		// http/sse fields
		this._urlRow = this._field('URL', this._input('mcp-form-url', cfg.url ?? ''));
		form.appendChild(this._urlRow);

		const error = document.createElement('div');
		error.className = 'mcp-form-error';
		form.appendChild(error);

		const buttons = document.createElement('div');
		buttons.className = 'mcp-form-buttons';
		const save = document.createElement('button');
		save.className = 'mcp-form-save';
		save.textContent = editing ? 'Save' : 'Add Server';
		save.addEventListener('click', () => this._handleSave(editing ? server.name : null));
		const cancel = document.createElement('button');
		cancel.className = 'mcp-form-cancel';
		cancel.textContent = 'Cancel';
		cancel.addEventListener('click', () => this._renderList());
		buttons.appendChild(save);
		buttons.appendChild(cancel);
		form.appendChild(buttons);

		this.panelEl.appendChild(form);
		this._updateTypeVisibility();
	}

	_field(labelText, inputEl) {
		const row = document.createElement('div');
		row.className = 'mcp-form-row';
		const label = document.createElement('label');
		label.textContent = labelText;
		row.appendChild(label);
		row.appendChild(inputEl);
		return row;
	}

	_input(className, value) {
		const el = document.createElement('input');
		el.type = 'text';
		el.className = className;
		el.value = value ?? '';
		return el;
	}

	_selectedType() {
		const checked = this.panelEl.querySelector('input[name="mcp-type"]:checked');
		return checked ? checked.value : 'stdio';
	}

	_updateTypeVisibility() {
		const isRemote = this._selectedType() !== 'stdio';
		if (this._commandRow) { this._commandRow.style.display = isRemote ? 'none' : ''; }
		if (this._argsRow) { this._argsRow.style.display = isRemote ? 'none' : ''; }
		if (this._urlRow) { this._urlRow.style.display = isRemote ? '' : 'none'; }
	}

	_handleSave(originalName) {
		const name = this.panelEl.querySelector('.mcp-form-name').value.trim();
		const type = this._selectedType();
		const config = { type, tools: ['*'] };
		if (type === 'stdio') {
			config.command = this.panelEl.querySelector('.mcp-form-command').value.trim();
			const args = this.panelEl.querySelector('.mcp-form-args').value
				.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
			if (args.length) { config.args = args; }
		} else {
			config.url = this.panelEl.querySelector('.mcp-form-url').value.trim();
		}

		const existingNames = this._servers
			.filter(s => s.type === 'user' && s.name !== originalName)
			.map(s => s.name);
		const errors = this._validate(name, type, config, existingNames);
		if (errors.length) {
			this._showFormError(errors.join(' '));
			return;
		}

		this._emit(originalName
			? { action: 'edit', name, config, originalName }
			: { action: 'add', name, config });
	}

	/** Lightweight client-side validation for instant feedback. The extension
	 *  re-validates authoritatively (defense-in-depth). */
	_validate(name, type, config, existingNames) {
		const errors = [];
		if (!name) {
			errors.push('Server name is required.');
		} else if (name.startsWith(MANAGED_KEY_PREFIX)) {
			errors.push(`Name cannot start with "${MANAGED_KEY_PREFIX}".`);
		} else if (existingNames.includes(name)) {
			errors.push(`A server named "${name}" already exists.`);
		}
		if (type === 'stdio' && !config.command) {
			errors.push('A command is required for local servers.');
		}
		if ((type === 'http' || type === 'sse') && !config.url) {
			errors.push('A URL is required for http/sse servers.');
		}
		return errors;
	}

	_showFormError(text) {
		const error = this.panelEl.querySelector('.mcp-form-error');
		if (error) { error.textContent = text; }
	}

	/** Called by main.js with the extension's action result. */
	handleActionResult(msg) {
		if (msg && msg.success === false) {
			this._showFormError((msg.errors ?? ['Action failed']).join(' '));
		}
	}

	_emit(payload) {
		if (this.onAction) { this.onAction(payload); }
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

	_attachAddHandler() {
		const addBtn = this.panelEl.querySelector('.mcp-add-btn');
		if (addBtn) {
			addBtn.addEventListener('click', () => this._showForm(null));
		}
	}
}
