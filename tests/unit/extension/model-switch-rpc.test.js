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

	describe('WebviewRpcClient model switch methods', function () {
		let rpcClientSource;

		before(function () {
			rpcClientSource = fs.readFileSync(
				path.join(__dirname, '..', '..', '..', 'src', 'webview', 'app', 'rpc', 'WebviewRpcClient.js'),
				'utf-8'
			);
		});

		it('has switchModel() send method', function () {
			assert.ok(
				/switchModel\s*\(/.test(rpcClientSource),
				'WebviewRpcClient should have switchModel() method'
			);
			assert.ok(
				rpcClientSource.includes("type: 'switchModel'"),
				'switchModel() should send message with type switchModel'
			);
		});

		it('has onModelSwitched() receive handler', function () {
			assert.ok(
				/onModelSwitched\s*\(/.test(rpcClientSource),
				'WebviewRpcClient should have onModelSwitched() method'
			);
			assert.ok(
				rpcClientSource.includes("'modelSwitched'"),
				'onModelSwitched should register for modelSwitched type'
			);
		});

		it('has onCurrentModel() receive handler', function () {
			assert.ok(
				/onCurrentModel\s*\(/.test(rpcClientSource),
				'WebviewRpcClient should have onCurrentModel() method'
			);
			assert.ok(
				rpcClientSource.includes("'currentModel'"),
				'onCurrentModel should register for currentModel type'
			);
		});
	});

	// The three extension.ts source-scans that lived here were deleted in v3.13.0
	// Task 5. They asserted that extension.ts's *text* contained 'model_switched',
	// 'model_switch_failed' and 'sendModelSwitched' — matches a comment would have
	// satisfied. The status handling moved to ChatSessionHost.applyStatus, where
	// chat-session-host-routing.test.js covers it by running it: a switch records
	// the model on the session's own state and tells that session's surface, and a
	// failed switch tells the surface without recording anything.

	// ================================================================
	// chatViewProvider.ts — switchModel event wiring
	// ================================================================

	describe('chatViewProvider.ts switchModel wiring', function () {
		let providerSource;

		before(function () {
			providerSource = fs.readFileSync(
				path.join(__dirname, '..', '..', '..', 'src', 'chatViewProvider.ts'),
				'utf-8'
			);
		});

		// The onSwitchModel registration moved to
		// src/extension/rpc/registerChatHandlers.ts in v3.13.0 Task 2, and is now
		// covered functionally by register-chat-handlers.test.js. The assertion
		// that lived here read the provider's source text, so it verified nothing
		// a comment could not have satisfied.

		it('exposes onDidRequestSwitchModel event', function () {
			assert.ok(
				providerSource.includes('onDidRequestSwitchModel'),
				'chatViewProvider should expose onDidRequestSwitchModel event'
			);
		});
	});

	// ================================================================
	// Shared types — already verified to exist
	// ================================================================

	describe('shared/messages.ts model switch types', function () {
		let messagesSource;

		before(function () {
			messagesSource = fs.readFileSync(
				path.join(__dirname, '..', '..', '..', 'src', 'shared', 'messages.ts'),
				'utf-8'
			);
		});

		it('defines SwitchModelPayload', function () {
			assert.ok(
				messagesSource.includes('SwitchModelPayload'),
				'Should define SwitchModelPayload'
			);
		});

		it('defines ModelSwitchedPayload', function () {
			assert.ok(
				messagesSource.includes('ModelSwitchedPayload'),
				'Should define ModelSwitchedPayload'
			);
		});

		it('defines CurrentModelPayload', function () {
			assert.ok(
				messagesSource.includes('CurrentModelPayload'),
				'Should define CurrentModelPayload'
			);
		});

		it('InitPayload includes currentModel', function () {
			assert.ok(
				messagesSource.includes('currentModel'),
				'InitPayload should include currentModel field'
			);
		});
	});
});
