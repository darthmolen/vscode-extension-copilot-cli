/**
 * v3.13.0 Task 7 phase 4 — a tab remembers which session it was showing.
 *
 * `registerWebviewPanelSerializer` is what makes a chat tab survive a window
 * reload, and it restores whatever the *webview* saved with `setState`. The
 * extension cannot write that itself, so the webview records the session id it is
 * already told on init.
 *
 * The state channel is shared — the sub-agent dock's minimized flag lives there
 * too — so this merges rather than replaces. Overwriting it would silently reset
 * an unrelated preference every time a session started.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');

let rememberSessionId;

before(async () => {
    ({ rememberSessionId } = await import(
        '../../../src/webview/app/state/surfaceSessionState.js'
    ));
});

/** A stand-in for the object `acquireVsCodeApi()` returns. */
function fakeVscodeApi(initial = {}) {
    let stored = initial;
    return {
        getState: () => stored,
        setState: (next) => { stored = next; },
        read: () => stored
    };
}

describe('rememberSessionId()', () => {
    it('records the session so a restored tab knows what to reopen', () => {
        const api = fakeVscodeApi();

        rememberSessionId(api, 'session-abc');

        expect(api.read().sessionId).to.equal('session-abc');
    });

    it('keeps everything else already in the state channel', () => {
        const api = fakeVscodeApi({ subagentDockMinimized: true });

        rememberSessionId(api, 'session-abc');

        expect(api.read()).to.deep.equal({ subagentDockMinimized: true, sessionId: 'session-abc' });
    });

    it('clears the id when a surface has no session yet', () => {
        // A fresh tab is initialised before its CLI session has an id. Leaving a
        // stale one behind would restore the previous conversation into it.
        const api = fakeVscodeApi({ sessionId: 'from-before' });

        rememberSessionId(api, null);

        expect(api.read().sessionId).to.equal(null);
    });

    it('survives a host with no state channel at all', () => {
        // Some test harnesses and older webview hosts have no setState.
        expect(() => rememberSessionId(undefined, 'x')).to.not.throw();
        expect(() => rememberSessionId({}, 'x')).to.not.throw();
    });

    it('treats a null state channel as an empty one', () => {
        const api = { getState: () => null, setState(next) { this.stored = next; } };

        rememberSessionId(api, 'session-abc');

        expect(api.stored).to.deep.equal({ sessionId: 'session-abc' });
    });
});
