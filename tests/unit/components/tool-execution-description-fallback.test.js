/**
 * Tool Description Fallback Tests (TDD RED phase)
 *
 * Tests that when a tool has arguments.description but no intent,
 * the description text appears as the intent label in the rendered card HTML.
 */

import { expect } from 'chai';
import { JSDOM } from 'jsdom';

describe('ToolExecution: args.description fallback', () => {
    let dom;
    let ToolExecution;
    let EventBus;
    let container;
    let eventBus;
    let toolExec;

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
        if (dom && dom.window) dom.window.close();
    });

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        eventBus = new EventBus();
        toolExec = new ToolExecution(container, eventBus);
    });

    afterEach(() => {
        document.body.removeChild(container);
    });

    it('shows args.description as intent label when no toolState.intent', () => {
        eventBus.emit('tool:start', {
            toolCallId: 'test-001',
            toolName: 'bash',
            arguments: {
                command: 'npm test',
                description: 'Run the test suite'
            },
            status: 'running'
            // NOTE: no intent field
        });

        const intentEl = container.querySelector('.tool-execution__intent');
        expect(intentEl, '.tool-execution__intent element must exist').to.exist;
        expect(intentEl.textContent).to.equal('Run the test suite');
    });

    it('uses toolState.intent over args.description when both present', () => {
        eventBus.emit('tool:start', {
            toolCallId: 'test-002',
            toolName: 'bash',
            arguments: {
                command: 'npm test',
                description: 'Run the test suite'
            },
            intent: 'Running tests',
            status: 'running'
        });

        const intentEl = container.querySelector('.tool-execution__intent');
        expect(intentEl).to.exist;
        expect(intentEl.textContent).to.equal('Running tests');
    });

    it('shows no intent element when neither intent nor description present', () => {
        eventBus.emit('tool:start', {
            toolCallId: 'test-003',
            toolName: 'bash',
            arguments: { command: 'npm test' },
            status: 'running'
        });

        const intentEl = container.querySelector('.tool-execution__intent');
        expect(intentEl).to.not.exist;
    });

    it('escapes HTML in args.description to prevent XSS', () => {
        eventBus.emit('tool:start', {
            toolCallId: 'test-004',
            toolName: 'bash',
            arguments: {
                command: 'echo test',
                description: '<script>alert("xss")</script>'
            },
            status: 'running'
        });

        const intentEl = container.querySelector('.tool-execution__intent');
        expect(intentEl).to.exist;
        // Should be escaped — no actual script tag
        expect(intentEl.querySelector('script')).to.not.exist;
        expect(intentEl.textContent).to.include('alert');
    });
});
