/**
 * TDD tests for typing indicator in streaming assistant bubbles
 *
 * RED phase: Tests FAIL before implementation.
 * Pattern: JSDOM + real MessageDisplay + real EventBus + fake timers.
 *
 * Covers:
 * 1. Typing indicator present after bubble creation (before content flush)
 * 2. Typing indicator removed after content flush (_flushSafeMarkdown)
 * 3. Typing indicator removed on inactivity flush (1.5s timer)
 * 4. Typing indicator removed on finalization (message:add)
 * 5. No typing indicator in non-streaming bubbles (direct addMessage)
 */

const assert = require('assert');
const { createComponentDOM, cleanupComponentDOM } = require('../../helpers/jsdom-component-setup');

describe('MessageDisplay — typing indicator (JSDOM)', function () {
    this.timeout(10000);

    let dom;
    let MessageDisplay;
    let EventBus;
    let container;
    let eventBus;
    let md;
    let clock;

    before(async function () {
        const mdModule = await import('../../../src/webview/app/components/MessageDisplay/MessageDisplay.js');
        MessageDisplay = mdModule.MessageDisplay;

        const busModule = await import('../../../src/webview/app/state/EventBus.js');
        EventBus = busModule.EventBus;
    });

    beforeEach(function () {
        dom = createComponentDOM();
        global.marked = { parse: (text) => `<p>${text}</p>` };

        // Install fake timers
        const realSetTimeout = global.setTimeout;
        const realClearTimeout = global.clearTimeout;
        clock = { timers: [], now: Date.now(), _realSetTimeout: realSetTimeout, _realClearTimeout: realClearTimeout };

        const pendingTimers = new Map();
        let timerIdCounter = 1000;

        global.setTimeout = (fn, delay) => {
            const id = timerIdCounter++;
            pendingTimers.set(id, { fn, delay, scheduled: clock.now });
            return id;
        };
        global.clearTimeout = (id) => {
            pendingTimers.delete(id);
        };

        clock.tick = (ms) => {
            clock.now += ms;
            for (const [id, timer] of Array.from(pendingTimers.entries())) {
                if (clock.now >= timer.scheduled + timer.delay) {
                    pendingTimers.delete(id);
                    timer.fn();
                }
            }
        };

        clock.pendingTimers = pendingTimers;

        container = document.getElementById('messages-mount');
        eventBus = new EventBus();
        md = new MessageDisplay(container, eventBus);
    });

    afterEach(function () {
        global.setTimeout = clock._realSetTimeout;
        global.clearTimeout = clock._realClearTimeout;
        cleanupComponentDOM(dom);
        delete global.marked;
    });

    // =========================================================================
    // 1. Typing indicator present after bubble creation
    // =========================================================================

    it('streaming bubble has typing indicator after first delta', function () {
        eventBus.emit('message:delta', { messageId: 'ti-1', deltaContent: 'Hello' });

        const bubble = md.messagesContainer.querySelector('[data-message-id="ti-1"]');
        assert.ok(bubble, 'Streaming bubble must exist');

        const indicator = bubble.querySelector('.typing-indicator');
        assert.ok(indicator, 'Typing indicator must be present in streaming bubble');

        const dots = indicator.querySelectorAll('.typing-indicator__dot');
        assert.strictEqual(dots.length, 3, 'Typing indicator must have 3 dots');
    });

    it('typing indicator is inside contentEl (message-display__content)', function () {
        eventBus.emit('message:delta', { messageId: 'ti-2', deltaContent: 'Hi' });

        const bubble = md.messagesContainer.querySelector('[data-message-id="ti-2"]');
        const contentEl = bubble.querySelector('.message-display__content');
        assert.ok(contentEl, 'Content element must exist');

        const indicator = contentEl.querySelector('.typing-indicator');
        assert.ok(indicator, 'Typing indicator must be inside contentEl');
    });

    // =========================================================================
    // 2. Typing indicator removed after content flush
    // =========================================================================

    it('typing indicator removed when _flushSafeMarkdown renders content', function () {
        // Send enough deltas to make bubble visible (deltaCount >= 2) with a complete paragraph
        eventBus.emit('message:delta', { messageId: 'ti-3', deltaContent: 'Hello world' });
        eventBus.emit('message:delta', { messageId: 'ti-3', deltaContent: '\n\nSecond paragraph' });

        const bubble = md.messagesContainer.querySelector('[data-message-id="ti-3"]');
        const contentEl = bubble.querySelector('.message-display__content');

        // After flush, typing indicator should be gone
        const indicator = contentEl.querySelector('.typing-indicator');
        assert.strictEqual(indicator, null, 'Typing indicator must be removed after content flush');

        // Real content should be present
        assert.ok(contentEl.innerHTML.length > 0, 'Content should have been flushed');
    });

    // =========================================================================
    // 3. Typing indicator removed on inactivity flush
    // =========================================================================

    it('typing indicator removed when inactivity timer fires', function () {
        eventBus.emit('message:delta', { messageId: 'ti-4', deltaContent: 'because:' });
        eventBus.emit('message:delta', { messageId: 'ti-4', deltaContent: ' thinking' });

        const bubble = md.messagesContainer.querySelector('[data-message-id="ti-4"]');
        const contentEl = bubble.querySelector('.message-display__content');

        // Before timer: indicator should still be present (no \n\n to trigger flush)
        const indicatorBefore = contentEl.querySelector('.typing-indicator');
        assert.ok(indicatorBefore, 'Typing indicator should still be present before inactivity flush');

        // Advance clock past 1.5s
        clock.tick(1500);

        // After timer: indicator should be gone, content should be present
        const indicatorAfter = contentEl.querySelector('.typing-indicator');
        assert.strictEqual(indicatorAfter, null, 'Typing indicator must be removed after inactivity flush');
        assert.ok(contentEl.innerHTML.includes('because:') || contentEl.textContent.includes('because:'),
            'Content should be flushed after inactivity');
    });

    // =========================================================================
    // 4. Typing indicator removed on finalization
    // =========================================================================

    it('typing indicator removed when message finalizes via message:add', function () {
        eventBus.emit('message:delta', { messageId: 'ti-5', deltaContent: 'partial' });

        const bubble = md.messagesContainer.querySelector('[data-message-id="ti-5"]');

        // Finalize
        eventBus.emit('message:add', {
            role: 'assistant',
            content: 'partial content complete.',
            messageId: 'ti-5',
            timestamp: Date.now()
        });

        const indicator = bubble.querySelector('.typing-indicator');
        assert.strictEqual(indicator, null, 'Typing indicator must be removed after finalization');
    });

    // =========================================================================
    // 5. No typing indicator in non-streaming bubbles
    // =========================================================================

    it('no typing indicator in non-streaming assistant messages', function () {
        eventBus.emit('message:add', {
            role: 'assistant',
            content: 'Direct message, no streaming',
            messageId: 'ti-6',
            timestamp: Date.now()
        });

        const bubble = md.messagesContainer.querySelector('.message-display__item--assistant');
        assert.ok(bubble, 'Assistant bubble must exist');

        const indicator = bubble.querySelector('.typing-indicator');
        assert.strictEqual(indicator, null, 'Non-streaming bubbles must not have typing indicator');
    });
});
