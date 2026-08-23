/**
 * Moving a session between surfaces is a transfer, not a collision (v3.13.0 review, PR #49)
 *
 * *Move Chat Back to Sidebar* was implemented as `handleSwitchSession(sessionId, sidebarSurface)`.
 * That runs the collision rule: the tab's host holds the session **and has a surface**, so
 * `planSessionSwitch` correctly answers `reveal` — and the command then revealed the tab it was
 * asked to close, showed "already open in another chat", and disposed the tab. The sidebar never
 * adopted anything. **The feature never worked.**
 *
 * The collision rule was not wrong; it was asked the wrong question. "Show me session X" and
 * "move session X to this surface" have different right answers when another surface holds it —
 * reveal for the first, transfer for the second — and routing the second through the first is how
 * a reveal ends up disposing its own target.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { planSessionTransfer } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'session', 'sessionSwitchPlan.js')
);

function host(name, surface) {
    return { handle: name, getSurface: () => surface };
}

describe('planSessionTransfer', () => {
    it('moves the host off its current surface and onto the destination', () => {
        const tabHost = host('host#2', { tab: true });
        const plan = planSessionTransfer('session-a', host('host#1', { sidebar: true }), () => tabHost);

        expect(plan.action).to.equal('transfer');
        expect(plan.host).to.equal(tabHost);
    });

    it('refuses when the destination already holds it — there is nothing to move', () => {
        const self = host('host#1', { sidebar: true });
        const plan = planSessionTransfer('session-a', self, () => self);

        expect(plan.action).to.equal('already-here');
    });

    it('transfers a host whose surface has already gone, rather than resuming a second copy', () => {
        // A closed tab winding down. The session is live; it just has nowhere to draw.
        const orphan = host('host#2', undefined);
        const plan = planSessionTransfer('session-a', host('host#1', {}), () => orphan);

        expect(plan.action).to.equal('transfer');
        expect(plan.host).to.equal(orphan);
    });

    it('falls back to resuming when this window has no host for the session', () => {
        const plan = planSessionTransfer('session-a', host('host#1', {}), () => undefined);
        expect(plan.action).to.equal('resume');
    });

    it('never answers `reveal` — revealing is what broke the command', () => {
        const plans = [
            planSessionTransfer('a', host('h1', {}), () => host('h2', {})),
            planSessionTransfer('a', host('h1', {}), () => host('h2', undefined)),
            planSessionTransfer('a', host('h1', {}), () => undefined)
        ];
        expect(plans.map(p => p.action)).to.not.include('reveal');
    });

    it('leaves the switch planner alone — showing a session still reveals its surface', () => {
        const { planSessionSwitch } = require(
            path.join(__dirname, '../../..', 'out', 'extension', 'session', 'sessionSwitchPlan.js')
        );
        const other = host('host#2', { tab: true });
        expect(planSessionSwitch('a', host('host#1', {}), () => other).action).to.equal('reveal');
    });
});
