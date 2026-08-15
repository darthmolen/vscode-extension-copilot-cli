/**
 * The `withoutVscode` test helper itself.
 *
 * The helper bans the `vscode` module for the duration of a callback so tests
 * can prove a module has no runtime dependency on it. If the ban is lifted
 * early the helper silently stops testing anything, so the helper needs its
 * own coverage.
 *
 * Raised in review of PR #40: a `try/finally` around `fn()` restores
 * `Module.prototype.require` as soon as `fn` RETURNS — which, for an async
 * callback, is before its body has finished running.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const Module = require('module');
const { withoutVscode } = require('../../helpers/without-vscode');

/** Resolves true when `require('vscode')` is currently banned. */
function vscodeIsBanned() {
    try {
        require('vscode');
        return false;
    } catch (e) {
        return e.code === 'MODULE_NOT_FOUND';
    }
}

describe('withoutVscode helper', () => {
    it('bans the vscode module inside a synchronous callback', () => {
        const banned = withoutVscode(() => vscodeIsBanned());

        expect(banned).to.equal(true);
    });

    it('keeps the ban in force across an await inside an async callback', async () => {
        const bannedAfterAwait = await withoutVscode(async () => {
            await new Promise(resolve => setImmediate(resolve));
            return vscodeIsBanned();
        });

        expect(bannedAfterAwait).to.equal(true);
    });

    it('restores the original require once a synchronous callback returns', () => {
        const before = Module.prototype.require;

        withoutVscode(() => 'done');

        expect(Module.prototype.require).to.equal(before);
    });

    it('restores the original require only after an async callback settles', async () => {
        const before = Module.prototype.require;

        await withoutVscode(async () => {
            await new Promise(resolve => setImmediate(resolve));
        });

        expect(Module.prototype.require).to.equal(before);
    });

    it('restores the original require when the callback throws', () => {
        const before = Module.prototype.require;

        expect(() => withoutVscode(() => { throw new Error('boom'); })).to.throw('boom');
        expect(Module.prototype.require).to.equal(before);
    });

    it('restores the original require when an async callback rejects', async () => {
        const before = Module.prototype.require;

        let rejected = false;
        try {
            await withoutVscode(async () => { throw new Error('boom'); });
        } catch (e) {
            rejected = e.message === 'boom';
        }

        expect(rejected).to.equal(true);
        expect(Module.prototype.require).to.equal(before);
    });
});
