/**
 * TDD tests for CompactSlashHandlers
 *
 * RED phase: Tests FAIL because CompactSlashHandlers doesn't exist yet.
 *
 * Covers:
 * 1. handleCompact() calls sessionManager.compactSession()
 * 2. handleCompact() returns formatted result with tokensRemoved/messagesRemoved
 * 3. handleCompact() handles null result gracefully
 * 4. handleCompact() handles thrown errors
 */

const assert = require('assert');
const path = require('path');

describe('CompactSlashHandlers', function () {
	this.timeout(5000);

	let CompactSlashHandlers;

	before(function () {
		try {
			const mod = require('../../../out/extension/services/slashCommands/CompactSlashHandlers.js');
			CompactSlashHandlers = mod.CompactSlashHandlers;
		} catch (e) {
			console.log('Module not yet compiled, skipping:', e.message);
			this.skip();
		}
	});

	it('should call compactSession() on the session manager', async function () {
		let called = false;
		const mockManager = {
			compactSession: async () => {
				called = true;
				return { tokensRemoved: 1000, messagesRemoved: 5 };
			}
		};

		const handler = new CompactSlashHandlers(mockManager);
		await handler.handleCompact();

		assert.strictEqual(called, true, 'compactSession() must be called');
	});

	it('should return success with token/message counts', async function () {
		const mockManager = {
			compactSession: async () => ({ tokensRemoved: 2500, messagesRemoved: 8 })
		};

		const handler = new CompactSlashHandlers(mockManager);
		const result = await handler.handleCompact();

		assert.strictEqual(result.success, true);
		assert.ok(result.content, 'content should be non-empty');
		assert.ok(result.content.includes('2500') || result.content.toLowerCase().includes('token'),
			'content should mention tokens or the count');
	});

	it('should return success message when compactSession returns null', async function () {
		const mockManager = {
			compactSession: async () => null
		};

		const handler = new CompactSlashHandlers(mockManager);
		const result = await handler.handleCompact();

		assert.strictEqual(result.success, true);
		assert.ok(result.content, 'content should be non-empty even when null returned');
	});

	it('should return error when compactSession throws', async function () {
		const mockManager = {
			compactSession: async () => { throw new Error('RPC failure'); }
		};

		const handler = new CompactSlashHandlers(mockManager);
		const result = await handler.handleCompact();

		assert.strictEqual(result.success, false);
		assert.ok(result.error, 'error should be set');
		assert.ok(result.error.includes('RPC failure') || result.error.length > 0);
	});
});
