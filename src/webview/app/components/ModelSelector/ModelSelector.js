/**
 * ModelSelector Component
 *
 * Dropdown for switching models mid-session.
 * Collapsed state shows short model name; click to expand grouped model list.
 * Uses dynamic model list from SDK when available, falls back to static catalog.
 */

const MODEL_CATALOG = [
	{ group: 'Standard', models: [
		{ id: 'claude-sonnet-4.5', label: 'sonnet-4.5' },
		{ id: 'gpt-4o', label: 'gpt-4o' },
		{ id: 'gpt-4.1', label: 'gpt-4.1' },
	]},
	{ group: 'Fast', models: [
		{ id: 'claude-haiku-3.5', label: 'haiku-3.5' },
		{ id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
		{ id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
	]},
	{ group: 'Premium', models: [
		{ id: 'claude-opus-4.5', label: 'opus-4.5' },
		{ id: 'o3', label: 'o3' },
		{ id: 'o4-mini', label: 'o4-mini' },
		{ id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
	]},
];

/** Map model ID prefix to vendor group name */
const VENDOR_PREFIXES = [
	{ prefix: 'claude-', group: 'Anthropic' },
	{ prefix: 'gpt-', group: 'OpenAI' },
	{ prefix: 'o1', group: 'OpenAI' },
	{ prefix: 'o3', group: 'OpenAI' },
	{ prefix: 'o4', group: 'OpenAI' },
	{ prefix: 'gemini-', group: 'Google' },
];

class ModelSelector {
	constructor(container, eventBus) {
		this.container = container;
		this.eventBus = eventBus;
		this.currentModel = null;
		this.isOpen = false;
		this._dynamicModels = null;

		this.render();
		this.attachListeners();
	}

	render() {
		this.container.innerHTML = `
			<div class="model-selector">
				<button class="model-selector-bar" title="Switch model">
					<span class="model-selector-label">—</span>
					<span class="model-selector-arrow">▾</span>
				</button>
				<div class="model-selector-dropdown" style="display: none;"></div>
			</div>
		`;

		this.bar = this.container.querySelector('.model-selector-bar');
		this.labelEl = this.container.querySelector('.model-selector-label');
		this.dropdown = this.container.querySelector('.model-selector-dropdown');
	}

	attachListeners() {
		this.bar.addEventListener('click', (e) => {
			e.stopPropagation();
			this.toggle();
		});

		this.container.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.isOpen) {
				this.close();
			}
		});
	}

	/**
	 * Set the current model and update display
	 * @param {string} modelId
	 */
	setModel(modelId) {
		this.currentModel = modelId;
		this.labelEl.textContent = this._shortName(modelId);
		if (this.isOpen) {
			this._renderDropdown();
		}
	}

	/**
	 * Set the available models from SDK (replaces static catalog)
	 * @param {Array<{id: string, name: string}>} models
	 */
	setAvailableModels(models) {
		this._dynamicModels = models;
		if (this.isOpen) {
			this._renderDropdown();
		}
	}

	toggle() {
		if (this.isOpen) {
			this.close();
		} else {
			this.open();
		}
	}

	open() {
		this.isOpen = true;
		this._renderDropdown();
		this.dropdown.style.display = '';
	}

	close() {
		this.isOpen = false;
		this.dropdown.style.display = 'none';
	}

	_renderDropdown() {
		const catalog = this._dynamicModels
			? this._groupDynamicModels(this._dynamicModels)
			: MODEL_CATALOG;

		let html = '';
		for (const group of catalog) {
			html += `<div class="model-group-header">${group.group}</div>`;
			for (const model of group.models) {
				const isCurrent = model.id === this.currentModel;
				html += `<div class="model-option${isCurrent ? ' current' : ''}" data-model="${model.id}">
					<span class="model-option-check">${isCurrent ? '✓' : ''}</span>
					<span class="model-option-label">${model.label}</span>
				</div>`;
			}
		}
		this.dropdown.innerHTML = html;

		// Attach click handlers
		const options = this.dropdown.querySelectorAll('.model-option');
		for (const option of options) {
			option.addEventListener('click', (e) => {
				e.stopPropagation();
				const modelId = option.dataset.model;
				if (modelId !== this.currentModel) {
					this.eventBus.emit('modelSelected', modelId);
				}
				this.close();
			});
		}
	}

	/**
	 * Group dynamic models by vendor prefix
	 * @param {Array<{id: string, name: string}>} models
	 * @returns {Array<{group: string, models: Array<{id: string, label: string}>}>}
	 */
	_groupDynamicModels(models) {
		const groups = new Map();

		for (const model of models) {
			const vendor = this._getVendorGroup(model.id);
			if (!groups.has(vendor)) {
				groups.set(vendor, []);
			}
			groups.set(vendor, [...groups.get(vendor), {
				id: model.id,
				label: this._shortName(model.id),
			}]);
		}

		return Array.from(groups.entries()).map(([group, models]) => ({
			group,
			models,
		}));
	}

	/**
	 * Determine vendor group from model ID
	 * @param {string} modelId
	 * @returns {string}
	 */
	_getVendorGroup(modelId) {
		for (const { prefix, group } of VENDOR_PREFIXES) {
			if (modelId.startsWith(prefix)) {
				return group;
			}
		}
		return 'Other';
	}

	/**
	 * Strip vendor prefix to produce short display name
	 * @param {string} modelId
	 * @returns {string}
	 */
	_shortName(modelId) {
		if (!modelId) { return '—'; }
		// Strip 'claude-' prefix
		return modelId.replace(/^claude-/, '');
	}
}

export { ModelSelector };
