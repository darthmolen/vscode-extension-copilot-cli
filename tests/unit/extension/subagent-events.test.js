/**
 * Sub-agent event handling in SDKSessionManager (Tasks 2-3).
 *
 * Verifies _handleSDKEvent:
 *  - captures envelope `agentId` + `parentToolCallId` onto the tool state
 *  - fires onDidStartSubagent for subagent.started
 *  - fires onDidCompleteSubagent for subagent.completed / subagent.failed
 *
 * Requires `npm run compile-tests` (out/). Mirrors compaction-metrics-reset.test.js.
 */
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
	if (id === 'vscode') {
		return require('../../helpers/vscode-mock');
	}
	return originalRequire.apply(this, arguments);
};

const { expect } = require('chai');

describe('SDKSessionManager — sub-agent events', function () {
	let SDKSessionManager;

	before(function () {
		try {
			SDKSessionManager = require('../../../out/sdkSessionManager.js').SDKSessionManager;
		} catch (e) {
			console.log('Module not yet compiled, skipping:', e.message);
			this.skip();
		}
	});

	function createMockContext() {
		const started = [];
		const tools = [];
		const completed = [];
		const output = [];
		const subMsgs = [];
		return {
			logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
			_onDidStartTool: { fire: (s) => tools.push(s) },
			_onDidUpdateTool: { fire: () => {} },
			_onDidCompleteTool: { fire: () => {} },
			_onDidStartSubagent: { fire: (s) => started.push(s) },
			_onDidCompleteSubagent: { fire: (s) => completed.push(s) },
			_onDidReceiveOutput: { fire: (s) => output.push(s) },
			_onDidSubagentMessage: { fire: (s) => subMsgs.push(s) },
			fileSnapshotService: {
				captureByPath: () => {},
				getSnapshot: () => undefined,
				correlateToToolCallId: () => {},
			},
			toolExecutions: new Map(),
			// toolCallId -> intentionSummary, consumed as each tool starts.
			toolIntents: new Map(),
			// The dispatcher delegates to these instance methods via `this.*`.
			handleToolStart: SDKSessionManager.prototype.handleToolStart,
			_started: started,
			_tools: tools,
			_completed: completed,
			_output: output,
			_subMsgs: subMsgs,
		};
	}

	const fire = (ctx, event) => SDKSessionManager.prototype._handleSDKEvent.call(ctx, event);

	it('captures envelope agentId + parentToolCallId on tool.execution_start', function () {
		const ctx = createMockContext();
		fire(ctx, {
			type: 'tool.execution_start',
			agentId: 'agent-xyz',
			data: { toolCallId: 't1', toolName: 'grep', arguments: {}, parentToolCallId: 'task-1' },
		});
		expect(ctx._tools).to.have.length(1);
		expect(ctx._tools[0].agentId).to.equal('agent-xyz');
		expect(ctx._tools[0].parentToolCallId).to.equal('task-1');
	});

	it('fires onDidStartSubagent for subagent.started (keyed by envelope agentId)', function () {
		const ctx = createMockContext();
		fire(ctx, {
			type: 'subagent.started',
			agentId: 'agent-xyz',
			data: { toolCallId: 'agent-xyz', agentName: 'general-purpose', agentDisplayName: 'General Purpose Agent', agentDescription: 'desc' },
		});
		expect(ctx._started).to.have.length(1);
		expect(ctx._started[0]).to.include({ agentId: 'agent-xyz', agentDisplayName: 'General Purpose Agent' });
	});

	it('fires onDidCompleteSubagent with the receipt on subagent.completed', function () {
		const ctx = createMockContext();
		fire(ctx, {
			type: 'subagent.completed',
			agentId: 'agent-xyz',
			data: { toolCallId: 'agent-xyz', agentName: 'general-purpose', model: 'claude-sonnet-4.6', totalToolCalls: 13, totalTokens: 282777, durationMs: 87168 },
		});
		expect(ctx._completed).to.have.length(1);
		expect(ctx._completed[0]).to.include({ agentId: 'agent-xyz', status: 'complete', model: 'claude-sonnet-4.6', totalToolCalls: 13, durationMs: 87168 });
	});

	it('fires onDidCompleteSubagent with status failed on subagent.failed', function () {
		const ctx = createMockContext();
		fire(ctx, {
			type: 'subagent.failed',
			agentId: 'agent-xyz',
			data: { toolCallId: 'agent-xyz', error: 'boom' },
		});
		expect(ctx._completed).to.have.length(1);
		expect(ctx._completed[0]).to.include({ agentId: 'agent-xyz', status: 'failed', error: 'boom' });
	});

	it('routes a sub-agent assistant.message to onDidSubagentMessage, NOT the main transcript', function () {
		const ctx = createMockContext();
		fire(ctx, {
			type: 'assistant.message',
			agentId: 'agent-xyz',
			data: { messageId: 'm1', content: 'plan looks sound', reasoningText: 'checked the types' },
		});
		expect(ctx._subMsgs, 'fires subagent message').to.have.length(1);
		expect(ctx._subMsgs[0]).to.include({ agentId: 'agent-xyz', content: 'plan looks sound', reasoningText: 'checked the types' });
		expect(ctx._output, 'does NOT leak to main transcript').to.have.length(0);
	});

	it('a main-agent assistant.message still fires onDidReceiveOutput (regression)', function () {
		const ctx = createMockContext();
		fire(ctx, { type: 'assistant.message', data: { messageId: 'm1', content: 'hello there' } });
		expect(ctx._output).to.have.length(1);
		expect(ctx._subMsgs).to.have.length(0);
	});

	it('falls back to data.toolCallId when envelope agentId is absent', function () {
		const ctx = createMockContext();
		fire(ctx, {
			type: 'subagent.started',
			data: { toolCallId: 'task-only', agentName: 'explore', agentDisplayName: 'Explore Agent' },
		});
		expect(ctx._started[0].agentId).to.equal('task-only');
	});
});
