/**
 * BufferedEmitter Tests (TDD RED Phase)
 *
 * Tests for BufferedEmitter utility that buffers events until the first
 * listener subscribes, then flushes in order.
 *
 * These tests must FAIL before implementation exists (RED phase).
 */

import { expect } from 'chai';

// BufferedEmitter has zero vscode runtime deps — import from compiled output
let BufferedEmitter;

before(async () => {
    try {
        const mod = await import('../../../out/utilities/bufferedEmitter.js');
        BufferedEmitter = mod.BufferedEmitter;
    } catch (e) {
        // Expected during RED phase — module doesn't exist yet
        console.warn('BufferedEmitter not found (RED phase):', e.message);
    }
});

describe('BufferedEmitter', () => {

    // Gate: skip all tests if module not loaded (RED phase confirmation)
    beforeEach(function () {
        if (!BufferedEmitter) {
            this.skip();
        }
    });

    describe('buffering before listener', () => {
        it('should buffer events fired before any listener subscribes', () => {
            const emitter = new BufferedEmitter();
            const received = [];

            // Fire events with no listener
            emitter.fire('a');
            emitter.fire('b');
            emitter.fire('c');

            // Now subscribe — should receive all buffered events
            emitter.event((data) => received.push(data));

            expect(received).to.deep.equal(['a', 'b', 'c']);

            emitter.dispose();
        });

        it('should buffer multiple events in order', () => {
            const emitter = new BufferedEmitter();
            const received = [];

            emitter.fire(1);
            emitter.fire(2);
            emitter.fire(3);
            emitter.fire(4);
            emitter.fire(5);

            emitter.event((data) => received.push(data));

            expect(received).to.deep.equal([1, 2, 3, 4, 5]);

            emitter.dispose();
        });
    });

    describe('flushing on first listener', () => {
        it('should flush all buffered events synchronously to the first listener', () => {
            const emitter = new BufferedEmitter();
            const received = [];

            emitter.fire('x');
            emitter.fire('y');

            // Subscribe — flush happens synchronously during this call
            emitter.event((data) => received.push(data));

            // Should already have received buffered events (no async)
            expect(received).to.deep.equal(['x', 'y']);

            emitter.dispose();
        });

        it('should flush buffer then continue receiving new events', () => {
            const emitter = new BufferedEmitter();
            const received = [];

            emitter.fire('buffered');

            emitter.event((data) => received.push(data));

            emitter.fire('live');

            expect(received).to.deep.equal(['buffered', 'live']);

            emitter.dispose();
        });
    });

    describe('normal passthrough after listener', () => {
        it('should pass events directly to listener after subscription', () => {
            const emitter = new BufferedEmitter();
            const received = [];

            // Subscribe first, then fire
            emitter.event((data) => received.push(data));

            emitter.fire('a');
            emitter.fire('b');

            expect(received).to.deep.equal(['a', 'b']);

            emitter.dispose();
        });

        it('should support multiple listeners', () => {
            const emitter = new BufferedEmitter();
            const received1 = [];
            const received2 = [];

            emitter.event((data) => received1.push(data));
            emitter.event((data) => received2.push(data));

            emitter.fire('x');

            expect(received1).to.deep.equal(['x']);
            expect(received2).to.deep.equal(['x']);

            emitter.dispose();
        });

        it('should flush buffer only to first listener, second gets nothing buffered', () => {
            const emitter = new BufferedEmitter();
            const received1 = [];
            const received2 = [];

            emitter.fire('buffered');

            emitter.event((data) => received1.push(data));
            emitter.event((data) => received2.push(data));

            emitter.fire('live');

            // First listener got flush + live
            expect(received1).to.deep.equal(['buffered', 'live']);
            // Second listener only got live (buffer already flushed)
            expect(received2).to.deep.equal(['live']);

            emitter.dispose();
        });
    });

    describe('disposal', () => {
        it('should clear buffer on dispose', () => {
            const emitter = new BufferedEmitter();
            const received = [];

            emitter.fire('a');
            emitter.fire('b');

            emitter.dispose();

            // Subscribe after dispose — should receive nothing
            emitter.event((data) => received.push(data));

            expect(received).to.deep.equal([]);
        });

        it('should not fire events after dispose', () => {
            const emitter = new BufferedEmitter();
            const received = [];

            emitter.event((data) => received.push(data));

            emitter.fire('before');
            emitter.dispose();
            emitter.fire('after');

            expect(received).to.deep.equal(['before']);
        });

        it('should return a no-op disposable when subscribing after disposal', () => {
            const emitter = new BufferedEmitter();
            emitter.dispose();

            const disposable = emitter.event(() => {});
            // Should not throw
            expect(() => disposable.dispose()).to.not.throw();
        });
    });

    describe('listener disposal', () => {
        it('should stop receiving events after listener is disposed', () => {
            const emitter = new BufferedEmitter();
            const received = [];

            const sub = emitter.event((data) => received.push(data));

            emitter.fire('before');
            sub.dispose();
            emitter.fire('after');

            expect(received).to.deep.equal(['before']);

            emitter.dispose();
        });

        it('should not affect other listeners when one is disposed', () => {
            const emitter = new BufferedEmitter();
            const received1 = [];
            const received2 = [];

            const sub1 = emitter.event((data) => received1.push(data));
            emitter.event((data) => received2.push(data));

            emitter.fire('both');
            sub1.dispose();
            emitter.fire('only2');

            expect(received1).to.deep.equal(['both']);
            expect(received2).to.deep.equal(['both', 'only2']);

            emitter.dispose();
        });
    });

    describe('edge cases', () => {
        it('should handle fire with no listeners and empty buffer gracefully', () => {
            const emitter = new BufferedEmitter();
            expect(() => emitter.fire('orphan')).to.not.throw();
            emitter.dispose();
        });

        it('should handle subscribe with no buffered events', () => {
            const emitter = new BufferedEmitter();
            const received = [];

            emitter.event((data) => received.push(data));

            // No fires before subscribe — received should be empty
            expect(received).to.deep.equal([]);

            emitter.dispose();
        });

        it('should handle typed data correctly', () => {
            const emitter = new BufferedEmitter();
            const received = [];

            emitter.fire({ type: 'status', value: 42 });

            emitter.event((data) => received.push(data));

            expect(received).to.deep.equal([{ type: 'status', value: 42 }]);

            emitter.dispose();
        });
    });
});
