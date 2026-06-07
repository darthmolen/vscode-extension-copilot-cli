/**
 * Unit tests for pure mutations of the copilotCLI.mcpServers config object.
 * Each returns a NEW object and never mutates its input. The extension handlers
 * call these, then persist via config.update (the untested I/O boundary).
 *
 * TDD: RED → GREEN → REFACTOR
 */

const { expect } = require('chai');

let addMcpServerToConfig, removeMcpServerFromConfig, setMcpServerEnabled, editMcpServerInConfig;

before(function () {
    const mod = require('../../../out/extension/services/mcpServerMutations.js');
    addMcpServerToConfig = mod.addMcpServerToConfig;
    removeMcpServerFromConfig = mod.removeMcpServerFromConfig;
    setMcpServerEnabled = mod.setMcpServerEnabled;
    editMcpServerInConfig = mod.editMcpServerInConfig;
});

describe('addMcpServerToConfig', () => {
    it('adds a new server entry', () => {
        const result = addMcpServerToConfig({}, 'fs', { command: 'npx', tools: ['*'] });
        expect(result.fs).to.deep.equal({ command: 'npx', tools: ['*'] });
    });

    it('does not mutate the input config', () => {
        const input = { a: { command: 'a' } };
        addMcpServerToConfig(input, 'b', { command: 'b' });
        expect(Object.keys(input)).to.deep.equal(['a']);
    });

    it('throws when the name already exists', () => {
        expect(() => addMcpServerToConfig({ fs: { command: 'x' } }, 'fs', { command: 'y' })).to.throw();
    });
});

describe('removeMcpServerFromConfig', () => {
    it('removes the named server', () => {
        const result = removeMcpServerFromConfig({ a: { command: 'a' }, b: { command: 'b' } }, 'a');
        expect(result).to.deep.equal({ b: { command: 'b' } });
    });

    it('is a no-op when the name is absent', () => {
        const result = removeMcpServerFromConfig({ a: { command: 'a' } }, 'missing');
        expect(result).to.deep.equal({ a: { command: 'a' } });
    });

    it('does not mutate the input', () => {
        const input = { a: { command: 'a' } };
        removeMcpServerFromConfig(input, 'a');
        expect(input).to.deep.equal({ a: { command: 'a' } });
    });
});

describe('setMcpServerEnabled', () => {
    it('sets enabled: false on the entry', () => {
        const result = setMcpServerEnabled({ a: { command: 'a' } }, 'a', false);
        expect(result.a.enabled).to.equal(false);
    });

    it('sets enabled: true on the entry', () => {
        const result = setMcpServerEnabled({ a: { command: 'a', enabled: false } }, 'a', true);
        expect(result.a.enabled).to.equal(true);
    });

    it('is a no-op when the name is absent', () => {
        const result = setMcpServerEnabled({ a: { command: 'a' } }, 'missing', false);
        expect(result).to.deep.equal({ a: { command: 'a' } });
    });

    it('does not mutate the input', () => {
        const input = { a: { command: 'a' } };
        setMcpServerEnabled(input, 'a', false);
        expect(input.a).to.not.have.property('enabled');
    });
});

describe('editMcpServerInConfig', () => {
    it('replaces the named entry, preserving others', () => {
        const result = editMcpServerInConfig(
            { a: { command: 'old' }, b: { command: 'b' } }, 'a', { command: 'new', tools: ['*'] }
        );
        expect(result.a).to.deep.equal({ command: 'new', tools: ['*'] });
        expect(result.b).to.deep.equal({ command: 'b' });
    });

    it('does not mutate the input', () => {
        const input = { a: { command: 'old' } };
        editMcpServerInConfig(input, 'a', { command: 'new' });
        expect(input.a).to.deep.equal({ command: 'old' });
    });
});
