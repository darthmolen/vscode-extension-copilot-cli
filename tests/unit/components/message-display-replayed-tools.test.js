/**
 * Replayed tool entries render as real tool chips (v3.13.0 P2)
 *
 * The bug in one line: `handleInitMessage` collapsed `type` into `role` and dropped
 * everything else, so every tool call in a restored transcript came back as a plain
 * bubble reading "Tool execution", frozen at running.
 *
 * The fix renders them through the same `buildToolHtml` the live path uses — a pure
 * function of tool state — without touching the live lifecycle. So these tests
 * assert two things at once: the chip is real, and nothing on the live path fired.
 */

const { describe, it, before, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { createComponentDOM, cleanupComponentDOM } = require(
    path.join(__dirname, '../../helpers/jsdom-component-setup.js')
);

let MessageDisplay, EventBus, dom;

before(async () => {
    // Imported once; the DOM itself is built per test — see mountDisplay.
    dom = createComponentDOM();
    ({ MessageDisplay } = await import(
        '../../../src/webview/app/components/MessageDisplay/MessageDisplay.js'
    ));
    ({ EventBus } = await import('../../../src/webview/app/state/EventBus.js'));
    cleanupComponentDOM(dom);
});

/**
 * A fresh DOM per test.
 *
 * Not once per file: ~1800 tests share one mocha process and DOM globals leak
 * across files, so a `before`-scoped document can be torn down by another file's
 * cleanup before these tests run. Rebuilding per test costs little and removes the
 * dependency on ordering entirely.
 */
function mountDisplay() {
    dom = createComponentDOM();
    global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    global.cancelAnimationFrame = (id) => clearTimeout(id);

    const container = document.createElement('div');
    container.id = 'messages-mount';
    const existing = document.getElementById('messages-mount');
    if (existing) {
        existing.parentNode.replaceChild(container, existing);
    } else {
        document.querySelector('main').appendChild(container);
    }
    const eventBus = new EventBus();
    return { container, eventBus, display: new MessageDisplay(container, eventBus) };
}

function toolMessage(over = {}) {
    return {
        kind: 'tool',
        content: 'bash',
        timestamp: 1_700_000_000_000,
        tool: {
            toolCallId: 't1',
            toolName: 'bash',
            status: 'complete',
            arguments: { command: 'ls -la' },
            startTime: 1_700_000_000_000,
            endTime: 1_700_000_002_000,
            ...over
        }
    };
}

describe('MessageDisplay — replayed tool entries', () => {
    let container, eventBus, display;

    beforeEach(() => {
        ({ container, eventBus, display } = mountDisplay());
    });

    afterEach(() => {
        cleanupComponentDOM(dom);
    });

    it('renders the real tool name, not "Tool execution"', () => {
        eventBus.emit('message:add', toolMessage({ toolName: 'grep' }));

        const html = container.querySelector('#messages').innerHTML;
        expect(html).to.contain('grep');
        expect(html).to.not.contain('Tool execution');
    });

    it('shows a completed tool as complete, not frozen at running', () => {
        eventBus.emit('message:add', toolMessage({ status: 'complete' }));

        const html = container.querySelector('#messages').innerHTML;
        expect(html).to.contain('✅');   // the live chip's complete icon
        expect(html).to.not.contain('⏳'); // running
    });

    it('shows a failed tool as failed, and why', () => {
        eventBus.emit('message:add', toolMessage({
            status: 'failed',
            error: { message: 'Command failed: ls /nope', code: 'failure' }
        }));

        const html = container.querySelector('#messages').innerHTML;
        expect(html).to.contain('❌');
        expect(html).to.contain('Command failed');
    });

    it('shows an interrupted tool as still running', () => {
        eventBus.emit('message:add', toolMessage({ status: 'running', endTime: undefined }));

        expect(container.querySelector('#messages').innerHTML).to.contain('⏳');
    });

    it('does not render a tool entry as a chat bubble', () => {
        eventBus.emit('message:add', toolMessage());

        const bubbles = container.querySelectorAll('.message-display__item');
        expect(bubbles).to.have.lengthOf(0);
    });

    it('still renders ordinary messages as bubbles', () => {
        eventBus.emit('message:add', { kind: 'user', content: 'hello', timestamp: 1 });

        expect(container.querySelectorAll('.message-display__item')).to.have.lengthOf(1);
    });

    it('leaves the live tool path alone — no tool:start is emitted', () => {
        const fired = [];
        eventBus.on('tool:start', () => fired.push('tool:start'));

        eventBus.emit('message:add', toolMessage());

        expect(fired).to.have.lengthOf(0);
    });
});

describe('ToolExecution — clearing between transcripts', () => {
    let container, eventBus, display;

    beforeEach(() => {
        ({ container, eventBus, display } = mountDisplay());
    });

    afterEach(() => {
        cleanupComponentDOM(dom);
    });

    /**
     * `MessageDisplay.clear()` calls `this.toolExecution.clear()` behind a
     * `typeof === 'function'` guard, and `ToolExecution` had no `clear()` — so the
     * guard was dead and tool state outlived the DOM it pointed at. With
     * `retainContextWhenHidden`, hiding and showing the sidebar re-inits a webview
     * whose ToolExecution still holds groups that `clear()` just wiped.
     */
    it('forgets tool state when the transcript is cleared', () => {
        eventBus.emit('tool:start', { toolCallId: 't1', toolName: 'bash', status: 'running' });

        display.clear();

        expect(display.toolExecution.tools.size).to.equal(0);
        expect(display.toolExecution.currentToolGroup).to.equal(null);
        expect(display.toolExecution.collapsedCards.size).to.equal(0);
    });
});
