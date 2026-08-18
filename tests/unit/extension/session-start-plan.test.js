/**
 * C2 — a start request for a *specific* session must resume that session.
 *
 * `ChatSessionHost.ensureStarted()` computes `{ sessionId, resume }` and hands them
 * to `startManager`. Until this landed, `extension.ts` injected a zero-argument
 * closure that discarded both and called `resumeAndStartSession(context)`, so
 * opening or restoring a surface for session X resumed whatever the mtime
 * heuristic picked — or silently reused the window's manager for some *other*
 * session.
 *
 * `planSessionStart` is that decision, extracted so it can be driven from plain
 * mocha with no vscode.
 */

const assert = require('assert');
const { planSessionStart } = require('../../../out/extension/session/sessionStartPlan');

/** A stand-in for the window's SDKSessionManager. */
function running(sessionId) {
    return { isRunning: () => true, getSessionId: () => sessionId };
}
function stopped(sessionId) {
    return { isRunning: () => false, getSessionId: () => sessionId };
}

describe('planSessionStart()', function () {
    describe('no session was asked for — the ambient startup path', function () {
        it('consults the resume heuristic when nothing is running', function () {
            const plan = planSessionStart({}, null);
            assert.strictEqual(plan.reuseRunning, false);
            assert.strictEqual(plan.consultAmbient, true);
            assert.strictEqual(plan.requestedSessionId, undefined);
        });

        it('reuses the running session rather than starting a second', function () {
            const plan = planSessionStart({}, running('abc'));
            assert.strictEqual(plan.reuseRunning, true);
        });

        it('starts when the manager exists but has stopped', function () {
            const plan = planSessionStart({}, stopped('abc'));
            assert.strictEqual(plan.reuseRunning, false);
            assert.strictEqual(plan.consultAmbient, true);
        });

        it('treats an explicit null sessionId the same as none', function () {
            const plan = planSessionStart({ sessionId: null }, null);
            assert.strictEqual(plan.consultAmbient, true);
            assert.strictEqual(plan.requestedSessionId, undefined);
        });
    });

    describe('a brand-new session was asked for — New Tab', function () {
        it('never resumes anything, whatever the heuristic would have picked', function () {
            const plan = planSessionStart({ fresh: true }, null);
            assert.strictEqual(plan.reuseRunning, false);
            assert.strictEqual(plan.requestedSessionId, undefined);
            assert.strictEqual(plan.consultAmbient, false,
                'the gesture said *new* — resumeLastSession does not get a vote');
            assert.strictEqual(plan.fresh, true);
        });

        it('does not hand back the session already running in this window', function () {
            const plan = planSessionStart({ fresh: true }, running('the-sidebar-session'));
            assert.strictEqual(plan.reuseRunning, false,
                'reusing here would put the sidebar\'s conversation in the new tab');
            assert.strictEqual(plan.fresh, true);
        });

        it('is not fresh when the ambient path is taken', function () {
            assert.strictEqual(planSessionStart({}, null).fresh, false);
            assert.strictEqual(planSessionStart({ sessionId: 'x' }, null).fresh, false);
        });
    });

    describe('a specific session was asked for — a stated intent', function () {
        it('resumes that session, and never asks the heuristic', function () {
            const plan = planSessionStart({ sessionId: 'wanted' }, null);
            assert.strictEqual(plan.reuseRunning, false);
            assert.strictEqual(plan.requestedSessionId, 'wanted');
            assert.strictEqual(plan.consultAmbient, false,
                'a named session is an intent — the mtime heuristic must not override it');
        });

        it('restores a specific stopped session', function () {
            const plan = planSessionStart({ sessionId: 'wanted' }, stopped('wanted'));
            assert.strictEqual(plan.reuseRunning, false);
            assert.strictEqual(plan.requestedSessionId, 'wanted');
            assert.strictEqual(plan.consultAmbient, false);
        });

        it('reuses the running manager when it is already that session', function () {
            const plan = planSessionStart({ sessionId: 'wanted' }, running('wanted'));
            assert.strictEqual(plan.reuseRunning, true);
        });

        it('does NOT reuse a manager running some OTHER session', function () {
            const plan = planSessionStart({ sessionId: 'wanted' }, running('somethingElse'));
            assert.strictEqual(plan.reuseRunning, false,
                'reusing here hands the caller the wrong session\'s manager — the C2 defect');
            assert.strictEqual(plan.requestedSessionId, 'wanted');
            assert.strictEqual(plan.consultAmbient, false);
        });

        it('does not reuse a running manager that has no id yet', function () {
            const plan = planSessionStart({ sessionId: 'wanted' }, running(null));
            assert.strictEqual(plan.reuseRunning, false);
            assert.strictEqual(plan.requestedSessionId, 'wanted');
        });
    });
});
