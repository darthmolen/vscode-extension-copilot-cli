/**
 * Tool Group Message Lifecycle Tests
 *
 * Tests that tool groups close when user/assistant messages arrive,
 * ensuring each agent response gets its own tool group. System and
 * other message roles do NOT close tool groups.
 *
 * History: v3.1.0 removed the message:add listener to prevent
 * auto-collapsing expanded groups, but this caused ALL tools to pile
 * into one group forever. v3.2.0 re-adds the listener — individual
 * card collapse state is preserved via the collapsedCards Set.
 */

import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { ToolExecution } from '../../../src/webview/app/components/ToolExecution/ToolExecution.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

describe('Tool Group - Message lifecycle', () => {
    let dom, container, eventBus, toolExecution;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><div id="container"></div>');
        global.window = dom.window;
        global.document = dom.window.document;

        container = document.getElementById('container');
        eventBus = new EventBus();
        toolExecution = new ToolExecution(container, eventBus);
    });

    afterEach(() => {
        delete global.window;
        delete global.document;
    });

    /**
     * Helper: emit enough tool:start events to exceed the overflow threshold
     * (>3 tools) so that the expand/contract toggle button appears.
     */
    function addToolsToTriggerOverflow(count = 5) {
        for (let i = 1; i <= count; i++) {
            eventBus.emit('tool:start', {
                toolCallId: `tool-${i}`,
                toolName: 'bash',
                arguments: { command: `cmd-${i}` },
                status: 'running',
                startTime: Date.now()
            });
        }
    }

    describe('assistant message closes current tool group', () => {
        it('should create a new group for tools after assistant message', () => {
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'ls' },
                status: 'running',
                startTime: Date.now()
            });
            eventBus.emit('tool:start', {
                toolCallId: 'tool-2',
                toolName: 'bash',
                arguments: { command: 'pwd' },
                status: 'running',
                startTime: Date.now()
            });

            expect(container.querySelectorAll('.tool-group')).to.have.length(1);

            // Assistant message closes the current group
            eventBus.emit('message:add', {
                role: 'assistant',
                content: 'Working on it...',
                timestamp: Date.now()
            });

            // Next tool starts a new group
            eventBus.emit('tool:start', {
                toolCallId: 'tool-3',
                toolName: 'bash',
                arguments: { command: 'whoami' },
                status: 'running',
                startTime: Date.now()
            });

            const groups = container.querySelectorAll('.tool-group');
            expect(groups).to.have.length(2);
            expect(groups[0].querySelectorAll('.tool-execution__item')).to.have.length(2);
            expect(groups[1].querySelectorAll('.tool-execution__item')).to.have.length(1);
        });
    });

    describe('user message closes current tool group', () => {
        it('should start a new group for tools after user message', () => {
            addToolsToTriggerOverflow();

            eventBus.emit('message:add', {
                role: 'user',
                content: 'Tell me more',
                timestamp: Date.now()
            });

            eventBus.emit('tool:start', {
                toolCallId: 'tool-new',
                toolName: 'bash',
                arguments: { command: 'echo test' },
                status: 'running',
                startTime: Date.now()
            });

            const groups = container.querySelectorAll('.tool-group');
            expect(groups).to.have.length(2);
        });
    });

    describe('new group starts fresh (not expanded)', () => {
        it('should not inherit expanded state from previous group', () => {
            addToolsToTriggerOverflow();

            // Expand the first group
            const expandBtn = container.querySelector('.tool-group-toggle');
            expect(expandBtn, 'Expand button should exist').to.exist;
            expandBtn.click();

            // Assistant message closes the group
            eventBus.emit('message:add', {
                role: 'assistant',
                content: 'Here is the result.',
                timestamp: Date.now()
            });

            // Start tools in a new group
            for (let i = 0; i < 5; i++) {
                eventBus.emit('tool:start', {
                    toolCallId: `new-tool-${i}`,
                    toolName: 'bash',
                    arguments: { command: `new-cmd-${i}` },
                    status: 'running',
                    startTime: Date.now()
                });
            }

            // The new group should NOT be expanded (starts fresh)
            const groups = container.querySelectorAll('.tool-group');
            expect(groups).to.have.length(2);

            const newContainer = groups[1].querySelector('.tool-group-container');
            expect(newContainer.classList.contains('expanded'),
                'New tool group should start collapsed, not inherit expanded state').to.be.false;
        });
    });

    describe('multiple messages create multiple groups', () => {
        it('should create separate groups for each message boundary', () => {
            // Round 1
            eventBus.emit('tool:start', {
                toolCallId: 'round1-tool',
                toolName: 'bash',
                arguments: { command: 'echo 1' },
                status: 'running',
                startTime: Date.now()
            });

            eventBus.emit('message:add', { role: 'assistant', content: 'msg1', timestamp: Date.now() });

            // Round 2
            eventBus.emit('tool:start', {
                toolCallId: 'round2-tool',
                toolName: 'bash',
                arguments: { command: 'echo 2' },
                status: 'running',
                startTime: Date.now()
            });

            eventBus.emit('message:add', { role: 'user', content: 'msg2', timestamp: Date.now() });

            // Round 3
            eventBus.emit('tool:start', {
                toolCallId: 'round3-tool',
                toolName: 'bash',
                arguments: { command: 'echo 3' },
                status: 'running',
                startTime: Date.now()
            });

            expect(container.querySelectorAll('.tool-group')).to.have.length(3);
        });
    });

    describe('system messages should still be ignored', () => {
        it('should not affect tool groups when system message arrives', () => {
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'ls' },
                status: 'running',
                startTime: Date.now()
            });

            // System message — should NOT close the group
            eventBus.emit('message:add', {
                role: 'system',
                content: 'System info',
                timestamp: Date.now()
            });

            eventBus.emit('tool:start', {
                toolCallId: 'tool-2',
                toolName: 'bash',
                arguments: { command: 'pwd' },
                status: 'running',
                startTime: Date.now()
            });

            expect(container.querySelectorAll('.tool-group')).to.have.length(1);
        });
    });
});
