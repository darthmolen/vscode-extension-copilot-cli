/**
 * TDD tests for Phase 6b — Streaming MessageDisplay
 *
 * RED phase: Groups B/C/D/E FAIL before implementation.
 * Group A (regression) must PASS immediately.
 *
 * Pattern: JSDOM + createComponentDOM() + CJS require of actual MessageDisplay.js
 */

const assert = require('assert');
const { createComponentDOM, cleanupComponentDOM } = require('../../helpers/jsdom-component-setup');

describe('MessageDisplay - streaming', function () {
    let dom, eventBus, messageDisplay;

    beforeEach(function () {
        dom = createComponentDOM();
        global.marked = {
            parse: (text) => {
                // Minimal code fence handling for test assertions
                if (text.trim().startsWith('```')) return `<pre>${text}</pre>`;
                return `<p>${text}</p>`;
            }
        };

        const { EventBus } = require('../../../src/webview/app/state/EventBus.js');
        eventBus = new EventBus();

        const { MessageDisplay } = require('../../../src/webview/app/components/MessageDisplay/MessageDisplay.js');
        const container = document.getElementById('messages-mount');
        messageDisplay = new MessageDisplay(container, eventBus);
    });

    afterEach(function () {
        cleanupComponentDOM(dom);
    });

    // =========================================================================
    // Group A — Regression (must PASS immediately — before any implementation)
    // =========================================================================

    describe('Group A — Regression', function () {
        it('addMessage() with no streaming bubble still renders as today', function () {
            eventBus.emit('message:add', { role: 'assistant', content: 'Hello world', messageId: 'no-stream' });
            const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
            assert.ok(bubble, 'assistant bubble must exist when added via message:add with no prior delta');
            assert.ok(bubble.innerHTML.includes('Hello world'), 'bubble must contain the message content');
        });

        it('tool-call message (empty content) renders without error', function () {
            assert.doesNotThrow(() => {
                eventBus.emit('message:add', { role: 'assistant', content: '', messageId: 'tool-call-turn' });
            });
        });

        it('user message still renders normally', function () {
            eventBus.emit('message:add', { role: 'user', content: 'Hello' });
            const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--user');
            assert.ok(bubble, 'user bubble must exist');
        });
    });

    // =========================================================================
    // Group B — Bubble lifecycle (must FAIL before implementation)
    // =========================================================================

    describe('Group B — Bubble lifecycle', function () {
        it('first delta creates streaming bubble in DOM immediately', function () {
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'Hello' });
            const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
            assert.ok(bubble, 'streaming bubble must exist in DOM after first delta');
        });

        it('streaming bubble starts hidden (streaming-hidden class) until deltaCount >= 2', function () {
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'Hello' });
            const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
            assert.ok(bubble, 'streaming bubble must exist');
            assert.ok(
                bubble.classList.contains('streaming-hidden'),
                'bubble must have streaming-hidden class after first delta (hidden until 2+ deltas)'
            );
        });

        it('bubble becomes visible (streaming-hidden removed) after second delta', function () {
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'Hello' });
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: ' world' });
            const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
            assert.ok(bubble, 'streaming bubble must exist');
            assert.ok(
                !bubble.classList.contains('streaming-hidden'),
                'streaming-hidden must be removed after deltaCount >= 2'
            );
        });

        it('streamingBubbles map tracks active bubble by messageId', function () {
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'Hello' });
            assert.ok(
                messageDisplay.streamingBubbles && messageDisplay.streamingBubbles.has('msg-1'),
                'streamingBubbles map must exist and track msg-1'
            );
        });

        it('second delta for same messageId reuses existing bubble (no duplicate)', function () {
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'Hello' });
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: ' world' });
            const bubbles = messageDisplay.messagesContainer.querySelectorAll('.message-display__item--assistant');
            assert.strictEqual(bubbles.length, 1, 'only one bubble must exist for the same messageId');
        });
    });

    // =========================================================================
    // Group C — GPT progressive rendering (must FAIL before implementation)
    // =========================================================================

    describe('Group C — GPT progressive rendering', function () {
        it('completed paragraph is rendered as HTML before response ends', function () {
            // Paragraph complete when \n\n arrives
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'First paragraph' });
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: '\n\nSecond' });
            const state = messageDisplay.streamingBubbles && messageDisplay.streamingBubbles.get('msg-1');
            assert.ok(state, 'streaming state must exist');
            assert.ok(
                state.contentEl.innerHTML.includes('<p>'),
                `paragraph must be rendered as HTML before response ends, got: ${state.contentEl.innerHTML}`
            );
        });

        it('code fence buffers until closing ``` before rendering', function () {
            const deltas = ['```js\n', 'const x = 1;\n', '```\n'];
            deltas.forEach(d =>
                eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: d })
            );
            const state = messageDisplay.streamingBubbles && messageDisplay.streamingBubbles.get('msg-1');
            assert.ok(state, 'streaming state must exist');
            assert.ok(
                state.contentEl.innerHTML.includes('<pre>'),
                `code fence must render as <pre> after closing fence, got: ${state.contentEl.innerHTML}`
            );
        });

        it('image syntax buffers until ) then renders as <img>', function () {
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: '![alt' });
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: '](https://example.com/img.png)' });
            const state = messageDisplay.streamingBubbles && messageDisplay.streamingBubbles.get('msg-1');
            assert.ok(state, 'streaming state must exist');
            assert.ok(
                state.contentEl.innerHTML.includes('<img') || state.contentEl.innerHTML.includes('img.png'),
                `<img> must exist after image syntax completes, got: ${state.contentEl.innerHTML}`
            );
        });
    });

    // =========================================================================
    // Group D — Finalization (must FAIL before implementation)
    // =========================================================================

    describe('Group D — Finalization', function () {
        it('GPT: final message:add flushes remaining buffer and removes bubble from map', function () {
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'Hello ' });
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'world' });
            eventBus.emit('message:add', { role: 'assistant', content: 'Hello world', messageId: 'msg-1' });

            const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
            assert.ok(bubble, 'finalized bubble must still exist in DOM');
            assert.ok(
                messageDisplay.streamingBubbles && !messageDisplay.streamingBubbles.has('msg-1'),
                'bubble must be removed from streamingBubbles map after finalization'
            );
        });

        it('Claude: single delta + message:add triggers fade-in (streaming-hidden removed)', function () {
            // Claude sends 1 delta = full response, bubble was hidden
            eventBus.emit('message:delta', { messageId: 'msg-claude', deltaContent: 'Hello streaming world.' });
            eventBus.emit('message:add', { role: 'assistant', content: 'Hello streaming world.', messageId: 'msg-claude' });

            const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
            assert.ok(bubble, 'bubble must exist after finalization');
            assert.ok(
                !bubble.classList.contains('streaming-hidden'),
                'streaming-hidden must be removed on finalize (Claude path)'
            );
            assert.ok(
                bubble.classList.contains('streaming-fade-in'),
                'streaming-fade-in class must be added on finalize'
            );
        });

        it('tool-call: message:add with no prior delta renders normally (no streaming state)', function () {
            eventBus.emit('message:add', { role: 'assistant', content: '**bold**', messageId: 'msg-tool' });
            const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
            assert.ok(bubble, 'bubble must exist');
            assert.ok(
                !messageDisplay.streamingBubbles || !messageDisplay.streamingBubbles.has('msg-tool'),
                'no streaming state for non-streamed message'
            );
        });

        it('finalized bubble content contains rendered markdown', function () {
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: '**bold**' });
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: ' text' });
            eventBus.emit('message:add', { role: 'assistant', content: '**bold** text', messageId: 'msg-1' });

            const bubble = messageDisplay.messagesContainer.querySelector('.message-display__item--assistant');
            assert.ok(bubble, 'bubble must exist');
            // marked.parse is mocked to wrap in <p>
            assert.ok(
                bubble.innerHTML.includes('<p>') || bubble.innerHTML.includes('bold'),
                `bubble must have rendered content, got: ${bubble.innerHTML}`
            );
        });
    });

    // =========================================================================
    // Group E — Auto-scroll (must FAIL before implementation)
    // =========================================================================

    describe('Group E — Auto-scroll', function () {
        it('autoScroll() is called after a paragraph flush during streaming', function () {
            let scrollCalls = 0;
            messageDisplay.autoScroll = () => { scrollCalls++; };

            // First delta — bubble created but hidden
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: 'Hello' });
            // Second delta — bubble becomes visible, triggers flush on \n\n
            eventBus.emit('message:delta', { messageId: 'msg-1', deltaContent: ' world\n\n' });

            assert.ok(scrollCalls >= 1, `autoScroll must be called at least once during streaming, called ${scrollCalls} times`);
        });
    });
});
