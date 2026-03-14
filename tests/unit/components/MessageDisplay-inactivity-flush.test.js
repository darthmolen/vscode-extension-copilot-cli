/**
 * TDD tests for Part 4 — Inactivity Flush Timer
 *
 * RED phase: Tests FAIL before implementation.
 *
 * Problem: _flushSafeMarkdown requires \n\n to flush a paragraph. When the model
 * writes "because:" and then calls a tool, the streaming buffer stalls — never
 * gets the \n\n — so the text stays invisible for 60+ seconds until the tool
 * returns and the assistant.message finalization fires.
 *
 * Fix: A 1.5s inactivity timer in _renderDeltaProgress. When 1.5s passes with
 * no new delta, force-flush the entire pending buffer regardless of markdown safety.
 * Clear the timer on finalization to prevent double-render race.
 *
 * Tests:
 * 1. After 1.5s inactivity, pending buffer is flushed to DOM
 * 2. New delta resets the timer (no premature flush while actively streaming)
 * 3. Finalization clears the timer (no double-render after assistant.message)
 * 4. flushTimer is tracked on state object (source scan)
 */

const assert = require('assert');
const { createComponentDOM, cleanupComponentDOM } = require('../../helpers/jsdom-component-setup');

describe('MessageDisplay — inactivity flush timer (Part 4)', function () {
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

        // Install fake timers (save originals to restore in afterEach)
        const realSetTimeout = global.setTimeout;
        const realClearTimeout = global.clearTimeout;
        clock = { timers: [], now: Date.now(), _realSetTimeout: realSetTimeout, _realClearTimeout: realClearTimeout };

        // Track all setTimeout calls and allow manual advance
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

        // Expose tick function
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
        // Restore real timers before cleanup
        global.setTimeout = clock._realSetTimeout;
        global.clearTimeout = clock._realClearTimeout;

        cleanupComponentDOM(dom);
        delete global.marked;
    });

    // =========================================================================
    // 1. Inactivity flush: after 1.5s buffer flushed even without \n\n
    // =========================================================================

    it('flushes pending buffer after 1.5s of inactivity', function () {
        // Send a delta that won't be flushed by _flushSafeMarkdown (no \n\n)
        eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'because:' });

        // Before timer fires: content NOT visible (buffer stalled)
        const bubble = md.messagesContainer.querySelector('[data-message-id="msg-1"]');
        assert.ok(bubble, 'Streaming bubble must exist');

        // contentEl should be empty because no \n\n yet and deltaCount < 2 threshold or no flush
        // Actually deltaCount=1 so still hidden... but let's send a second to make it visible
        eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: ' more text' });
        
        // After 2 deltas, bubble is visible but buffer not yet flushed (no \n\n)
        const contentEl = bubble.querySelector('.message-display__content');
        assert.strictEqual(contentEl.innerHTML, '', 'Buffer should not be flushed yet without \\n\\n');

        // Advance clock by 1.5s — inactivity timer should fire
        clock.tick(1500);

        // Now the buffer should be flushed to DOM
        assert.ok(
            contentEl.innerHTML.length > 0,
            'Buffer should be flushed to DOM after 1.5s inactivity'
        );
        assert.ok(
            contentEl.innerHTML.includes('because:') || contentEl.textContent.includes('because:'),
            'Flushed content should contain the pending text'
        );
    });

    // =========================================================================
    // 2. New delta resets the timer
    // =========================================================================

    it('resets the inactivity timer when new delta arrives', function () {
        // Start streaming
        eventBus.emit('message:delta', { messageId: 'msg-2', deltaContent: 'First ' });
        eventBus.emit('message:delta', { messageId: 'msg-2', deltaContent: 'second ' });

        const countBefore = clock.pendingTimers.size;
        assert.ok(countBefore >= 1, 'A timer must be scheduled after deltas');

        // Advance 1000ms (less than 1500ms threshold)
        clock.tick(1000);

        const bubble = md.messagesContainer.querySelector('[data-message-id="msg-2"]');
        const contentEl = bubble.querySelector('.message-display__content');
        const htmlBefore = contentEl.innerHTML;

        // New delta arrives — should reset timer
        eventBus.emit('message:delta', { messageId: 'msg-2', deltaContent: 'third ' });

        // Advance another 1000ms (total 2000ms from start, but only 1000ms since last delta)
        clock.tick(1000);

        // Should NOT have flushed yet (timer was reset 1000ms ago, threshold is 1500ms)
        // Note: if no \n\n in buffer, contentEl should still be empty (not yet flushed)
        // This test verifies the timer was reset, not that content was flushed
        const timersAfterReset = clock.pendingTimers.size;
        assert.ok(timersAfterReset >= 1, 'Timer must still be pending after reset (not yet fired)');
    });

    // =========================================================================
    // 3. Finalization clears the timer
    // =========================================================================

    it('clears the inactivity timer on streaming finalization', function () {
        // Start streaming
        eventBus.emit('message:delta', { messageId: 'msg-3', deltaContent: 'some content' });
        eventBus.emit('message:delta', { messageId: 'msg-3', deltaContent: ' more content' });

        assert.ok(clock.pendingTimers.size >= 1, 'Timer must be scheduled');

        // Finalize with message:add
        eventBus.emit('message:add', {
            role: 'assistant',
            content: 'some content more content and final.',
            messageId: 'msg-3',
            timestamp: Date.now()
        });

        // After finalization, the streamingBubbles entry is deleted
        assert.ok(!md.streamingBubbles.has('msg-3'), 'Bubble must be removed from tracking after finalization');

        // Advance clock — timer should NOT fire (was cleared on finalization)
        const htmlAfterFinalize = md.messagesContainer.querySelector('[data-message-id="msg-3"]')
            ?.querySelector('.message-display__content')?.innerHTML;

        clock.tick(1500);

        // Content should reflect the finalized text, NOT be rendered again by the stale timer
        const htmlAfterTick = md.messagesContainer.querySelector('[data-message-id="msg-3"]')
            ?.querySelector('.message-display__content')?.innerHTML;

        assert.strictEqual(htmlAfterTick, htmlAfterFinalize, 
            'HTML should not change after finalization when timer fires (timer was cleared)');
    });

    // =========================================================================
    // 4. Source scan: flushTimer tracked on state object
    // =========================================================================

    it('tracks flushTimer on the streaming state object', function () {
        const fs = require('fs');
        const src = fs.readFileSync(
            require('path').join(__dirname, '../../../src/webview/app/components/MessageDisplay/MessageDisplay.js'),
            'utf8'
        );

        assert.ok(
            src.includes('flushTimer'),
            'MessageDisplay.js must reference flushTimer on state'
        );
        assert.ok(
            src.includes('clearTimeout') && src.includes('flushTimer'),
            'MessageDisplay.js must call clearTimeout on flushTimer'
        );
        assert.ok(
            src.includes('1500') || src.includes('INACTIVITY_FLUSH_MS') || src.includes('1_500'),
            'MessageDisplay.js must define the 1500ms inactivity threshold'
        );
    });
});
