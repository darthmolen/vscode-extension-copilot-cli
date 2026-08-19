/**
 * SdkSessionBackend — the real backend behind `AcpSessionBackend` (IN-3 cycle 5)
 *
 * Cycles 1–4 built the protocol surface against an injected fake. This is the
 * adapter that makes it real: one `SDKSessionManager` per session (spine S3),
 * exposed as the three-member slice the agent actually touches.
 *
 * The manager is injected rather than constructed, so these tests spawn no CLI and
 * import no `vscode`. That is also the shape the composition root needs — the agent
 * process builds managers, the backend only drives one.
 *
 * Facts from src/sdkSessionManager.ts that this relies on:
 *   - `sendMessage()` awaits `session.sendAndWait`, which blocks until session.idle
 *     (:1384, and the comment at :2268). So it already spans a turn; the backend
 *     does not need its own turn-end signal.
 *   - `onDidMessageDelta` fires `{ messageId, deltaContent }` — the streaming path.
 *   - Emitter subscription returns an `IDisposable`, not an unsubscribe function.
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { SdkSessionBackend } = require(
    path.join(__dirname, '../../..', 'out', 'acp', 'SdkSessionBackend.js')
);

/** A manager stand-in exposing only the slice the backend declares. */
function makeManager(over = {}) {
    const listeners = new Set();
    return {
        started: 0,
        sent: [],
        disposedSubscriptions: 0,
        sessionId: 'copilot-session-1',
        setPermissionHandler(h) { this.permissionHandler = h; },
        async start() { this.started++; },
        getSessionId() { return this.sessionId; },
        async sendMessage(text) { this.sent.push(text); },
        onDidMessageDelta(listener) {
            listeners.add(listener);
            return { dispose: () => { listeners.delete(listener); this.disposedSubscriptions++; } };
        },
        // The other emitters the backend subscribes. Each returns its own disposable
        // so the "one unsubscribe releases all of them" claim is observable.
        onDidReceiveReasoningDelta() { return { dispose: () => { this.disposedSubscriptions++; } }; },
        onDidStartTool() { return { dispose: () => { this.disposedSubscriptions++; } }; },
        onDidUpdateTool() { return { dispose: () => { this.disposedSubscriptions++; } }; },
        onDidCompleteTool() { return { dispose: () => { this.disposedSubscriptions++; } }; },
        onDidStartSubagent() { return { dispose: () => { this.disposedSubscriptions++; } }; },
        onDidSubagentMessage() { return { dispose: () => { this.disposedSubscriptions++; } }; },
        onDidCompleteSubagent() { return { dispose: () => { this.disposedSubscriptions++; } }; },
        emitDelta(deltaContent, messageId = 'm1') {
            for (const l of [...listeners]) { l({ messageId, deltaContent }); }
        },
        liveListeners: () => listeners.size,
        ...over
    };
}

describe('SdkSessionBackend (IN-3 cycle 5)', () => {
    let manager;

    beforeEach(() => {
        manager = makeManager();
    });

    it('starts the manager and adopts its session id', async () => {
        const backend = await SdkSessionBackend.start(manager);

        expect(manager.started, 'manager was never started').to.equal(1);
        expect(backend.sessionId).to.equal('copilot-session-1');
    });

    /**
     * A backend with no id cannot be routed to — `session/new` would hand the
     * client a handle that no later request could resolve. Failing here is the
     * only honest outcome.
     */
    it('refuses to exist when the manager produced no session id', async () => {
        const idless = makeManager({ getSessionId: () => null });

        let error;
        try {
            await SdkSessionBackend.start(idless);
        } catch (e) {
            error = e;
        }

        expect(error, 'an id-less backend must not be returned').to.be.an('error');
        expect(String(error.message)).to.match(/session id/i);
    });

    it('forwards streaming deltas as typed message events', async () => {
        const backend = await SdkSessionBackend.start(manager);
        const seen = [];

        backend.onEvent(e => seen.push(e));
        manager.emitDelta('four');
        manager.emitDelta(', obviously');

        expect(seen.map(e => e.kind)).to.deep.equal(['message', 'message']);
        expect(seen.map(e => e.deltaContent)).to.deep.equal(['four', ', obviously']);
    });

    /**
     * The agent subscribes per turn and unsubscribes in a `finally`. That contract
     * only holds if the returned function actually disposes the underlying emitter
     * subscription — returning a no-op would leak silently.
     */
    it('returns an unsubscribe that disposes the emitter subscription', async () => {
        const backend = await SdkSessionBackend.start(manager);
        const seen = [];

        const off = backend.onEvent(e => seen.push(e));
        manager.emitDelta('heard');
        off();
        manager.emitDelta('not heard');

        expect(seen.map(e => e.deltaContent)).to.deep.equal(['heard']);
        expect(manager.liveListeners(), 'emitter subscription outlived unsubscribe').to.equal(0);
        // One unsubscribe must release EVERY emitter it subscribed, not just the
        // first — a partial release shows up as duplicated chunks turns later.
        expect(manager.disposedSubscriptions, 'not all emitter subscriptions were released').to.equal(8);
    });

    it('sends a prompt through the manager and reports the turn ended', async () => {
        const backend = await SdkSessionBackend.start(manager);

        const res = await backend.prompt('what is 2+2?');

        expect(manager.sent).to.deep.equal(['what is 2+2?']);
        expect(res.stopReason).to.equal('end_turn');
    });

    it('propagates a send failure rather than reporting a completed turn', async () => {
        const failing = makeManager({
            sendMessage: async () => { throw new Error('connection closed'); }
        });
        const backend = await SdkSessionBackend.start(failing);

        let error;
        try {
            await backend.prompt('hi');
        } catch (e) {
            error = e;
        }

        expect(error, 'a failed send must not resolve as end_turn').to.be.an('error');
        expect(String(error.message)).to.match(/connection closed/);
    });
});

/**
 * Mode support (IN-3, unblocks the ticket's plan-mode assertions 3/4a/4b/5).
 *
 * ACP models modes generically — `SetSessionModeRequest` is `{ sessionId, modeId }`
 * and `SessionMode` is `{ id, name, description? }`. Our manager has exactly two,
 * `'work' | 'plan'`, reached through `enablePlanMode()` / `disablePlanMode()`
 * rather than a single setter, so the backend is where that impedance is absorbed.
 */
describe('SdkSessionBackend — modes (IN-3)', () => {
    function makeModalManager(over = {}) {
        const base = makeManager(over);
        return Object.assign(base, {
            mode: 'work',
            planCalls: [],
            getCurrentMode() { return this.mode; },
            async enablePlanMode() { this.planCalls.push('enable'); this.mode = 'plan'; },
            async disablePlanMode() { this.planCalls.push('disable'); this.mode = 'work'; },
            ...over
        });
    }

    it('reports the mode the manager is actually in', async () => {
        const m = makeModalManager();
        const backend = await SdkSessionBackend.start(m);

        expect(backend.currentModeId).to.equal('work');
        m.mode = 'plan';
        expect(backend.currentModeId, 'must read through, not cache').to.equal('plan');
    });

    it('enables plan mode when asked for the plan mode id', async () => {
        const m = makeModalManager();
        const backend = await SdkSessionBackend.start(m);

        await backend.setMode('plan');

        expect(m.planCalls).to.deep.equal(['enable']);
        expect(backend.currentModeId).to.equal('plan');
    });

    it('leaves plan mode when asked for work', async () => {
        const m = makeModalManager({ mode: 'plan' });
        const backend = await SdkSessionBackend.start(m);

        await backend.setMode('work');

        expect(m.planCalls).to.deep.equal(['disable']);
        expect(backend.currentModeId).to.equal('work');
    });

    /**
     * Re-entering the mode you are already in must not re-run the transition:
     * enablePlanMode() creates a second SDK session, so calling it twice would
     * strand one. Idempotence here is not tidiness, it is a leak guard.
     */
    it('does nothing when already in the requested mode', async () => {
        const m = makeModalManager();
        const backend = await SdkSessionBackend.start(m);

        await backend.setMode('work');

        expect(m.planCalls, 'a no-op transition still touched the manager').to.be.empty;
    });

    it('rejects a mode id it does not have, naming it', async () => {
        const m = makeModalManager();
        const backend = await SdkSessionBackend.start(m);

        let error;
        try { await backend.setMode('turbo'); } catch (e) { error = e; }

        expect(error, 'an unknown mode must not silently succeed').to.be.an('error');
        expect(String(error.message)).to.include('turbo');
        expect(m.planCalls).to.be.empty;
    });
});
