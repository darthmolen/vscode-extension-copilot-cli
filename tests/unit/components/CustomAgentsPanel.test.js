/**
 * CustomAgentsPanel Component Tests
 *
 * TDD RED phase: Tests written BEFORE the implementation exists.
 * Run: npx mocha tests/unit/components/CustomAgentsPanel.test.js --timeout 10000
 *
 * All tests import actual production code (no mocks of production logic).
 * Tests click real DOM buttons to verify EventBus side-effects.
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { CustomAgentsPanel } from '../../../src/webview/app/components/CustomAgentsPanel/CustomAgentsPanel.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

const SAMPLE_BUILT_IN = { name: 'planner', displayName: 'Planner', description: 'Plans things.', prompt: 'Plan it.', builtIn: true };
const SAMPLE_USER = { name: 'my-agent', displayName: 'My Agent', description: 'Does stuff.', prompt: 'Do stuff.' };

describe('CustomAgentsPanel Component', () => {
	let dom, container, eventBus, panel;

	beforeEach(() => {
		dom = new JSDOM(`<!DOCTYPE html><div id="container"></div>`);
		global.document = dom.window.document;
		global.window = dom.window;
		container = document.getElementById('container');
		eventBus = new EventBus();
	});

	afterEach(() => {
		delete global.document;
		delete global.window;
	});

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	describe('Lifecycle', () => {
		it('should render .custom-agents-panel element', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			const el = container.querySelector('.custom-agents-panel');
			expect(el, '.custom-agents-panel must exist').to.not.be.null;
		});

		it('should start closed (no .open class)', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			const el = container.querySelector('.custom-agents-panel');
			expect(el.classList.contains('open')).to.be.false;
		});

		it('should emit agents:request on eventBus immediately on construction', () => {
			let requested = false;
			eventBus.on('agents:request', () => { requested = true; });
			panel = new CustomAgentsPanel(container, eventBus);
			expect(requested, 'agents:request must fire on construction').to.be.true;
		});

		it('show() adds .open class', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.show();
			const el = container.querySelector('.custom-agents-panel');
			expect(el.classList.contains('open')).to.be.true;
		});

		it('hide() removes .open class', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.show();
			panel.hide();
			const el = container.querySelector('.custom-agents-panel');
			expect(el.classList.contains('open')).to.be.false;
		});

		it('toggle() opens a closed panel', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.toggle();
			const el = container.querySelector('.custom-agents-panel');
			expect(el.classList.contains('open')).to.be.true;
		});

		it('toggle() closes an open panel', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.show();
			panel.toggle();
			const el = container.querySelector('.custom-agents-panel');
			expect(el.classList.contains('open')).to.be.false;
		});
	});

	// -------------------------------------------------------------------------
	// List View
	// -------------------------------------------------------------------------

	describe('List View', () => {
		it('setAgents([]) renders no rows without crashing', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			expect(() => panel.setAgents([])).to.not.throw();
			const rows = container.querySelectorAll('.agent-row');
			expect(rows.length).to.equal(0);
		});

		it('setAgents([...]) renders one .agent-row per agent', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.setAgents([SAMPLE_BUILT_IN, SAMPLE_USER]);
			const rows = container.querySelectorAll('.agent-row');
			expect(rows.length).to.equal(2);
		});

		it('built-in agent row has ✏️ edit button', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.setAgents([SAMPLE_BUILT_IN]);
			const editBtns = container.querySelectorAll('.agent-row [data-action="edit"]');
			expect(editBtns.length).to.be.greaterThan(0);
		});

		it('built-in agent row has NO 🗑 delete button', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.setAgents([SAMPLE_BUILT_IN]);
			const deleteBtns = container.querySelectorAll('.agent-row [data-action="delete"]');
			expect(deleteBtns.length).to.equal(0);
		});

		it('user agent row has both ✏️ and 🗑 buttons', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.setAgents([SAMPLE_USER]);
			const editBtns = container.querySelectorAll('.agent-row [data-action="edit"]');
			const deleteBtns = container.querySelectorAll('.agent-row [data-action="delete"]');
			expect(editBtns.length).to.be.greaterThan(0);
			expect(deleteBtns.length).to.be.greaterThan(0);
		});
	});

	// -------------------------------------------------------------------------
	// Edit Transitions — click real DOM buttons
	// -------------------------------------------------------------------------

	describe('Edit Transitions', () => {
		it('clicking ✏️ on a row shows the detail form', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.setAgents([SAMPLE_USER]);
			const editBtn = container.querySelector('[data-action="edit"]');
			editBtn.click();
			const form = container.querySelector('.agents-form');
			expect(form, '.agents-form must appear after clicking edit').to.not.be.null;
		});

		it('detail form name field is readonly for existing agent', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.setAgents([SAMPLE_USER]);
			container.querySelector('[data-action="edit"]').click();
			const nameField = container.querySelector('.agents-form [name="name"], .agents-form #agentName');
			expect(nameField, 'Name field must exist in form').to.not.be.null;
			expect(nameField.readOnly || nameField.hasAttribute('readonly'), 'Name field must be readonly on edit').to.be.true;
		});

		it('[+] new-agent button shows empty form with editable name', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.setAgents([]);
			const newBtn = container.querySelector('[data-action="new"]');
			expect(newBtn, '[+] new agent button must exist').to.not.be.null;
			newBtn.click();
			const form = container.querySelector('.agents-form');
			expect(form, '.agents-form must appear after clicking [+]').to.not.be.null;
			const nameField = container.querySelector('.agents-form [name="name"], .agents-form #agentName');
			expect(nameField, 'Name field must exist').to.not.be.null;
			expect(nameField.readOnly || nameField.hasAttribute('readonly')).to.be.false;
		});

		it('Cancel button in form returns to list view', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.setAgents([SAMPLE_USER]);
			container.querySelector('[data-action="edit"]').click();
			const cancelBtn = container.querySelector('.agents-form .agents-form__cancel-btn');
			expect(cancelBtn, 'Cancel button must exist in form').to.not.be.null;
			cancelBtn.click();
			const form = container.querySelector('.agents-form');
			expect(form, 'Form must be hidden after cancel').to.be.null;
		});
	});

	// -------------------------------------------------------------------------
	// Form Submission — click real Save button, verify EventBus side-effect
	// -------------------------------------------------------------------------

	describe('Form Submission', () => {
		it('clicking Save emits agents:save with form data', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.setAgents([SAMPLE_USER]);
			container.querySelector('[data-action="edit"]').click();

			// Fill in form fields
			const nameField = container.querySelector('.agents-form [name="name"], .agents-form #agentName');
			const promptField = container.querySelector('.agents-form [name="prompt"], .agents-form #agentPrompt');
			if (promptField) promptField.value = 'Updated prompt.';

			let savedAgent = null;
			eventBus.on('agents:save', (agent) => { savedAgent = agent; });

			const saveBtn = container.querySelector('.agents-form .agents-form__save-btn');
			expect(saveBtn, 'Save button must exist').to.not.be.null;
			saveBtn.click();

			expect(savedAgent, 'agents:save event must fire').to.not.be.null;
			expect(savedAgent.name).to.equal(SAMPLE_USER.name);
		});

		it('clicking Save with empty name does NOT emit agents:save', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.setAgents([]);
			const newBtn = container.querySelector('[data-action="new"]');
			newBtn.click();

			// Leave name field empty
			const nameField = container.querySelector('.agents-form [name="name"], .agents-form #agentName');
			if (nameField) nameField.value = '';

			let savedAgent = null;
			eventBus.on('agents:save', (agent) => { savedAgent = agent; });

			container.querySelector('.agents-form .agents-form__save-btn').click();

			expect(savedAgent, 'agents:save must NOT fire with empty name').to.be.null;
		});
	});

	// -------------------------------------------------------------------------
	// Delete — click real 🗑 button, verify EventBus side-effect
	// -------------------------------------------------------------------------

	describe('Delete', () => {
		it('clicking 🗑 emits agents:delete with agent name', () => {
			panel = new CustomAgentsPanel(container, eventBus);
			panel.setAgents([SAMPLE_USER]);

			let deletedName = null;
			eventBus.on('agents:delete', (name) => { deletedName = name; });

			const deleteBtn = container.querySelector('.agent-row [data-action="delete"]');
			expect(deleteBtn, 'Delete button must exist for user agent').to.not.be.null;
			deleteBtn.click();

			expect(deletedName, 'agents:delete must fire with agent name').to.equal(SAMPLE_USER.name);
		});
	});
});

// ─── Phase 1b: Dirty flag + agents:panelClosed ───────────────────────────────

describe('CustomAgentsPanel — dirty flag + agents:panelClosed', () => {
let dom, container, eventBus, panel;

const AGENT = { name: 'tester', displayName: 'Tester', description: 'Tests', prompt: 'Test stuff.', builtIn: false };

beforeEach(() => {
dom = new JSDOM('<!DOCTYPE html><div id="root"></div>');
global.document = dom.window.document;
global.window = dom.window;
container = dom.window.document.getElementById('root');
eventBus = new EventBus();
panel = new CustomAgentsPanel(container, eventBus);
panel.setAgents([AGENT]);
});

afterEach(() => {
delete global.document;
delete global.window;
});

it('_mutatedSinceOpen starts false after construction', () => {
expect(panel._mutatedSinceOpen, '_mutatedSinceOpen must be false initially').to.equal(false);
});

it('emitting agents:save sets _mutatedSinceOpen = true', () => {
eventBus.emit('agents:save', AGENT);
expect(panel._mutatedSinceOpen, '_mutatedSinceOpen must be true after save').to.equal(true);
});

it('emitting agents:delete sets _mutatedSinceOpen = true', () => {
eventBus.emit('agents:delete', AGENT.name);
expect(panel._mutatedSinceOpen, '_mutatedSinceOpen must be true after delete').to.equal(true);
});

it('hide() emits agents:panelClosed with { mutated: true } when mutated', () => {
panel._mutatedSinceOpen = true;
let received = null;
eventBus.on('agents:panelClosed', (data) => { received = data; });
panel.hide();
expect(received, 'agents:panelClosed must be emitted').to.not.be.null;
expect(received.mutated, 'mutated must be true').to.equal(true);
});

it('hide() emits agents:panelClosed with { mutated: false } when not mutated', () => {
panel._mutatedSinceOpen = false;
let received = null;
eventBus.on('agents:panelClosed', (data) => { received = data; });
panel.hide();
expect(received, 'agents:panelClosed must be emitted').to.not.be.null;
expect(received.mutated, 'mutated must be false').to.equal(false);
});

it('after hide(), _mutatedSinceOpen resets to false', () => {
panel._mutatedSinceOpen = true;
panel.hide();
expect(panel._mutatedSinceOpen, '_mutatedSinceOpen must reset to false after hide()').to.equal(false);
});
});
