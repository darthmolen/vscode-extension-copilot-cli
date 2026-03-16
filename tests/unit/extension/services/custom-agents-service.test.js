/**
 * Tests for CustomAgentsService — file-based storage pivot (Phase 2a RED)
 *
 * CustomAgentsService now delegates file I/O to AgentFileService (injected via constructor).
 * No VS Code config mocks — storage is file-based.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceRoot = '/home/user/myproject';

Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return {
            workspace: {
                get workspaceFolders() {
                    if (!mockWorkspaceRoot) return undefined;
                    return [{ uri: { fsPath: mockWorkspaceRoot } }];
                },
            },
        };
    }
    return originalRequire.apply(this, arguments);
};

const { expect } = require('chai');
const path = require('path');

const ServicePath = path.join(__dirname, '../../../../out/extension/services/CustomAgentsService.js');

let CustomAgentsService, BUILT_IN_AGENTS;

describe('CustomAgentsService — file-based storage', function () {
    this.timeout(10000);

    let service;
    let mockFileService;
    let savedCalls;
    let deletedCalls;
    let mockFileAgents;

    before(function () {
        delete require.cache[require.resolve(ServicePath)];
        const mod = require(ServicePath);
        CustomAgentsService = mod.CustomAgentsService;
        BUILT_IN_AGENTS = mod.BUILT_IN_AGENTS;
    });

    beforeEach(() => {
        mockWorkspaceRoot = '/home/user/myproject';
        savedCalls = [];
        deletedCalls = [];
        mockFileAgents = [];

        // Inject mock AgentFileService
        mockFileService = {
            getAll: (workspaceRoot) => mockFileAgents,
            save: (agent, scope, workspaceRoot) => {
                savedCalls.push({ agent, scope, workspaceRoot });
            },
            delete: (name, workspaceRoot) => {
                deletedCalls.push({ name, workspaceRoot });
            },
        };

        service = new CustomAgentsService(mockFileService);
    });

    // ─── BUILT_IN_AGENTS ─────────────────────────────────────────────────────

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

    // ─── getAll() ─────────────────────────────────────────────────────────────

    describe('getAll()', () => {
        it('returns 3 built-in agents when no file agents exist', () => {
            const agents = service.getAll();
            expect(agents).to.have.length(3);
        });

        it('calls agentFileService.getAll() to get file agents', () => {
            let called = false;
            mockFileService.getAll = () => { called = true; return []; };
            service.getAll();
            expect(called, 'agentFileService.getAll() must be called').to.be.true;
        });

        it('merges file agents with built-ins', () => {
            mockFileAgents = [{ name: 'my-agent', prompt: 'Do stuff.' }];
            const agents = service.getAll();
            expect(agents).to.have.length(4);
            expect(agents.map(a => a.name)).to.include('my-agent');
        });

        it('file agent overrides built-in with same name', () => {
            mockFileAgents = [{ name: 'planner', prompt: 'Overridden planner.' }];
            const agents = service.getAll();
            expect(agents).to.have.length(3);
            const planner = agents.find(a => a.name === 'planner');
            expect(planner.prompt).to.equal('Overridden planner.');
        });

        it('overridden built-in retains builtIn: true', () => {
            mockFileAgents = [{ name: 'planner', prompt: 'Custom planner.' }];
            const agents = service.getAll();
            const planner = agents.find(a => a.name === 'planner');
            expect(planner.builtIn).to.equal(true);
        });
    });

    // ─── save() ──────────────────────────────────────────────────────────────

    describe('save()', () => {
        it('calls agentFileService.save() with the agent', async () => {
            await service.save({ name: 'my-agent', prompt: 'Hello.' });
            expect(savedCalls).to.have.length(1);
            expect(savedCalls[0].agent.name).to.equal('my-agent');
        });

        it('saves with scope global by default', async () => {
            await service.save({ name: 'my-agent', prompt: 'Hello.' });
            expect(savedCalls[0].scope).to.equal('global');
        });

        it('does NOT call vscode.workspace.getConfiguration (no VS Code config)', async () => {
            // This test verifies the new implementation doesn't touch VS Code config at all.
            // If it did, it would throw because our vscode mock has no getConfiguration.
            let threw = false;
            try {
                await service.save({ name: 'my-agent', prompt: 'Hello.' });
            } catch (e) {
                threw = true;
            }
            expect(threw, 'save() must not throw (must not use vscode.workspace.getConfiguration)').to.be.false;
        });

        it('throws when name is empty string', async () => {
            let threw = false;
            try { await service.save({ name: '', prompt: 'Hello.' }); } catch (e) { threw = true; expect(e.message).to.include('Agent name is required'); }
            expect(threw, 'should have thrown').to.be.true;
        });

        it('throws when name is whitespace-only', async () => {
            let threw = false;
            try { await service.save({ name: '  ', prompt: 'Hello.' }); } catch (e) { threw = true; }
            expect(threw, 'should have thrown for whitespace name').to.be.true;
        });

        it('throws when prompt is empty', async () => {
            let threw = false;
            try { await service.save({ name: 'agent', prompt: '' }); } catch (e) { threw = true; expect(e.message).to.include('prompt is required'); }
            expect(threw, 'should have thrown for empty prompt').to.be.true;
        });

        it('throws when name has invalid characters', async () => {
            let threw = false;
            try { await service.save({ name: 'My Agent!', prompt: 'Prompt.' }); } catch (e) { threw = true; }
            expect(threw, 'should have thrown for invalid name').to.be.true;
        });

        it('does not pass builtIn flag to agentFileService.save()', async () => {
            await service.save({ name: 'my-agent', prompt: 'Hello.', builtIn: false });
            expect(savedCalls[0].agent).to.not.have.property('builtIn');
        });
    });

    // ─── delete() ────────────────────────────────────────────────────────────

    describe('delete()', () => {
        it('calls agentFileService.delete() with the agent name', async () => {
            await service.delete('my-agent');
            expect(deletedCalls).to.have.length(1);
            expect(deletedCalls[0].name).to.equal('my-agent');
        });

        it('throws when deleting planner (built-in)', async () => {
            let threw = false;
            try { await service.delete('planner'); } catch (e) { threw = true; expect(e.message).to.include('Cannot delete built-in agent: planner'); }
            expect(threw, 'should have thrown').to.be.true;
        });

        it('throws when deleting implementer (built-in)', async () => {
            let threw = false;
            try { await service.delete('implementer'); } catch (e) { threw = true; }
            expect(threw, 'should have thrown').to.be.true;
        });

        it('throws when deleting reviewer (built-in)', async () => {
            let threw = false;
            try { await service.delete('reviewer'); } catch (e) { threw = true; }
            expect(threw, 'should have thrown').to.be.true;
        });

        it('does NOT call vscode.workspace.getConfiguration', async () => {
            let threw = false;
            try { await service.delete('my-agent'); } catch (e) { threw = true; }
            expect(threw, 'delete() must not throw').to.be.false;
        });
    });

    // ─── toSDKAgents() ───────────────────────────────────────────────────────

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

        it('does not include scope field on any agent', () => {
            mockFileAgents = [{ name: 'custom', prompt: 'Hi.', scope: 'global' }];
            const sdkAgents = service.toSDKAgents();
            for (const agent of sdkAgents) {
                expect(agent).to.not.have.property('scope');
            }
        });

        it('every agent has a prompt field', () => {
            const sdkAgents = service.toSDKAgents();
            for (const agent of sdkAgents) {
                expect(agent.prompt).to.be.a('string').with.length.greaterThan(0);
            }
        });

        it('includes all agents from getAll()', () => {
            mockFileAgents = [{ name: 'custom', prompt: 'Hi.' }];
            expect(service.toSDKAgents()).to.have.length(4);
        });
    });
});
