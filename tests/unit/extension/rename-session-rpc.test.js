/**
 * TDD tests for Feature 2: /rename command - RPC message contract
 *
 * The renameSession message must be recognized as a valid WebviewMessage.
 * Tests the messages.ts RenameSessionPayload and isWebviewMessage type guard.
 *
 * RED phase: Tests FAIL until RenameSessionPayload is added to messages.ts.
 */

const assert = require('assert');

describe('Feature 2: renameSession RPC message', () => {
	let messages;

	before(function () {
		try {
			messages = require('../../../out/shared/messages');
		} catch (err) {
			console.log('[TDD RED] Compiled messages not available:', err.message);
			this.skip();
		}
	});

	it('isWebviewMessage returns true for renameSession', function () {
		const msg = {
			type: 'renameSession',
			name: 'My Session Name'
		};
		assert.strictEqual(messages.isWebviewMessage(msg), true,
			'renameSession should be a valid webview message');
	});

	it('isWebviewMessage returns true for renameSession with empty name', function () {
		const msg = {
			type: 'renameSession',
			name: ''
		};
		assert.strictEqual(messages.isWebviewMessage(msg), true,
			'renameSession with empty name should be valid (triggers input box)');
	});

	it('isWebviewMessage returns false for unknown type', function () {
		const msg = { type: 'unknownType', name: 'test' };
		assert.strictEqual(messages.isWebviewMessage(msg), false);
	});

	describe('ExtensionRpcRouter.onRenameSession', () => {
		let ExtensionRpcRouter;

		before(function () {
			try {
				({ ExtensionRpcRouter } = require('../../../out/extension/rpc/ExtensionRpcRouter'));
			} catch (err) {
				console.log('[TDD RED] Compiled ExtensionRpcRouter not available:', err.message);
				this.skip();
			}
		});

		it('routes renameSession messages to registered handler', function () {
			const mockWebview = {
				postMessage: () => {},
				onDidReceiveMessage: () => ({ dispose: () => {} }),
				cspSource: 'mock',
				asWebviewUri: (uri) => uri
			};

			const router = new ExtensionRpcRouter(mockWebview);

			let receivedPayload = null;
			router.onRenameSession((payload) => {
				receivedPayload = payload;
			});

			router.route({ type: 'renameSession', name: 'My New Name' });

			assert.ok(receivedPayload !== null, 'Handler should have been called');
			assert.strictEqual(receivedPayload.type, 'renameSession');
			assert.strictEqual(receivedPayload.name, 'My New Name');
		});
	});
});
