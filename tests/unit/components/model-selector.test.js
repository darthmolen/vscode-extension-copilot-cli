import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { ModelSelector } from '../../../src/webview/app/components/ModelSelector/ModelSelector.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

describe('ModelSelector Component', () => {
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

	describe('Rendering', () => {
		it('should render collapsed bar with model name', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			expect(bar).to.not.be.null;
			expect(bar.textContent).to.include('sonnet-4.5');
		});

		it('should strip vendor prefix from model name', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			expect(bar.textContent).to.not.include('claude-');
		});

		it('should show short name for known models', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('gpt-4o');

			const bar = container.querySelector('.model-selector-bar');
			expect(bar.textContent).to.include('gpt-4o');
		});

		it('should show dropdown indicator', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			expect(bar.textContent).to.include('▾');
		});
	});

	describe('Dropdown Interaction', () => {
		it('should expand on click showing model list', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const dropdown = container.querySelector('.model-selector-dropdown');
			expect(dropdown).to.not.be.null;
			expect(dropdown.style.display).to.not.equal('none');
		});

		it('should show grouped model options', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const groups = container.querySelectorAll('.model-group-header');
			expect(groups.length).to.be.greaterThan(0);
		});

		it('should mark current model with checkmark', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const items = container.querySelectorAll('.model-option');
			const currentItem = Array.from(items).find(
				item => item.dataset.model === 'claude-sonnet-4.5'
			);
			expect(currentItem).to.not.be.undefined;
			expect(currentItem.classList.contains('current')).to.be.true;
		});

		it('should collapse on second click', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click(); // open
			bar.click(); // close

			const dropdown = container.querySelector('.model-selector-dropdown');
			expect(dropdown.style.display).to.equal('none');
		});
	});

	describe('Model Selection', () => {
		it('should emit modelSelected event on model click', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			let emittedModel = null;
			eventBus.on('modelSelected', (model) => {
				emittedModel = model;
			});

			const bar = container.querySelector('.model-selector-bar');
			bar.click(); // open dropdown

			const items = container.querySelectorAll('.model-option');
			const otherModel = Array.from(items).find(
				item => item.dataset.model !== 'claude-sonnet-4.5'
			);
			expect(otherModel).to.not.be.undefined;
			otherModel.click();

			expect(emittedModel).to.equal(otherModel.dataset.model);
		});

		it('should close dropdown after selection', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const items = container.querySelectorAll('.model-option');
			const otherModel = Array.from(items).find(
				item => item.dataset.model !== 'claude-sonnet-4.5'
			);
			otherModel.click();

			const dropdown = container.querySelector('.model-selector-dropdown');
			expect(dropdown.style.display).to.equal('none');
		});

		it('should not emit if same model is clicked', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			let emitCount = 0;
			eventBus.on('modelSelected', () => { emitCount++; });

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const items = container.querySelectorAll('.model-option');
			const currentItem = Array.from(items).find(
				item => item.dataset.model === 'claude-sonnet-4.5'
			);
			currentItem.click();

			expect(emitCount).to.equal(0);
		});
	});

	describe('Keyboard Navigation', () => {
		it('should close dropdown on Escape', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click(); // open

			const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
			container.dispatchEvent(event);

			const dropdown = container.querySelector('.model-selector-dropdown');
			expect(dropdown.style.display).to.equal('none');
		});
	});

	describe('setModel updates display', () => {
		it('should update bar text when model changes', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			let bar = container.querySelector('.model-selector-bar');
			expect(bar.textContent).to.include('sonnet-4.5');

			selector.setModel('gpt-4o');
			bar = container.querySelector('.model-selector-bar');
			expect(bar.textContent).to.include('gpt-4o');
		});
	});

	describe('Dynamic model list (setAvailableModels)', () => {
		it('should have setAvailableModels method', () => {
			const selector = new ModelSelector(container, eventBus);
			expect(selector.setAvailableModels).to.be.a('function');
		});

		it('should render dynamic models in dropdown', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setAvailableModels([
				{ id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
				{ id: 'gpt-5', name: 'GPT-5' },
				{ id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
			]);
			selector.setModel('claude-sonnet-4.6');

			const bar = container.querySelector('.model-selector-bar');
			bar.click(); // open dropdown

			const options = container.querySelectorAll('.model-option');
			const modelIds = Array.from(options).map(o => o.dataset.model);
			expect(modelIds).to.include('claude-sonnet-4.6');
			expect(modelIds).to.include('gpt-5');
			expect(modelIds).to.include('gemini-3-pro-preview');
		});

		it('should group dynamic models by cost tier', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setAvailableModels([
				{ id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', multiplier: 0.5 },
				{ id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', multiplier: 1.0 },
				{ id: 'claude-opus-4.6', name: 'Claude Opus 4.6', multiplier: 3.0 },
			]);
			selector.setModel('claude-sonnet-4.6');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const groups = container.querySelectorAll('.model-group-header');
			const groupTexts = Array.from(groups).map(g => g.textContent);
			expect(groups.length).to.equal(3);
			expect(groupTexts).to.include('Fast');
			expect(groupTexts).to.include('Standard');
			expect(groupTexts).to.include('Premium');
		});

		it('should use fallback catalog when setAvailableModels not called', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setModel('claude-sonnet-4.5');

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			// Should have options from MODEL_CATALOG fallback
			const options = container.querySelectorAll('.model-option');
			expect(options.length).to.be.greaterThan(0);
		});

		it('should emit modelSelected for dynamic model selection', () => {
			const selector = new ModelSelector(container, eventBus);
			selector.setAvailableModels([
				{ id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
				{ id: 'gpt-5', name: 'GPT-5' },
			]);
			selector.setModel('claude-sonnet-4.6');

			let emittedModel = null;
			eventBus.on('modelSelected', (model) => { emittedModel = model; });

			const bar = container.querySelector('.model-selector-bar');
			bar.click();

			const gpt5 = container.querySelector('[data-model="gpt-5"]');
			expect(gpt5).to.not.be.null;
			gpt5.click();

			expect(emittedModel).to.equal('gpt-5');
		});
	});
});
