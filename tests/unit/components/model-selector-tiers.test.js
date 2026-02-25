/**
 * TDD RED: ModelSelector tier grouping + multiplier badges
 *
 * Tests that the ModelSelector groups models by cost tier (Fast/Standard/Premium)
 * instead of vendor, and shows multiplier badges next to each model.
 */
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { ModelSelector } from '../../../src/webview/app/components/ModelSelector/ModelSelector.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

describe('ModelSelector Tier Grouping', () => {
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

	describe('Tier-based grouping with dynamic models', () => {
		const dynamicModels = [
			{ id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', multiplier: 0.5 },
			{ id: 'gpt-5-mini', name: 'GPT-5 Mini', multiplier: 0.5 },
			{ id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', multiplier: 1.0 },
			{ id: 'gpt-5', name: 'GPT-5', multiplier: 1.0 },
			{ id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', multiplier: 1.0 },
			{ id: 'claude-opus-4.6', name: 'Claude Opus 4.6', multiplier: 3.0 },
			{ id: 'claude-opus-4.5', name: 'Claude Opus 4.5', multiplier: 2.5 },
		];

		it('should group models by tier, not vendor', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setAvailableModels(dynamicModels);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const headers = container.querySelectorAll('.model-group-header');
			const headerTexts = Array.from(headers).map(h => h.textContent);

			// Should have tier headers, not vendor headers
			expect(headerTexts).to.include('Fast');
			expect(headerTexts).to.include('Standard');
			expect(headerTexts).to.include('Premium');

			// Should NOT have vendor headers
			expect(headerTexts).to.not.include('Anthropic');
			expect(headerTexts).to.not.include('OpenAI');
			expect(headerTexts).to.not.include('Google');
		});

		it('should order tiers: Fast, Standard, Premium', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setAvailableModels(dynamicModels);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const headers = container.querySelectorAll('.model-group-header');
			const headerTexts = Array.from(headers).map(h => h.textContent);

			const fastIdx = headerTexts.indexOf('Fast');
			const standardIdx = headerTexts.indexOf('Standard');
			const premiumIdx = headerTexts.indexOf('Premium');

			expect(fastIdx).to.be.lessThan(standardIdx);
			expect(standardIdx).to.be.lessThan(premiumIdx);
		});

		it('should place fast models (multiplier < 1.0) in Fast group', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setAvailableModels(dynamicModels);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			// Find the Fast group header, then get the model options that follow before next header
			const allElements = container.querySelectorAll('.model-group-header, .model-option');
			const elements = Array.from(allElements);
			const fastHeaderIdx = elements.findIndex(el =>
				el.classList.contains('model-group-header') && el.textContent === 'Fast'
			);
			const nextHeaderIdx = elements.findIndex((el, i) =>
				i > fastHeaderIdx && el.classList.contains('model-group-header')
			);

			const fastModels = elements
				.slice(fastHeaderIdx + 1, nextHeaderIdx === -1 ? undefined : nextHeaderIdx)
				.filter(el => el.classList.contains('model-option'))
				.map(el => el.dataset.model);

			expect(fastModels).to.include('claude-haiku-4.5');
			expect(fastModels).to.include('gpt-5-mini');
			expect(fastModels).to.not.include('claude-sonnet-4.5');
			expect(fastModels).to.not.include('claude-opus-4.6');
		});

		it('should place premium models (multiplier > 1.0) in Premium group', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setAvailableModels(dynamicModels);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const allElements = container.querySelectorAll('.model-group-header, .model-option');
			const elements = Array.from(allElements);
			const premiumHeaderIdx = elements.findIndex(el =>
				el.classList.contains('model-group-header') && el.textContent === 'Premium'
			);
			const nextHeaderIdx = elements.findIndex((el, i) =>
				i > premiumHeaderIdx && el.classList.contains('model-group-header')
			);

			const premiumModels = elements
				.slice(premiumHeaderIdx + 1, nextHeaderIdx === -1 ? undefined : nextHeaderIdx)
				.filter(el => el.classList.contains('model-option'))
				.map(el => el.dataset.model);

			expect(premiumModels).to.include('claude-opus-4.6');
			expect(premiumModels).to.include('claude-opus-4.5');
			expect(premiumModels).to.not.include('claude-sonnet-4.5');
		});
	});

	describe('Multiplier badges in dropdown', () => {
		it('should show multiplier badge for each model option', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setAvailableModels([
				{ id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', multiplier: 1.0 },
				{ id: 'claude-opus-4.6', name: 'Claude Opus 4.6', multiplier: 3.0 },
			]);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const badges = container.querySelectorAll('.model-option-multiplier');
			expect(badges.length).to.be.greaterThan(0);
		});

		it('should display correct multiplier values', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setAvailableModels([
				{ id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', multiplier: 0.5 },
				{ id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', multiplier: 1.0 },
				{ id: 'claude-opus-4.6', name: 'Claude Opus 4.6', multiplier: 3.0 },
			]);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const options = container.querySelectorAll('.model-option');
			for (const option of options) {
				const badge = option.querySelector('.model-option-multiplier');
				expect(badge, `badge should exist for ${option.dataset.model}`).to.not.be.null;

				const modelId = option.dataset.model;
				if (modelId === 'claude-haiku-4.5') {
					expect(badge.textContent).to.include('0.5x');
				} else if (modelId === 'claude-sonnet-4.5') {
					expect(badge.textContent).to.include('1x');
				} else if (modelId === 'claude-opus-4.6') {
					expect(badge.textContent).to.include('3x');
				}
			}
		});
	});

	describe('Multiplier in collapsed bar', () => {
		it('should show multiplier in collapsed bar when model has known multiplier', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setAvailableModels([
				{ id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', multiplier: 1.0 },
				{ id: 'claude-opus-4.6', name: 'Claude Opus 4.6', multiplier: 3.0 },
			]);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			expect(bar.textContent).to.include('1x');
		});

		it('should update bar multiplier when model changes', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setAvailableModels([
				{ id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', multiplier: 1.0 },
				{ id: 'claude-opus-4.6', name: 'Claude Opus 4.6', multiplier: 3.0 },
			]);

			selector.setModel('claude-sonnet-4.5');
			let bar = container.querySelector('.model-selector-bar');
			expect(bar.textContent).to.include('1x');

			selector.setModel('claude-opus-4.6');
			bar = container.querySelector('.model-selector-bar');
			expect(bar.textContent).to.include('3x');
		});
	});

	describe('Missing multiplier defaults', () => {
		it('should place models without multiplier in Standard group', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setAvailableModels([
				{ id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', multiplier: 0.5 },
				{ id: 'unknown-model', name: 'Unknown Model' }, // no multiplier
			]);
			selector.setModel('claude-haiku-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const allElements = container.querySelectorAll('.model-group-header, .model-option');
			const elements = Array.from(allElements);
			const standardHeaderIdx = elements.findIndex(el =>
				el.classList.contains('model-group-header') && el.textContent === 'Standard'
			);

			expect(standardHeaderIdx, 'Standard group should exist').to.not.equal(-1);

			const nextHeaderIdx = elements.findIndex((el, i) =>
				i > standardHeaderIdx && el.classList.contains('model-group-header')
			);

			const standardModels = elements
				.slice(standardHeaderIdx + 1, nextHeaderIdx === -1 ? undefined : nextHeaderIdx)
				.filter(el => el.classList.contains('model-option'))
				.map(el => el.dataset.model);

			expect(standardModels).to.include('unknown-model');
		});
	});

	describe('Static fallback catalog', () => {
		it('should have multiplier values in MODEL_CATALOG fallback', () => {
			const selector = new ModelSelector(container, eventBus);
			// Don't call setAvailableModels - use static catalog
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			// Fallback catalog should have tier headers
			const headers = container.querySelectorAll('.model-group-header');
			const headerTexts = Array.from(headers).map(h => h.textContent);
			expect(headerTexts).to.include('Standard');

			// Should have multiplier badges
			const badges = container.querySelectorAll('.model-option-multiplier');
			expect(badges.length).to.be.greaterThan(0);
		});
	});
});
