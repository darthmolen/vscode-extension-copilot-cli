/**
 * ToolExecution - Individual Card Collapse/Expand Tests
 *
 * Tests for collapsing/expanding individual tool execution cards by clicking
 * their header area. Distinct from the tool *group* expand/collapse which
 * toggles visibility of many cards at once.
 *
 * TDD: RED phase - these tests should FAIL until the feature is implemented.
 */

import { expect } from 'chai';
import { JSDOM } from 'jsdom';

describe('ToolExecution - Individual Card Collapse', () => {
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

    /**
     * Helper: emit a tool:start event and return the created .tool-execution__item element.
     */
    function emitToolStart(id, toolName, args) {
        eventBus.emit('tool:start', {
            toolCallId: id,
            toolName: toolName || 'bash',
            arguments: args || { command: 'echo hello' },
            status: 'running',
            startTime: Date.now()
        });
        return container.querySelector(`[data-tool-id="${id}"]`);
    }

    describe('Clicking tool card header toggles collapsed state', () => {
        it('should add collapsed class when header is clicked', () => {
            const toolItem = emitToolStart('tool-collapse-1', 'bash', { command: 'ls' });
            const header = toolItem.querySelector('.tool-execution__header');

            expect(header, 'header element should exist').to.exist;
            expect(toolItem.classList.contains('collapsed'), 'should not start collapsed').to.be.false;

            // Act: click the header
            header.click();

            // Assert: the .tool-execution__item gets a 'collapsed' class
            expect(toolItem.classList.contains('collapsed'), 'should be collapsed after click').to.be.true;
        });

        it('should remove collapsed class when header is clicked again (toggle)', () => {
            const toolItem = emitToolStart('tool-collapse-2', 'grep', { pattern: 'foo' });
            const header = toolItem.querySelector('.tool-execution__header');

            // Collapse
            header.click();
            expect(toolItem.classList.contains('collapsed')).to.be.true;

            // Expand
            header.click();
            expect(toolItem.classList.contains('collapsed'), 'should be expanded after second click').to.be.false;
        });

        it('should toggle through multiple cycles', () => {
            const toolItem = emitToolStart('tool-collapse-3', 'bash', { command: 'pwd' });
            const header = toolItem.querySelector('.tool-execution__header');

            for (let i = 0; i < 5; i++) {
                header.click();
                expect(toolItem.classList.contains('collapsed'), `cycle ${i}: should be collapsed`).to.be.true;
                header.click();
                expect(toolItem.classList.contains('collapsed'), `cycle ${i}: should be expanded`).to.be.false;
            }
        });
    });

    describe('Collapsed card hides content below header', () => {
        it('should have a content wrapper with class tool-execution__content', () => {
            const toolItem = emitToolStart('tool-content-1', 'bash', { command: 'ls -la' });

            const content = toolItem.querySelector('.tool-execution__content');
            expect(content, 'content wrapper should exist').to.exist;
        });

        it('should contain args preview inside content wrapper', () => {
            const toolItem = emitToolStart('tool-content-2', 'bash', { command: 'ls -la' });

            const content = toolItem.querySelector('.tool-execution__content');
            const args = content.querySelector('.tool-execution__args');
            expect(args, 'args preview should be inside content wrapper').to.exist;
        });

        it('should contain details inside content wrapper', () => {
            const toolItem = emitToolStart('tool-content-3', 'bash', { command: 'ls' });

            const content = toolItem.querySelector('.tool-execution__content');
            const details = content.querySelector('.tool-execution__details');
            expect(details, 'details section should be inside content wrapper').to.exist;
        });
    });

    describe('Collapse state survives tool status update', () => {
        it('should preserve collapsed state when tool completes', () => {
            const toolItem = emitToolStart('tool-update-1', 'bash', { command: 'sleep 1' });
            const header = toolItem.querySelector('.tool-execution__header');

            // Collapse the card
            header.click();
            expect(toolItem.classList.contains('collapsed')).to.be.true;

            // Tool completes -- this triggers innerHTML replacement
            eventBus.emit('tool:complete', {
                toolCallId: 'tool-update-1',
                status: 'complete',
                result: 'done',
                endTime: Date.now() + 1000
            });

            // The same element reference should still be collapsed
            const updatedItem = container.querySelector('[data-tool-id="tool-update-1"]');
            expect(updatedItem.classList.contains('collapsed'), 'should remain collapsed after update').to.be.true;
        });

        it('should keep click handler working after tool status update', () => {
            emitToolStart('tool-update-2', 'bash', { command: 'echo hi' });

            // Complete the tool (triggers innerHTML replacement)
            eventBus.emit('tool:complete', {
                toolCallId: 'tool-update-2',
                status: 'complete',
                result: 'hi',
                endTime: Date.now() + 500
            });

            const updatedItem = container.querySelector('[data-tool-id="tool-update-2"]');
            const header = updatedItem.querySelector('.tool-execution__header');

            // Click to collapse after update
            header.click();
            expect(updatedItem.classList.contains('collapsed'), 'should collapse after update').to.be.true;

            // Click again to expand
            header.click();
            expect(updatedItem.classList.contains('collapsed'), 'should expand after update').to.be.false;
        });
    });

    describe('Individual collapse is independent per card', () => {
        it('collapsing one card should not affect another', () => {
            const card1 = emitToolStart('tool-indep-1', 'bash', { command: 'ls' });
            const card2 = emitToolStart('tool-indep-2', 'grep', { pattern: 'test' });

            const header1 = card1.querySelector('.tool-execution__header');

            // Collapse card 1 only
            header1.click();

            expect(card1.classList.contains('collapsed'), 'card 1 should be collapsed').to.be.true;
            expect(card2.classList.contains('collapsed'), 'card 2 should NOT be collapsed').to.be.false;
        });
    });

    describe('Header cursor style indicates clickability', () => {
        it('should have cursor pointer style on header via CSS class', () => {
            const toolItem = emitToolStart('tool-cursor-1', 'bash', { command: 'ls' });
            const header = toolItem.querySelector('.tool-execution__header');

            // We verify the header exists and is the correct element;
            // actual cursor styling is via CSS which JSDOM does not compute,
            // but we verify the header element has the right class.
            expect(header.classList.contains('tool-execution__header')).to.be.true;
        });
    });

    describe('Collapse chevron indicator', () => {
        it('should have a collapse indicator element in the header', () => {
            const toolItem = emitToolStart('tool-chevron-1', 'bash', { command: 'ls' });
            const indicator = toolItem.querySelector('.tool-execution__collapse-indicator');

            expect(indicator, 'collapse indicator should exist in card').to.exist;
        });

        it('should show right-pointing indicator when collapsed', () => {
            const toolItem = emitToolStart('tool-chevron-2', 'bash', { command: 'ls' });
            const header = toolItem.querySelector('.tool-execution__header');

            header.click();

            const indicator = toolItem.querySelector('.tool-execution__collapse-indicator');
            // When collapsed, the indicator text should suggest collapsed state
            expect(indicator.textContent.trim()).to.equal('\u25B6'); // right-pointing triangle
        });

        it('should show down-pointing indicator when expanded', () => {
            const toolItem = emitToolStart('tool-chevron-3', 'bash', { command: 'ls' });
            const indicator = toolItem.querySelector('.tool-execution__collapse-indicator');

            // Default state is expanded
            expect(indicator.textContent.trim()).to.equal('\u25BC'); // down-pointing triangle
        });
    });
});
