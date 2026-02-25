/**
 * Tests for queued message indicator (v3.3.0)
 *
 * TDD RED phase: Tests written BEFORE the implementation exists.
 *
 * When a user sends a message while the AI is already processing a turn,
 * the CLI queues the message. We need to:
 * 1. Track isInTurn state (set on assistant.turn_start, cleared on assistant.turn_end)
 * 2. Fire message_queued status when sendMessage is called while isInTurn
 * 3. Fire message_dequeued status on the next user.message event (queued message accepted)
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

describe('Queued Message Indicator', function () {
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

	function createMockContext() {
		const firedStatus = [];
		return {
			logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
			_onDidChangeStatus: { fire: (data) => firedStatus.push(data) },
			_onDidReceiveOutput: { fire: () => {} },
			_onDidReceiveReasoning: { fire: () => {} },
			_onDidReceiveError: { fire: () => {} },
			_onDidStartTool: { fire: () => {} },
			_onDidUpdateTool: { fire: () => {} },
			_onDidCompleteTool: { fire: () => {} },
			_onDidChangeFile: { fire: () => {} },
			_onDidProduceDiff: { fire: () => {} },
			_onDidUpdateUsage: { fire: () => {} },
			fileSnapshotService: { captureByPath: () => {} },
			toolExecutions: new Map(),
			lastMessageIntent: undefined,
			_isInTurn: false,
			firedStatus,
		};
	}

	function callHandleSDKEvent(ctx, event) {
		SDKSessionManager.prototype._handleSDKEvent.call(ctx, event);
	}

	describe('turn tracking', function () {
		it('should set _isInTurn to true on assistant.turn_start', function () {
			const ctx = createMockContext();
			assert.strictEqual(ctx._isInTurn, false);

			callHandleSDKEvent(ctx, {
				type: 'assistant.turn_start',
				data: { turnId: 'turn-1' }
			});

			assert.strictEqual(ctx._isInTurn, true);
		});

		it('should set _isInTurn to false on assistant.turn_end', function () {
			const ctx = createMockContext();
			ctx._isInTurn = true;

			callHandleSDKEvent(ctx, {
				type: 'assistant.turn_end',
				data: { turnId: 'turn-1' }
			});

			assert.strictEqual(ctx._isInTurn, false);
		});
	});

	describe('message_queued status', function () {
		it('should fire message_queued when _isInTurn is true and pending_messages.modified fires', function () {
			const ctx = createMockContext();
			ctx._isInTurn = true;

			callHandleSDKEvent(ctx, {
				type: 'pending_messages.modified',
				ephemeral: true,
				data: {}
			});

			const queued = ctx.firedStatus.filter(e => e.status === 'message_queued');
			assert.strictEqual(queued.length, 1, 'Should fire message_queued');
		});

		it('should NOT fire message_queued when _isInTurn is false', function () {
			const ctx = createMockContext();
			ctx._isInTurn = false;

			callHandleSDKEvent(ctx, {
				type: 'pending_messages.modified',
				ephemeral: true,
				data: {}
			});

			const queued = ctx.firedStatus.filter(e => e.status === 'message_queued');
			assert.strictEqual(queued.length, 0, 'Should NOT fire message_queued when not in a turn');
		});
	});

	describe('new SDK event logging', function () {
		it('should not throw on subagent events', function () {
			const ctx = createMockContext();

			assert.doesNotThrow(() => {
				callHandleSDKEvent(ctx, { type: 'subagent.started', data: {} });
				callHandleSDKEvent(ctx, { type: 'subagent.completed', data: {} });
				callHandleSDKEvent(ctx, { type: 'subagent.failed', data: {} });
				callHandleSDKEvent(ctx, { type: 'subagent.selected', data: {} });
			});
		});

		it('should not throw on hook events', function () {
			const ctx = createMockContext();

			assert.doesNotThrow(() => {
				callHandleSDKEvent(ctx, { type: 'hook.start', data: {} });
				callHandleSDKEvent(ctx, { type: 'hook.end', data: {} });
			});
		});

		it('should not throw on session.idle event', function () {
			const ctx = createMockContext();

			assert.doesNotThrow(() => {
				callHandleSDKEvent(ctx, { type: 'session.idle', data: {} });
			});
		});
	});
});
