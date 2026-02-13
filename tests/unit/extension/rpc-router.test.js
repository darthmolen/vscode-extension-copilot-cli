/**
 * Unit tests for ExtensionRpcRouter
 */

const assert = require('assert').strict;
const Module = require('module');

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

describe('ExtensionRpcRouter Unit Tests', function () {
	let ExtensionRpcRouter;

	before(function () {
		const extensionModule = require('../../../dist/extension.js');
		ExtensionRpcRouter = extensionModule.ExtensionRpcRouter;
	});

	it('should import ExtensionRpcRouter', function () {
		assert.ok(ExtensionRpcRouter, 'ExtensionRpcRouter should be exported');
	});

	it('should instantiate router', function () {
		const mockWebview = createMockWebview();
		const router = new ExtensionRpcRouter(mockWebview);
		assert.ok(router, 'Router should be created');
	});

	it('should send init message', function () {
		const mockWebview = createMockWebview();
		const router = new ExtensionRpcRouter(mockWebview);

		router.sendInit({
			sessionId: 'test',
			sessionActive: true,
			messages: [],
			planModeStatus: null,
			workspacePath: null,
			activeFilePath: null
		});

		const sent = mockWebview._getSentMessages();
		assert.equal(sent[0].type, 'init');
	});

	it('should register and call handler', function () {
		const mockWebview = createMockWebview();
		const router = new ExtensionRpcRouter(mockWebview);

		let called = false;
		router.onReady(() => { called = true; });
		router.route({ type: 'ready' });
		assert.ok(called, 'Handler should be called when message is routed');
	});
});
