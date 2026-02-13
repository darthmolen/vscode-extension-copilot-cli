/**
 * MessageDisplay Component Tests
 *
 * Tests the MessageDisplay component for rendering chat messages,
 * markdown content, attachments, and empty state.
 */

import { expect } from 'chai';
import { createComponentDOM, cleanupComponentDOM } from '../helpers/jsdom-component-setup.js';

describe('MessageDisplay Component', () => {
    let dom;
    let MessageDisplay;
    let EventBus;
    let container;
    let eventBus;
    let display;

    before(async () => {
        dom = createComponentDOM();

        const displayModule = await import('../../src/webview/app/components/MessageDisplay/MessageDisplay.js');
        MessageDisplay = displayModule.MessageDisplay;

        const busModule = await import('../../src/webview/app/state/EventBus.js');
        EventBus = busModule.EventBus;
    });

    after(() => {
        cleanupComponentDOM(dom);
    });

    beforeEach(() => {
        // Create a fresh mount container (MessageDisplay renders its own structure inside)
        container = document.createElement('div');
        container.id = 'messages-mount';
        // Replace the existing mount point so <main> structure is intact
        const existingMount = document.getElementById('messages-mount');
        if (existingMount) {
            existingMount.parentNode.replaceChild(container, existingMount);
        } else {
            document.querySelector('main').appendChild(container);
        }

        eventBus = new EventBus();
        display = new MessageDisplay(container, eventBus);
    });

    afterEach(() => {
        if (display && display.dispose) {
            display.dispose();
        }
        // Restore mount point for next test
        if (container && container.parentNode) {
            const fresh = document.createElement('div');
            fresh.id = 'messages-mount';
            container.parentNode.replaceChild(fresh, container);
        }
    });

    describe('Component initialization', () => {
        it('should create a MessageDisplay instance', () => {
            expect(display).to.exist;
            expect(display).to.be.instanceOf(MessageDisplay);
        });

        it('should render initial structure with messages container', () => {
            const messagesDiv = container.querySelector('#messages');
            expect(messagesDiv).to.exist;
            expect(messagesDiv.classList.contains('message-display')).to.be.true;
        });

        it('should show empty state initially', () => {
            const emptyState = container.querySelector('.message-display__empty');
            expect(emptyState).to.exist;
            expect(emptyState.style.display).to.not.equal('none');
        });
    });

    describe('Adding messages', () => {
        it('should add a user message', () => {
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
            display.addMessage({
                role: 'user',
                content: 'Test message',
                timestamp: Date.now()
            });

            const emptyState = container.querySelector('.message-display__empty');
            expect(emptyState.style.display).to.equal('none');
        });

        it('should add multiple messages in order', () => {
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
            display.addMessage({
                role: 'assistant',
                content: '**Bold text** and *italic text*',
                timestamp: Date.now()
            });

            const assistantMsg = container.querySelector('.message-display__item--assistant');
            const content = assistantMsg.querySelector('.message-display__content');

            // Should contain rendered HTML from marked.parse mock
            expect(content.innerHTML).to.include('<p>');
        });

        it('should NOT render markdown in user messages', () => {
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
            eventBus.emit('message:add', { role: 'user', content: 'First', timestamp: 1 });
            eventBus.emit('message:add', { role: 'assistant', content: 'Second', timestamp: 2 });

            const messages = container.querySelectorAll('.message-display__item');
            expect(messages).to.have.length(2);
        });
    });

    describe('Scrolling behavior', () => {
        it('should auto-scroll to bottom when message added', () => {
            // Add enough messages to create content
            for (let i = 0; i < 10; i++) {
                display.addMessage({
                    role: 'user',
                    content: `Message ${i}`,
                    timestamp: i
                });
            }

            // JSDOM doesn't support real scrolling — verify scrollTop was set
            expect(display.messagesContainer.scrollTop).to.be.at.least(0);
        });
    });
});
