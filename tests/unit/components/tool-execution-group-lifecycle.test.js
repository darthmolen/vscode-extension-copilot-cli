/**
 * ToolExecution - Tool Group Lifecycle Tests
 *
 * Tests that tool groups close when assistant/user messages arrive,
 * so each agent response gets its own tool group div.
 *
 * Bug: v3.1.0 removed the message:add listener to prevent auto-collapsing
 * manually-expanded tool groups. Side effect: all tools pile into one group.
 */

import { expect } from 'chai';
import { JSDOM } from 'jsdom';

describe('ToolExecution - Tool Group Lifecycle', () => {
    let dom, container, eventBus, toolExecution;
    let ToolExecution, EventBus;

    before(async () => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.window = dom.window;
        global.document = dom.window.document;

        const execModule = await import('../../../src/webview/app/components/ToolExecution/ToolExecution.js');
        ToolExecution = execModule.ToolExecution;

        const busModule = await import('../../../src/webview/app/state/EventBus.js');
        EventBus = busModule.EventBus;
    });

    after(() => {
        delete global.window;
        delete global.document;
        if (dom && dom.window) {
            dom.window.close();
        }
    });

    beforeEach(() => {
        container = document.createElement('div');
        container.id = 'messages';
        document.body.appendChild(container);
        eventBus = new EventBus();
        toolExecution = new ToolExecution(container, eventBus);
    });

    afterEach(() => {
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    function emitToolStart(id, toolName) {
        eventBus.emit('tool:start', {
            toolCallId: id,
            toolName: toolName || 'bash',
            arguments: { command: 'echo hello' },
            status: 'running',
            startTime: Date.now()
        });
        return container.querySelector(`[data-tool-id="${id}"]`);
    }

    describe('Assistant message closes current tool group', () => {
        it('should create a new tool group after assistant message', () => {
            // First round of tools
            emitToolStart('tool-1');
            emitToolStart('tool-2');

            // Assistant responds
            eventBus.emit('message:add', { role: 'assistant', content: 'Done!' });

            // Second round of tools
            emitToolStart('tool-3');

            const groups = container.querySelectorAll('.tool-group');
            expect(groups.length, 'should have 2 separate tool groups').to.equal(2);

            // First group has 2 tools, second has 1
            const group1Tools = groups[0].querySelectorAll('.tool-execution__item');
            const group2Tools = groups[1].querySelectorAll('.tool-execution__item');
            expect(group1Tools.length).to.equal(2);
            expect(group2Tools.length).to.equal(1);
        });
    });

    describe('User message closes current tool group', () => {
        it('should create a new tool group after user message', () => {
            emitToolStart('tool-a');

            // User sends a message
            eventBus.emit('message:add', { role: 'user', content: 'Next task' });

            emitToolStart('tool-b');

            const groups = container.querySelectorAll('.tool-group');
            expect(groups.length, 'should have 2 separate tool groups').to.equal(2);
        });
    });

    describe('Reasoning message does NOT close tool group', () => {
        it('should keep tools in same group across reasoning messages', () => {
            emitToolStart('tool-r1');

            // Reasoning message arrives (not user/assistant)
            eventBus.emit('message:add', { role: 'reasoning', content: 'Thinking...' });

            emitToolStart('tool-r2');

            const groups = container.querySelectorAll('.tool-group');
            expect(groups.length, 'reasoning should not split tool groups').to.equal(1);
        });
    });

    describe('Individual card collapse state preserved across group close', () => {
        it('should keep collapsed cards tracked after group closes', () => {
            emitToolStart('tool-c1');
            emitToolStart('tool-c2');

            // Collapse the first card
            const card1 = container.querySelector('[data-tool-id="tool-c1"]');
            const header1 = card1.querySelector('.tool-execution__header');
            header1.click();
            expect(card1.classList.contains('collapsed')).to.be.true;

            // Assistant message closes the group
            eventBus.emit('message:add', { role: 'assistant', content: 'Done' });

            // The collapsedCards Set should still contain tool-c1
            expect(toolExecution.collapsedCards.has('tool-c1'),
                'collapsed card should still be tracked after group close').to.be.true;
        });
    });
});
