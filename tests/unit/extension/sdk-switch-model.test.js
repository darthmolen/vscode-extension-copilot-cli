/**
 * Tests for mid-session model switching (v3.3.0)
 *
 * switchModel() uses session.rpc.model.switchTo() to change model in-place.
 * Fires model_switched on success, model_switch_failed on error.
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
const path = require('path');

describe('Mid-Session Model Switching', function () {
	this.timeout(10000);

	let SDKSessionManager;

	before(function () {
		try {
			const mod = require('../../../out/sdkSessionManager.js');
			SDKSessionManager = mod.SDKSessionManager;
		} catch (e) {
			console.log('Module not yet compiled, skipping:', e.message);
			this.skip();
		}
	});

	describe('switchModel()', function () {
		it('should exist as a public method on SDKSessionManager', function () {
			assert.strictEqual(typeof SDKSessionManager.prototype.switchModel, 'function',
				'switchModel should be a public method');
		});

		it('should no-op if new model equals current model', async function () {
			const firedStatus = [];
			const ctx = {
				config: { model: 'claude-sonnet-4.5' },
				logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
				_onDidChangeStatus: { fire: (d) => firedStatus.push(d) },
			};

			await SDKSessionManager.prototype.switchModel.call(ctx, 'claude-sonnet-4.5');

			// Should not fire any status events
			assert.strictEqual(firedStatus.length, 0, 'Should not fire any events for same model');
		});

		it('should call SDK and update config on success (event fired by session.model_change)', async function () {
			const firedStatus = [];
			let switchedTo = null;

			const ctx = {
				config: { model: 'claude-sonnet-4.5' },
				session: {
					rpc: {
						model: {
							switchTo: async ({ modelId }) => {
								switchedTo = modelId;
								return { modelId };
							},
						},
					},
				},
				logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
				_onDidChangeStatus: { fire: (d) => firedStatus.push(d) },
			};

			await SDKSessionManager.prototype.switchModel.call(ctx, 'gpt-5');

			// Should have called rpc.model.switchTo
			assert.strictEqual(switchedTo, 'gpt-5', 'Should call rpc.model.switchTo with new model');

			// Should have updated config.model
			assert.strictEqual(ctx.config.model, 'gpt-5', 'config.model should be updated');

			// switchModel() no longer fires model_switched directly — the SDK
			// session.model_change event handler is the single source of truth
			const switched = firedStatus.filter(e => e.status === 'model_switched');
			assert.strictEqual(switched.length, 0, 'switchModel should not fire model_switched directly');
		});

		it('should fire model_switch_failed and keep previous model on error', async function () {
			const firedStatus = [];

			const ctx = {
				config: { model: 'claude-sonnet-4.5' },
				session: {
					rpc: {
						model: {
							switchTo: async () => { throw new Error('Model not supported'); },
						},
					},
				},
				logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
				_onDidChangeStatus: { fire: (d) => firedStatus.push(d) },
			};

			await SDKSessionManager.prototype.switchModel.call(ctx, 'nonexistent-model');

			// Should keep previous model (config not updated on failure)
			assert.strictEqual(ctx.config.model, 'claude-sonnet-4.5',
				'config.model should remain unchanged on failure');

			// Should fire model_switch_failed
			const failed = firedStatus.filter(e => e.status === 'model_switch_failed');
			assert.strictEqual(failed.length, 1, 'Should fire model_switch_failed');
			assert.strictEqual(failed[0].model, 'claude-sonnet-4.5', 'Should include previous model');
		});
	});

	describe('getCurrentModel()', function () {
		it('should exist as a public method', function () {
			assert.strictEqual(typeof SDKSessionManager.prototype.getCurrentModel, 'function',
				'getCurrentModel should be a public method');
		});

		it('should return config.model', function () {
			const ctx = { config: { model: 'claude-sonnet-4.5' } };
			const result = SDKSessionManager.prototype.getCurrentModel.call(ctx);
			assert.strictEqual(result, 'claude-sonnet-4.5');
		});
	});

	describe('StatusData types', function () {
		it('should include model_switched and model_switch_failed in status type', function () {
			const fs = require('fs');
			const source = fs.readFileSync(
				path.join(__dirname, '../../../src/sdkSessionManager.ts'), 'utf8'
			);

			// Find StatusData interface
			const statusMatch = source.match(/export interface StatusData \{([\s\S]*?)\}/m);
			assert.ok(statusMatch, 'StatusData interface should exist');

			const statusBody = statusMatch[1];
			assert.ok(statusBody.includes("'model_switched'"),
				'StatusData should include model_switched');
			assert.ok(statusBody.includes("'model_switch_failed'"),
				'StatusData should include model_switch_failed');
			assert.ok(statusBody.includes('model?: string'),
				'StatusData should have optional model field');
		});
	});
});
