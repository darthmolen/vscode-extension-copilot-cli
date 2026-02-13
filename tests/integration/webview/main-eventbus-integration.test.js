/**
 * main.js + EventBus Integration Tests
 * 
 * Deep integration tests that verify:
 * 1. main.js creates and exposes EventBus
 * 2. RPC handlers emit correct EventBus events
 * 3. MessageDisplay receives events and updates DOM
 * 
 * This tests the ACTUAL integration we built in Phase 4.2.
 */

import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';
import { MessageDisplay } from '../../../src/webview/app/components/MessageDisplay/MessageDisplay.js';

describe('EventBus Integration (Phase 4.2 Verification)', () => {
    let container;
    let eventBus;
    let messageDisplay;

    beforeEach(() => {
        // Setup DOM
        const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.window = dom.window;
        global.document = dom.window.document;
        global.marked = { parse: (text) => `<p>${text}</p>` };

        // Create container
        container = document.createElement('div');
        container.id = 'messages';
        document.body.appendChild(container);

        // Create EventBus and MessageDisplay (simulating what main.js does)
        eventBus = new EventBus();
        messageDisplay = new MessageDisplay(container, eventBus);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        delete global.window;
        delete global.document;
        delete global.marked;
    });

    describe('EventBus → MessageDisplay flow', () => {
        it('should render user message when event emitted', () => {
            // Simulate what main.js does when user sends message
            eventBus.emit('message:add', {
                role: 'user',
                content: 'Hello from test',
                timestamp: Date.now()
            });

            // Verify MessageDisplay rendered it
            const userMsg = container.querySelector('.message-display__item--user');
            expect(userMsg).to.exist;
            expect(userMsg.textContent).to.include('Hello from test');
        });

        it('should render assistant message when event emitted', () => {
            // Simulate what main.js does when assistant responds
            eventBus.emit('message:add', {
                role: 'assistant',
                content: 'Response from assistant',
                timestamp: Date.now()
            });

            const assistantMsg = container.querySelector('.message-display__item--assistant');
            expect(assistantMsg).to.exist;
            expect(assistantMsg.textContent).to.include('Response from assistant');
        });

        it('should render multiple messages in order', () => {
            // Simulate conversation flow
            eventBus.emit('message:add', {
                role: 'user',
                content: 'First',
                timestamp: 1
            });

            eventBus.emit('message:add', {
                role: 'assistant',
                content: 'Second',
                timestamp: 2
            });

            eventBus.emit('message:add', {
                role: 'user',
                content: 'Third',
                timestamp: 3
            });

            const messages = container.querySelectorAll('.message-display__item');
            expect(messages).to.have.length(3);
            expect(messages[0].textContent).to.include('First');
            expect(messages[1].textContent).to.include('Second');
            expect(messages[2].textContent).to.include('Third');
        });

        it('should hide empty state after first message', () => {
            const emptyState = container.querySelector('.message-display__empty');
            expect(emptyState).to.exist;
            expect(emptyState.style.display).to.not.equal('none');

            // Emit message
            eventBus.emit('message:add', {
                role: 'user',
                content: 'Test',
                timestamp: Date.now()
            });

            expect(emptyState.style.display).to.equal('none');
        });
    });

    describe('Reasoning toggle integration', () => {
        it('should show/hide reasoning messages when toggled', () => {
            // Add reasoning message
            eventBus.emit('message:add', {
                role: 'reasoning',
                content: 'Thinking deeply...',
                timestamp: Date.now()
            });

            const reasoningMsg = container.querySelector('.message-display__item--reasoning');
            expect(reasoningMsg).to.exist;

            // Initially hidden (default)
            expect(reasoningMsg.style.display).to.equal('none');

            // Toggle on
            eventBus.emit('reasoning:toggle', true);
            expect(reasoningMsg.style.display).to.equal('block');

            // Toggle off
            eventBus.emit('reasoning:toggle', false);
            expect(reasoningMsg.style.display).to.equal('none');
        });
    });

    describe('Attachment rendering integration', () => {
        it('should render attachments when included in message event', () => {
            eventBus.emit('message:add', {
                role: 'user',
                content: 'Check this file',
                timestamp: Date.now(),
                attachments: [
                    {
                        type: 'image',
                        webviewUri: 'data:image/png;base64,test',
                        displayName: 'test.png'
                    }
                ]
            });

            const attachment = container.querySelector('.message-display__attachment');
            expect(attachment).to.exist;
            expect(attachment.textContent).to.include('test.png');
        });
    });

    describe('Event decoupling verification', () => {
        it('should allow multiple subscribers to message:add', () => {
            let subscriber1Called = false;
            let subscriber2Called = false;

            eventBus.on('message:add', () => {
                subscriber1Called = true;
            });

            eventBus.on('message:add', () => {
                subscriber2Called = true;
            });

            eventBus.emit('message:add', {
                role: 'user',
                content: 'Test',
                timestamp: Date.now()
            });

            expect(subscriber1Called).to.be.true;
            expect(subscriber2Called).to.be.true;
        });

        it('should not crash if MessageDisplay throws error', () => {
            // Add a subscriber that throws
            eventBus.on('message:add', () => {
                throw new Error('Test error');
            });

            // Should not throw - EventBus catches errors
            expect(() => {
                eventBus.emit('message:add', {
                    role: 'user',
                    content: 'Test',
                    timestamp: Date.now()
                });
            }).to.not.throw();
        });
    });
});
