/**
 * Message-delta streaming, driven rather than grepped.
 *
 * This file previously held nineteen assertions over the *text* of
 * `sdkSessionManager.ts`, `shared/messages.ts` and `ExtensionRpcRouter.ts` —
 * "declares `_onDidMessageDelta` as a BufferedEmitter", "`MessageDeltaPayload`
 * should have messageId and deltaContent fields", and so on. They could not fail
 * for a real reason and would have passed against a comment, and the type ones
 * duplicated what `tsc --noEmit` already gates on every build.
 *
 * Deleting them would have left a genuine hole: `assistant.message_delta` was
 * covered by *nothing else*. So the behaviour is tested here instead, through the
 * dispatcher, the way `subagent-events.test.js` does it.
 *
 * The old scans also missed the branches most worth having: a sub-agent's delta must
 * not reach the main bubble, and an empty reasoning delta must not cross the RPC
 * boundary at all. Both are real early returns in the handler and now have tests.
 *
 * `integration/webview/reasoning-delta-streaming.test.js` was folded in here and
 * deleted. It scanned the same three files plus `main.js`, `WebviewRpcClient.js` and
 * `MessageDisplay.js` for the reasoning half; its webview claims — that a delta
 * creates a bubble, and that `showReasoning=false` suppresses it — are covered by
 * running them in `unit/components/MessageDisplay-reasoning-streaming.test.js`.
 *
 * Requires `npm run compile-tests` (out/).
 */

const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const { installVscodeMock } = require('../../helpers/with-vscode-mock');

const mock = installVscodeMock();
let SDKSessionManager, ExtensionRpcRouter;

before(function () {
    mock.install();
    try {
        ({ SDKSessionManager } = require(path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js')));
        ({ ExtensionRpcRouter } = require(path.join(__dirname, '../../..', 'out', 'extension', 'rpc', 'ExtensionRpcRouter.js')));
    } catch (e) {
        console.log('Module not yet compiled, skipping:', e.message);
        this.skip();
    }
});
after(() => mock.restore());

/** Just enough of a manager for the event dispatcher to run against. */
function managerContext() {
    const deltas = [];
    const reasoningDeltas = [];
    const output = [];
    const subagentMessages = [];
    return {
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        _onDidMessageDelta: { fire: (d) => deltas.push(d) },
        _onDidReceiveOutput: { fire: (o) => output.push(o) },
        _onDidSubagentMessage: { fire: (m) => subagentMessages.push(m) },
        _onDidReceiveReasoning: { fire() {} },
        _onDidReceiveReasoningDelta: { fire: (d) => reasoningDeltas.push(d) },
        _onDidStartTool: { fire() {} },
        _onDidUpdateTool: { fire() {} },
        _onDidCompleteTool: { fire() {} },
        fileSnapshotService: { captureByPath() {}, getSnapshot: () => undefined, correlateToToolCallId() {} },
        toolExecutions: new Map(),
        lastMessageIntent: undefined,
        deltas,
        reasoningDeltas,
        output,
        subagentMessages
    };
}

const fire = (ctx, event) => SDKSessionManager.prototype._handleSDKEvent.call(ctx, event);

describe('SDKSessionManager — assistant.message_delta', () => {
    it('streams the delta with its message id', () => {
        const ctx = managerContext();

        fire(ctx, { type: 'assistant.message_delta', data: { messageId: 'm1', deltaContent: 'hel' } });
        fire(ctx, { type: 'assistant.message_delta', data: { messageId: 'm1', deltaContent: 'lo' } });

        expect(ctx.deltas).to.deep.equal([
            { messageId: 'm1', deltaContent: 'hel' },
            { messageId: 'm1', deltaContent: 'lo' }
        ]);
    });

    it('keeps a sub-agent\'s delta out of the main bubble', () => {
        // Sub-agent text streams to the dock via onDidSubagentMessage. Letting it
        // through here would interleave a sub-agent's tokens into the transcript —
        // the separation the sub-agent dock exists to maintain.
        const ctx = managerContext();

        fire(ctx, {
            type: 'assistant.message_delta',
            agentId: 'agent-xyz',
            data: { messageId: 'm1', deltaContent: 'from a sub-agent' }
        });

        expect(ctx.deltas).to.have.lengthOf(0);
    });
});

describe('SDKSessionManager — assistant.message carries a message id', () => {
    it('emits content and its id together, not a bare string', () => {
        // The emitter's payload became an object so a completed message can be
        // matched to the bubble its deltas were streaming into.
        const ctx = managerContext();

        fire(ctx, { type: 'assistant.message', data: { content: 'all done', messageId: 'm1' } });

        expect(ctx.output).to.deep.equal([{ content: 'all done', messageId: 'm1' }]);
    });

    it('sends an empty signal to close a streaming bubble that ended in tool calls', () => {
        const ctx = managerContext();

        fire(ctx, {
            type: 'assistant.message',
            data: { messageId: 'm1', content: 'thinking out loud', toolRequests: [{ name: 'grep', arguments: {} }] }
        });

        expect(ctx.output).to.deep.equal([{ content: '', messageId: 'm1' }]);
    });

    it('tolerates a message with no id', () => {
        const ctx = managerContext();

        fire(ctx, { type: 'assistant.message', data: { content: 'no id here' } });

        expect(ctx.output).to.deep.equal([{ content: 'no id here', messageId: '' }]);
    });

    it('routes a sub-agent message to the dock, never the transcript', () => {
        const ctx = managerContext();

        fire(ctx, { type: 'assistant.message', agentId: 'agent-xyz', data: { content: 'sub-agent speaking' } });

        expect(ctx.output).to.have.lengthOf(0);
        expect(ctx.subagentMessages).to.have.lengthOf(1);
    });
});

describe('SDKSessionManager — assistant.reasoning_delta', () => {
    it('streams the reasoning delta with its id', () => {
        const ctx = managerContext();

        fire(ctx, { type: 'assistant.reasoning_delta', data: { reasoningId: 'r1', deltaContent: 'because' } });

        expect(ctx.reasoningDeltas).to.deep.equal([{ reasoningId: 'r1', deltaContent: 'because' }]);
    });

    it('drops an empty delta rather than crossing the RPC boundary with nothing', () => {
        // Some models emit reasoning with empty content and an opaque id. Forwarding
        // it renders a blank "Assistant Reasoning" box.
        const ctx = managerContext();

        fire(ctx, { type: 'assistant.reasoning_delta', data: { reasoningId: 'r1', deltaContent: '' } });

        expect(ctx.reasoningDeltas).to.have.lengthOf(0);
    });

    it('keeps a sub-agent\'s reasoning out of the main transcript', () => {
        const ctx = managerContext();

        fire(ctx, {
            type: 'assistant.reasoning_delta',
            agentId: 'agent-xyz',
            data: { reasoningId: 'r1', deltaContent: 'sub-agent thinking' }
        });

        expect(ctx.reasoningDeltas).to.have.lengthOf(0);
    });
});

describe('ExtensionRpcRouter.sendMessageDelta', () => {
    /** A webview that records what was posted to it. */
    function fakeWebview() {
        const posted = [];
        return {
            posted,
            postMessage: (m) => { posted.push(m); return Promise.resolve(true); },
            onDidReceiveMessage: () => ({ dispose() {} })
        };
    }

    it('puts the delta on the wire with both fields', () => {
        const webview = fakeWebview();

        new ExtensionRpcRouter(webview).sendMessageDelta('m1', 'hello');

        expect(webview.posted).to.deep.equal([
            { type: 'messageDelta', messageId: 'm1', deltaContent: 'hello' }
        ]);
    });

    it('puts a reasoning delta on the wire under its own type', () => {
        const webview = fakeWebview();

        new ExtensionRpcRouter(webview).sendReasoningDelta('r1', 'because');

        expect(webview.posted).to.deep.equal([
            { type: 'reasoningDelta', reasoningId: 'r1', deltaContent: 'because' }
        ]);
    });
});
