/**
 * TDD RED: Extension pipeline tests for billing.multiplier passthrough
 *
 * Tests that the multiplier flows from SDK → modelCapabilitiesService → sdkSessionManager → RPC → webview.
 * These tests should FAIL against current code because getAvailableModels() strips billing data.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
	if (id === 'vscode') {
		return require('../../helpers/vscode-mock');
	}
	return originalRequire.apply(this, arguments);
};

const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Multiplier Pipeline', function () {
	this.timeout(10000);

	describe('sdkSessionManager.getAvailableModels()', function () {
		let SDKSessionManager;

		before(function () {
			try {
				const mod = require('../../../out/sdkSessionManager.js');
				SDKSessionManager = mod.SDKSessionManager;
			} catch (e) {
				this.skip();
			}
		});

		it('should include multiplier from SDK billing data', async function () {
			const mockModels = [
				{
					id: 'claude-sonnet-4.5',
					name: 'Claude Sonnet 4.5',
					capabilities: { supports: { vision: true, reasoningEffort: false }, limits: { max_context_window_tokens: 200000 } },
					billing: { multiplier: 1.0 },
				},
				{
					id: 'claude-opus-4.6',
					name: 'Claude Opus 4.6',
					capabilities: { supports: { vision: true, reasoningEffort: false }, limits: { max_context_window_tokens: 200000 } },
					billing: { multiplier: 3.0 },
				},
				{
					id: 'claude-haiku-4.5',
					name: 'Claude Haiku 4.5',
					capabilities: { supports: { vision: true, reasoningEffort: false }, limits: { max_context_window_tokens: 200000 } },
					billing: { multiplier: 0.5 },
				},
			];

			const ctx = {
				modelCapabilitiesService: {
					getAllModels: async () => mockModels,
				},
			};
			const result = await SDKSessionManager.prototype.getAvailableModels.call(ctx);

			assert.strictEqual(result.length, 3);

			const sonnet = result.find(m => m.id === 'claude-sonnet-4.5');
			assert.strictEqual(sonnet.multiplier, 1.0, 'sonnet should have multiplier 1.0');

			const opus = result.find(m => m.id === 'claude-opus-4.6');
			assert.strictEqual(opus.multiplier, 3.0, 'opus should have multiplier 3.0');

			const haiku = result.find(m => m.id === 'claude-haiku-4.5');
			assert.strictEqual(haiku.multiplier, 0.5, 'haiku should have multiplier 0.5');
		});

		it('should return undefined multiplier when billing is missing', async function () {
			const mockModels = [
				{
					id: 'gpt-5',
					name: 'GPT-5',
					capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } },
				},
			];

			const ctx = {
				modelCapabilitiesService: {
					getAllModels: async () => mockModels,
				},
			};
			const result = await SDKSessionManager.prototype.getAvailableModels.call(ctx);

			const gpt5 = result.find(m => m.id === 'gpt-5');
			assert.ok('multiplier' in gpt5, 'result should have multiplier key even when billing is missing');
		});
	});

	describe('AvailableModelsPayload type contract', function () {
		it('should include multiplier in the message type definition', function () {
			const messagesSource = fs.readFileSync(
				path.join(__dirname, '../../../src/shared/messages.ts'),
				'utf-8'
			);

			const payloadMatch = messagesSource.match(/interface AvailableModelsPayload[\s\S]*?}/);
			assert.ok(payloadMatch, 'AvailableModelsPayload interface should exist');

			const payloadDef = payloadMatch[0];
			assert.ok(
				payloadDef.includes('multiplier'),
				`AvailableModelsPayload should include 'multiplier' field. Got:\n${payloadDef}`
			);
		});
	});

	describe('ExtensionRpcRouter.sendAvailableModels()', function () {
		let ExtensionRpcRouter;

		before(function () {
			try {
				const mod = require('../../../out/extension/rpc/ExtensionRpcRouter.js');
				ExtensionRpcRouter = mod.ExtensionRpcRouter;
			} catch (e) {
				this.skip();
			}
		});

		it('should post multiplier in the message to webview', function () {
			const sentMessages = [];
			const mockWebview = {
				postMessage(msg) { sentMessages.push(msg); return Promise.resolve(true); },
				onDidReceiveMessage() { return { dispose: () => {} }; },
				asWebviewUri: (uri) => uri,
				cspSource: '',
			};

			const router = new ExtensionRpcRouter(mockWebview);

			const models = [
				{ id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', multiplier: 1.0 },
				{ id: 'claude-opus-4.6', name: 'Claude Opus 4.6', multiplier: 3.0 },
			];

			router.sendAvailableModels(models);

			assert.strictEqual(sentMessages.length, 1);
			const msg = sentMessages[0];
			assert.strictEqual(msg.type, 'availableModels');
			assert.strictEqual(msg.models.length, 2);
			assert.strictEqual(msg.models[0].multiplier, 1.0, 'sonnet multiplier should be in message');
			assert.strictEqual(msg.models[1].multiplier, 3.0, 'opus multiplier should be in message');
		});
	});
});
