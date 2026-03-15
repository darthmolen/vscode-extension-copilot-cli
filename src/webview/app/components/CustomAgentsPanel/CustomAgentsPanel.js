/**
 * CustomAgentsPanel Component
 *
 * Collapsible panel between SessionToolbar and messages for managing custom agents.
 * List view shows all agents; clicking ✏️ slides to detail/edit form.
 *
 * Events emitted on EventBus:
 *   agents:request  — on construction, requests full agents list
 *   agents:save     — { name, displayName, description, prompt, tools } — save/update agent
 *   agents:delete   — name string — delete agent by name
 */

class CustomAgentsPanel {
	constructor(container, eventBus) {
		this.container = container;
		this.eventBus = eventBus;
		this._agents = [];
		this._isOpen = false;
		this._showingForm = false;
		this._editingAgent = null;

		this._render();
		this._attachPanelListeners();

		// Request agents data immediately
		this.eventBus.emit('agents:request');
	}

	// -------------------------------------------------------------------------
	// Visibility
	// -------------------------------------------------------------------------

	show() {
		this._isOpen = true;
		const el = this.container.querySelector('.custom-agents-panel');
		if (el) el.classList.add('open');
	}

	hide() {
		this._isOpen = false;
		const el = this.container.querySelector('.custom-agents-panel');
		if (el) el.classList.remove('open');
	}

	toggle() {
		if (this._isOpen) {
			this.hide();
		} else {
			this.show();
		}
	}

	// -------------------------------------------------------------------------
	// Data
	// -------------------------------------------------------------------------

	setAgents(agents) {
		this._agents = agents || [];
		this._showingForm = false;
		this._editingAgent = null;
		this._renderList();
	}

	// -------------------------------------------------------------------------
	// Private — Rendering
	// -------------------------------------------------------------------------

	_render() {
		this.container.innerHTML = `
			<div class="custom-agents-panel">
				<div class="custom-agents-header">
					<span class="custom-agents-title">Custom Agents</span>
					<button class="agent-new-btn" id="newAgentBtn" title="Add new agent">+</button>
					<button class="custom-agents-close-btn" title="Close">✕</button>
				</div>
				<div class="agents-list-view">
					<div class="agents-list"></div>
				</div>
			</div>
		`;
	}

	_attachPanelListeners() {
		const closeBtn = this.container.querySelector('.custom-agents-close-btn');
		if (closeBtn) closeBtn.addEventListener('click', () => this.hide());

		const newBtn = this.container.querySelector('.agent-new-btn, #newAgentBtn');
		if (newBtn) newBtn.addEventListener('click', () => this._showForm(null));
	}

	_renderList() {
		const listEl = this.container.querySelector('.agents-list');
		if (!listEl) return;

		// Remove any existing form
		const existingForm = this.container.querySelector('.agents-form');
		if (existingForm) existingForm.remove();

		listEl.innerHTML = '';

		for (const agent of this._agents) {
			const row = document.createElement('div');
			row.className = 'agent-row';
			row.dataset.name = agent.name;

			const desc = agent.description
				? agent.description.slice(0, 40) + (agent.description.length > 40 ? '…' : '')
				: '';

			const deleteBtn = agent.builtIn
				? ''
				: `<button class="agent-delete-btn" title="Delete agent" data-name="${agent.name}">🗑</button>`;

			row.innerHTML = `
				<span class="agent-name">${agent.displayName || agent.name}</span>
				<span class="agent-desc">${desc}</span>
				<button class="agent-edit-btn" title="Edit agent" data-name="${agent.name}">✏️</button>
				${deleteBtn}
			`;

			row.querySelector('.agent-edit-btn').addEventListener('click', () => {
				this._showForm(agent);
			});

			if (!agent.builtIn) {
				row.querySelector('.agent-delete-btn').addEventListener('click', () => {
					this.eventBus.emit('agents:delete', agent.name);
				});
			}

			listEl.appendChild(row);
		}
	}

	_showForm(agent) {
		// agent is null for new agent, object for editing
		this._showingForm = true;
		this._editingAgent = agent;

		// Remove existing form if any
		const existing = this.container.querySelector('.agents-form');
		if (existing) existing.remove();

		const isEdit = agent !== null;
		const name = isEdit ? (agent.name || '') : '';
		const displayName = isEdit ? (agent.displayName || '') : '';
		const description = isEdit ? (agent.description || '') : '';
		const prompt = isEdit ? (agent.prompt || '') : '';
		const tools = isEdit && agent.tools ? (Array.isArray(agent.tools) ? agent.tools.join(', ') : '') : '';

		const form = document.createElement('div');
		form.className = 'agents-form';
		form.innerHTML = `
			<div class="agents-form-field">
				<label for="agentName">Name</label>
				<input id="agentName" name="name" type="text" value="${name}" ${isEdit ? 'readonly' : ''} placeholder="slug-name" />
			</div>
			<div class="agents-form-field">
				<label for="agentDisplayName">Display Name</label>
				<input id="agentDisplayName" name="displayName" type="text" value="${displayName}" placeholder="Human-readable name" />
			</div>
			<div class="agents-form-field">
				<label for="agentDescription">Description</label>
				<input id="agentDescription" name="description" type="text" value="${description}" placeholder="Brief description" />
			</div>
			<div class="agents-form-field">
				<label for="agentPrompt">Prompt</label>
				<textarea id="agentPrompt" name="prompt" rows="4" placeholder="System prompt for this agent">${prompt}</textarea>
			</div>
			<div class="agents-form-field">
				<label for="agentTools">Tools (comma-separated, blank = all)</label>
				<input id="agentTools" name="tools" type="text" value="${tools}" placeholder="view, grep, glob, bash" />
			</div>
			<div class="agents-form-actions">
				<button class="agent-save-btn">Save</button>
				<button class="agent-cancel-btn">Cancel</button>
			</div>
		`;

		form.querySelector('.agent-save-btn').addEventListener('click', () => {
			this._handleSave(form);
		});

		form.querySelector('.agent-cancel-btn').addEventListener('click', () => {
			form.remove();
			this._showingForm = false;
		});

		// Insert form after the list
		const listView = this.container.querySelector('.agents-list-view');
		if (listView) listView.insertAdjacentElement('afterend', form);
		else this.container.querySelector('.custom-agents-panel').appendChild(form);
	}

	_handleSave(form) {
		const nameField = form.querySelector('#agentName');
		const name = nameField ? nameField.value.trim() : '';

		if (!name) {
			// Validation: name required — do not emit
			return;
		}

		const displayName = form.querySelector('#agentDisplayName')?.value.trim() || undefined;
		const description = form.querySelector('#agentDescription')?.value.trim() || undefined;
		const prompt = form.querySelector('#agentPrompt')?.value.trim() || '';
		const toolsRaw = form.querySelector('#agentTools')?.value.trim() || '';
		const tools = toolsRaw
			? toolsRaw.split(',').map(t => t.trim()).filter(Boolean)
			: undefined;

		const agent = { name, prompt };
		if (displayName) agent.displayName = displayName;
		if (description) agent.description = description;
		if (tools) agent.tools = tools;

		this.eventBus.emit('agents:save', agent);
	}
}

export { CustomAgentsPanel };
