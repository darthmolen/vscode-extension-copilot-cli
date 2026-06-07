const { describe, it } = require('mocha');
const assert = require('assert');

const { EXTENSION_MESSAGE_TYPES, MCP_SERVER_STATUSES, isWebviewMessage, isExtensionMessage } = require('../../../out/shared/messages');

describe('mcpStatus message type registration', () => {
    it('mcpStatus is a registered extension message type', () => {
        assert.ok(
            EXTENSION_MESSAGE_TYPES.includes('mcpStatus'),
            `mcpStatus must be in EXTENSION_MESSAGE_TYPES, got: [${EXTENSION_MESSAGE_TYPES.join(', ')}]`
        );
    });
});

describe('MCP server action message guards', () => {
    it('isWebviewMessage accepts mcpServerAction', () => {
        assert.strictEqual(isWebviewMessage({ type: 'mcpServerAction', action: 'add', name: 'x' }), true);
    });

    it('isExtensionMessage accepts mcpServerActionResult', () => {
        assert.strictEqual(isExtensionMessage({ type: 'mcpServerActionResult', success: true, action: 'add', name: 'x' }), true);
    });
});

describe('MCP_SERVER_STATUSES tuple', () => {
    it('exports an array including unknown for older-CLI fallback', () => {
        assert.ok(Array.isArray(MCP_SERVER_STATUSES), 'MCP_SERVER_STATUSES must be an array');
        assert.ok(MCP_SERVER_STATUSES.includes('unknown'),
            `MCP_SERVER_STATUSES must include 'unknown', got: [${MCP_SERVER_STATUSES.join(', ')}]`);
    });

    it('still includes the original four statuses', () => {
        for (const s of ['configured', 'connecting', 'connected', 'failed']) {
            assert.ok(MCP_SERVER_STATUSES.includes(s), `must include ${s}`);
        }
    });
});
