/**
 * ModelSelector Component
 *
 * Dropdown for switching models mid-session.
 * Collapsed state shows short model name + cost badge; click to expand tier-grouped list.
 * Uses dynamic model list from SDK when available, falls back to static catalog.
 *
 * Models are grouped by cost tier (Recommended/Fast/Standard/Premium), not by vendor.
 * `auto` is pinned at the top (Recommended) with no cost badge — Copilot's server-side
 * router picks the best model per turn.
 *
 * Cost tier is derived from `multiplier` when present (older / premium-request-billed
 * accounts) and otherwise from `outputPrice` (per-1M-token price from the SDK's
 * billing.tokenPrices — the only cost signal on token-billed accounts as of CLI 1.0.6x).
 */

const AUTO_ID = 'auto';

const MODEL_CATALOG = [
	{ group: 'Recommended', models: [
		{ id: 'auto', label: 'auto' },
	]},
	{ group: 'Fast', models: [
		{ id: 'gpt-5-mini', label: 'gpt-5-mini', outputPrice: 200 },
		{ id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', outputPrice: 450 },
		{ id: 'claude-haiku-4.5', label: 'haiku-4.5', outputPrice: 500 },
	]},
	{ group: 'Standard', models: [
		{ id: 'claude-sonnet-5', label: 'sonnet-5', outputPrice: 1000 },
		{ id: 'gpt-5.4', label: 'gpt-5.4', outputPrice: 1500 },
		{ id: 'claude-sonnet-4.6', label: 'sonnet-4.6', outputPrice: 1500 },
	]},
	{ group: 'Premium', models: [
		{ id: 'claude-opus-4.8', label: 'opus-4.8', outputPrice: 2500 },
		{ id: 'gpt-5.5', label: 'gpt-5.5', outputPrice: 3000 },
		{ id: 'claude-fable-5', label: 'fable-5', outputPrice: 5000 },
	]},
];

/** Tier display order (used to sort groups regardless of insertion). */
const TIER_ORDER = ['Recommended', 'Fast', 'Standard', 'Premium'];

/** Relative cost glyph shown when only a token price (no multiplier) is known. */
const TIER_GLYPH = { Fast: '$', Standard: '$$', Premium: '$$$' };

class ModelSelector {
	constructor(container, eventBus) {
		this.container = container;
		this.eventBus = eventBus;
		this.currentModel = null;
		this.isOpen = false;
		this._dynamicModels = null;
		this._costMap = new Map();

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

		this._onDocumentClick = (event) => {
			if (this.isOpen && !this.container.contains(event.target)) {
				this.close();
			}
		};
		document.addEventListener('click', this._onDocumentClick);
	}

	destroy() {
		if (this._onDocumentClick) {
			document.removeEventListener('click', this._onDocumentClick);
		}
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
		this._costMap = new Map(
			models.map(m => [m.id, { multiplier: m.multiplier, outputPrice: m.outputPrice }])
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
				const badge = this._badge(model);
				const tierClass = badge.tier ? ` tier-${badge.tier.toLowerCase()}` : '';
				html += `<div class="model-option${isCurrent ? ' current' : ''}" data-model="${model.id}">
					<span class="model-option-check">${isCurrent ? '✓' : ''}</span>
					<span class="model-option-label">${model.label}</span>
					<span class="model-option-multiplier${tierClass}">${badge.text}</span>
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
	 * Group dynamic models by cost tier. `auto` is pinned to the top "Recommended" group.
	 * @param {Array<{id: string, name: string, multiplier?: number, outputPrice?: number}>} models
	 * @returns {Array<{group: string, models: Array<{id: string, label: string, multiplier?: number, outputPrice?: number}>}>}
	 */
	_groupDynamicModels(models) {
		const tiers = new Map(TIER_ORDER.map(t => [t, []]));

		for (const model of models) {
			const tier = model.id === AUTO_ID ? 'Recommended' : this._getTier(model);
			tiers.get(tier).push({
				id: model.id,
				label: this._shortName(model.id),
				multiplier: model.multiplier,
				outputPrice: model.outputPrice,
			});
		}

		return Array.from(tiers.entries())
			.filter(([, models]) => models.length > 0)
			.map(([group, models]) => ({ group, models }));
	}

	/**
	 * Classify a model into a cost tier. Prefers `multiplier` (relative request cost)
	 * when present; otherwise derives from `outputPrice` (per-1M-token price).
	 * @param {{multiplier?: number, outputPrice?: number}|number|undefined} cost
	 * @returns {string}
	 */
	_getTier(cost) {
		const c = (typeof cost === 'number') ? { multiplier: cost } : (cost || {});
		if (c.multiplier != null) {
			if (c.multiplier < 1.0) { return 'Fast'; }
			if (c.multiplier > 1.0) { return 'Premium'; }
			return 'Standard';
		}
		if (c.outputPrice != null) {
			if (c.outputPrice <= 900) { return 'Fast'; }
			if (c.outputPrice <= 1500) { return 'Standard'; }
			return 'Premium';
		}
		return 'Standard';
	}

	/**
	 * Compute the cost badge for a model option.
	 * - `auto` (and any model with no cost signal): no badge.
	 * - multiplier present: `Nx`.
	 * - outputPrice only: relative glyph ($/$$/$$$) for its tier.
	 * @param {{id: string, multiplier?: number, outputPrice?: number}} model
	 * @returns {{text: string, tier: string}}
	 */
	_badge(model) {
		if (model.id === AUTO_ID) { return { text: '', tier: '' }; }
		if (model.multiplier != null) {
			return { text: `${model.multiplier}x`, tier: this._getTier(model) };
		}
		if (model.outputPrice != null) {
			const tier = this._getTier(model);
			return { text: TIER_GLYPH[tier] || '', tier };
		}
		return { text: '', tier: '' };
	}

	/**
	 * Update the multiplier badge in the collapsed bar
	 * @param {string} modelId
	 */
	_updateBarMultiplier(modelId) {
		const cost = this._getCostForModel(modelId);
		// Remove previous tier classes
		this.multiplierEl.classList.remove('tier-fast', 'tier-standard', 'tier-premium');
		const badge = this._badge({ id: modelId, ...(cost || {}) });
		if (badge.text) {
			this.multiplierEl.textContent = `(${badge.text})`;
			this.multiplierEl.classList.add(`tier-${badge.tier.toLowerCase()}`);
		} else {
			this.multiplierEl.textContent = '';
		}
	}

	/**
	 * Look up the cost signal (multiplier/outputPrice) for a model ID from the
	 * dynamic SDK list or the static catalog.
	 * @param {string} modelId
	 * @returns {{multiplier?: number, outputPrice?: number}|null}
	 */
	_getCostForModel(modelId) {
		// Check dynamic models first
		if (this._costMap.has(modelId)) {
			return this._costMap.get(modelId);
		}
		// Check static catalog
		for (const group of MODEL_CATALOG) {
			const model = group.models.find(m => m.id === modelId);
			if (model) { return { multiplier: model.multiplier, outputPrice: model.outputPrice }; }
		}
		return null;
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
