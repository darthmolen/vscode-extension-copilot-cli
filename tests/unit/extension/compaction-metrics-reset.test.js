/**
 * Tests for compaction metric reset (v3.3.0)
 *
 * TDD RED phase: Tests written BEFORE the implementation exists.
 *
 * The SDK emits 'session.compaction_start' and 'session.compaction_complete' events.
 * On compaction_complete (success), we should fire reset_metrics with postCompactionTokens
 * so the webview can update Window/Used to post-compaction values instead of zeroing out.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock vscode module BEFORE anything else loads
Module.prototype.require = function (id) {
	if (id === 'vscode') {
		return require('../../helpers/vscode-mock');
	}
	return originalRequire.apply(this, arguments);
};

const assert = require('assert');
const path = require('path');

describe('Compaction Metric Reset', function () {
	this.timeout(10000);

	let SDKSessionManager;
	let handleSDKEvent;

	before(function () {
		try {
			const mod = require('../../../out/sdkSessionManager.js');
			SDKSessionManager = mod.SDKSessionManager;
		} catch (e) {
			console.log('Module not yet compiled, skipping:', e.message);
			this.skip();
		}
	});

	/**
	 * Create a minimal mock context that has just the fields _handleSDKEvent needs.
	 * We call the prototype method with this as `this`.
	 */
	function createMockContext() {
		const firedEvents = [];
		return {
			logger: {
				info: () => {},
				warn: () => {},
				error: () => {},
				debug: () => {}
			},
			_onDidChangeStatus: {
				fire: (data) => firedEvents.push(data)
			},
			_onDidReceiveOutput: {
				fire: () => {}
			},
			_onDidReceiveReasoning: {
				fire: () => {}
			},
			_onDidReceiveError: {
				fire: () => {}
			},
			_onDidStartTool: {
				fire: () => {}
			},
			_onDidUpdateTool: {
				fire: () => {}
			},
			_onDidCompleteTool: {
				fire: () => {}
			},
			_onDidChangeFile: {
				fire: () => {}
			},
			_onDidProduceDiff: {
				fire: () => {}
			},
			_onDidUpdateUsage: {
				fire: () => {}
			},
			fileSnapshotService: {
				captureByPath: () => {}
			},
			toolExecutions: new Map(),
			lastMessageIntent: undefined,
			firedEvents
		};
	}

	function callHandleSDKEvent(ctx, event) {
		// _handleSDKEvent is a private TS method but exists as a regular method in compiled JS
		SDKSessionManager.prototype._handleSDKEvent.call(ctx, event);
	}

	describe('session.compaction_complete', function () {
		it('should fire reset_metrics with postCompactionTokens on successful compaction', function () {
			const ctx = createMockContext();

			callHandleSDKEvent(ctx, {
				type: 'session.compaction_complete',
				data: {
					success: true,
					preCompactionTokens: 80000,
					postCompactionTokens: 5000
				}
			});

			assert.strictEqual(ctx.firedEvents.length, 1);
			const fired = ctx.firedEvents[0];
			assert.strictEqual(fired.status, 'reset_metrics');
			assert.strictEqual(fired.resetMetrics, true);
			assert.strictEqual(fired.postCompactionTokens, 5000);
		});

		it('should NOT fire reset_metrics when compaction fails', function () {
			const ctx = createMockContext();

			callHandleSDKEvent(ctx, {
				type: 'session.compaction_complete',
				data: {
					success: false,
					error: 'compaction failed'
				}
			});

			// Should not fire any status change for failed compaction
			const resetEvents = ctx.firedEvents.filter(e => e.status === 'reset_metrics');
			assert.strictEqual(resetEvents.length, 0);
		});

		it('should default postCompactionTokens to 0 when not provided', function () {
			const ctx = createMockContext();

			callHandleSDKEvent(ctx, {
				type: 'session.compaction_complete',
				data: {
					success: true
				}
			});

			assert.strictEqual(ctx.firedEvents.length, 1);
			assert.strictEqual(ctx.firedEvents[0].postCompactionTokens, 0);
		});
	});

	describe('session.compaction_start', function () {
		it('should not fire reset_metrics on compaction start', function () {
			const ctx = createMockContext();

			callHandleSDKEvent(ctx, {
				type: 'session.compaction_start',
				data: {}
			});

			const resetEvents = ctx.firedEvents.filter(e => e.status === 'reset_metrics');
			assert.strictEqual(resetEvents.length, 0);
		});
	});

	describe('unrelated events', function () {
		it('should NOT fire reset_metrics for assistant.turn_end', function () {
			const ctx = createMockContext();

			callHandleSDKEvent(ctx, {
				type: 'assistant.turn_end',
				data: { turnId: 'test-turn-1' }
			});

			// turn_end fires 'ready', not 'reset_metrics'
			const resetEvents = ctx.firedEvents.filter(e => e.status === 'reset_metrics');
			assert.strictEqual(resetEvents.length, 0);
		});

		it('should NOT fire reset_metrics for session.usage_info', function () {
			const ctx = createMockContext();

			callHandleSDKEvent(ctx, {
				type: 'session.usage_info',
				data: { currentTokens: 5000, tokenLimit: 100000, messagesLength: 10 }
			});

			const resetEvents = ctx.firedEvents.filter(e => e.status === 'reset_metrics');
			assert.strictEqual(resetEvents.length, 0);
		});
	});
});
