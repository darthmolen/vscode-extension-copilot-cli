/**
 * Unit tests for validateMcpServerInput — pure validation shared by the webview
 * add/edit form and the extension-side save handler (defense-in-depth).
 *
 * TDD: RED → GREEN → REFACTOR
 */

const { expect } = require('chai');

let validateMcpServerInput;

before(function () {
    const mod = require('../../../out/extension/services/mcpServerMutations.js');
    validateMcpServerInput = mod.validateMcpServerInput;
});

describe('validateMcpServerInput', () => {
    it('accepts a valid stdio server', () => {
        const result = validateMcpServerInput({ name: 'fs', type: 'stdio', command: 'npx' }, []);
        expect(result.valid).to.equal(true);
        expect(result.errors).to.deep.equal([]);
    });

    it('accepts a valid http server', () => {
        const result = validateMcpServerInput({ name: 'gh', type: 'http', url: 'https://x.test' }, []);
        expect(result.valid).to.equal(true);
    });

    it('rejects an empty / whitespace name', () => {
        expect(validateMcpServerInput({ name: '', type: 'stdio', command: 'x' }, []).valid).to.equal(false);
        expect(validateMcpServerInput({ name: '   ', type: 'stdio', command: 'x' }, []).valid).to.equal(false);
    });

    it('rejects a duplicate name', () => {
        const result = validateMcpServerInput({ name: 'fs', type: 'stdio', command: 'x' }, ['fs']);
        expect(result.valid).to.equal(false);
    });

    it('rejects a reserved _copilotcli_ prefix', () => {
        const result = validateMcpServerInput({ name: '_copilotcli_x', type: 'stdio', command: 'x' }, []);
        expect(result.valid).to.equal(false);
    });

    it('rejects a stdio server with no command', () => {
        const result = validateMcpServerInput({ name: 'fs', type: 'stdio' }, []);
        expect(result.valid).to.equal(false);
    });

    it('rejects an http server with no url', () => {
        const result = validateMcpServerInput({ name: 'gh', type: 'http' }, []);
        expect(result.valid).to.equal(false);
    });

    it('allows the same name when editing (existing name excluded by caller)', () => {
        // Caller passes the existing-names list WITHOUT the server being edited.
        const result = validateMcpServerInput({ name: 'fs', type: 'stdio', command: 'x' }, ['other']);
        expect(result.valid).to.equal(true);
    });
});
