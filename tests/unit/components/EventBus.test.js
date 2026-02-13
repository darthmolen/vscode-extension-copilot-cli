/**
 * EventBus Component Tests
 * 
 * Test the lightweight pub/sub EventBus for component communication.
 * 
 * TDD: RED phase - these tests should FAIL until EventBus is implemented.
 */

import { expect } from 'chai';
import { JSDOM } from 'jsdom';

// Setup DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;

describe('EventBus', () => {
    let EventBus;
    let eventBus;

    before(async () => {
        // Dynamic import of EventBus (will fail until created)
        const module = await import('../../../src/webview/app/state/EventBus.js');
        EventBus = module.EventBus;
    });

    beforeEach(() => {
        eventBus = new EventBus();
    });

    describe('Basic pub/sub', () => {
        it('should create an EventBus instance', () => {
            expect(eventBus).to.exist;
            expect(eventBus).to.be.instanceOf(EventBus);
        });

        it('should subscribe to events and receive emitted data', () => {
            let receivedData = null;
            
            eventBus.on('test:event', (data) => {
                receivedData = data;
            });
            
            eventBus.emit('test:event', { foo: 'bar' });
            
            expect(receivedData).to.deep.equal({ foo: 'bar' });
        });

        it('should support multiple subscribers to same event', () => {
            const received = [];
            
            eventBus.on('test:event', (data) => {
                received.push(`listener1: ${data}`);
            });
            
            eventBus.on('test:event', (data) => {
                received.push(`listener2: ${data}`);
            });
            
            eventBus.emit('test:event', 'hello');
            
            expect(received).to.have.length(2);
            expect(received[0]).to.equal('listener1: hello');
            expect(received[1]).to.equal('listener2: hello');
        });

        it('should not trigger listeners for different events', () => {
            let triggered = false;
            
            eventBus.on('event:one', () => {
                triggered = true;
            });
            
            eventBus.emit('event:two', {});
            
            expect(triggered).to.be.false;
        });
    });

    describe('Unsubscribe', () => {
        it('should unsubscribe listener from event', () => {
            let callCount = 0;
            
            const listener = () => {
                callCount++;
            };
            
            eventBus.on('test:event', listener);
            eventBus.emit('test:event');
            expect(callCount).to.equal(1);
            
            eventBus.off('test:event', listener);
            eventBus.emit('test:event');
            expect(callCount).to.equal(1); // Should not increment
        });

        it('should not affect other listeners when unsubscribing', () => {
            let count1 = 0;
            let count2 = 0;
            
            const listener1 = () => count1++;
            const listener2 = () => count2++;
            
            eventBus.on('test:event', listener1);
            eventBus.on('test:event', listener2);
            
            eventBus.off('test:event', listener1);
            eventBus.emit('test:event');
            
            expect(count1).to.equal(0); // Unsubscribed, not called
            expect(count2).to.equal(1); // Still subscribed, called
        });
    });

    describe('Real-world usage patterns', () => {
        it('should handle message:add event', () => {
            let addedMessage = null;
            
            eventBus.on('message:add', (message) => {
                addedMessage = message;
            });
            
            const testMessage = {
                role: 'user',
                content: 'Hello world'
            };
            
            eventBus.emit('message:add', testMessage);
            
            expect(addedMessage).to.deep.equal(testMessage);
        });

        it('should handle tool:start and tool:complete events', () => {
            const events = [];
            
            eventBus.on('tool:start', (data) => {
                events.push({ type: 'start', data });
            });
            
            eventBus.on('tool:complete', (data) => {
                events.push({ type: 'complete', data });
            });
            
            eventBus.emit('tool:start', { toolId: 'test-123', name: 'bash' });
            eventBus.emit('tool:complete', { toolId: 'test-123', result: 'success' });
            
            expect(events).to.have.length(2);
            expect(events[0].type).to.equal('start');
            expect(events[0].data.toolId).to.equal('test-123');
            expect(events[1].type).to.equal('complete');
            expect(events[1].data.result).to.equal('success');
        });

        it('should handle session:change event', () => {
            let currentSessionId = null;
            
            eventBus.on('session:change', (sessionId) => {
                currentSessionId = sessionId;
            });
            
            eventBus.emit('session:change', 'session-abc-123');
            
            expect(currentSessionId).to.equal('session-abc-123');
        });
    });

    describe('Error handling', () => {
        it('should not crash if listener throws error', () => {
            eventBus.on('test:event', () => {
                throw new Error('Listener error');
            });
            
            // Should not throw
            expect(() => {
                eventBus.emit('test:event');
            }).to.not.throw();
        });

        it('should continue calling other listeners if one throws', () => {
            let called = false;
            
            eventBus.on('test:event', () => {
                throw new Error('First listener error');
            });
            
            eventBus.on('test:event', () => {
                called = true;
            });
            
            eventBus.emit('test:event');
            
            expect(called).to.be.true;
        });
    });
});
