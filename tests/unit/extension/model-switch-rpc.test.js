/**
 * Unit tests for model switching RPC wiring
 *
 * Tests: ExtensionRpcRouter (send/receive), WebviewRpcClient (send/receive),
 * and extension.ts status handler wiring for model_switched/model_switch_failed.
 */

const assert = require('assert').strict;
const Module = require('module');
const fs = require('fs');
const path = require('path');

// Mock vscode
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
	if (id === 'vscode') {
		return {};
	}
	return originalRequire.apply(this, arguments);
};

function createMockWebview() {
	const sentMessages = [];
	return {
		postMessage(msg) { sentMessages.push(msg); },
		onDidReceiveMessage(h) { return { dispose: () => {} }; },
		_getSentMessages() { return sentMessages; }
	};
}

describe('Model Switch RPC Contract', function () {
	let ExtensionRpcRouter;

	before(function () {
		const extensionModule = require('../../../dist/extension.js');
		ExtensionRpcRouter = extensionModule.ExtensionRpcRouter;
	});

	// ================================================================
	// ExtensionRpcRouter — send methods
	// ================================================================

	describe('ExtensionRpcRouter send methods', function () {
		it('sendModelSwitched posts modelSwitched message', function () {
			const mockWebview = createMockWebview();
			const router = new ExtensionRpcRouter(mockWebview);

			router.sendModelSwitched('claude-sonnet-4.5', true);

			const sent = mockWebview._getSentMessages();
			assert.equal(sent.length, 1);
			assert.equal(sent[0].type, 'modelSwitched');
			assert.equal(sent[0].model, 'claude-sonnet-4.5');
			assert.equal(sent[0].success, true);
		});

		it('sendModelSwitched posts failure', function () {
			const mockWebview = createMockWebview();
			const router = new ExtensionRpcRouter(mockWebview);

			router.sendModelSwitched('claude-opus-4.5', false);

			const sent = mockWebview._getSentMessages();
			assert.equal(sent[0].type, 'modelSwitched');
			assert.equal(sent[0].model, 'claude-opus-4.5');
			assert.equal(sent[0].success, false);
		});

		it('sendCurrentModel posts currentModel message', function () {
			const mockWebview = createMockWebview();
			const router = new ExtensionRpcRouter(mockWebview);

			router.sendCurrentModel('gpt-4o');

			const sent = mockWebview._getSentMessages();
			assert.equal(sent.length, 1);
			assert.equal(sent[0].type, 'currentModel');
			assert.equal(sent[0].model, 'gpt-4o');
		});
	});

	// ================================================================
	// ExtensionRpcRouter — receive handler
	// ================================================================

	describe('ExtensionRpcRouter receive handler', function () {
		it('onSwitchModel routes switchModel messages', function () {
			const mockWebview = createMockWebview();
			const router = new ExtensionRpcRouter(mockWebview);

			let receivedPayload = null;
			router.onSwitchModel((payload) => {
				receivedPayload = payload;
			});

			router.route({ type: 'switchModel', model: 'claude-sonnet-4.5' });

			assert.ok(receivedPayload, 'Handler should be called');
			assert.equal(receivedPayload.model, 'claude-sonnet-4.5');
		});

		it('onSwitchModel returns disposable', function () {
			const mockWebview = createMockWebview();
			const router = new ExtensionRpcRouter(mockWebview);

			let callCount = 0;
			const disposable = router.onSwitchModel(() => { callCount++; });

			router.route({ type: 'switchModel', model: 'test' });
			assert.equal(callCount, 1);

			disposable.dispose();
			router.route({ type: 'switchModel', model: 'test2' });
			assert.equal(callCount, 1, 'Handler should not be called after dispose');
		});
	});

	// ================================================================
	// WebviewRpcClient — source inspection
	// ================================================================

	// Two scan blocks were deleted here on 2026-08-22.
	//
	// 'WebviewRpcClient model switch methods' read the client's *source* to check it
	// contained `switchModel()`, `onModelSwitched()` and `onCurrentModel()`. The
	// client is plain JS and importable: `webview-rpc-client.test.js` instantiates
	// the real thing and drives its sends and receives, which is the same claim made
	// by running it.
	//
	// 'shared/messages.ts model switch types' asserted four interfaces exist by
	// matching the file's text. `tsc --noEmit` is a gate on every build and makes
	// that claim properly; a string match would also have passed against a comment.
	//
	// What stays above is behavioural: the router's sends and receives, driven
	// through a fake webview.
});
