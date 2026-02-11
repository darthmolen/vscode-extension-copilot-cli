import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { MessageDisplay } from '../src/webview/app/components/MessageDisplay/MessageDisplay.js';
import { EventBus } from '../src/webview/app/state/EventBus.js';

describe('MessageDisplay Tool Ownership (Parent-Child Pattern)', () => {
    let dom, container, eventBus;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><div id="container"></div>');
        global.window = dom.window;
        global.document = dom.window.document;
        
        container = document.getElementById('container');
        eventBus = new EventBus();
        
        // Mock marked for markdown parsing
        global.marked = { parse: (text) => text };
    });

    afterEach(() => {
        delete global.window;
        delete global.document;
        delete global.marked;
    });

    describe('Component Ownership', () => {
        it('should create ToolExecution child component', () => {
            const messageDisplay = new MessageDisplay(container, eventBus);
            
            expect(messageDisplay.toolExecution).to.exist;
            expect(messageDisplay.toolExecution.constructor.name).to.equal('ToolExecution');
        });

        it('should pass messagesContainer to ToolExecution', () => {
            const messageDisplay = new MessageDisplay(container, eventBus);
            
            // ToolExecution's container should be MessageDisplay's messagesContainer
            expect(messageDisplay.toolExecution.container).to.equal(messageDisplay.messagesContainer);
        });

        it('should pass eventBus to ToolExecution', () => {
            const messageDisplay = new MessageDisplay(container, eventBus);
            
            expect(messageDisplay.toolExecution.eventBus).to.equal(eventBus);
        });
    });

    describe('Tool Rendering Inside Messages', () => {
        it('should render tools inside .messages container', () => {
            const messageDisplay = new MessageDisplay(container, eventBus);
            
            // Emit tool:start event
            eventBus.emit('tool:start', {
                toolCallId: 'test-123',
                toolName: 'bash',
                arguments: { command: 'ls' },
                status: 'running',
                startTime: Date.now()
            });
            
            const messagesDiv = container.querySelector('.messages');
            const toolGroup = messagesDiv.querySelector('.tool-group');
            
            expect(toolGroup, 'Tool group should exist').to.exist;
            expect(toolGroup.parentElement, 'Tool group should be child of .messages').to.equal(messagesDiv);
        });

        it('should render tools in chronological order with messages', () => {
            const messageDisplay = new MessageDisplay(container, eventBus);
            
            // User message
            eventBus.emit('message:add', {
                role: 'user',
                content: 'Run ls command',
                timestamp: 1000
            });
            
            // Tool execution
            eventBus.emit('tool:start', {
                toolCallId: 'test-123',
                toolName: 'bash',
                arguments: { command: 'ls' },
                status: 'running',
                startTime: 1001
            });
            
            eventBus.emit('tool:complete', {
                toolCallId: 'test-123',
                status: 'success',
                result: 'file1.txt\nfile2.txt',
                endTime: 1002
            });
            
            // Assistant message
            eventBus.emit('message:add', {
                role: 'assistant',
                content: 'Here are the files',
                timestamp: 1003
            });
            
            const messagesDiv = container.querySelector('.messages');
            const children = Array.from(messagesDiv.children).filter(el => 
                el.classList.contains('message-display__item') || 
                el.classList.contains('tool-group')
            );
            
            expect(children.length).to.equal(3);
            expect(children[0].classList.contains('message-display__item--user')).to.be.true;
            expect(children[1].classList.contains('tool-group')).to.be.true;
            expect(children[2].classList.contains('message-display__item--assistant')).to.be.true;
        });
    });

    describe('EventBus Communication', () => {
        it('should respond to tool:start events via child ToolExecution', () => {
            const messageDisplay = new MessageDisplay(container, eventBus);
            
            eventBus.emit('tool:start', {
                toolCallId: 'test-456',
                toolName: 'edit',
                status: 'running'
            });
            
            const toolExecutions = container.querySelectorAll('.tool-execution');
            expect(toolExecutions.length).to.equal(1);
        });

        it('should emit viewDiff events from child ToolExecution', (done) => {
            const messageDisplay = new MessageDisplay(container, eventBus);
            
            eventBus.on('viewDiff', (data) => {
                expect(data.toolCallId).to.equal('test-789');
                expect(data.beforeUri).to.equal('/tmp/before.txt');
                done();
            });
            
            // Start tool with diff data
            eventBus.emit('tool:start', {
                toolCallId: 'test-789',
                toolName: 'edit',
                status: 'running'
            });
            
            // Simulate diff available
            eventBus.emit('tool:diffAvailable', {
                toolCallId: 'test-789',
                beforeUri: '/tmp/before.txt',
                afterUri: '/workspace/after.txt',
                title: 'Test Edit'
            });
            
            // Click diff button
            const diffBtn = container.querySelector('[data-tool-id="test-789"] .view-diff-btn');
            if (diffBtn) {
                diffBtn.click();
            } else {
                // If button not found, fail gracefully
                done(new Error('Diff button not found'));
            }
        });

        it('should close tool group when message arrives', () => {
            const messageDisplay = new MessageDisplay(container, eventBus);
            
            // Start tool
            eventBus.emit('tool:start', {
                toolCallId: 'test-999',
                toolName: 'bash',
                status: 'running'
            });
            
            let toolGroup = container.querySelector('.tool-group');
            expect(toolGroup).to.exist;
            
            // Send user message - should close tool group
            eventBus.emit('message:add', {
                role: 'user',
                content: 'Next command',
                timestamp: Date.now()
            });
            
            // Tool group should be finalized (no longer "current")
            expect(messageDisplay.toolExecution.currentToolGroup).to.be.null;
        });
    });

    describe('Scrolling Behavior', () => {
        it('should scroll to bottom after rendering tool', () => {
            const messageDisplay = new MessageDisplay(container, eventBus);
            const messagesDiv = container.querySelector('.messages');
            
            // Spy on scrollToBottom
            let scrollCalled = false;
            const originalScroll = messageDisplay.scrollToBottom;
            messageDisplay.scrollToBottom = function() {
                scrollCalled = true;
                originalScroll.call(this);
            };
            
            eventBus.emit('tool:start', {
                toolCallId: 'test-scroll',
                toolName: 'bash',
                status: 'running'
            });
            
            // Note: In JSDOM scrollTop assignment might not work perfectly
            // but we can verify the method was called
            expect(scrollCalled).to.be.true;
        });
    });
});
