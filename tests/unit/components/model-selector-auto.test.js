/**
 * TDD RED: ModelSelector — 'auto' pinning + tokenPrices-based tiering
 *
 * As of CLI 1.0.6x, billing.multiplier is no longer populated; models carry
 * tokenPrices.outputPrice instead. The selector must:
 *   - pin the 'auto' model at the top in a "Recommended" group with no cost badge
 *   - derive Fast/Standard/Premium tiers from outputPrice when multiplier is absent
 *   - still honor multiplier when present (older/premium-billed accounts)
 */
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { ModelSelector } from '../../../src/webview/app/components/ModelSelector/ModelSelector.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

describe('ModelSelector — auto pinning + outputPrice tiering', () => {
	let dom, container, eventBus;

	beforeEach(() => {
		dom = new JSDOM(`<!DOCTYPE html><div id="container"></div>`);
		global.document = dom.window.document;
		global.window = dom.window;
		global.KeyboardEvent = dom.window.KeyboardEvent;
		container = document.getElementById('container');
		eventBus = new EventBus();
	});

	afterEach(() => {
		delete global.document;
		delete global.window;
		delete global.KeyboardEvent;
	});

	// Real shape from CLI 1.0.68 listModels(): no multiplier, only outputPrice.
	const realModels = [
		{ id: 'auto', name: 'Auto' },
		{ id: 'gpt-5-mini', name: 'GPT-5 Mini', outputPrice: 200 },
		{ id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', outputPrice: 500 },
		{ id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', outputPrice: 1500 },
		{ id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', outputPrice: 1400 },
		{ id: 'claude-opus-4.8', name: 'Claude Opus 4.8', outputPrice: 2500 },
		{ id: 'claude-fable-5', name: 'Claude Fable 5', outputPrice: 5000 },
	];

	function openDropdown(selector, current = 'auto') {
		selector.setAvailableModels(realModels);
		selector.setModel(current);
		container.querySelector('.model-selector-bar').click();
	}

	function groupOrder() {
		return Array.from(container.querySelectorAll('.model-group-header')).map(h => h.textContent);
	}

	function modelsInGroup(groupName) {
		const elements = Array.from(container.querySelectorAll('.model-group-header, .model-option'));
		const headerIdx = elements.findIndex(el =>
			el.classList.contains('model-group-header') && el.textContent === groupName);
		if (headerIdx === -1) return [];
		const nextIdx = elements.findIndex((el, i) =>
			i > headerIdx && el.classList.contains('model-group-header'));
		return elements
			.slice(headerIdx + 1, nextIdx === -1 ? undefined : nextIdx)
			.filter(el => el.classList.contains('model-option'))
			.map(el => el.dataset.model);
	}

	describe('auto pinning', () => {
		it('places auto in a "Recommended" group at the very top', () => {
			const selector = new ModelSelector(container, eventBus);
			openDropdown(selector);

			const headers = groupOrder();
			expect(headers[0]).to.equal('Recommended');
			expect(modelsInGroup('Recommended')).to.deep.equal(['auto']);
		});

		it('orders Recommended before Fast/Standard/Premium', () => {
			const selector = new ModelSelector(container, eventBus);
			openDropdown(selector);

			const headers = groupOrder();
			const rec = headers.indexOf('Recommended');
			const fast = headers.indexOf('Fast');
			const std = headers.indexOf('Standard');
			const prem = headers.indexOf('Premium');
			expect(rec).to.be.lessThan(fast);
			expect(fast).to.be.lessThan(std);
			expect(std).to.be.lessThan(prem);
		});

		it('renders no cost badge for the auto option', () => {
			const selector = new ModelSelector(container, eventBus);
			openDropdown(selector);

			const autoOption = container.querySelector('.model-option[data-model="auto"]');
			expect(autoOption, 'auto option should render').to.not.be.null;
			const badge = autoOption.querySelector('.model-option-multiplier');
			// no misleading "Nx" / "$$" for auto
			expect((badge?.textContent ?? '').trim()).to.equal('');
		});

		it('shows no multiplier in the collapsed bar when auto is selected', () => {
			const selector = new ModelSelector(container, eventBus);
			openDropdown(selector);
			const bar = container.querySelector('.model-selector-bar');
			expect(bar.textContent).to.not.match(/\dx/);
		});

		it('emits modelSelected with "auto" when the auto option is clicked', () => {
			const selector = new ModelSelector(container, eventBus);
			// start on a concrete model so clicking auto is a change
			selector.setAvailableModels(realModels);
			selector.setModel('claude-sonnet-4.6');
			container.querySelector('.model-selector-bar').click();

			let emitted = null;
			eventBus.on('modelSelected', id => { emitted = id; });
			container.querySelector('.model-option[data-model="auto"]').click();
			expect(emitted).to.equal('auto');
		});
	});

	describe('outputPrice-derived tiers (no multiplier present)', () => {
		it('buckets cheap models (low outputPrice) into Fast', () => {
			const selector = new ModelSelector(container, eventBus);
			openDropdown(selector);
			const fast = modelsInGroup('Fast');
			expect(fast).to.include('gpt-5-mini');   // 200
			expect(fast).to.include('claude-haiku-4.5'); // 500
			expect(fast).to.not.include('claude-sonnet-4.6');
		});

		it('buckets mid models into Standard', () => {
			const selector = new ModelSelector(container, eventBus);
			openDropdown(selector);
			const std = modelsInGroup('Standard');
			expect(std).to.include('claude-sonnet-4.6'); // 1500
			expect(std).to.include('gpt-5.3-codex');      // 1400
			expect(std).to.not.include('claude-opus-4.8');
		});

		it('buckets expensive models into Premium', () => {
			const selector = new ModelSelector(container, eventBus);
			openDropdown(selector);
			const prem = modelsInGroup('Premium');
			expect(prem).to.include('claude-opus-4.8'); // 2500
			expect(prem).to.include('claude-fable-5');  // 5000
			expect(prem).to.not.include('claude-sonnet-4.6');
		});
	});
});
