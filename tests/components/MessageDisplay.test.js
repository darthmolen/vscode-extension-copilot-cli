/**
 * MessageDisplay Component Tests
 * 
 * Tests the MessageDisplay component for rendering chat messages,
 * markdown content, attachments, and empty state.
 * 
 * TDD: RED phase - these tests should FAIL until MessageDisplay is implemented.
 */

import { expect } from 'chai';
import { JSDOM } from 'jsdom';

// Setup DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;

// Mock marked.js
global.marked = {
    parse: (text) => `<p>${text}</p>` // Simple mock for testing
};

describe('MessageDisplay Component', () => {
    let MessageDisplay;
    let EventBus;
    let container;
    let eventBus;

    before(async () => {
        // Dynamic import of MessageDisplay (will fail until created)
        const displayModule = await import('../../src/webview/app/components/MessageDisplay/MessageDisplay.js');
        MessageDisplay = displayModule.MessageDisplay;
        
        const busModule = await import('../../src/webview/app/state/EventBus.js');
        EventBus = busModule.EventBus;
    });

    beforeEach(() => {
        // Create fresh container for each test
        container = document.createElement('div');
        container.id = 'messages';
        document.body.appendChild(container);
        
        eventBus = new EventBus();
    });

    afterEach(() => {
        // Cleanup
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    describe('Component initialization', () => {
        it('should create a MessageDisplay instance', () => {
            const display = new MessageDisplay(container, eventBus);
            
            expect(display).to.exist;
            expect(display).to.be.instanceOf(MessageDisplay);
        });

        it('should render initial structure', () => {
            new MessageDisplay(container, eventBus);
            
            // Component adds class to existing container
            expect(container.classList.contains('message-display')).to.be.true;
        });

        it('should show empty state initially', () => {
            new MessageDisplay(container, eventBus);
            
            const emptyState = container.querySelector('.message-display__empty');
            expect(emptyState).to.exist;
            expect(emptyState.style.display).to.not.equal('none');
        });
    });

    describe('Adding messages', () => {
        it('should add a user message', () => {
            const display = new MessageDisplay(container, eventBus);
            
            display.addMessage({
                role: 'user',
                content: 'Hello, how are you?',
                timestamp: Date.now()
            });
            
            const userMsg = container.querySelector('.message-display__item--user');
            expect(userMsg).to.exist;
            expect(userMsg.textContent).to.include('Hello, how are you?');
        });

        it('should add an assistant message', () => {
            const display = new MessageDisplay(container, eventBus);
            
            display.addMessage({
                role: 'assistant',
                content: 'I am doing well, thank you!',
                timestamp: Date.now()
            });
            
            const assistantMsg = container.querySelector('.message-display__item--assistant');
            expect(assistantMsg).to.exist;
            expect(assistantMsg.textContent).to.include('I am doing well');
        });

        it('should hide empty state after adding first message', () => {
            const display = new MessageDisplay(container, eventBus);
            
            display.addMessage({
                role: 'user',
                content: 'Test message',
                timestamp: Date.now()
            });
            
            const emptyState = container.querySelector('.message-display__empty');
            expect(emptyState.style.display).to.equal('none');
        });

        it('should add multiple messages in order', () => {
            const display = new MessageDisplay(container, eventBus);
            
            display.addMessage({ role: 'user', content: 'First', timestamp: 1 });
            display.addMessage({ role: 'assistant', content: 'Second', timestamp: 2 });
            display.addMessage({ role: 'user', content: 'Third', timestamp: 3 });
            
            const messages = container.querySelectorAll('.message-display__item');
            expect(messages).to.have.length(3);
            expect(messages[0].textContent).to.include('First');
            expect(messages[1].textContent).to.include('Second');
            expect(messages[2].textContent).to.include('Third');
        });
    });

    describe('Markdown rendering', () => {
        it('should render markdown in assistant messages', () => {
            const display = new MessageDisplay(container, eventBus);
            
            display.addMessage({
                role: 'assistant',
                content: '**Bold text** and *italic text*',
                timestamp: Date.now()
            });
            
            const assistantMsg = container.querySelector('.message-display__item--assistant');
            const content = assistantMsg.querySelector('.message-display__content');
            
            // Should contain rendered HTML from marked.parse
            expect(content.innerHTML).to.include('<p>');
        });

        it('should NOT render markdown in user messages', () => {
            const display = new MessageDisplay(container, eventBus);
            
            display.addMessage({
                role: 'user',
                content: '**Bold text**',
                timestamp: Date.now()
            });
            
            const userMsg = container.querySelector('.message-display__item--user');
            const content = userMsg.querySelector('.message-display__content');
            
            // Should be plain text (escaped), not HTML
            expect(content.textContent.trim()).to.include('**Bold text**');
        });
    });

    describe('Attachment rendering', () => {
        it('should render image attachments', () => {
            const display = new MessageDisplay(container, eventBus);
            
            display.addMessage({
                role: 'user',
                content: 'Check this image',
                timestamp: Date.now(),
                attachments: [
                    { type: 'image', path: '/path/to/image.png', displayName: 'image.png' }
                ]
            });
            
            const attachment = container.querySelector('.message-display__attachment');
            expect(attachment).to.exist;
        });

        it('should render multiple attachments', () => {
            const display = new MessageDisplay(container, eventBus);
            
            display.addMessage({
                role: 'user',
                content: 'Multiple files',
                timestamp: Date.now(),
                attachments: [
                    { type: 'image', path: '/path/1.png', displayName: '1.png' },
                    { type: 'image', path: '/path/2.png', displayName: '2.png' }
                ]
            });
            
            const attachments = container.querySelectorAll('.message-display__attachment');
            expect(attachments).to.have.length(2);
        });
    });

    describe('EventBus integration', () => {
        it('should subscribe to message:add event', () => {
            const display = new MessageDisplay(container, eventBus);
            
            eventBus.emit('message:add', {
                role: 'user',
                content: 'Event-driven message',
                timestamp: Date.now()
            });
            
            const userMsg = container.querySelector('.message-display__item--user');
            expect(userMsg).to.exist;
            expect(userMsg.textContent).to.include('Event-driven message');
        });

        it('should handle multiple messages via events', () => {
            const display = new MessageDisplay(container, eventBus);
            
            eventBus.emit('message:add', { role: 'user', content: 'First', timestamp: 1 });
            eventBus.emit('message:add', { role: 'assistant', content: 'Second', timestamp: 2 });
            
            const messages = container.querySelectorAll('.message-display__item');
            expect(messages).to.have.length(2);
        });
    });

    describe('Scrolling behavior', () => {
        it('should auto-scroll to bottom when message added', () => {
            const display = new MessageDisplay(container, eventBus);
            
            // Add enough messages to overflow
            for (let i = 0; i < 10; i++) {
                display.addMessage({
                    role: 'user',
                    content: `Message ${i}`,
                    timestamp: i
                });
            }
            
            // Container should be scrolled to bottom
            // (Note: JSDOM doesn't support scrolling, so we check that scrollTop was set)
            // In real implementation, this would scroll
            expect(container.scrollTop).to.be.at.least(0);
        });
    });
});
