/**
 * SdkSessionBackend — a cancelled turn says it was cancelled (IN-3 §4c.3).
 *
 * `prompt()` returned `stopReason: 'end_turn'` unconditionally, which meant
 * `session/cancel` was only half real: we aborted the work and then told the client
 * the turn had finished normally. A host showing "done" for a turn the user just
 * stopped is worse than one that shows nothing — it contradicts the thing the user
 * did a moment ago.
 *
 * Only `cancelled` is added. `max_tokens`, `max_turn_requests` and `refusal` are real
 * ACP stop reasons, but the manager surfaces no signal for any of them, and returning
 * one we cannot detect would be the same lie in a different costume.
 *
 * The interesting case is the race, and it is the normal case rather than the edge
 * one: `sendMessage()` resolves when the SDK goes idle, and aborting is exactly what
 * makes it go idle. So a cancelled turn resolves *successfully*, and reading the
 * stop reason off whether `sendMessage` threw would report `end_turn` every time.
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { SdkSessionBackend } = require(
    path.join(__dirname, '../../..', 'out', 'acp', 'SdkSessionBackend.js')
);

function makeManager(over = {}) {
    const noSub = { dispose() {} };
    return {
        aborted: 0,
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
        getCurrentMode: () => 'work',
        async abortMessage() { this.aborted += 1; },
        async enablePlanMode() {},
        async disablePlanMode() {},
        async stop() {},
        dispose() {},
        ...over
    };
}

describe('SdkSessionBackend — stop reason (IN-3 §4c.3)', function () {
    this.timeout(10000);

    let manager;
    beforeEach(() => { manager = makeManager(); });

    it('reports a turn that ran to completion as end_turn', async () => {
        const backend = await SdkSessionBackend.start(manager);

        expect(await backend.prompt('hi')).to.deep.equal({ stopReason: 'end_turn' });
    });

    /**
     * The whole point. `sendMessage` resolves normally here — as it does in
     * production, because aborting is what ends the turn — so nothing about the call
     * itself distinguishes this from a completed turn.
     */
    it('reports a cancelled turn as cancelled', async () => {
        let finishTurn;
        manager = makeManager({ sendMessage: () => new Promise(r => { finishTurn = r; }) });
        const backend = await SdkSessionBackend.start(manager);

        const turn = backend.prompt('hi');
        await backend.cancel();
        finishTurn();

        expect(await turn).to.deep.equal({ stopReason: 'cancelled' });
    });

    /**
     * Cancellation is scoped to the turn that was running, not to the session. A
     * later turn is a new intention and must report its own outcome.
     */
    it('does not carry the cancellation into the next turn', async () => {
        const backend = await SdkSessionBackend.start(manager);

        await backend.prompt('one');
        await backend.cancel();
        expect(await backend.prompt('two')).to.deep.equal({ stopReason: 'end_turn' });
    });

    /**
     * Cancelling when nothing is running is a normal race — the client cannot know
     * the turn already ended. It must not poison the turn that comes after.
     */
    it('ignores a cancel that arrived with no turn in flight', async () => {
        const backend = await SdkSessionBackend.start(manager);

        await backend.cancel();

        expect(await backend.prompt('hi')).to.deep.equal({ stopReason: 'end_turn' });
    });

    it('still aborts the manager, which is what makes cancel real', async () => {
        const backend = await SdkSessionBackend.start(manager);

        await backend.prompt('one');
        await backend.cancel();

        expect(manager.aborted).to.equal(1);
    });
});
