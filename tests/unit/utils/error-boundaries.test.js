/**
 * Error Boundaries Tests
 *
 * Tests the safeHandler utility used to wrap event handlers
 * with error boundaries in extension.ts.
 */

import { expect } from 'chai';

/**
 * Standalone safeHandler implementation for testing.
 * Mirrors the one in extension.ts but without the Logger dependency.
 */
function safeHandler(name, handler) {
    return (data) => {
        try {
            handler(data);
        } catch (error) {
            // In production this logs via Logger; in tests we just swallow
            safeHandler._lastError = { name, error };
        }
    };
}
safeHandler._lastError = null;

describe('safeHandler utility', () => {

    beforeEach(() => {
        safeHandler._lastError = null;
    });

    it('should call the handler normally when no error occurs', () => {
        const received = [];
        const wrapped = safeHandler('test', (data) => received.push(data));

        wrapped('hello');
        wrapped('world');

        expect(received).to.deep.equal(['hello', 'world']);
    });

    it('should pass data through to the handler', () => {
        let capturedData;
        const wrapped = safeHandler('test', (data) => { capturedData = data; });

        const testData = { type: 'status', value: 42 };
        wrapped(testData);

        expect(capturedData).to.deep.equal(testData);
    });

    it('should catch errors and not rethrow', () => {
        const wrapped = safeHandler('throwHandler', () => {
            throw new Error('handler exploded');
        });

        // Should NOT throw
        expect(() => wrapped('data')).to.not.throw();
    });

    it('should record the error context when handler throws', () => {
        const wrapped = safeHandler('myHandler', () => {
            throw new Error('boom');
        });

        wrapped('trigger');

        expect(safeHandler._lastError).to.exist;
        expect(safeHandler._lastError.name).to.equal('myHandler');
        expect(safeHandler._lastError.error.message).to.equal('boom');
    });

    it('should continue working after an error', () => {
        let callCount = 0;
        const wrapped = safeHandler('counter', () => {
            callCount++;
            if (callCount === 2) {
                throw new Error('second call fails');
            }
        });

        wrapped('1st');  // succeeds
        wrapped('2nd');  // throws but caught
        wrapped('3rd');  // succeeds

        expect(callCount).to.equal(3);
    });

    it('should handle non-Error throws (string, number)', () => {
        const wrappedString = safeHandler('strThrow', () => {
            throw 'string error';  // eslint-disable-line no-throw-literal
        });
        const wrappedNumber = safeHandler('numThrow', () => {
            throw 42;  // eslint-disable-line no-throw-literal
        });

        expect(() => wrappedString('data')).to.not.throw();
        expect(() => wrappedNumber('data')).to.not.throw();
    });
});
