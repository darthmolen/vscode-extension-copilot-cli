/**
 * Unit tests for model default on session start and session switch.
 *
 * Covers:
 * - onSessionStarted sets backendState.currentModel from config
 * - handleSwitchSession includes currentModel in init message
 */

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

describe('Model Default on Session Start', function () {
	this.timeout(10000);

	let extensionSource;

	before(function () {
		extensionSource = fs.readFileSync(
			path.join(__dirname, '..', '..', '..', 'src', 'extension.ts'),
			'utf-8'
		);
	});

	// The 'onSessionStarted sets default model' source-scan that lived here was
	// deleted in v3.13.0 C1. It asserted that `extension.ts` *contained the text*
	// `setCurrentModel`, which stopped being true when the write moved onto the
	// host that started the session — a legitimate refactor, and the same match
	// would have passed against a comment. The behaviour it claimed to guard is
	// now asserted by running it: `recordSessionStart()` sets the model on the
	// starting host and on no other. See
	// tests/unit/extension/session-bootstrap-targets-host.test.js.

	// The handleSwitchSession source-scan that lived here was deleted in v3.13.0
	// Task 6: it asserted that the function's *text* contained 'currentModel',
	// which was true only because the function hand-built its own init payload.
	// There is now one init builder — ChatViewProvider.sendInit() — used by the
	// ready flow, the post-load re-send and session switch alike, so the property
	// it was guarding is structural rather than something three call sites must
	// each remember.

	// ================================================================
	// availableModels RPC plumbing
	// ================================================================

	describe('availableModels RPC contract', function () {
		it('messages.ts declares AvailableModelsPayload type', function () {
			const messagesSource = fs.readFileSync(
				path.join(__dirname, '..', '..', '..', 'src', 'shared', 'messages.ts'),
				'utf-8'
			);
			assert.ok(
				messagesSource.includes('AvailableModelsPayload'),
				'messages.ts should declare AvailableModelsPayload'
			);
			assert.ok(
				messagesSource.includes("'availableModels'"),
				'messages.ts should include availableModels type string'
			);
		});

		it('ExtensionRpcRouter has sendAvailableModels method', function () {
			const routerSource = fs.readFileSync(
				path.join(__dirname, '..', '..', '..', 'src', 'extension', 'rpc', 'ExtensionRpcRouter.ts'),
				'utf-8'
			);
			assert.ok(
				/sendAvailableModels\s*\(/.test(routerSource),
				'ExtensionRpcRouter should have sendAvailableModels() method'
			);
		});

		it('WebviewRpcClient has onAvailableModels handler', function () {
			const rpcClientSource = fs.readFileSync(
				path.join(__dirname, '..', '..', '..', 'src', 'webview', 'app', 'rpc', 'WebviewRpcClient.js'),
				'utf-8'
			);
			assert.ok(
				/onAvailableModels\s*\(/.test(rpcClientSource),
				'WebviewRpcClient should have onAvailableModels() method'
			);
			assert.ok(
				rpcClientSource.includes("'availableModels'"),
				'onAvailableModels should register for availableModels type'
			);
		});
	});

	// ================================================================
	// SDKSessionManager.getAvailableModels()
	// ================================================================

	describe('SDKSessionManager exposes getAvailableModels', function () {
		it('sdkSessionManager.ts has getAvailableModels method', function () {
			const sdkSource = fs.readFileSync(
				path.join(__dirname, '..', '..', '..', 'src', 'sdkSessionManager.ts'),
				'utf-8'
			);
			assert.ok(
				/getAvailableModels\s*\(/.test(sdkSource),
				'SDKSessionManager should have getAvailableModels() method'
			);
			// Should delegate to modelCapabilitiesService.getAllModels()
			const fnStart = sdkSource.indexOf('getAvailableModels');
			const fnBody = sdkSource.substring(fnStart, fnStart + 500);
			assert.ok(
				fnBody.includes('getAllModels'),
				'getAvailableModels should delegate to modelCapabilitiesService.getAllModels()'
			);
		});
	});

	// ================================================================
	// Extension sends available models after session start
	// ================================================================

	describe('Extension sends available models after session start', function () {
		it('onSessionStarted fetches and sends available models', function () {
			const fnStart = extensionSource.indexOf('function onSessionStarted');
			assert.ok(fnStart !== -1, 'onSessionStarted function should exist');

			const fnBody = extensionSource.substring(fnStart, fnStart + 2000);
			assert.ok(
				fnBody.includes('getAvailableModels'),
				'onSessionStarted should call getAvailableModels()'
			);
			assert.ok(
				fnBody.includes('sendAvailableModels'),
				'onSessionStarted should call sendAvailableModels()'
			);
		});

		it('chatViewProvider.ts has sendAvailableModels forwarding method', function () {
			const providerSource = fs.readFileSync(
				path.join(__dirname, '..', '..', '..', 'src', 'chatViewProvider.ts'),
				'utf-8'
			);
			assert.ok(
				/sendAvailableModels\s*\(/.test(providerSource),
				'ChatViewProvider should have sendAvailableModels() method'
			);
		});
	});

	// ================================================================
	// main.js wires availableModels to InputArea/ModelSelector
	// ================================================================

	describe('main.js wires availableModels handler', function () {
		it('main.js registers rpc.onAvailableModels handler', function () {
			const mainSource = fs.readFileSync(
				path.join(__dirname, '..', '..', '..', 'src', 'webview', 'main.js'),
				'utf-8'
			);
			assert.ok(
				mainSource.includes('onAvailableModels'),
				'main.js should register onAvailableModels handler'
			);
			assert.ok(
				mainSource.includes('setAvailableModels'),
				'main.js should call setAvailableModels on InputArea'
			);
		});

		it('InputArea.js has setAvailableModels method', function () {
			const inputAreaSource = fs.readFileSync(
				path.join(__dirname, '..', '..', '..', 'src', 'webview', 'app', 'components', 'InputArea', 'InputArea.js'),
				'utf-8'
			);
			assert.ok(
				/setAvailableModels\s*\(/.test(inputAreaSource),
				'InputArea should have setAvailableModels() method'
			);
		});
	});
});
