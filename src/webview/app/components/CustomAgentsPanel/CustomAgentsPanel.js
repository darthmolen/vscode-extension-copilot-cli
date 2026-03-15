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

import { escapeHtml } from '../../utils/webview-utils.js';

class CustomAgentsPanel {
	constructor(container, eventBus) {
		this.container = container;
		this.eventBus = eventBus;
		this._agents = [];
		this._isOpen = false;
		this._showingForm = false;
		this._editingAgent = null;
		this._mutatedSinceOpen = false;

		this._render();
		this._attachPanelListeners();

		// Track mutations so hide() can trigger a session reload if needed
		this.eventBus.on('agents:save', () => { this._mutatedSinceOpen = true; });
		this.eventBus.on('agents:delete', () => { this._mutatedSinceOpen = true; });

		// Request agents data immediately
		this.eventBus.emit('agents:request');
	}

	// -------------------------------------------------------------------------
	// Visibility
	// -------------------------------------------------------------------------

	show() {
		this._isOpen = true;
		const el = this.container.querySelector('.custom-agents-panel');
		if (el) {
			el.classList.add('open');
			el.setAttribute('aria-expanded', 'true');
		}
	}

	hide() {
		const mutated = this._mutatedSinceOpen;
		this._mutatedSinceOpen = false;
		this.eventBus.emit('agents:panelClosed', { mutated });
		this._isOpen = false;
		const el = this.container.querySelector('.custom-agents-panel');
		if (el) {
			el.classList.remove('open');
			el.setAttribute('aria-expanded', 'false');
		}
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
			<div class="custom-agents-panel" role="region" aria-label="Custom Agents" aria-expanded="false">
				<div class="custom-agents-panel__header">
					<span>Custom Agents</span>
					<div class="custom-agents-panel__actions">
						<button class="custom-agents-panel__btn" data-action="new" title="Add new agent" aria-label="Add new agent">+</button>
						<button class="custom-agents-panel__btn" data-action="close" title="Close panel" aria-label="Close panel">✕</button>
					</div>
				</div>
				<div class="agents-list-view">
					<div class="custom-agents-panel__list"></div>
				</div>
			</div>
		`;
	}

	_attachPanelListeners() {
		const closeBtn = this.container.querySelector('[data-action="close"]');
		if (closeBtn) closeBtn.addEventListener('click', () => this.hide());

		const newBtn = this.container.querySelector('[data-action="new"]');
		if (newBtn) newBtn.addEventListener('click', () => this._showForm(null));

		// Escape key closes panel
		this.container.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this._isOpen) {
				e.stopPropagation();
				if (this._showingForm) {
					const form = this.container.querySelector('.agents-form');
					if (form) form.remove();
					this._showingForm = false;
				} else {
					this.hide();
				}
			}
		});
	}

	_renderList() {
		const listEl = this.container.querySelector('.custom-agents-panel__list');
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

			const agentLabel = escapeHtml(agent.displayName || agent.name);
			const deleteBtn = agent.builtIn
				? ''
				: `<button class="agent-row__btn" data-action="delete" title="Delete agent" aria-label="Delete ${agentLabel}" data-name="${escapeHtml(agent.name)}">🗑</button>`;

			row.innerHTML = `
				<div class="agent-row__btns">
					<button class="agent-row__btn" data-action="edit" title="Edit agent" aria-label="Edit ${agentLabel}" data-name="${escapeHtml(agent.name)}">✏️</button>
					${deleteBtn}
				</div>
				<span class="agent-row__name">${escapeHtml(agent.displayName || agent.name)}</span>
				<span class="agent-row__desc">${escapeHtml(desc)}</span>
			`;

			row.querySelector('[data-action="edit"]').addEventListener('click', () => {
				this._showForm(agent);
			});

			if (!agent.builtIn) {
				row.querySelector('[data-action="delete"]').addEventListener('click', () => {
					this.eventBus.emit('agents:delete', agent.name);
					this._mutatedSinceOpen = true;
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
			<div class="agents-form__field">
				<label class="agents-form__label" for="agentName">Name</label>
				<input class="agents-form__input" id="agentName" name="name" type="text" ${isEdit ? 'readonly' : ''} placeholder="slug-format (lowercase, hyphens only)" />
			</div>
			<div class="agents-form__field">
				<label class="agents-form__label" for="agentDisplayName">Display Name</label>
				<input class="agents-form__input" id="agentDisplayName" name="displayName" type="text" placeholder="Human-readable name" />
			</div>
			<div class="agents-form__field">
				<label class="agents-form__label" for="agentDescription">Description</label>
				<input class="agents-form__input" id="agentDescription" name="description" type="text" placeholder="Brief description" />
			</div>
			<div class="agents-form__field">
				<label class="agents-form__label" for="agentPrompt">Prompt</label>
				<textarea class="agents-form__textarea" id="agentPrompt" name="prompt" rows="4" placeholder="System prompt for this agent"></textarea>
			</div>
			<div class="agents-form__field">
				<label class="agents-form__label" for="agentTools">Tools (comma-separated, blank = all)</label>
				<input class="agents-form__input" id="agentTools" name="tools" type="text" placeholder="view, grep, glob, bash" />
			</div>
			<div class="agents-form__actions">
				<button class="agents-form__save-btn">Save</button>
				<button class="agents-form__cancel-btn">Cancel</button>
			</div>
		`;

		// Set values programmatically to avoid XSS via innerHTML interpolation
		if (isEdit) {
			form.querySelector('#agentName').value = name;
			form.querySelector('#agentDisplayName').value = displayName;
			form.querySelector('#agentDescription').value = description;
			form.querySelector('#agentPrompt').value = prompt;
			form.querySelector('#agentTools').value = tools;
		}

		form.querySelector('.agents-form__save-btn').addEventListener('click', () => {
			this._handleSave(form);
		});

		form.querySelector('.agents-form__cancel-btn').addEventListener('click', () => {
			form.remove();
			this._showingForm = false;
		});

		// Insert form after the list
		const listView = this.container.querySelector('.agents-list-view');
		if (listView) listView.insertAdjacentElement('afterend', form);
		else this.container.querySelector('.custom-agents-panel').appendChild(form);

		// Focus first editable field
		const firstInput = isEdit
			? form.querySelector('#agentDisplayName')
			: form.querySelector('#agentName');
		if (firstInput) firstInput.focus();
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
		this._mutatedSinceOpen = true;
	}
}

export { CustomAgentsPanel };
