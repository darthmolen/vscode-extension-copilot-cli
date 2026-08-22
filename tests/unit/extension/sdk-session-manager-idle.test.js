/**
 * SDKSessionManager — `onDidBecomeIdle` (asked for by Lane B, cross-talk 03).
 *
 * P3 winds an orphaned host's session down at the next idle, so a chat tab closed
 * during the day does not leave a live CLI session with no UI. Lane B settled for
 * turn status (`assistant.turn_start` / `turn_end`) because `sdkSessionManager.ts` is
 * Lane A's file — and that is weaker in a specific way: a turn ending is not the
 * session being quiet. **The gap is background agents and attached shell commands**,
 * so a tab closed while a sub-agent runs can wind down before that sub-agent finishes.
 *
 * `session.idle` has the contract they want — *"idle with no background agents or
 * attached shell commands in flight"*. It arrives at `sdkSessionManager.ts:997` and
 * was only logged.
 *
 * ## Why this emitter must not buffer
 *
 * Every other event on this manager uses `BufferedEmitter`, which holds events fired
 * before anyone subscribed and **flushes them to the first listener**. That is right
 * for transcript content, which a late webview still needs.
 *
 * It is wrong here, and dangerously so. Idle is a **transition, not a state** — it
 * fires at the end of every turn and is `ephemeral: true`, never written to the event
 * log. A consumer that arms a countdown on it would, on subscribing, receive a burst
 * of idles from turns that ended minutes ago and wind down a session that is busy
 * right now. A replayed signal is a lie about the present.
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

const ROOT = path.join(__dirname, '../../..');

describe('SignalEmitter — a transition, never replayed', () => {
    let SignalEmitter;
    before(function () {
        ({ SignalEmitter } = require(path.join(ROOT, 'out', 'utilities', 'signalEmitter.js')));
    });

    it('delivers to a listener that is already attached', () => {
        const e = new SignalEmitter();
        const seen = [];
        e.event(() => seen.push('fired'));

        e.fire();

        assert.deepStrictEqual(seen, ['fired']);
    });

    /** The whole point. `BufferedEmitter` would deliver all three. */
    it('does not replay signals fired before anyone subscribed', () => {
        const e = new SignalEmitter();
        e.fire(); e.fire(); e.fire();

        const seen = [];
        e.event(() => seen.push('fired'));

        assert.deepStrictEqual(seen, [], 'a late subscriber was told about the past');
    });

    it('delivers each subsequent signal, because it is not a latch', () => {
        const e = new SignalEmitter();
        const seen = [];
        e.event(() => seen.push('fired'));

        e.fire(); e.fire();

        assert.strictEqual(seen.length, 2);
    });

    it('stops delivering once the subscription is disposed', () => {
        const e = new SignalEmitter();
        const seen = [];
        const sub = e.event(() => seen.push('fired'));

        sub.dispose();
        e.fire();

        assert.deepStrictEqual(seen, []);
    });

    /**
     * A listener may unsubscribe while being notified — a wind-down consumer cancels
     * itself on the idle it was waiting for. Iterating the live array would then skip
     * whoever came after it, silently.
     */
    it('still reaches later listeners when one unsubscribes mid-fire', () => {
        const e = new SignalEmitter();
        const seen = [];
        const first = e.event(() => { seen.push('first'); first.dispose(); });
        e.event(() => seen.push('second'));

        e.fire();

        assert.deepStrictEqual(seen, ['first', 'second'], 'a listener was skipped');
    });

    /** One listener throwing must not rob the others — this rides the SDK event pump. */
    it('delivers to every listener even if one throws', () => {
        const e = new SignalEmitter();
        const seen = [];
        e.event(() => { throw new Error('consumer blew up'); });
        e.event(() => seen.push('second'));

        assert.doesNotThrow(() => e.fire());
        assert.deepStrictEqual(seen, ['second']);
    });
});

describe('SDKSessionManager — session.idle reaches onDidBecomeIdle', function () {
    this.timeout(10000);

    let SDKSessionManager;
    before(function () {
        SDKSessionManager = require(path.join(ROOT, 'out', 'sdkSessionManager.js')).SDKSessionManager;
    });

    let fired, errors;
    function context(over = {}) {
        return Object.assign(Object.create(SDKSessionManager.prototype), {
            logger: { info() {}, warn() {}, error: m => errors.push(m), debug() {} },
            _onDidBecomeIdle: { fire: () => fired.push('idle') },
            ...over
        });
    }
    const send = (ctx, event) => SDKSessionManager.prototype._handleSDKEvent.call(ctx, event);

    beforeEach(function () { fired = []; errors = []; });

    it('fires when the session goes idle', function () {
        send(context(), { type: 'session.idle', data: {} });

        assert.deepStrictEqual(errors, [], 'the handler errored');
        assert.deepStrictEqual(fired, ['idle']);
    });

    it('fires on every idle, because it is a transition and not a state', function () {
        const ctx = context();

        send(ctx, { type: 'session.idle', data: {} });
        send(ctx, { type: 'session.idle', data: {} });

        assert.strictEqual(fired.length, 2);
    });

    /**
     * `session.idle` carries an optional `agentId`. A sub-agent's session going quiet
     * is not the session going quiet — and forwarding it would fire the wind-down
     * while the sub-agent's parent is still working, which is the precise failure
     * Lane B is trying to escape by moving off turn status.
     */
    it('ignores a sub-agent going idle', function () {
        send(context(), { type: 'session.idle', data: {}, agentId: 'sub-1' });

        assert.deepStrictEqual(fired, [], 'a sub-agent idle was reported as the session being quiet');
    });

    /**
     * Pins the emitter CHOICE, not just the wiring. Every test above uses a stub for
     * `_onDidBecomeIdle`, so swapping the real emitter to a `BufferedEmitter` would
     * leave them all green while reintroducing exactly the replay this exists to
     * prevent. This one drives the real one.
     */
    it('does not replay past idles to a consumer that subscribes later', function () {
        const { SignalEmitter } = require(path.join(ROOT, 'out', 'utilities', 'signalEmitter.js'));
        const emitter = new SignalEmitter();
        const ctx = context({ _onDidBecomeIdle: emitter });

        send(ctx, { type: 'session.idle', data: {} });
        send(ctx, { type: 'session.idle', data: {} });

        const seen = [];
        emitter.event(() => seen.push('idle'));

        assert.deepStrictEqual(seen, [],
            'a late consumer was told about idles from turns that already ended');

        send(ctx, { type: 'session.idle', data: {} });
        assert.deepStrictEqual(seen, ['idle'], 'the next real idle did not arrive');
    });

    /**
     * The one above injects its own emitter, so it proves the manager *uses* what it
     * is given and says nothing about what it *builds*. A real instance is the only
     * thing that pins the choice — swap `SignalEmitter` for `BufferedEmitter` in the
     * field declaration and every other test here stays green.
     */
    it('builds a non-replaying emitter, not merely accepts one', function () {
        const { createFakeHost } = require('../../helpers/fake-host');
        const manager = new SDKSessionManager({}, false, undefined, undefined, createFakeHost());

        manager._handleSDKEvent({ type: 'session.idle', data: {} });
        manager._handleSDKEvent({ type: 'session.idle', data: {} });

        const seen = [];
        manager.onDidBecomeIdle(() => seen.push('idle'));

        assert.deepStrictEqual(seen, [],
            'the manager built a buffering emitter — a late consumer got the past');

        manager._handleSDKEvent({ type: 'session.idle', data: {} });
        assert.deepStrictEqual(seen, ['idle']);
    });

    it('still logs it, as it always did', function () {
        const logged = [];
        send(context({ logger: { info: m => logged.push(m), warn() {}, error: m => errors.push(m), debug() {} } }),
            { type: 'session.idle', data: {} });

        assert.ok(logged.some(l => /idle/i.test(l)), 'the log line went missing');
    });
});
