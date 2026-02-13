/**
 * ToolExecution - Inline Diff Rendering Tests
 *
 * RED phase of TDD. These tests define the expected behavior for inline
 * diff rendering inside buildToolHtml(). The implementation does NOT exist
 * yet, so every test that asserts on inline-diff DOM elements will FAIL.
 *
 * Expected HTML structure (to be implemented in buildToolHtml):
 *
 *   <div class="inline-diff">
 *       <div class="diff-line diff-remove">- old line content</div>
 *       <div class="diff-line diff-add">+ new line content</div>
 *       <div class="diff-line diff-context">  context line</div>
 *       <div class="diff-truncated">... 14 more lines</div>
 *   </div>
 */

import { strict as assert } from 'assert';
import { JSDOM } from 'jsdom';

describe('ToolExecution - Inline Diff Rendering', () => {
    let dom, document, container, eventBus, toolExec;

    before(async () => {
        dom = new JSDOM('<!DOCTYPE html><html><body><div id="tool-container"></div></body></html>');
        global.window = dom.window;
        global.document = dom.window.document;
        document = dom.window.document;

        // Simple event bus mock — only on/emit are needed for ToolExecution
        eventBus = {
            _handlers: {},
            on(event, handler) {
                if (!this._handlers[event]) this._handlers[event] = [];
                this._handlers[event].push(handler);
            },
            emit(event, data) {
                (this._handlers[event] || []).forEach(h => h(data));
            }
        };

        container = document.getElementById('tool-container');

        try {
            const { ToolExecution } = await import(
                '../../../src/webview/app/components/ToolExecution/ToolExecution.js'
            );
            toolExec = new ToolExecution(container, eventBus);
        } catch (e) {
            // Import may fail in the test environment — handled by skip below
        }
    });

    beforeEach(function () {
        if (!toolExec) this.skip();
        container.innerHTML = '';
    });

    after(() => {
        delete global.window;
        delete global.document;
        if (dom && dom.window) {
            dom.window.close();
        }
    });

    // ---------------------------------------------------------------
    // Helper: render toolState through buildToolHtml and parse result
    // ---------------------------------------------------------------
    function renderToDOM(toolState) {
        const html = toolExec.buildToolHtml(toolState);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        return wrapper;
    }

    /** Minimal valid tool state without any diff data. */
    function baseToolState(overrides = {}) {
        return {
            toolCallId: 'test-1',
            toolName: 'edit',
            status: 'complete',
            startTime: Date.now(),
            endTime: Date.now() + 1000,
            ...overrides
        };
    }

    // ---------------------------------------------------------------
    // 1. No inline diff when diffLines absent
    // ---------------------------------------------------------------
    it('does not render inline diff when diffLines is absent', () => {
        const wrapper = renderToDOM(baseToolState());

        const inlineDiff = wrapper.querySelector('.inline-diff');
        assert.equal(inlineDiff, null, 'Should NOT render .inline-diff when diffLines is absent');
    });

    // ---------------------------------------------------------------
    // 2. Renders inline diff div when diffLines present
    // ---------------------------------------------------------------
    it('renders inline diff div when diffLines present', () => {
        const toolState = baseToolState({
            diffLines: [{ type: 'add', text: 'hello world' }],
            diffTruncated: false,
            diffTotalLines: 1
        });

        const wrapper = renderToDOM(toolState);

        const inlineDiff = wrapper.querySelector('.inline-diff');
        assert.ok(inlineDiff, 'Should render .inline-diff container');
    });

    // ---------------------------------------------------------------
    // 3. Renders add lines with correct class
    // ---------------------------------------------------------------
    it('renders add lines with diff-add class and "+" prefix', () => {
        const toolState = baseToolState({
            diffLines: [{ type: 'add', text: 'new line' }],
            diffTruncated: false,
            diffTotalLines: 1
        });

        const wrapper = renderToDOM(toolState);

        const addLine = wrapper.querySelector('.diff-line.diff-add');
        assert.ok(addLine, 'Should render a .diff-line.diff-add element');
        assert.equal(addLine.textContent, '+ new line',
            'Add line should have "+" prefix followed by the text');
    });

    // ---------------------------------------------------------------
    // 4. Renders remove lines with correct class
    // ---------------------------------------------------------------
    it('renders remove lines with diff-remove class and "-" prefix', () => {
        const toolState = baseToolState({
            diffLines: [{ type: 'remove', text: 'old line' }],
            diffTruncated: false,
            diffTotalLines: 1
        });

        const wrapper = renderToDOM(toolState);

        const removeLine = wrapper.querySelector('.diff-line.diff-remove');
        assert.ok(removeLine, 'Should render a .diff-line.diff-remove element');
        assert.equal(removeLine.textContent, '- old line',
            'Remove line should have "-" prefix followed by the text');
    });

    // ---------------------------------------------------------------
    // 5. Renders context lines with correct class
    // ---------------------------------------------------------------
    it('renders context lines with diff-context class and two-space prefix', () => {
        const toolState = baseToolState({
            diffLines: [{ type: 'context', text: 'unchanged' }],
            diffTruncated: false,
            diffTotalLines: 1
        });

        const wrapper = renderToDOM(toolState);

        const contextLine = wrapper.querySelector('.diff-line.diff-context');
        assert.ok(contextLine, 'Should render a .diff-line.diff-context element');
        assert.equal(contextLine.textContent, '  unchanged',
            'Context line should have two-space prefix followed by the text');
    });

    // ---------------------------------------------------------------
    // 6. Renders multiple diff lines in order
    // ---------------------------------------------------------------
    it('renders multiple diff lines in the correct order', () => {
        const toolState = baseToolState({
            diffLines: [
                { type: 'remove', text: 'old code' },
                { type: 'add', text: 'new code' },
                { type: 'context', text: 'same code' }
            ],
            diffTruncated: false,
            diffTotalLines: 3
        });

        const wrapper = renderToDOM(toolState);

        const lines = wrapper.querySelectorAll('.diff-line');
        assert.equal(lines.length, 3, 'Should render exactly 3 diff lines');

        // First line: remove
        assert.ok(lines[0].classList.contains('diff-remove'),
            'First line should have diff-remove class');
        assert.equal(lines[0].textContent, '- old code');

        // Second line: add
        assert.ok(lines[1].classList.contains('diff-add'),
            'Second line should have diff-add class');
        assert.equal(lines[1].textContent, '+ new code');

        // Third line: context
        assert.ok(lines[2].classList.contains('diff-context'),
            'Third line should have diff-context class');
        assert.equal(lines[2].textContent, '  same code');
    });

    // ---------------------------------------------------------------
    // 7. Shows truncation message
    // ---------------------------------------------------------------
    it('shows truncation message when diffTruncated is true', () => {
        const displayedLines = 10;
        const totalLines = 24;
        const remaining = totalLines - displayedLines;

        const toolState = baseToolState({
            diffLines: Array.from({ length: displayedLines }, (_, i) => ({
                type: 'context',
                text: `line ${i + 1}`
            })),
            diffTruncated: true,
            diffTotalLines: totalLines
        });

        const wrapper = renderToDOM(toolState);

        const truncated = wrapper.querySelector('.diff-truncated');
        assert.ok(truncated, 'Should render a .diff-truncated element');
        assert.equal(truncated.textContent, `... ${remaining} more lines`,
            `Truncation message should read "... ${remaining} more lines"`);
    });

    // ---------------------------------------------------------------
    // 8. No truncation message when not truncated
    // ---------------------------------------------------------------
    it('does not show truncation message when diffTruncated is false', () => {
        const toolState = baseToolState({
            diffLines: [
                { type: 'add', text: 'line a' },
                { type: 'add', text: 'line b' }
            ],
            diffTruncated: false,
            diffTotalLines: 2
        });

        const wrapper = renderToDOM(toolState);

        const truncated = wrapper.querySelector('.diff-truncated');
        assert.equal(truncated, null,
            'Should NOT render .diff-truncated when diffTruncated is false');
    });

    // ---------------------------------------------------------------
    // 9. Escapes HTML in diff lines
    // ---------------------------------------------------------------
    it('escapes HTML entities in diff line text', () => {
        const toolState = baseToolState({
            diffLines: [{ type: 'add', text: '<script>alert("xss")</script>' }],
            diffTruncated: false,
            diffTotalLines: 1
        });

        const wrapper = renderToDOM(toolState);

        const addLine = wrapper.querySelector('.diff-line.diff-add');
        assert.ok(addLine, 'Should render the diff line');

        // The raw <script> tag must NOT appear as an actual element
        const scripts = wrapper.querySelectorAll('script');
        assert.equal(scripts.length, 0,
            'Script tags in diff text must be escaped, not rendered as HTML');

        // The text content should preserve the original characters
        assert.ok(addLine.textContent.includes('<script>'),
            'Escaped text should still appear in textContent');
    });

    // ---------------------------------------------------------------
    // 10. View Diff button still renders alongside inline diff
    // ---------------------------------------------------------------
    it('renders both View Diff button and inline diff when both hasDiff and diffLines are present', () => {
        const toolState = baseToolState({
            hasDiff: true,
            diffData: {
                beforeUri: '/tmp/before.txt',
                afterUri: '/workspace/after.txt'
            },
            diffLines: [
                { type: 'remove', text: 'before' },
                { type: 'add', text: 'after' }
            ],
            diffTruncated: false,
            diffTotalLines: 2
        });

        const wrapper = renderToDOM(toolState);

        // View Diff button should still be present (existing behavior)
        const diffBtn = wrapper.querySelector('.tool-execution__diff-btn');
        assert.ok(diffBtn, 'View Diff button should render when hasDiff is true');
        assert.ok(diffBtn.textContent.includes('View Diff'),
            'Button text should include "View Diff"');

        // Inline diff should also be present (new behavior)
        const inlineDiff = wrapper.querySelector('.inline-diff');
        assert.ok(inlineDiff, 'Inline diff should render alongside the View Diff button');

        const lines = inlineDiff.querySelectorAll('.diff-line');
        assert.equal(lines.length, 2, 'Inline diff should contain 2 diff lines');
    });
});
