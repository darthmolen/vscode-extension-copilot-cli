/**
 * Tool Group Message Collapse Bug Test
 *
 * Regression tests for the bug where expanded tool groups auto-collapse
 * when a new user or assistant message arrives via the `message:add` event.
 *
 * The root cause is that `closeCurrentToolGroup()` is called on every
 * `message:add` with role 'user' or 'assistant', which resets
 * `currentToolGroup` to null and `toolGroupExpanded` to false even when
 * the user has manually expanded a tool group.
 *
 * The fix is to remove the `message:add` listener that calls
 * `closeCurrentToolGroup()`. Tool groups close naturally when a new
 * tool group is started.
 */

import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { ToolExecution } from '../../../src/webview/app/components/ToolExecution/ToolExecution.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

describe('Tool Group - No auto-collapse on message:add', () => {
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

    describe('message:add should NOT close the current tool group', () => {
        it('should keep tools in the same group when message:add arrives mid-group', () => {
            // Arrange: start a tool group with 2 tools
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

            // Act: an assistant message arrives
            eventBus.emit('message:add', {
                role: 'assistant',
                content: 'Working on it...',
                timestamp: Date.now()
            });

            // Act: another tool starts (still part of the same logical turn)
            eventBus.emit('tool:start', {
                toolCallId: 'tool-3',
                toolName: 'bash',
                arguments: { command: 'whoami' },
                status: 'running',
                startTime: Date.now()
            });

            // Assert: all 3 tools should be in the SAME group
            // (message:add should NOT force group separation)
            const groups = container.querySelectorAll('.tool-group');
            expect(groups).to.have.length(1);

            const tools = groups[0].querySelectorAll('.tool-execution__item');
            expect(tools).to.have.length(3);
        });

        it('should NOT reset toolGroupExpanded when user message arrives', () => {
            // Arrange: create a tool group with overflow, expand it
            addToolsToTriggerOverflow();

            const expandBtn = container.querySelector('.tool-group-toggle');
            expect(expandBtn, 'Expand button should exist').to.exist;
            expandBtn.click();

            // Act: user message arrives
            eventBus.emit('message:add', {
                role: 'user',
                content: 'Tell me more',
                timestamp: Date.now()
            });

            // Act: a tool completes, which triggers updateToolGroupToggle()
            // if currentToolGroup is still set.
            // With the bug, currentToolGroup is null so toggle is never
            // rebuilt, but toolGroupExpanded is false so the NEXT group
            // would inherit the wrong state.
            eventBus.emit('tool:start', {
                toolCallId: 'tool-new',
                toolName: 'bash',
                arguments: { command: 'echo test' },
                status: 'running',
                startTime: Date.now()
            });

            // Assert: the tool was added to the SAME group (not a new one)
            // which proves currentToolGroup was not nulled out
            const groups = container.querySelectorAll('.tool-group');
            expect(groups).to.have.length(1);

            // Assert: the container is still expanded
            const toolContainer = container.querySelector('.tool-group-container');
            expect(toolContainer.classList.contains('expanded'),
                'Tool group should remain expanded after user message and new tool').to.be.true;
        });

        it('should NOT reset toolGroupExpanded when assistant message arrives', () => {
            // Arrange: create a tool group with overflow, expand it
            addToolsToTriggerOverflow();

            const toolContainer = container.querySelector('.tool-group-container');
            const expandBtn = container.querySelector('.tool-group-toggle');
            expandBtn.click();
            expect(toolContainer.classList.contains('expanded')).to.be.true;

            // Act: assistant message arrives
            eventBus.emit('message:add', {
                role: 'assistant',
                content: 'Here is the result.',
                timestamp: Date.now()
            });

            // Act: another tool starts in the same group
            eventBus.emit('tool:start', {
                toolCallId: 'tool-new',
                toolName: 'bash',
                arguments: { command: 'echo done' },
                status: 'running',
                startTime: Date.now()
            });

            // Assert: same group, still expanded
            const groups = container.querySelectorAll('.tool-group');
            expect(groups).to.have.length(1);
            expect(toolContainer.classList.contains('expanded'),
                'Tool group should remain expanded after assistant message').to.be.true;
        });

        it('should preserve expanded state through multiple sequential messages', () => {
            // Arrange
            addToolsToTriggerOverflow();

            const toolContainer = container.querySelector('.tool-group-container');
            const expandBtn = container.querySelector('.tool-group-toggle');
            expandBtn.click();

            // Act: several messages in a row
            eventBus.emit('message:add', { role: 'user', content: 'msg1', timestamp: Date.now() });
            eventBus.emit('message:add', { role: 'assistant', content: 'msg2', timestamp: Date.now() });
            eventBus.emit('message:add', { role: 'user', content: 'msg3', timestamp: Date.now() });

            // Act: more tools arrive
            eventBus.emit('tool:start', {
                toolCallId: 'tool-after-msgs',
                toolName: 'bash',
                arguments: { command: 'echo hi' },
                status: 'running',
                startTime: Date.now()
            });

            // Assert: all in one group, still expanded
            expect(container.querySelectorAll('.tool-group')).to.have.length(1);
            expect(toolContainer.classList.contains('expanded'),
                'Tool group should remain expanded after multiple messages').to.be.true;
        });
    });

    describe('system messages should still be ignored', () => {
        it('should not affect tool groups when system message arrives', () => {
            // Arrange: start a tool group
            eventBus.emit('tool:start', {
                toolCallId: 'tool-1',
                toolName: 'bash',
                arguments: { command: 'ls' },
                status: 'running',
                startTime: Date.now()
            });

            // Act: system message (was never handled, still should not be)
            eventBus.emit('message:add', {
                role: 'system',
                content: 'System info',
                timestamp: Date.now()
            });

            // Act: another tool in same group
            eventBus.emit('tool:start', {
                toolCallId: 'tool-2',
                toolName: 'bash',
                arguments: { command: 'pwd' },
                status: 'running',
                startTime: Date.now()
            });

            // Assert: same group
            expect(container.querySelectorAll('.tool-group')).to.have.length(1);
        });
    });
});
