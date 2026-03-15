/**
 * TDD tests for AgentFileService — Phase 1a RED
 *
 * Tests the file-based agent storage: parse, scan, save, delete.
 * All tests are behavioral — no source-string scanning.
 *
 * RED phase: AgentFileService does not exist yet. All tests should fail.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
    if (id === 'vscode') {
        return require('../../../helpers/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

// Lazy-load after vscode mock is in place
let AgentFileService;
before(function () {
    try {
        AgentFileService = require('../../../../out/extension/services/AgentFileService.js').AgentFileService;
    } catch {
        // Will be caught per-test
    }
});

function skipIfNotCompiled(ctx) {
    if (!AgentFileService) { ctx.skip(); }
}

// ─── parseAgentFile ───────────────────────────────────────────────────────────

describe('AgentFileService.parseAgentFile()', function () {
    let service;
    let tmpDir;

    beforeEach(function () {
        skipIfNotCompiled(this);
        service = new AgentFileService();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agt-test-'));
    });

    afterEach(function () {
        if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    function writeTmp(name, content) {
        const filePath = path.join(tmpDir, name);
        fs.writeFileSync(filePath, content, 'utf-8');
        return filePath;
    }

    it('parses valid frontmatter + body into CustomAgentDefinition', function () {
        const filePath = writeTmp('reviewer.md', [
            '---',
            'name: reviewer',
            'displayName: Reviewer',
            'description: Reviews code',
            '---',
            '',
            'You are a code reviewer. Be thorough.'
        ].join('\n'));

        const result = service.parseAgentFile(filePath);
        assert.strictEqual(result.kind, 'success');
        assert.strictEqual(result.agent.name, 'reviewer');
        assert.strictEqual(result.agent.displayName, 'Reviewer');
        assert.strictEqual(result.agent.description, 'Reviews code');
        assert.strictEqual(result.agent.prompt, 'You are a code reviewer. Be thorough.');
    });

    it('returns error when frontmatter name is missing', function () {
        const filePath = writeTmp('noname.md', [
            '---',
            'displayName: No Name Agent',
            '---',
            '',
            'Some prompt.'
        ].join('\n'));

        const result = service.parseAgentFile(filePath);
        assert.strictEqual(result.kind, 'error');
        assert.ok(result.message, 'error result must have a message');
    });

    it('parses tools as comma-separated string into array', function () {
        const filePath = writeTmp('toolstr.md', [
            '---',
            'name: toolstr',
            'tools: view, grep, glob',
            '---',
            '',
            'Use tools.'
        ].join('\n'));

        const result = service.parseAgentFile(filePath);
        assert.strictEqual(result.kind, 'success');
        assert.deepStrictEqual(result.agent.tools, ['view', 'grep', 'glob']);
    });

    it('parses tools as YAML array into array', function () {
        const filePath = writeTmp('toolarray.md', [
            '---',
            'name: toolarray',
            'tools:',
            '  - bash',
            '  - view',
            '---',
            '',
            'Use array tools.'
        ].join('\n'));

        const result = service.parseAgentFile(filePath);
        assert.strictEqual(result.kind, 'success');
        assert.deepStrictEqual(result.agent.tools, ['bash', 'view']);
    });

    it('handles missing optional fields gracefully', function () {
        const filePath = writeTmp('minimal.md', [
            '---',
            'name: minimal',
            '---',
            '',
            'Minimal prompt.'
        ].join('\n'));

        const result = service.parseAgentFile(filePath);
        assert.strictEqual(result.kind, 'success');
        assert.strictEqual(result.agent.name, 'minimal');
        assert.strictEqual(result.agent.description, undefined);
        assert.strictEqual(result.agent.displayName, undefined);
        assert.strictEqual(result.agent.model, undefined);
    });

    it('strips leading/trailing whitespace from prompt body', function () {
        const filePath = writeTmp('spaces.md', [
            '---',
            'name: spaces',
            '---',
            '',
            '  Trimmed prompt.  '
        ].join('\n'));

        const result = service.parseAgentFile(filePath);
        assert.strictEqual(result.kind, 'success');
        assert.strictEqual(result.agent.prompt, 'Trimmed prompt.');
    });

    it('handles --- horizontal rules in body without breaking parse', function () {
        const filePath = writeTmp('hrule.md', [
            '---',
            'name: hrule',
            '---',
            '',
            'First section.',
            '',
            '---',
            '',
            'Second section after a divider.'
        ].join('\n'));

        const result = service.parseAgentFile(filePath);
        assert.strictEqual(result.kind, 'success');
        assert.ok(result.agent.prompt.includes('Second section after a divider.'),
            'body must include content after --- horizontal rule');
    });
});

// ─── getAgentDirs ─────────────────────────────────────────────────────────────

describe('AgentFileService.getAgentDirs()', function () {
    let service;

    beforeEach(function () {
        skipIfNotCompiled(this);
        service = new AgentFileService();
    });

    it('includes ~/.copilot/agents as global dir', function () {
        const dirs = service.getAgentDirs();
        const expected = path.join(os.homedir(), '.copilot', 'agents');
        assert.ok(dirs.includes(expected),
            `dirs must include ${expected}, got: ${JSON.stringify(dirs)}`);
    });

    it('includes workspace/.copilot/agents when workspaceRoot provided', function () {
        const workspaceRoot = '/home/user/myproject';
        const dirs = service.getAgentDirs(workspaceRoot);
        const expected = path.join(workspaceRoot, '.copilot', 'agents');
        assert.ok(dirs.includes(expected),
            `dirs must include project dir ${expected}`);
    });

    it('returns only global dir when no workspace provided', function () {
        const dirs = service.getAgentDirs();
        assert.strictEqual(dirs.length, 1, 'should return exactly 1 dir when no workspace given');
    });

    it('uses path.join so Windows paths are constructed correctly', function () {
        // Simulate Windows homedir
        const winHome = 'C:\\Users\\TestUser';
        const dirs = service.getAgentDirs(undefined, winHome);
        const expected = path.join(winHome, '.copilot', 'agents');
        assert.ok(dirs.includes(expected),
            `Windows path must be ${expected}, got: ${JSON.stringify(dirs)}`);
    });
});

// ─── scanDirectory ────────────────────────────────────────────────────────────

describe('AgentFileService.scanDirectory()', function () {
    let service;
    let tmpDir;

    beforeEach(function () {
        skipIfNotCompiled(this);
        service = new AgentFileService();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agt-scan-'));
    });

    afterEach(function () {
        if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('returns empty array when directory does not exist', function () {
        const result = service.scanDirectory(path.join(tmpDir, 'nonexistent'));
        assert.deepStrictEqual(result, []);
    });

    it('reads .md files and returns parsed agents', function () {
        fs.writeFileSync(path.join(tmpDir, 'planner.md'), [
            '---', 'name: planner', '---', '', 'Plan things.'
        ].join('\n'));
        const result = service.scanDirectory(tmpDir);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].name, 'planner');
    });

    it('skips non-.md files', function () {
        fs.writeFileSync(path.join(tmpDir, 'planner.md'), [
            '---', 'name: planner', '---', '', 'Plan.'
        ].join('\n'));
        fs.writeFileSync(path.join(tmpDir, 'README.txt'), 'not an agent');
        fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}');
        const result = service.scanDirectory(tmpDir);
        assert.strictEqual(result.length, 1);
    });

    it('skips files with parse errors and continues', function () {
        fs.writeFileSync(path.join(tmpDir, 'broken.md'), '# No frontmatter at all');
        fs.writeFileSync(path.join(tmpDir, 'valid.md'), [
            '---', 'name: valid', '---', '', 'Valid prompt.'
        ].join('\n'));
        const result = service.scanDirectory(tmpDir);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].name, 'valid');
    });
});

// ─── getAll ───────────────────────────────────────────────────────────────────

describe('AgentFileService.getAll()', function () {
    let service;
    let globalDir;
    let projectDir;
    let tmpRoot;

    beforeEach(function () {
        skipIfNotCompiled(this);
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agt-all-'));
        globalDir = path.join(tmpRoot, 'global', '.copilot', 'agents');
        projectDir = path.join(tmpRoot, 'project', '.copilot', 'agents');
        fs.mkdirSync(globalDir, { recursive: true });
        fs.mkdirSync(projectDir, { recursive: true });
        service = new AgentFileService({ homeDir: path.join(tmpRoot, 'global') });
    });

    afterEach(function () {
        if (tmpRoot && fs.existsSync(tmpRoot)) {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    it('merges global and project agents', function () {
        fs.writeFileSync(path.join(globalDir, 'a.md'), ['---', 'name: a', '---', '', 'Agent A.'].join('\n'));
        fs.writeFileSync(path.join(projectDir, 'b.md'), ['---', 'name: b', '---', '', 'Agent B.'].join('\n'));

        const result = service.getAll(path.join(tmpRoot, 'project'));
        const names = result.map(a => a.name).sort();
        assert.deepStrictEqual(names, ['a', 'b']);
    });

    it('project agent wins on name collision', function () {
        fs.writeFileSync(path.join(globalDir, 'clash.md'), ['---', 'name: clash', '---', '', 'Global version.'].join('\n'));
        fs.writeFileSync(path.join(projectDir, 'clash.md'), ['---', 'name: clash', '---', '', 'Project version.'].join('\n'));

        const result = service.getAll(path.join(tmpRoot, 'project'));
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].prompt, 'Project version.');
    });

    it('returns only global agents when no workspace provided', function () {
        fs.writeFileSync(path.join(globalDir, 'g.md'), ['---', 'name: g', '---', '', 'Global only.'].join('\n'));
        const result = service.getAll();
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].name, 'g');
    });
});

// ─── serializeAgent ───────────────────────────────────────────────────────────

describe('AgentFileService.serializeAgent()', function () {
    let service;

    beforeEach(function () {
        skipIfNotCompiled(this);
        service = new AgentFileService();
    });

    it('produces valid frontmatter + body', function () {
        const agent = { name: 'impl', displayName: 'Implementer', prompt: 'Implement things.', description: 'Does impl' };
        const content = service.serializeAgent(agent);
        assert.ok(content.startsWith('---\n'), 'must start with ---');
        assert.ok(content.includes('name: impl'), 'must include name');
        assert.ok(content.includes('Implement things.'), 'must include prompt in body');
    });

    it('serializes tools array as comma-separated string', function () {
        const agent = { name: 'tool-agent', prompt: 'Use tools.', tools: ['bash', 'view', 'grep'] };
        const content = service.serializeAgent(agent);
        assert.ok(content.includes('bash') && content.includes('view'), 'must include tools');
    });

    it('omits undefined optional fields from frontmatter', function () {
        const agent = { name: 'bare', prompt: 'Bare prompt.' };
        const content = service.serializeAgent(agent);
        assert.ok(!content.includes('description:'), 'must not include undefined description');
        assert.ok(!content.includes('displayName:'), 'must not include undefined displayName');
        assert.ok(!content.includes('model:'), 'must not include undefined model');
    });

    it('does not write builtIn flag to frontmatter', function () {
        const agent = { name: 'builtin-agent', prompt: 'Built in.', builtIn: true };
        const content = service.serializeAgent(agent);
        assert.ok(!content.includes('builtIn'), 'builtIn must not appear in serialized output');
    });
});

// ─── save ─────────────────────────────────────────────────────────────────────

describe('AgentFileService.save()', function () {
    let service;
    let tmpRoot;

    beforeEach(function () {
        skipIfNotCompiled(this);
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agt-save-'));
        service = new AgentFileService({ homeDir: tmpRoot });
    });

    afterEach(function () {
        if (tmpRoot && fs.existsSync(tmpRoot)) {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    it('writes file to ~/.copilot/agents/<name>.md for global scope', function () {
        const agent = { name: 'my-agent', prompt: 'Do stuff.' };
        service.save(agent, 'global');
        const expected = path.join(tmpRoot, '.copilot', 'agents', 'my-agent.md');
        assert.ok(fs.existsSync(expected), `file must exist at ${expected}`);
    });

    it('creates directory if it does not exist', function () {
        const agent = { name: 'newdir-agent', prompt: 'Prompt.' };
        service.save(agent, 'global');
        const dir = path.join(tmpRoot, '.copilot', 'agents');
        assert.ok(fs.existsSync(dir), 'directory must be created');
    });

    it('writes file to <workspace>/.copilot/agents/<name>.md for project scope', function () {
        const workspaceRoot = path.join(tmpRoot, 'myproject');
        const agent = { name: 'proj-agent', prompt: 'Project prompt.' };
        service.save(agent, 'project', workspaceRoot);
        const expected = path.join(workspaceRoot, '.copilot', 'agents', 'proj-agent.md');
        assert.ok(fs.existsSync(expected), `project file must exist at ${expected}`);
    });

    it('throws when scope is project and workspaceRoot is undefined', function () {
        const agent = { name: 'no-root', prompt: 'Prompt.' };
        assert.throws(
            () => service.save(agent, 'project', undefined),
            /workspaceRoot/i,
            'must throw an error mentioning workspaceRoot'
        );
    });
});

// ─── delete ───────────────────────────────────────────────────────────────────

describe('AgentFileService.delete()', function () {
    let service;
    let tmpRoot;

    beforeEach(function () {
        skipIfNotCompiled(this);
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agt-del-'));
        service = new AgentFileService({ homeDir: tmpRoot });
    });

    afterEach(function () {
        if (tmpRoot && fs.existsSync(tmpRoot)) {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    it('removes file from global dir', function () {
        const globalAgentsDir = path.join(tmpRoot, '.copilot', 'agents');
        fs.mkdirSync(globalAgentsDir, { recursive: true });
        fs.writeFileSync(path.join(globalAgentsDir, 'to-delete.md'), '---\nname: to-delete\n---\n\nDelete me.');

        service.delete('to-delete');
        assert.ok(!fs.existsSync(path.join(globalAgentsDir, 'to-delete.md')), 'global file must be removed');
    });

    it('removes file from project dir', function () {
        const workspaceRoot = path.join(tmpRoot, 'proj');
        const projectAgentsDir = path.join(workspaceRoot, '.copilot', 'agents');
        fs.mkdirSync(projectAgentsDir, { recursive: true });
        fs.writeFileSync(path.join(projectAgentsDir, 'proj-del.md'), '---\nname: proj-del\n---\n\nDelete me.');

        service.delete('proj-del', workspaceRoot);
        assert.ok(!fs.existsSync(path.join(projectAgentsDir, 'proj-del.md')), 'project file must be removed');
    });

    it('does not throw when file does not exist (idempotent)', function () {
        assert.doesNotThrow(() => service.delete('nonexistent-agent'));
    });
});
