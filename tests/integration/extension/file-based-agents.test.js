/**
 * Integration tests for file-based custom agents pipeline — Phase 4
 *
 * Tests the full round-trip: AgentFileService.save() → getAll() → CustomAgentsService.toSDKAgents()
 * Uses real temp directories (no mocks for file I/O).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceRoot;

Module.prototype.require = function (id) {
    if (id === 'vscode') {
        const mock = require('../../helpers/vscode-mock');
        // Override workspaceFolders to be dynamic
        return {
            ...mock,
            workspace: {
                ...mock.workspace,
                get workspaceFolders() {
                    if (!mockWorkspaceRoot) return undefined;
                    return [{ uri: { fsPath: mockWorkspaceRoot } }];
                },
            },
        };
    }
    return originalRequire.apply(this, arguments);
};

let AgentFileService, CustomAgentsService;

before(function () {
    try {
        AgentFileService = require('../../../out/extension/services/AgentFileService.js').AgentFileService;
        CustomAgentsService = require('../../../out/extension/services/CustomAgentsService.js').CustomAgentsService;
    } catch (e) {
        // Skip if not compiled
    }
});

describe('Integration: file-based agents pipeline', function () {
    let tmpRoot;
    let globalHome;
    let fileService;
    let agentService;

    beforeEach(function () {
        if (!AgentFileService || !CustomAgentsService) { this.skip(); }

        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agt-int-'));
        globalHome = path.join(tmpRoot, 'home');
        mockWorkspaceRoot = undefined;

        fileService = new AgentFileService({ homeDir: globalHome });
        agentService = new CustomAgentsService(fileService);
    });

    afterEach(function () {
        if (tmpRoot && fs.existsSync(tmpRoot)) {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
        mockWorkspaceRoot = undefined;
    });

    it('save() writes a file that getAll() can read back', async function () {
        const agent = { name: 'my-agent', displayName: 'My Agent', prompt: 'Do excellent things.', description: 'Excellent' };
        await agentService.save(agent);

        const loaded = fileService.getAll();
        const found = loaded.find(a => a.name === 'my-agent');
        assert.ok(found, 'saved agent must be found by getAll()');
        assert.strictEqual(found.prompt, 'Do excellent things.');
        assert.strictEqual(found.displayName, 'My Agent');
    });

    it('saved agent appears in CustomAgentsService.getAll() alongside built-ins', async function () {
        await agentService.save({ name: 'custom-impl', prompt: 'Custom implementer.' });

        const all = agentService.getAll();
        assert.ok(all.length >= 4, 'must have at least 4 agents (3 built-ins + 1 custom)');
        assert.ok(all.some(a => a.name === 'custom-impl'), 'custom agent must appear in getAll()');
        assert.ok(all.some(a => a.name === 'planner'), 'planner built-in must still appear');
    });

    it('toSDKAgents() returns custom agent without builtIn or scope fields', async function () {
        await agentService.save({ name: 'sdk-agent', prompt: 'For the SDK.' });

        const sdkAgents = agentService.toSDKAgents();
        const found = sdkAgents.find(a => a.name === 'sdk-agent');
        assert.ok(found, 'agent must appear in toSDKAgents()');
        assert.strictEqual(found.builtIn, undefined, 'builtIn must not be in SDK agent');
        assert.strictEqual(found.scope, undefined, 'scope must not be in SDK agent');
    });

    it('delete() removes the file and agent no longer appears', async function () {
        await agentService.save({ name: 'to-remove', prompt: 'Remove me.' });
        assert.ok(agentService.getAll().some(a => a.name === 'to-remove'), 'agent must exist before delete');

        await agentService.delete('to-remove');
        assert.ok(!agentService.getAll().some(a => a.name === 'to-remove'), 'agent must be gone after delete');
    });

    it('round-trip: tools array survives save → load', async function () {
        const agent = { name: 'tool-agent', prompt: 'Use tools.', tools: ['bash', 'view', 'grep'] };
        await agentService.save(agent);

        const loaded = fileService.getAll();
        const found = loaded.find(a => a.name === 'tool-agent');
        assert.ok(found, 'agent must be loadable');
        assert.deepStrictEqual(found.tools?.sort(), ['bash', 'grep', 'view']);
    });

    it('round-trip: model field survives save → load', async function () {
        const agent = { name: 'model-agent', prompt: 'Use a specific model.', model: 'haiku' };
        await agentService.save(agent);

        const loaded = fileService.getAll();
        const found = loaded.find(a => a.name === 'model-agent');
        assert.ok(found, 'agent must be loadable');
        assert.strictEqual(found.model, 'haiku');
    });

    it('manually created .md file is picked up by getAll()', function () {
        const agentsDir = path.join(globalHome, '.copilot', 'agents');
        fs.mkdirSync(agentsDir, { recursive: true });
        fs.writeFileSync(path.join(agentsDir, 'hand-crafted.md'), [
            '---',
            'name: hand-crafted',
            'description: Created outside the UI',
            '---',
            '',
            'This agent was written by hand.'
        ].join('\n'));

        const all = agentService.getAll();
        assert.ok(all.some(a => a.name === 'hand-crafted'), 'manually created agent must be discovered');
    });
});
