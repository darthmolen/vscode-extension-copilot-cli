/**
 * forkCurrentSession — the fork command's decision logic
 *
 * S1 cycle 7. This lived inside `handleForkSession` in extension.ts, reaching
 * for three module-level globals (`sessionManager`, `logger`, `vscode.window`)
 * and a module-private `handleSwitchSession`. It had no signature, so it had no
 * tests — and the first attempt at testing it regexed the source, which
 * CLAUDE.md bans for good reason.
 *
 * Giving it an explicit dependency signature is what made it testable. These
 * tests need no vscode mock at all.
 */

const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { forkCurrentSession } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'commands', 'forkSession.js')
);

/** Records everything the command did, so tests assert on effects. */
function makeDeps(over = {}) {
    const calls = { info: [], warn: [], error: [], switched: [], forked: [] };
    return {
        calls,
        deps: {
            getSessionId: () => 'parent-1',
            fork: async (sessionId, opts) => {
                calls.forked.push({ sessionId, opts });
                return 'forked-1';
            },
            switchTo: async id => { calls.switched.push(id); },
            notify: {
                info: m => calls.info.push(m),
                warn: m => calls.warn.push(m),
                error: m => calls.error.push(m)
            },
            logger: { debug() {}, info() {}, warn() {}, error() {} },
            sessionStateDir: '/tmp/session-state',
            ...over
        }
    };
}

describe('forkCurrentSession', () => {
    let ctx;

    beforeEach(() => {
        ctx = makeDeps();
    });

    it('forks the current session and switches to the fork', async () => {
        await forkCurrentSession(ctx.deps);

        expect(ctx.calls.forked).to.have.lengthOf(1);
        expect(ctx.calls.forked[0].sessionId).to.equal('parent-1');
        expect(ctx.calls.forked[0].opts).to.deep.equal({ sessionStateDir: '/tmp/session-state' });
        expect(ctx.calls.switched).to.deep.equal(['forked-1']);
    });

    it('tells the user the fork succeeded', async () => {
        await forkCurrentSession(ctx.deps);

        expect(ctx.calls.info).to.have.lengthOf(1);
        expect(ctx.calls.info[0]).to.match(/fork/i);
        expect(ctx.calls.error).to.be.empty;
    });

    it('warns and does nothing when there is no active session', async () => {
        const noSession = makeDeps({ getSessionId: () => null });

        await forkCurrentSession(noSession.deps);

        expect(noSession.calls.warn).to.have.lengthOf(1);
        expect(noSession.calls.warn[0]).to.match(/no active session/i);
        expect(noSession.calls.forked, 'must not fork without a session').to.be.empty;
        expect(noSession.calls.switched, 'must not switch').to.be.empty;
    });

    it('reports the error and stays on the parent when forking fails', async () => {
        const failing = makeDeps({
            fork: async () => { throw new Error('CLI refused'); }
        });

        await forkCurrentSession(failing.deps);

        expect(failing.calls.error).to.have.lengthOf(1);
        expect(failing.calls.error[0]).to.match(/CLI refused/);
        expect(failing.calls.switched, 'must not switch after a failed fork').to.be.empty;
    });

    it('does not swallow a failure as success', async () => {
        const failing = makeDeps({
            fork: async () => { throw new Error('CLI refused'); }
        });

        await forkCurrentSession(failing.deps);

        expect(failing.calls.info, 'reported success despite failing').to.be.empty;
    });

    it('surfaces a switch failure rather than claiming success', async () => {
        const badSwitch = makeDeps({
            switchTo: async () => { throw new Error('session vanished'); }
        });

        await forkCurrentSession(badSwitch.deps);

        expect(badSwitch.calls.error).to.have.lengthOf(1);
        expect(badSwitch.calls.error[0]).to.match(/session vanished/);
        expect(badSwitch.calls.info).to.be.empty;
    });
});
