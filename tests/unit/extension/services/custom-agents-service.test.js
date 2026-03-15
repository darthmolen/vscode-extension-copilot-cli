/**
 * Tests for CustomAgentsService
 *
 * TDD RED phase: Tests written BEFORE the implementation exists.
 * Run: npx mocha tests/unit/extension/services/custom-agents-service.test.js --timeout 10000
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

let mockUserAgents = [];
let updateCalls = [];

Module.prototype.require = function (id) {
	if (id === 'vscode') {
		return {
			workspace: {
				getConfiguration: (section) => ({
					get: (key, defaultValue) => {
						if (section === 'copilotCLI' && key === 'customAgents') {
							return mockUserAgents;
						}
						return defaultValue;
					},
					update: async (key, value, global) => {
						updateCalls.push({ key, value, global });
					},
				}),
			},
		};
	}
	return originalRequire.apply(this, arguments);
};

const { expect } = require('chai');
const path = require('path');

const ServicePath = path.join(__dirname, '../../../../out/extension/services/CustomAgentsService.js');
const { CustomAgentsService, BUILT_IN_AGENTS } = require(ServicePath);

describe('CustomAgentsService', function () {
	this.timeout(10000);

	let service;

	beforeEach(() => {
		mockUserAgents = [];
		updateCalls = [];
		service = new CustomAgentsService();
	});

	// -------------------------------------------------------------------------
	// BUILT_IN_AGENTS constant
	// -------------------------------------------------------------------------

	describe('BUILT_IN_AGENTS', () => {
		it('exports 3 built-in agents', () => {
			expect(BUILT_IN_AGENTS).to.be.an('array').with.length(3);
		});

		it('includes planner, implementer, reviewer', () => {
			const names = BUILT_IN_AGENTS.map(a => a.name);
			expect(names).to.include('planner');
			expect(names).to.include('implementer');
			expect(names).to.include('reviewer');
		});

		it('all built-ins have builtIn: true', () => {
			for (const agent of BUILT_IN_AGENTS) {
				expect(agent.builtIn).to.equal(true);
			}
		});

		it('all built-ins have a non-empty prompt', () => {
			for (const agent of BUILT_IN_AGENTS) {
				expect(agent.prompt).to.be.a('string').with.length.greaterThan(0);
			}
		});
	});

	// -------------------------------------------------------------------------
	// getAll()
	// -------------------------------------------------------------------------

	describe('getAll()', () => {
		it('returns 3 built-in agents when no user agents configured', () => {
			const agents = service.getAll();
			expect(agents).to.have.length(3);
		});

		it('merges user-defined agents with built-ins', () => {
			mockUserAgents = [{ name: 'my-agent', prompt: 'Do stuff.' }];
			const agents = service.getAll();
			expect(agents).to.have.length(4);
			expect(agents.map(a => a.name)).to.include('my-agent');
		});

		it('user agent overrides built-in with same name', () => {
			mockUserAgents = [{ name: 'planner', prompt: 'Overridden planner prompt.' }];
			const agents = service.getAll();
			// Still 3 total (override, not addition)
			expect(agents).to.have.length(3);
			const planner = agents.find(a => a.name === 'planner');
			expect(planner.prompt).to.equal('Overridden planner prompt.');
		});

		it('overridden built-in retains builtIn flag', () => {
			mockUserAgents = [{ name: 'planner', prompt: 'Custom planner.' }];
			const agents = service.getAll();
			const planner = agents.find(a => a.name === 'planner');
			expect(planner.builtIn).to.equal(true);
		});
	});

	// -------------------------------------------------------------------------
	// save()
	// -------------------------------------------------------------------------

	describe('save()', () => {
		it('calls config.update with the updated agents array', async () => {
			await service.save({ name: 'my-agent', prompt: 'Hello.' });
			expect(updateCalls).to.have.length(1);
			expect(updateCalls[0].key).to.equal('customAgents');
			expect(updateCalls[0].value).to.be.an('array');
		});

		it('upserts: replaces existing agent with same name', async () => {
			mockUserAgents = [{ name: 'my-agent', prompt: 'Old.' }];
			await service.save({ name: 'my-agent', prompt: 'New.' });
			const saved = updateCalls[0].value;
			expect(saved).to.have.length(1);
			expect(saved[0].prompt).to.equal('New.');
		});

		it('adds new agent when name does not exist', async () => {
			mockUserAgents = [{ name: 'existing', prompt: 'X.' }];
			await service.save({ name: 'new-agent', prompt: 'Y.' });
			const saved = updateCalls[0].value;
			expect(saved).to.have.length(2);
		});

		it('throws when name is empty string', async () => {
			let threw = false;
			try { await service.save({ name: '', prompt: 'Hello.' }); } catch (e) { threw = true; expect(e.message).to.include('Agent name is required'); }
			expect(threw, 'should have thrown').to.be.true;
		});

		it('throws when name is whitespace-only', async () => {
			let threw = false;
			try { await service.save({ name: '  ', prompt: 'Hello.' }); } catch (e) { threw = true; expect(e.message).to.include('Agent name is required'); }
			expect(threw, 'should have thrown').to.be.true;
		});

		it('does not store builtIn flag in workspace config', async () => {
			await service.save({ name: 'my-agent', prompt: 'Hello.', builtIn: false });
			const saved = updateCalls[0].value;
			expect(saved[0]).to.not.have.property('builtIn');
		});
	});

	// -------------------------------------------------------------------------
	// delete()
	// -------------------------------------------------------------------------

	describe('delete()', () => {
		it('removes agent from user agents array', async () => {
			mockUserAgents = [
				{ name: 'my-agent', prompt: 'A.' },
				{ name: 'other', prompt: 'B.' },
			];
			await service.delete('my-agent');
			const saved = updateCalls[0].value;
			expect(saved.map(a => a.name)).to.not.include('my-agent');
			expect(saved.map(a => a.name)).to.include('other');
		});

		it('throws when deleting a built-in agent', async () => {
			let threw = false;
			try { await service.delete('planner'); } catch (e) { threw = true; expect(e.message).to.include('Cannot delete built-in agent: planner'); }
			expect(threw, 'should have thrown').to.be.true;
		});

		it('throws when deleting implementer', async () => {
			let threw = false;
			try { await service.delete('implementer'); } catch (e) { threw = true; expect(e.message).to.include('Cannot delete built-in agent: implementer'); }
			expect(threw, 'should have thrown').to.be.true;
		});

		it('throws when deleting reviewer', async () => {
			let threw = false;
			try { await service.delete('reviewer'); } catch (e) { threw = true; expect(e.message).to.include('Cannot delete built-in agent: reviewer'); }
			expect(threw, 'should have thrown').to.be.true;
		});
	});

	// -------------------------------------------------------------------------
	// toSDKAgents()
	// -------------------------------------------------------------------------

	describe('toSDKAgents()', () => {
		it('returns an array', () => {
			expect(service.toSDKAgents()).to.be.an('array');
		});

		it('does not include builtIn field on any agent', () => {
			const sdkAgents = service.toSDKAgents();
			for (const agent of sdkAgents) {
				expect(agent).to.not.have.property('builtIn');
			}
		});

		it('every agent has a prompt field', () => {
			const sdkAgents = service.toSDKAgents();
			for (const agent of sdkAgents) {
				expect(agent.prompt).to.be.a('string').with.length.greaterThan(0);
			}
		});

		it('includes all agents from getAll()', () => {
			mockUserAgents = [{ name: 'custom', prompt: 'Hi.' }];
			expect(service.toSDKAgents()).to.have.length(4);
		});
	});
});
