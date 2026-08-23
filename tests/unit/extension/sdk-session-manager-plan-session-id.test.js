/**
 * `plan_mode_enabled` publishes the plan session's id (asked for by Lane B, cross-talk 04).
 *
 * P4 writes a `session-pairing.json` **on the plan session**, pointing at its work
 * session — one writer, written once at creation. To write into the plan session's
 * directory, the writer needs that session's id.
 *
 * The id is derived here (`${workSessionId}-plan`) and was **never published**:
 * `plan_mode_enabled` fired with no payload. So `extension.ts` could only have written
 * the record by deriving the id from the suffix itself — which would make P4 a **third**
 * knower of the `-plan` convention, inside the very change whose purpose is to reduce
 * the count from two to one.
 *
 * That is the whole argument for this field, and it is worth stating in a test because
 * the field looks trivial and the reason it exists is not: **the cost of ever adopting
 * the CLI's native plan mode is however many places currently know what `-plan` means.**
 * Publishing it here keeps that number at one.
 */

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'vscode') { return require('../../helpers/vscode-mock'); }
    return originalRequire.apply(this, arguments);
};

const { describe, it, before, beforeEach } = require('mocha');
const assert = require('assert');
const path = require('path');

describe('SDKSessionManager — plan_mode_enabled carries the plan session id', function () {
    this.timeout(10000);

    let SDKSessionManager;
    before(function () {
        SDKSessionManager = require(path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js')).SDKSessionManager;
    });

    let fired;
    const context = (over = {}) => Object.assign(Object.create(SDKSessionManager.prototype), {
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        _onDidChangeStatus: { fire: e => fired.push(e) },
        ...over
    });

    beforeEach(function () { fired = []; });

    /**
     * `enablePlanMode` creates a real SDK session, so it is not callable here. What IS
     * callable is the emit itself — extracted so the payload is testable without a CLI,
     * which is the only part Lane B depends on.
     */
    it('announces plan mode with the id of the session it just created', function () {
        const ctx = context({ workSessionId: 'work-abc' });

        SDKSessionManager.prototype.announcePlanModeEnabled.call(ctx, 'work-abc-plan');

        assert.deepStrictEqual(fired, [{ status: 'plan_mode_enabled', planSessionId: 'work-abc-plan' }]);
    });

    /**
     * The consumer writes a file into a directory named by this value. An undefined id
     * would have it derive one from the suffix — which is the third knower this exists
     * to prevent — or write nothing at all.
     */
    it('never announces without one', function () {
        const ctx = context({ workSessionId: 'work-abc' });

        SDKSessionManager.prototype.announcePlanModeEnabled.call(ctx, undefined);

        assert.strictEqual(fired.length, 1);
        assert.ok(fired[0].planSessionId, 'announced plan mode with no plan session id');
    });

    // A third test lived here and read `src/sdkSessionManager.ts`, asserting no
    // payload-free `plan_mode_enabled` emit remained. It is gone rather than added to
    // `KNOWN_SOURCE_READERS`, because that list is debt and not a set of exemptions —
    // and because Lane B's gate had just been proved right by a source scan that
    // reported a field missing from an interface which plainly had it.
    //
    // What it guarded is real but narrow: someone bypassing `announcePlanModeEnabled`
    // with an inline fire, after which Lane B's record-writer silently stops writing.
    // `enablePlanMode` creates a live SDK session, so no behavioural test can reach it
    // from here. The residual risk is the ordinary one that any extracted method
    // carries — that a caller stops calling it — and we do not buy that guarantee with
    // source scans anywhere else.
    //
    // If it ever needs a real guard, the answer is the type system rather than a
    // regex: making `StatusData` a discriminated union would let `plan_mode_enabled`
    // *require* `planSessionId`, and a payload-free emit would not compile. That is a
    // larger change to a type Lane B reads through a local widening, so it is recorded
    // rather than done.
});
