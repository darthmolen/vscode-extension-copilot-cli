/**
 * Empty-reasoning guard in _handleSDKEvent.
 *
 * With `auto` routing to gpt models, the CLI emits `assistant.reasoning` with an empty
 * `content` (only an opaque encrypted reasoningId) and NO reasoning_delta events. The
 * extension must NOT forward empty reasoning — otherwise the webview renders a blank
 * "ASSISTANT REASONING" box. Non-empty reasoning (Claude extended thinking) must still fire.
 *
 * Requires `npm run compile-tests` (out/). Mirrors subagent-events.test.js.
 */
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
	if (id === 'vscode') { return require('../../helpers/vscode-mock'); }
	return originalRequire.apply(this, arguments);
};

const { expect } = require('chai');

describe('Empty-reasoning guard (_handleSDKEvent assistant.reasoning)', function () {
	this.timeout(10000);

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
		const reasoning = [];
		const deltas = [];
		return {
			logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
			_onDidReceiveReasoning: { fire: (s) => reasoning.push(s) },
			_onDidReceiveReasoningDelta: { fire: (s) => deltas.push(s) },
			_reasoning: reasoning,
			_deltas: deltas,
		};
	}

	const fire = (ctx, event) => SDKSessionManager.prototype._handleSDKEvent.call(ctx, event);

	it('does NOT fire reasoning for empty content', function () {
		const ctx = createMockContext();
		fire(ctx, { type: 'assistant.reasoning', data: { reasoningId: 'r1', content: '' } });
		expect(ctx._reasoning).to.have.length(0);
	});

	it('does NOT fire reasoning for whitespace-only content', function () {
		const ctx = createMockContext();
		fire(ctx, { type: 'assistant.reasoning', data: { reasoningId: 'r1', content: '   \n\t ' } });
		expect(ctx._reasoning).to.have.length(0);
	});

	it('does NOT fire reasoning when content is missing entirely', function () {
		const ctx = createMockContext();
		fire(ctx, { type: 'assistant.reasoning', data: { reasoningId: 'r1' } });
		expect(ctx._reasoning).to.have.length(0);
	});

	it('DOES fire reasoning for real thinking text (Claude)', function () {
		const ctx = createMockContext();
		fire(ctx, { type: 'assistant.reasoning', data: { reasoningId: 'r1', content: 'Let me check the types...' } });
		expect(ctx._reasoning).to.have.length(1);
		expect(ctx._reasoning[0]).to.include({ reasoningId: 'r1', content: 'Let me check the types...' });
	});

	it('still forwards non-empty reasoning deltas (streaming path unaffected)', function () {
		const ctx = createMockContext();
		fire(ctx, { type: 'assistant.reasoning_delta', data: { reasoningId: 'r1', deltaContent: 'Let me' } });
		expect(ctx._deltas).to.have.length(1);
		expect(ctx._deltas[0]).to.include({ reasoningId: 'r1', deltaContent: 'Let me' });
	});

	it('does NOT forward an empty reasoning delta (symmetric with the reasoning guard)', function () {
		const ctx = createMockContext();
		fire(ctx, { type: 'assistant.reasoning_delta', data: { reasoningId: 'r1', deltaContent: '' } });
		expect(ctx._deltas).to.have.length(0);
	});
});
