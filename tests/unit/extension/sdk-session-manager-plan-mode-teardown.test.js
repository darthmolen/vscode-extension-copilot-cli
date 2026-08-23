/**
 * SDKSessionManager.stop() — the dual-session teardown
 *
 * Plan mode is a deliberate two-session design: a plan session and a work session,
 * kept apart so planning never pollutes the work context. The streams do not cross,
 * which is the point.
 *
 * But teardown was asymmetric. In plan mode `this.session` IS the plan session —
 * `enablePlanMode()` ends with `setActiveSession(this.planSession)` — while the work
 * session is parked on `this.workSession`. `stop()` disconnected `this.session` and
 * nothing else, and `this.workSession` was assigned in six places and released in
 * none. Stopping while in plan mode therefore stranded the work session's SDK
 * connection.
 *
 * Every teardown path reaches this: handleSwitchSession, handleNewSession,
 * handleStopChat and deactivate all call stop() or dispose() and then drop the
 * manager.
 *
 * Prototype-called, because reaching stop() through start() would spawn a CLI.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { SDKSessionManager } = require(
    path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js')
);

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeSession(name, log) {
    return { name, async disconnect() { log.push(name); } };
}

/** The minimum `this` for a prototype-called stop(). */
function ctx(over = {}) {
    return {
        logger: silentLogger,
        _sessionSub: { value: undefined },
        session: null,
        workSession: null,
        planSession: null,
        sessionId: 'work-1',
        workSessionId: 'work-1',
        toolExecutions: new Map(),
        fileSnapshotService: { cleanupAllSnapshots() {} },
        _onDidChangeStatus: { fire() {} },
        clientProvider: { async stop() {} },
        ownsClientProvider: true,
        ...over
    };
}

describe('SDKSessionManager.stop() — plan-mode teardown', () => {
    it('disconnects the work session when stopped in work mode', async () => {
        const log = [];
        const work = makeSession('work', log);

        await SDKSessionManager.prototype.stop.call(ctx({ session: work, workSession: work }));

        expect(log).to.deep.equal(['work']);
    });

    /**
     * The leak. In plan mode `this.session` is the PLAN session, so disconnecting
     * only that leaves the work session connected with nothing left holding a
     * reference to it.
     */
    it('disconnects BOTH sessions when stopped while in plan mode', async () => {
        const log = [];
        const plan = makeSession('plan', log);
        const work = makeSession('work', log);

        await SDKSessionManager.prototype.stop.call(
            ctx({ session: plan, planSession: plan, workSession: work, currentMode: 'plan' })
        );

        expect(log.sort(), 'the work session was stranded').to.deep.equal(['plan', 'work']);
    });

    /** In work mode the two references are the same object; do not disconnect twice. */
    it('does not disconnect the same session twice', async () => {
        const log = [];
        const only = makeSession('only', log);

        await SDKSessionManager.prototype.stop.call(
            ctx({ session: only, workSession: only, planSession: only })
        );

        expect(log).to.deep.equal(['only']);
    });

    it('releases both references so a stopped manager holds no session', async () => {
        const log = [];
        const plan = makeSession('plan', log);
        const work = makeSession('work', log);
        const c = ctx({ session: plan, planSession: plan, workSession: work, currentMode: 'plan' });

        await SDKSessionManager.prototype.stop.call(c);

        expect(c.session, 'session still held').to.equal(null);
        expect(c.workSession, 'workSession still held — this is the leak').to.equal(null);
        expect(c.planSession, 'planSession still held').to.equal(null);
    });

    /**
     * A session that fails to disconnect must not prevent the other from being
     * released — otherwise one bad connection strands the good one too.
     */
    it('still releases the work session when the plan session fails to disconnect', async () => {
        const log = [];
        const work = makeSession('work', log);
        const plan = { name: 'plan', async disconnect() { throw new Error('already closed'); } };
        const c = ctx({ session: plan, planSession: plan, workSession: work, currentMode: 'plan' });

        await SDKSessionManager.prototype.stop.call(c);

        expect(log, 'a failing plan disconnect blocked the work one').to.deep.equal(['work']);
        expect(c.workSession).to.equal(null);
    });
});
