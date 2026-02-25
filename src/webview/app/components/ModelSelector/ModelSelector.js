/**
 * ModelSelector Component
 *
 * Dropdown for switching models mid-session.
 * Collapsed state shows short model name + multiplier; click to expand tier-grouped model list.
 * Uses dynamic model list from SDK when available, falls back to static catalog.
 *
 * Models are grouped by cost tier (Fast/Standard/Premium), not by vendor.
 * Each model shows a multiplier badge indicating request cost.
 */

const MODEL_CATALOG = [
	{ group: 'Fast', models: [
		{ id: 'claude-haiku-4.5', label: 'haiku-4.5', multiplier: 0.5 },
		{ id: 'gpt-5-mini', label: 'gpt-5-mini', multiplier: 0.5 },
		{ id: 'gpt-4.1', label: 'gpt-4.1', multiplier: 0.5 },
	]},
	{ group: 'Standard', models: [
		{ id: 'claude-sonnet-4.5', label: 'sonnet-4.5', multiplier: 1.0 },
		{ id: 'gpt-5', label: 'gpt-5', multiplier: 1.0 },
		{ id: 'gemini-3-pro-preview', label: 'gemini-3-pro', multiplier: 1.0 },
	]},
	{ group: 'Premium', models: [
		{ id: 'claude-opus-4.6', label: 'opus-4.6', multiplier: 3.0 },
		{ id: 'claude-opus-4.6-fast', label: 'opus-4.6-fast', multiplier: 2.5 },
		{ id: 'claude-opus-4.5', label: 'opus-4.5', multiplier: 2.5 },
	]},
];

class ModelSelector {
	constructor(container, eventBus) {
		this.container = container;
		this.eventBus = eventBus;
		this.currentModel = null;
		this.isOpen = false;
		this._dynamicModels = null;
		this._multiplierMap = new Map();

		this.render();
		this.attachListeners();
	}

	render() {
		this.container.innerHTML = `
			<div class="model-selector">
				<button class="model-selector-bar" title="Switch model">
					<span class="model-selector-label">—</span>
					<span class="model-selector-multiplier"></span>
					<span class="model-selector-arrow">▾</span>
				</button>
				<div class="model-selector-dropdown" style="display: none;"></div>
			</div>
		`;

		this.bar = this.container.querySelector('.model-selector-bar');
		this.labelEl = this.container.querySelector('.model-selector-label');
		this.multiplierEl = this.container.querySelector('.model-selector-multiplier');
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
		this._updateBarMultiplier(modelId);
		if (this.isOpen) {
			this._renderDropdown();
		}
	}

	/**
	 * Set the available models from SDK (replaces static catalog)
	 * @param {Array<{id: string, name: string, multiplier?: number}>} models
	 */
	setAvailableModels(models) {
		this._dynamicModels = models;
		this._multiplierMap = new Map(
			models.map(m => [m.id, m.multiplier])
		);
		if (this.currentModel) {
			this._updateBarMultiplier(this.currentModel);
		}
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
				const multiplier = model.multiplier ?? 1.0;
				const tier = this._getTier(multiplier);
				html += `<div class="model-option${isCurrent ? ' current' : ''}" data-model="${model.id}">
					<span class="model-option-check">${isCurrent ? '✓' : ''}</span>
					<span class="model-option-label">${model.label}</span>
					<span class="model-option-multiplier tier-${tier.toLowerCase()}">${multiplier}x</span>
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
	 * Group dynamic models by cost tier
	 * @param {Array<{id: string, name: string, multiplier?: number}>} models
	 * @returns {Array<{group: string, models: Array<{id: string, label: string, multiplier: number}>}>}
	 */
	_groupDynamicModels(models) {
		const tiers = new Map([['Fast', []], ['Standard', []], ['Premium', []]]);

		for (const model of models) {
			const tier = this._getTier(model.multiplier);
			tiers.get(tier).push({
				id: model.id,
				label: this._shortName(model.id),
				multiplier: model.multiplier ?? 1.0,
			});
		}

		return Array.from(tiers.entries())
			.filter(([, models]) => models.length > 0)
			.map(([group, models]) => ({ group, models }));
	}

	/**
	 * Classify a model into a cost tier by its multiplier
	 * @param {number|undefined} multiplier
	 * @returns {string}
	 */
	_getTier(multiplier) {
		if (multiplier == null) { return 'Standard'; }
		if (multiplier < 1.0) { return 'Fast'; }
		if (multiplier > 1.0) { return 'Premium'; }
		return 'Standard';
	}

	/**
	 * Update the multiplier badge in the collapsed bar
	 * @param {string} modelId
	 */
	_updateBarMultiplier(modelId) {
		const multiplier = this._getMultiplierForModel(modelId);
		// Remove previous tier classes
		this.multiplierEl.classList.remove('tier-fast', 'tier-standard', 'tier-premium');
		if (multiplier != null) {
			const tier = this._getTier(multiplier);
			this.multiplierEl.textContent = `(${multiplier}x)`;
			this.multiplierEl.classList.add(`tier-${tier.toLowerCase()}`);
		} else {
			this.multiplierEl.textContent = '';
		}
	}

	/**
	 * Look up multiplier for a model ID from dynamic models or static catalog
	 * @param {string} modelId
	 * @returns {number|undefined}
	 */
	_getMultiplierForModel(modelId) {
		// Check dynamic models first
		if (this._multiplierMap.has(modelId)) {
			return this._multiplierMap.get(modelId) ?? 1.0;
		}
		// Check static catalog
		for (const group of MODEL_CATALOG) {
			const model = group.models.find(m => m.id === modelId);
			if (model) { return model.multiplier; }
		}
		return undefined;
	}

	/**
	 * Strip vendor prefix to produce short display name
	 * @param {string} modelId
	 * @returns {string}
	 */
	_shortName(modelId) {
		if (!modelId) { return '—'; }
		return modelId.replace(/^claude-/, '');
	}
}

export { ModelSelector };
