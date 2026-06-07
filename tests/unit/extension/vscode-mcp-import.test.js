/**
 * Unit tests for VS Code native MCP import (pure functions).
 *
 * Covers the deterministic translation/merge/path logic that converts a VS Code
 * `mcp.json` server entry into the Copilot SDK's MCPServerConfig shape. The
 * file-reading adapter (getImportedServers) is an I/O boundary and is not tested
 * here.
 *
 * TDD: RED → GREEN → REFACTOR
 */

const { expect } = require('chai');

let translateVSCodeMcpServer;
let mergeImportedSources;
let resolveUserMcpJsonPath;

before(function () {
    const mod = require('../../../out/extension/services/vscodeMcpImportService.js');
    translateVSCodeMcpServer = mod.translateVSCodeMcpServer;
    mergeImportedSources = mod.mergeImportedSources;
    resolveUserMcpJsonPath = mod.resolveUserMcpJsonPath;
});

describe('translateVSCodeMcpServer', () => {
    const WS = '/home/user/project';

    it('renames cwd to workingDirectory', () => {
        const result = translateVSCodeMcpServer({ command: 'node', cwd: '/srv' }, WS);
        expect(result.workingDirectory).to.equal('/srv');
        expect(result).to.not.have.property('cwd');
    });

    it('injects tools: ["*"] when absent', () => {
        const result = translateVSCodeMcpServer({ command: 'node' }, WS);
        expect(result.tools).to.deep.equal(['*']);
    });

    it('preserves an explicit tools list', () => {
        const result = translateVSCodeMcpServer({ command: 'node', tools: ['read_file'] }, WS);
        expect(result.tools).to.deep.equal(['read_file']);
    });

    it('infers type "stdio" from command when type is absent', () => {
        const result = translateVSCodeMcpServer({ command: 'node' }, WS);
        expect(result.type).to.equal('stdio');
    });

    it('infers type "http" from url when type is absent', () => {
        const result = translateVSCodeMcpServer({ url: 'https://x.test/mcp' }, WS);
        expect(result.type).to.equal('http');
    });

    it('keeps an explicit type (e.g. sse)', () => {
        const result = translateVSCodeMcpServer({ url: 'https://x.test/mcp', type: 'sse' }, WS);
        expect(result.type).to.equal('sse');
    });

    it('drops VS Code-only fields (envFile, dev, sandboxEnabled, oauth)', () => {
        const result = translateVSCodeMcpServer({
            command: 'node',
            envFile: '.env',
            dev: { watch: true },
            sandboxEnabled: true,
            oauth: { clientId: 'x' },
        }, WS);
        expect(result).to.not.have.property('envFile');
        expect(result).to.not.have.property('dev');
        expect(result).to.not.have.property('sandboxEnabled');
        expect(result).to.not.have.property('oauth');
    });

    it('returns null when any value uses ${input:...} (unresolvable)', () => {
        const result = translateVSCodeMcpServer({
            command: 'node',
            env: { TOKEN: '${input:api-key}' },
        }, WS);
        expect(result).to.equal(null);
    });

    it('expands ${workspaceFolder}', () => {
        const result = translateVSCodeMcpServer({
            command: 'node',
            args: ['${workspaceFolder}/server.js'],
        }, WS);
        expect(result.args[0]).to.equal('/home/user/project/server.js');
    });

    it('passes through command, args, env, url, headers, timeout', () => {
        const stdio = translateVSCodeMcpServer({
            command: 'node', args: ['a'], env: { A: '1' }, timeout: 5000,
        }, WS);
        expect(stdio.command).to.equal('node');
        expect(stdio.args).to.deep.equal(['a']);
        expect(stdio.env).to.deep.equal({ A: '1' });
        expect(stdio.timeout).to.equal(5000);

        const http = translateVSCodeMcpServer({
            url: 'https://x.test/mcp', headers: { Authorization: 'Bearer t' },
        }, WS);
        expect(http.url).to.equal('https://x.test/mcp');
        expect(http.headers).to.deep.equal({ Authorization: 'Bearer t' });
    });
});

describe('mergeImportedSources', () => {
    it('takes the union of disjoint user and workspace servers', () => {
        const result = mergeImportedSources(
            { a: { command: 'a' } },
            { b: { command: 'b' } }
        );
        expect(Object.keys(result).sort()).to.deep.equal(['a', 'b']);
    });

    it('lets the workspace entry win on a name collision', () => {
        const result = mergeImportedSources(
            { shared: { command: 'user' } },
            { shared: { command: 'workspace' } }
        );
        expect(result.shared.command).to.equal('workspace');
    });

    it('handles empty inputs', () => {
        expect(mergeImportedSources({}, {})).to.deep.equal({});
    });
});

describe('resolveUserMcpJsonPath', () => {
    it('resolves the default-profile mcp.json (two levels up from globalStorage)', () => {
        const result = resolveUserMcpJsonPath('/home/u/.config/Code/User/globalStorage/pub.ext');
        expect(result).to.equal('/home/u/.config/Code/User/mcp.json');
    });

    it('resolves a named-profile mcp.json', () => {
        const result = resolveUserMcpJsonPath('/home/u/.config/Code/User/profiles/abc/globalStorage/pub.ext');
        expect(result).to.equal('/home/u/.config/Code/User/profiles/abc/mcp.json');
    });
});
