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
const fs = require('fs');

describe('SDKSessionManager — plan_mode_enabled carries the plan session id', function () {
    this.timeout(10000);

    let SDKSessionManager, source;
    before(function () {
        SDKSessionManager = require(path.join(__dirname, '../../..', 'out', 'sdkSessionManager.js')).SDKSessionManager;
        source = fs.readFileSync(path.join(__dirname, '../../..', 'src', 'sdkSessionManager.ts'), 'utf8');
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

    /**
     * A behavioural test cannot reach `enablePlanMode` without a live CLI, so this pins
     * the one thing that would silently break the contract: the emit going back inline
     * without the id. It asserts the ABSENCE of the old payload-free call, which is the
     * shape that regressed, not the presence of a string.
     */
    it('has no payload-free plan_mode_enabled emit left in the source', function () {
        assert.ok(
            !/fire\(\{\s*status:\s*'plan_mode_enabled'\s*\}\)/.test(source),
            'a plan_mode_enabled event is being fired without the plan session id'
        );
    });
});
