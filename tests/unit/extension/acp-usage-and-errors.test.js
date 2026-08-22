/**
 * The last two mappable emitters (IN-3 §4c, "still open" → decided 2026-08-22).
 *
 * ## Usage
 *
 * ACP's `usage_update` requires `used` and `size` — both non-optional. Our `UsageData`
 * carries `currentTokens`, `tokenLimit` and `remainingPercentage`, and a percentage
 * alone cannot produce either number. So the rule is: forward when both absolutes are
 * there, stay silent when they are not. Emitting a guessed context window would put a
 * number in front of someone that no measurement supports.
 *
 * ## Errors
 *
 * ACP has **no error variant**. Every `session/update` case was checked;
 * `session_info_update` is title and timestamp. So an error either rides the
 * transcript or does not reach the host at all.
 *
 * It rides the transcript, tagged in `_meta` — the same decision already taken for
 * sub-agent traffic in `sessionUpdateMapper.ts`, and for the same reason: a generic
 * host renders it inline and loses nothing, while a client that knows our tag can
 * draw it as an error.
 *
 * **Only out-of-turn errors.** `sendMessage()` fires this emitter *and rethrows*, so an
 * in-turn error already reaches the client as a rejected `session/prompt` carrying the
 * same message. Forwarding it as well would show one fault twice. The rejection is the
 * protocol's own mechanism and is correlated to the turn; the notification is the only
 * channel for an error that arrives when no turn is running.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const M = require(join(REPO_ROOT, 'out', 'acp', 'sessionUpdateMapper.js'));
const { SdkSessionBackend } = require(join(REPO_ROOT, 'out', 'acp', 'SdkSessionBackend.js'));

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const SID = 'sess-1';

function makeManager(over = {}) {
    const noSub = { dispose() {} };
    const listeners = { usage: new Set(), error: new Set() };
    return {
        setPermissionHandler() {},
        async start() {},
        getSessionId: () => 'session-a',
        async sendMessage() {},
        onDidMessageDelta: () => noSub,
        onDidReceiveReasoningDelta: () => noSub,
        onDidStartTool: () => noSub,
        onDidUpdateTool: () => noSub,
        onDidCompleteTool: () => noSub,
        onDidStartSubagent: () => noSub,
        onDidSubagentMessage: () => noSub,
        onDidCompleteSubagent: () => noSub,
        onDidUpdateTodos: () => noSub,
        onDidProduceDiff: () => noSub,
        onDidUpdateUsage(l) { listeners.usage.add(l); return { dispose: () => listeners.usage.delete(l) }; },
        onDidReceiveError(l) { listeners.error.add(l); return { dispose: () => listeners.error.delete(l) }; },
        emitUsage(u) { for (const l of [...listeners.usage]) { l(u); } },
        emitError(m) { for (const l of [...listeners.error]) { l(m); } },
        getCurrentMode: () => 'work',
        async abortMessage() {},
        async enablePlanMode() {},
        async disablePlanMode() {},
        async stop() {},
        dispose() {},
        ...over
    };
}

const started = async (over = {}) => {
    const manager = makeManager(over);
    const backend = await SdkSessionBackend.start(manager, silentLogger);
    const events = [];
    backend.onEvent(e => events.push(e));
    return { manager, backend, events };
};

describe('usage — context accounting reaches the host (IN-3)', () => {
    it('maps to ACP usage_update with the absolute numbers', () => {
        const n = M.usageUpdate(SID, { used: 12_000, size: 200_000 });

        expect(n.sessionId).to.equal(SID);
        expect(n.update.sessionUpdate).to.equal('usage_update');
        expect(n.update.used).to.equal(12_000);
        expect(n.update.size).to.equal(200_000);
    });

    it('forwards a usage report that carries both numbers', async () => {
        const h = await started();

        h.manager.emitUsage({ currentTokens: 12_000, tokenLimit: 200_000, remainingPercentage: 94 });

        expect(h.events.filter(e => e.kind === 'usage'))
            .to.deep.equal([{ kind: 'usage', used: 12_000, size: 200_000 }]);
    });

    /**
     * A percentage cannot be turned into a token count without the window size, and a
     * window size cannot be inferred from a percentage. Publishing either as a number
     * would put a figure in front of someone that no measurement supports.
     */
    it('stays silent when it only has a percentage', async () => {
        const h = await started();

        h.manager.emitUsage({ remainingPercentage: 94 });

        expect(h.events.filter(e => e.kind === 'usage')).to.deep.equal([]);
    });

    it('stays silent when either absolute is missing', async () => {
        const h = await started();

        h.manager.emitUsage({ currentTokens: 12_000 });
        h.manager.emitUsage({ tokenLimit: 200_000 });

        expect(h.events.filter(e => e.kind === 'usage')).to.deep.equal([]);
    });

    /**
     * The numbers come from a CLI event, not from our own arithmetic. A non-numeric
     * or non-finite reading is a broken measurement, and forwarding it would put
     * `NaN` where a host expects a token count.
     */
    it('stays silent on a reading that is not a finite number', async () => {
        const h = await started();

        h.manager.emitUsage({ currentTokens: NaN, tokenLimit: 200_000 });
        h.manager.emitUsage({ currentTokens: 12_000, tokenLimit: Infinity });
        h.manager.emitUsage({ currentTokens: '12000', tokenLimit: 200_000 });

        expect(h.events.filter(e => e.kind === 'usage')).to.deep.equal([]);
    });

    /** Zero used is a real reading — a fresh session — not a missing one. */
    it('forwards a zero reading rather than mistaking it for absent', async () => {
        const h = await started();

        h.manager.emitUsage({ currentTokens: 0, tokenLimit: 200_000 });

        expect(h.events.filter(e => e.kind === 'usage'))
            .to.deep.equal([{ kind: 'usage', used: 0, size: 200_000 }]);
    });
});

describe('errors — the transcript is the only channel ACP offers (IN-3)', () => {
    it('maps to an agent_message_chunk carrying the text', () => {
        const n = M.errorUpdate(SID, { message: 'the CLI lost its connection' });

        expect(n.update.sessionUpdate).to.equal('agent_message_chunk');
        expect(n.update.content.text).to.include('the CLI lost its connection');
    });

    /**
     * Tagged rather than dressed up as model output. A generic host renders it inline
     * and loses nothing; ours can draw it as an error. Same decision as sub-agent
     * traffic, and the tag is namespaced for the same reason — `_meta` is shared, and
     * ACP tells implementations not to assume anything about keys they did not write.
     */
    it('tags the envelope so a client can tell it from model output', () => {
        const n = M.errorUpdate(SID, { message: 'boom' });

        expect(n._meta).to.have.property('copilotCliChat.error', true);
    });

    it('forwards an error that arrives with no turn running', async () => {
        const h = await started();

        h.manager.emitError('the CLI lost its connection');

        expect(h.events.filter(e => e.kind === 'error'))
            .to.deep.equal([{ kind: 'error', message: 'the CLI lost its connection' }]);
    });

    /**
     * The duplication guard. `sendMessage()` fires this emitter and then rethrows, so
     * the same fault already reaches the client as a rejected `session/prompt`.
     */
    it('stays silent while a turn is running, because the rejection already says it', async () => {
        let failTurn;
        const h = await started({ sendMessage: () => new Promise((_r, reject) => { failTurn = reject; }) });

        const turn = h.backend.prompt('go');
        h.manager.emitError('Failed to send message: boom');
        failTurn(new Error('boom'));
        await turn.catch(() => {});

        expect(h.events.filter(e => e.kind === 'error')).to.deep.equal([]);
    });

    /** And the silence is scoped to the turn, not to the session. */
    it('forwards again once the turn is over', async () => {
        const h = await started();

        await h.backend.prompt('go');
        h.manager.emitError('something later went wrong');

        expect(h.events.filter(e => e.kind === 'error')).to.have.lengthOf(1);
    });
});
