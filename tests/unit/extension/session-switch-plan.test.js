/**
 * What switching to a session should actually do (v3.13.0 P3 §4.5)
 *
 * `handleSwitchSession` stopped the *global* manager — since Task 7, possibly
 * another surface's — and then started a **second** `SDKSessionManager` resuming
 * the same id. Two managers, one session directory.
 *
 * `ChatPanelService.openSession` already does the right thing: consult the
 * registry, reveal the surface that has it, otherwise attach. This is that rule
 * written down once, so the dropdown and the panel service cannot drift — the
 * recurring failure this cycle is one truth living in two places.
 *
 * The decision is separated from the doing so it can be tested from plain mocha:
 * `vscode`-free, like `planSessionStart` next to it.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { planSessionSwitch } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'sessionSwitchPlan.js')
);

/** The two members the decision reads. Nothing else is needed to make it. */
function fakeHost(surface) {
    return { handle: 'host#x', getSurface: () => surface };
}

describe('planSessionSwitch', () => {
    it('resumes from disk when this window has no host for the session', () => {
        const plan = planSessionSwitch('session-a', fakeHost({}), () => undefined);
        expect(plan.action).to.equal('resume');
    });

    it('reveals the surface already showing it — never steals', () => {
        // Stealing would blank a surface out from under whoever is looking at it,
        // and one-session-one-surface is the invariant the whole task rests on.
        const incumbent = fakeHost({ isASurface: true });
        const plan = planSessionSwitch('session-a', fakeHost({}), () => incumbent);

        expect(plan.action).to.equal('reveal');
        expect(plan.host).to.equal(incumbent);
    });

    it('reattaches to a host whose surface went away, rather than starting a second manager', () => {
        // A closed tab leaves its host alive on a wind-down countdown. Reselecting
        // its session from the dropdown is the only route back, so it must find the
        // host that is already there.
        const orphan = fakeHost(undefined);
        const plan = planSessionSwitch('session-a', fakeHost({}), () => orphan);

        expect(plan.action).to.equal('reattach');
        expect(plan.host).to.equal(orphan);
    });

    it('does nothing when the requester already is that session', () => {
        // Selecting the session you are already on must not stop and restart it.
        const self = fakeHost({ isASurface: true });
        const plan = planSessionSwitch('session-a', self, () => self);

        expect(plan.action).to.equal('already-here');
    });

    it('reveals rather than does-nothing when a *different* host holds it', () => {
        const other = fakeHost({ isASurface: true });
        const requester = fakeHost({ isAnotherSurface: true });
        const plan = planSessionSwitch('session-a', requester, (id) => id === 'session-a' ? other : undefined);

        expect(plan.action).to.equal('reveal');
        expect(plan.host).to.equal(other);
    });

    it('looks up the session it was asked about, and no other', () => {
        const asked = [];
        planSessionSwitch('session-b', fakeHost({}), (id) => { asked.push(id); return undefined; });
        expect(asked).to.deep.equal(['session-b']);
    });
});
