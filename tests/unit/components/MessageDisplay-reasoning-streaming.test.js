/**
 * TDD tests for Part 3 — Reasoning Delta Streaming (JSDOM component test)
 *
 * RED phase: Tests FAIL before implementation.
 * Pattern: JSDOM + real MessageDisplay + real EventBus.
 *
 * Covers:
 * 1. showReasoning=true + reasoning:delta → element created with text appended
 * 2. showReasoning=false + reasoning:delta → no element created
 * 3. Final message:add {role:'reasoning', reasoningId} after streaming → finalizes, no duplicate
 * 4. Backward compat: message:add {role:'reasoning'} without reasoningId renders normally
 */

const assert = require('assert');
const { createComponentDOM, cleanupComponentDOM } = require('../../helpers/jsdom-component-setup');

describe('MessageDisplay — reasoning streaming (JSDOM)', function () {
    this.timeout(10000);

    let dom;
    let MessageDisplay;
    let EventBus;
    let container;
    let eventBus;
    let md;

    before(async function () {
        const mdModule = await import('../../../src/webview/app/components/MessageDisplay/MessageDisplay.js');
        MessageDisplay = mdModule.MessageDisplay;

        const busModule = await import('../../../src/webview/app/state/EventBus.js');
        EventBus = busModule.EventBus;
    });

    beforeEach(function () {
        dom = createComponentDOM();
        global.marked = { parse: (text) => `<p>${text}</p>` };

        container = document.getElementById('messages-mount');
        eventBus = new EventBus();
        md = new MessageDisplay(container, eventBus);
    });

    afterEach(function () {
        cleanupComponentDOM(dom);
        delete global.marked;
    });

    // =========================================================================
    // 1. showReasoning=true → delta creates element and appends text
    // =========================================================================

    it('creates a reasoning streaming element when showReasoning=true and delta arrives', function () {
        // Enable reasoning display
        eventBus.emit('reasoning:toggle', true);

        // Send a delta
        eventBus.emit('reasoning:delta', {
            reasoningId: 'reasoning-001',
            deltaContent: 'I need to think about this'
        });

        // A reasoning element should now exist
        const reasoningEl = md.messagesContainer.querySelector('.message-display__item--reasoning');
        assert.ok(reasoningEl, 'Reasoning element should be created when showReasoning=true');
        assert.ok(
            reasoningEl.textContent.includes('I need to think about this'),
            'Reasoning element should contain the delta text'
        );
    });

    it('appends multiple deltas to the same element keyed by reasoningId', function () {
        eventBus.emit('reasoning:toggle', true);

        eventBus.emit('reasoning:delta', { reasoningId: 'reasoning-002', deltaContent: 'First chunk. ' });
        eventBus.emit('reasoning:delta', { reasoningId: 'reasoning-002', deltaContent: 'Second chunk.' });

        const reasoningEls = md.messagesContainer.querySelectorAll('.message-display__item--reasoning');
        assert.strictEqual(reasoningEls.length, 1, 'Should be exactly one reasoning element for same reasoningId');
        assert.ok(reasoningEls[0].textContent.includes('First chunk.'), 'Should contain first chunk');
        assert.ok(reasoningEls[0].textContent.includes('Second chunk.'), 'Should contain second chunk');
    });

    it('stores streaming bubble in reasoningStreamingBubbles Map', function () {
        eventBus.emit('reasoning:toggle', true);

        eventBus.emit('reasoning:delta', { reasoningId: 'reasoning-003', deltaContent: 'Thinking...' });

        assert.ok(md.reasoningStreamingBubbles, 'reasoningStreamingBubbles Map must exist');
        assert.ok(md.reasoningStreamingBubbles.has('reasoning-003'), 'Must track streaming bubble by reasoningId');
    });

    // =========================================================================
    // 2. showReasoning=false → delta is ignored, no element created
    // =========================================================================

    it('does NOT create a reasoning element when showReasoning=false (default)', function () {
        // showReasoning defaults to false — do NOT enable it

        eventBus.emit('reasoning:delta', {
            reasoningId: 'reasoning-004',
            deltaContent: 'Secret thinking'
        });

        const reasoningEl = md.messagesContainer.querySelector('.message-display__item--reasoning');
        assert.strictEqual(reasoningEl, null, 'Should NOT create reasoning element when showReasoning=false');
    });

    // =========================================================================
    // 3. Finalization: message:add with reasoningId → finalizes streaming bubble
    // =========================================================================

    it('finalizes streaming bubble on message:add with matching reasoningId', function () {
        eventBus.emit('reasoning:toggle', true);

        // Stream some deltas
        eventBus.emit('reasoning:delta', { reasoningId: 'reasoning-005', deltaContent: 'Let me consider' });
        eventBus.emit('reasoning:delta', { reasoningId: 'reasoning-005', deltaContent: ' this carefully.' });

        assert.ok(md.reasoningStreamingBubbles.has('reasoning-005'), 'Bubble must be tracked before finalization');

        // Final reasoning message arrives
        eventBus.emit('message:add', {
            role: 'reasoning',
            content: 'Let me consider this carefully.',
            reasoningId: 'reasoning-005',
            timestamp: Date.now()
        });

        // Bubble removed from tracking map
        assert.ok(!md.reasoningStreamingBubbles.has('reasoning-005'), 'Bubble must be removed from map after finalization');

        // Only one reasoning element (no duplicate)
        const reasoningEls = md.messagesContainer.querySelectorAll('.message-display__item--reasoning');
        assert.strictEqual(reasoningEls.length, 1, 'Should be exactly one reasoning element (no duplicate)');

        // Content should match final canonical text
        assert.ok(reasoningEls[0].textContent.includes('Let me consider this carefully.'), 
            'Finalized element should contain canonical text');
    });

    // =========================================================================
    // 4. Backward compat: message:add without reasoningId renders normally
    // =========================================================================

    // =========================================================================
    // 5. Streaming reasoning bubble has styled header matching finalized bubble
    // =========================================================================

    it('streaming reasoning bubble has "Assistant Reasoning" header with italic style', function () {
        eventBus.emit('reasoning:toggle', true);

        eventBus.emit('reasoning:delta', {
            reasoningId: 'reasoning-styled-001',
            deltaContent: 'Thinking deeply...'
        });

        const reasoningEl = md.messagesContainer.querySelector('.message-display__item--reasoning');
        assert.ok(reasoningEl, 'Reasoning element should exist');

        // Must have styled header matching finalized bubble
        const header = reasoningEl.querySelector('.message-display__header');
        assert.ok(header, 'Streaming reasoning bubble must have a .message-display__header');
        assert.ok(header.textContent.includes('Assistant Reasoning'),
            'Header must say "Assistant Reasoning"');
        assert.strictEqual(header.style.fontStyle, 'italic', 'Header must be italic');
    });

    it('streaming reasoning bubble has "message" class on outer div', function () {
        eventBus.emit('reasoning:toggle', true);

        eventBus.emit('reasoning:delta', {
            reasoningId: 'reasoning-styled-002',
            deltaContent: 'More thinking...'
        });

        const reasoningEl = md.messagesContainer.querySelector('.message-display__item--reasoning');
        assert.ok(reasoningEl.classList.contains('message'),
            'Streaming reasoning bubble must have "message" class');
    });

    it('streaming reasoning bubble content div has message-display__content class', function () {
        eventBus.emit('reasoning:toggle', true);

        eventBus.emit('reasoning:delta', {
            reasoningId: 'reasoning-styled-003',
            deltaContent: 'Content here'
        });

        const reasoningEl = md.messagesContainer.querySelector('.message-display__item--reasoning');
        const contentEl = reasoningEl.querySelector('.message-display__content');
        assert.ok(contentEl, 'Content div must have .message-display__content class');
        assert.ok(contentEl.textContent.includes('Content here'),
            'Content must contain delta text');
        assert.strictEqual(contentEl.style.fontStyle, 'italic', 'Content must be italic');
    });

    // =========================================================================
    // 6. Backward compat: message:add without reasoningId renders normally
    // =========================================================================

    it('calls autoScroll after reasoning:delta appends content', function () {
        eventBus.emit('reasoning:toggle', true);

        let scrollCalled = false;
        const origAutoScroll = md.autoScroll.bind(md);
        md.autoScroll = function () {
            scrollCalled = true;
            origAutoScroll();
        };

        eventBus.emit('reasoning:delta', {
            reasoningId: 'reasoning-scroll-001',
            deltaContent: 'Scrollable reasoning content'
        });

        assert.ok(scrollCalled, 'autoScroll must be called after reasoning:delta');
    });

    it('renders reasoning element normally when no reasoningId (history replay)', function () {
        // Enable reasoning to see it
        eventBus.emit('reasoning:toggle', true);

        // History replay: no reasoningId, no streaming bubble
        eventBus.emit('message:add', {
            role: 'reasoning',
            content: 'Historical reasoning content',
            timestamp: Date.now()
        });

        const reasoningEls = md.messagesContainer.querySelectorAll('.message-display__item--reasoning');
        assert.strictEqual(reasoningEls.length, 1, 'Should create one reasoning element for history replay');
        assert.ok(reasoningEls[0].textContent.includes('Historical reasoning content'),
            'Historical reasoning content should be visible');
    });
});
