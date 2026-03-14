import { escapeHtml } from '../../utils/webview-utils.js';
import { ToolExecution } from '../ToolExecution/ToolExecution.js';

/**
 * MessageDisplay Component (Parent)
 *
 * Renders chat messages including user messages, assistant messages, and reasoning.
 * Handles markdown rendering for assistant messages and attachments display.
 * Self-rendering component - creates its own DOM structure
 *
 * Children: ToolExecution (created internally)
 *
 * Usage:
 *   const display = new MessageDisplay(container, eventBus);
 *   // ToolExecution is created automatically as child component
 */

const DEBUG_SCROLL = false;
function scrollLog(...args) {
    if (DEBUG_SCROLL) console.log('[Scroll]', ...args);
}

export class MessageDisplay {
    constructor(container, eventBus) {
        this.container = container;
        this.eventBus = eventBus;
        this.messagesContainer = null;
        this.emptyState = null;
        this.thinking = null;
        this.showReasoning = false;
        this.mermaidModule = null;

        // MutationObserver for auto-scroll
        this.scrollTimeout = null;
        this.mutationObserver = null;
        this.userHasScrolled = false; // Track if user manually scrolled
        this.isProgrammaticScroll = false; // Flag to ignore our own scrolls

        this.render();

        // Streaming state: tracks in-progress assistant bubbles keyed by messageId
        // Each entry: { el, contentEl, deltaCount, buffer, renderedUpTo }
        this.streamingBubbles = new Map();

        // Reasoning streaming state: tracks in-progress reasoning bubbles keyed by reasoningId
        // Each entry: { el, contentEl }
        this.reasoningStreamingBubbles = new Map();

        // Create ToolExecution as child component - owns tool rendering
        this.toolExecution = new ToolExecution(this.messagesContainer, eventBus);

        this.attachListeners();
        this.setupAutoScroll();
    }

    render() {
        this.container.innerHTML = `
            <div class="messages message-display" id="messages" role="log" aria-live="polite" aria-label="Chat messages">
                <div class="empty-state message-display__empty" id="emptyState">
                    <div class="empty-state-icon message-display__empty-icon" aria-hidden="true">💬</div>
                    <div class="empty-state-text message-display__empty-text">
                        Start a chat session to begin<br>
                        Use the command palette to start the CLI
                    </div>
                </div>
            </div>
            <div class="thinking message-display__thinking" id="thinking" role="status" aria-live="polite"><span class="thinking-icon" aria-hidden="true">🧠</span><span class="thinking-text">Thinking...</span></div>
        `;

        // Get element references
        this.messagesContainer = this.container.querySelector('#messages');
        this.emptyState = this.container.querySelector('#emptyState');
        this.thinking = this.container.querySelector('#thinking');
    }

    attachListeners() {
        // Subscribe to message:add event from EventBus
        this.eventBus.on('message:add', (message) => {
            this.addMessage(message);
        });

        // Subscribe to message:delta event for streaming progressive rendering
        this.eventBus.on('message:delta', (data) => {
            const state = this._getOrCreateStreamingBubble(data.messageId);
            state.deltaCount++;
            state.buffer += data.deltaContent;
            this._renderDeltaProgress(state);
        });

        // Subscribe to task:complete event
        this.eventBus.on('task:complete', (data) => {
            this.addTaskComplete(data);
        });

        // Subscribe to reasoning:toggle event
        this.eventBus.on('reasoning:toggle', (enabled) => {
            this.showReasoning = enabled;
            this.updateReasoningVisibility();
        });

        // Subscribe to reasoning:delta event for real-time reasoning streaming
        this.eventBus.on('reasoning:delta', (data) => {
            if (!this.showReasoning) { return; }
            let state = this.reasoningStreamingBubbles.get(data.reasoningId);
            if (!state) {
                const el = document.createElement('div');
                el.className = 'message-display__item message-display__item--reasoning';
                el.setAttribute('aria-label', 'Assistant reasoning');
                const contentEl = document.createElement('div');
                contentEl.className = 'message-display__reasoning-content';
                el.appendChild(contentEl);
                this.messagesContainer.appendChild(el);
                state = { el, contentEl };
                this.reasoningStreamingBubbles.set(data.reasoningId, state);
            }
            state.contentEl.textContent += data.deltaContent;
        });

        // Delegated click handler for image file links
        if (this.messagesContainer) {
            this.messagesContainer.addEventListener('click', (e) => {
                const link = e.target.closest('.image-file-link');
                if (link) {
                    e.preventDefault();
                    const filePath = link.getAttribute('data-filepath');
                    if (filePath) {
                        this.eventBus.emit('openFile', filePath);
                    }
                }
            });
        }

        // Track user manual scrolling
        if (this.messagesContainer) {
            this.messagesContainer.addEventListener('scroll', () => {
                // Ignore scroll events we triggered programmatically
                if (this.isProgrammaticScroll) {
                    scrollLog('Ignoring programmatic scroll');
                    return;
                }

                // Only set userHasScrolled if they scroll away from bottom
                if (!this.isNearBottomRaw()) {
                    scrollLog('User manually scrolled away from bottom');
                    this.userHasScrolled = true;
                } else {
                    scrollLog('User scrolled to bottom, resuming auto-scroll');
                    this.userHasScrolled = false;
                }
            });
        }
    }

    /**
     * Setup MutationObserver for auto-scroll on new message additions.
     * Only triggers when children are added (new messages), not on
     * unrelated layout changes like input area resize.
     */
    setupAutoScroll() {
        if (!this.messagesContainer) return;

        scrollLog('Setting up MutationObserver on messagesContainer');

        this.mutationObserver = new MutationObserver((mutations) => {
            const hasNewChildren = mutations.some(m => m.addedNodes.length > 0);
            if (hasNewChildren) {
                scrollLog('Mutation detected: new children added, debouncing scroll...');
                clearTimeout(this.scrollTimeout);
                this.scrollTimeout = setTimeout(() => {
                    scrollLog('Debounce complete, calling autoScroll()');
                    this.autoScroll();
                }, 50);
            }
        });

        this.mutationObserver.observe(this.messagesContainer, {
            childList: true,
            subtree: false
        });

        scrollLog('MutationObserver active');
    }

    /**
     * Raw check if near bottom (without initial load special case)
     */
    isNearBottomRaw() {
        if (!this.messagesContainer) return true;

        const threshold = 100;
        const { scrollTop, scrollHeight, clientHeight } = this.messagesContainer;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

        return distanceFromBottom < threshold;
    }

    /**
     * Check if user is near the bottom of messages (within 100px threshold)
     * Special case: If user hasn't manually scrolled yet, always return true (initial load)
     */
    isNearBottom() {
        if (!this.messagesContainer) return true;

        // If user hasn't manually scrolled away, always auto-scroll (initial load behavior)
        if (!this.userHasScrolled) {
            scrollLog('User has not manually scrolled, auto-scrolling');
            return true;
        }

        const threshold = 100; // px from bottom
        const { scrollTop, scrollHeight, clientHeight } = this.messagesContainer;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

        scrollLog('scrollTop:', scrollTop, 'scrollHeight:', scrollHeight, 'clientHeight:', clientHeight, 'distance:', distanceFromBottom);

        return distanceFromBottom < threshold;
    }

    /**
     * Auto-scroll to bottom only if user is near bottom
     */
    autoScroll() {
        const nearBottom = this.isNearBottom();
        scrollLog('autoScroll() called, nearBottom:', nearBottom);
        if (nearBottom) {
            this.scrollToBottom();
        } else {
            scrollLog('User scrolled up, skipping auto-scroll');
        }
    }

    /**
     * Scroll messages to bottom
     */
    scrollToBottom() {
        if (this.messagesContainer) {
            scrollLog('scrollToBottom() called, scrollHeight:', this.messagesContainer.scrollHeight);

            // Set flag to ignore the scroll event we're about to trigger
            this.isProgrammaticScroll = true;
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;

            // Reset flag after scroll completes (next frame, not next tick)
            requestAnimationFrame(() => {
                this.isProgrammaticScroll = false;
                this.userHasScrolled = false; // We're at bottom now
            });
        }
    }

    /**
     * Cleanup resources
     */
    dispose() {
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
        if (this.scrollTimeout) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = null;
        }
    }

    addMessage(message) {
        const { role, content, attachments, timestamp, messageId, reasoningId } = message;

        // --- Streaming finalization path ---
        // If we already have a streaming bubble for this messageId, finalize it.
        if (role === 'assistant' && messageId && this.streamingBubbles.has(messageId)) {
            const state = this.streamingBubbles.get(messageId);
            // Clear inactivity timer to prevent double-render race
            if (state.flushTimer !== null) {
                clearTimeout(state.flushTimer);
                state.flushTimer = null;
            }
            // Flush remaining buffer
            const remaining = state.buffer.slice(state.renderedUpTo);
            if (remaining) {
                state.contentEl.insertAdjacentHTML('beforeend',
                    typeof marked !== 'undefined' ? marked.parse(remaining) : remaining);
            }
            // Post-process the whole bubble for SVG/mermaid
            this._renderSvgBlocks(state.el);
            this._renderMermaidBlocks(state.el);
            // Remove hidden class (Claude path: bubble was never shown)
            state.el.classList.remove('streaming-hidden');
            // Add fade-in animation
            state.el.classList.add('streaming-fade-in');
            this.streamingBubbles.delete(messageId);
            return; // Don't create a duplicate bubble
        }

        // --- Reasoning streaming finalization path ---
        // If we already have a streaming reasoning bubble for this reasoningId, finalize it.
        if (role === 'reasoning' && reasoningId && this.reasoningStreamingBubbles.has(reasoningId)) {
            const state = this.reasoningStreamingBubbles.get(reasoningId);
            // Replace textContent with canonical final text
            state.contentEl.textContent = content || '';
            this.reasoningStreamingBubbles.delete(reasoningId);
            return; // Don't create a duplicate bubble
        }

        // Guard: skip creating an empty assistant bubble (e.g. finalization signal from Part 2 suppression)
        if (role === 'assistant' && (!content || !content.trim())) {
            return;
        }

        // Hide empty state after first message
        if (this.emptyState) {
            this.emptyState.style.display = 'none';
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-display__item message-display__item--${role}`;
        messageDiv.setAttribute('role', 'article');
        messageDiv.dataset.timestamp = timestamp || Date.now();

        // Handle different message types
        if (role === 'reasoning') {
            messageDiv.setAttribute('aria-label', 'Assistant reasoning');
            messageDiv.style.display = this.showReasoning ? 'block' : 'none';
            messageDiv.innerHTML = `
                <div class="message-header message-display__header" style="font-style: italic;">Assistant Reasoning</div>
                <div class="message-content message-display__content" style="font-style: italic;">${escapeHtml(content)}</div>
            `;
        } else {
            messageDiv.setAttribute('aria-label', `${role === 'user' ? 'Your' : 'Assistant'} message`);

            // Use marked for assistant messages, plain text for user
            const renderedContent = role === 'assistant'
                ? (typeof marked !== 'undefined' ? marked.parse(content) : content)
                : escapeHtml(content);

            // Build attachments HTML if present
            let attachmentsHtml = '';
            if (attachments && attachments.length > 0) {
                attachmentsHtml = '<div class="message-attachments message-display__attachments">' +
                    attachments.map(att => `
                        <div class="message-attachment message-display__attachment">
                            ${att.webviewUri ? `<img src="${att.webviewUri}" alt="${att.displayName}" class="message-attachment-image" />` : ''}
                            <div class="message-attachment-name">📎 ${att.displayName}</div>
                        </div>
                    `).join('') +
                    '</div>';
            }

            messageDiv.innerHTML = `
                <div class="message-header message-display__header">${role === 'user' ? 'You' : 'Assistant'}</div>
                <div class="message-content message-display__content">
                    ${renderedContent}
                    ${attachmentsHtml}
                </div>
            `;
        }

        // Post-process: render SVG code blocks and inline SVGs as actual images
        // Post-process: render mermaid code blocks as diagrams
        if (role === 'assistant') {
            this._renderSvgBlocks(messageDiv);
            this._renderMermaidBlocks(messageDiv);
        }

        this.messagesContainer.appendChild(messageDiv);
        // MutationObserver handles scrolling automatically
    }

    /**
     * Render a task-complete callout when session.task_complete fires.
     * @param {{ summary?: string }} data
     */
    addTaskComplete(data) {
        if (this.emptyState) {
            this.emptyState.style.display = 'none';
        }

        const el = document.createElement('div');
        el.className = 'message message-display__item message-display__item--task-complete';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-label', 'Task complete');

        const summaryHtml = data && data.summary
            ? `<div class="message-display__task-complete-summary">${escapeHtml(data.summary)}</div>`
            : '';

        el.innerHTML = `
            <div class="message-display__task-complete-header">✓ Task Complete</div>
            ${summaryHtml}
        `;

        this.messagesContainer.appendChild(el);
    }

    // =========================================================================
    // Streaming helpers
    // =========================================================================

    /**
     * Get or create a streaming bubble state for the given messageId.
     * @param {string} messageId
     * @returns {{ el, contentEl, deltaCount, buffer, renderedUpTo, flushTimer }}
     */
    _getOrCreateStreamingBubble(messageId) {
        if (this.streamingBubbles.has(messageId)) {
            return this.streamingBubbles.get(messageId);
        }
        const state = this._createStreamingBubble(messageId);
        this.streamingBubbles.set(messageId, state);
        return state;
    }

    /**
     * Create a new streaming bubble DOM element and return its state object.
     * The bubble starts with class `streaming-hidden` (opacity: 0) until
     * deltaCount reaches 2 (GPT path) or finalization (Claude path).
     * @param {string} messageId
     */
    _createStreamingBubble(messageId) {
        if (this.emptyState) {
            this.emptyState.style.display = 'none';
        }

        const el = document.createElement('div');
        el.className = 'message message-display__item message-display__item--assistant streaming-hidden';
        el.setAttribute('role', 'article');
        el.setAttribute('aria-label', 'Assistant message');
        el.dataset.messageId = messageId;

        el.innerHTML = `
            <div class="message-header message-display__header">Assistant</div>
            <div class="message-content message-display__content"></div>
        `;

        const contentEl = el.querySelector('.message-display__content');
        this.messagesContainer.appendChild(el);

        return { el, contentEl, deltaCount: 0, buffer: '', renderedUpTo: 0, flushTimer: null };
    }

    /**
     * Called after each new delta chunk. Decides whether to flush safe markdown units.
     * @param {{ el, contentEl, deltaCount, buffer, renderedUpTo, flushTimer }} state
     */
    _renderDeltaProgress(state) {
        // Reset inactivity timer on every new delta
        if (state.flushTimer !== null) {
            clearTimeout(state.flushTimer);
        }
        state.flushTimer = setTimeout(() => {
            state.flushTimer = null;
            // Force-flush any pending buffer that _flushSafeMarkdown wouldn't emit yet
            const pending = state.buffer.slice(state.renderedUpTo);
            if (pending) {
                state.el.classList.remove('streaming-hidden');
                state.contentEl.insertAdjacentHTML('beforeend',
                    typeof marked !== 'undefined' ? marked.parse(pending) : pending);
                state.renderedUpTo = state.buffer.length;
                this.autoScroll();
            }
        }, 1500);

        if (state.deltaCount < 2) {
            // Still hidden — accumulate buffer, don't touch DOM
            return;
        }
        if (state.deltaCount === 2) {
            // Make visible for the first time (GPT path)
            state.el.classList.remove('streaming-hidden');
        }
        this._flushSafeMarkdown(state);
        this.autoScroll();
    }

    /**
     * Streaming state machine: flush completed markdown constructs from the buffer.
     * Only renders "safe" units — ones where we know the markdown is complete:
     *   - Paragraphs (terminated by \n\n)
     *   - Headings (line starting with # terminated by \n)
     *   - Code fences (``` ... ```)
     *   - Images (![alt](url))
     *   - Tables (lines starting with | ... blank line)
     *
     * Uses insertAdjacentHTML (not innerHTML+=) to avoid O(n²) re-serialization.
     * @param {{ el, contentEl, deltaCount, buffer, renderedUpTo }} state
     */
    _flushSafeMarkdown(state) {
        const buf = state.buffer;
        let pos = state.renderedUpTo;
        let openConstruct = 'none'; // 'none' | 'codeFence' | 'image' | 'table'
        let unitStart = pos;

        while (pos < buf.length) {
            const remaining = buf.slice(pos);

            if (openConstruct === 'none') {
                // Detect code fence open
                if (remaining.startsWith('```')) {
                    openConstruct = 'codeFence';
                    pos += 3;
                    // Skip language specifier line
                    const nl = buf.indexOf('\n', pos);
                    if (nl === -1) break; // Not enough data yet
                    pos = nl + 1;
                    continue;
                }
                // Detect image open
                if (remaining.startsWith('![')) {
                    openConstruct = 'image';
                    pos += 2;
                    continue;
                }
                // Detect table (line starts with |)
                if (remaining.startsWith('|')) {
                    openConstruct = 'table';
                    pos += 1;
                    continue;
                }
                // Detect heading (line starts with #)
                if (remaining.startsWith('#')) {
                    const nl = buf.indexOf('\n', pos);
                    if (nl === -1) break; // Not enough data yet
                    pos = nl + 1;
                    const unit = buf.slice(unitStart, pos);
                    state.contentEl.insertAdjacentHTML('beforeend',
                        typeof marked !== 'undefined' ? marked.parse(unit) : unit);
                    state.renderedUpTo = pos;
                    unitStart = pos;
                    continue;
                }
                // Detect paragraph completion (\n\n)
                const doubleNl = buf.indexOf('\n\n', pos);
                if (doubleNl === -1) break; // No complete paragraph yet
                pos = doubleNl + 2;
                const unit = buf.slice(unitStart, pos);
                state.contentEl.insertAdjacentHTML('beforeend',
                    typeof marked !== 'undefined' ? marked.parse(unit) : unit);
                state.renderedUpTo = pos;
                unitStart = pos;

            } else if (openConstruct === 'codeFence') {
                // Look for closing ```
                const closeIdx = buf.indexOf('```', pos);
                if (closeIdx === -1) break; // Code fence not closed yet
                pos = closeIdx + 3;
                // Skip trailing newline after closing fence
                if (buf[pos] === '\n') pos++;
                const unit = buf.slice(unitStart, pos);
                state.contentEl.insertAdjacentHTML('beforeend',
                    typeof marked !== 'undefined' ? marked.parse(unit) : unit);
                state.renderedUpTo = pos;
                unitStart = pos;
                openConstruct = 'none';

            } else if (openConstruct === 'image') {
                // Look for closing ) after the (url part
                const closeIdx = buf.indexOf(')', pos);
                if (closeIdx === -1) break; // Image not complete yet
                pos = closeIdx + 1;
                const unit = buf.slice(unitStart, pos);
                state.contentEl.insertAdjacentHTML('beforeend',
                    typeof marked !== 'undefined' ? marked.parse(unit) : unit);
                state.renderedUpTo = pos;
                unitStart = pos;
                openConstruct = 'none';

            } else if (openConstruct === 'table') {
                // Table ends at blank line (double newline)
                const blankLine = buf.indexOf('\n\n', pos);
                if (blankLine === -1) break; // Table not complete yet
                pos = blankLine + 2;
                const unit = buf.slice(unitStart, pos);
                state.contentEl.insertAdjacentHTML('beforeend',
                    typeof marked !== 'undefined' ? marked.parse(unit) : unit);
                state.renderedUpTo = pos;
                unitStart = pos;
                openConstruct = 'none';

            } else {
                pos++;
            }
        }
    }

    /**
     * Post-process rendered HTML to convert SVG code blocks and inline SVGs
     * into actual rendered SVG images within .svg-render containers.
     */
    _sanitizeSvg(svgSource) {
        const temp = document.createElement('div');
        temp.innerHTML = svgSource;
        // Remove script, foreignObject, and event handler attributes
        temp.querySelectorAll('script, foreignObject').forEach(el => el.remove());
        const all = temp.querySelectorAll('*');
        all.forEach(el => {
            for (const attr of [...el.attributes]) {
                if (attr.name.startsWith('on')) {
                    el.removeAttribute(attr.name);
                }
            }
        });
        return temp.innerHTML;
    }

    _renderSvgBlocks(messageDiv) {
        // 1. Handle ```svg code blocks (rendered as <pre><code class="language-svg">)
        const svgCodeBlocks = messageDiv.querySelectorAll('code.language-svg');
        svgCodeBlocks.forEach(codeEl => {
            const svgSource = codeEl.textContent;
            const preEl = codeEl.parentElement;
            if (!preEl || preEl.tagName !== 'PRE') return;

            const container = document.createElement('div');
            container.className = 'svg-render';
            container.innerHTML = this._sanitizeSvg(svgSource);

            const svgEl = container.querySelector('svg');
            if (svgEl) {
                svgEl.style.maxWidth = '100%';
                svgEl.style.height = 'auto';
            }

            preEl.replaceWith(container);
        });

        // 2. Handle inline <svg> tags not already in a .svg-render container
        const inlineSvgs = messageDiv.querySelectorAll('svg');
        inlineSvgs.forEach(svgEl => {
            if (svgEl.closest('.svg-render')) return;

            const container = document.createElement('div');
            container.className = 'svg-render';
            svgEl.style.maxWidth = '100%';
            svgEl.style.height = 'auto';
            svgEl.parentNode.insertBefore(container, svgEl);
            container.appendChild(svgEl);
        });
    }

    _renderMermaidBlocks(messageDiv) {
        const mermaidCodeBlocks = messageDiv.querySelectorAll('code.language-mermaid');
        mermaidCodeBlocks.forEach(codeEl => {
            const mermaidSource = codeEl.textContent;
            const preEl = codeEl.parentElement;
            if (!preEl || preEl.tagName !== 'PRE') return;

            const container = document.createElement('div');
            container.className = 'mermaid-render';
            container.dataset.mermaidSource = mermaidSource;

            // Toolbar with View Source and Save buttons
            const toolbar = document.createElement('div');
            toolbar.className = 'mermaid-toolbar';
            toolbar.innerHTML = `
                <button class="mermaid-toolbar__btn mermaid-toolbar__source" type="button" aria-label="View mermaid source" title="View Source">{ }</button>
                <button class="mermaid-toolbar__btn mermaid-toolbar__save" type="button" aria-label="Save mermaid diagram as image" title="Save Image">\uD83D\uDCBE</button>
            `;
            container.appendChild(toolbar);

            // Diagram container (mermaid renders into this)
            const diagramDiv = document.createElement('div');
            diagramDiv.className = 'mermaid-diagram';
            diagramDiv.textContent = mermaidSource;
            container.appendChild(diagramDiv);

            // Source view (hidden by default)
            const sourceDiv = document.createElement('pre');
            sourceDiv.className = 'mermaid-source hidden';
            sourceDiv.textContent = mermaidSource;
            container.appendChild(sourceDiv);

            preEl.replaceWith(container);
            this._renderMermaidDiagram(diagramDiv);

            // Wire View Source toggle
            toolbar.querySelector('.mermaid-toolbar__source').addEventListener('click', () => {
                const showing = diagramDiv.classList.toggle('hidden');
                sourceDiv.classList.toggle('hidden', !showing);
            });

            // Wire Save button
            toolbar.querySelector('.mermaid-toolbar__save').addEventListener('click', () => {
                const svg = diagramDiv.querySelector('svg');
                this.eventBus.emit('saveMermaidImage', {
                    svgContent: svg ? svg.outerHTML : '',
                    source: mermaidSource
                });
            });
        });
    }

    async _renderMermaidDiagram(diagramDiv) {
        try {
            if (!this.mermaidModule) {
                const mod = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
                this.mermaidModule = mod.default;
                const theme = document.body.classList.contains('vscode-light') ? 'default' : 'dark';
                this.mermaidModule.initialize({ startOnLoad: false, theme });
            }
            await this.mermaidModule.run({ nodes: [diagramDiv] });
        } catch {
            // mermaid.js unavailable (offline, CSP, JSDOM) — keep source text as fallback
        }
    }

    updateReasoningVisibility() {
        const reasoningMessages = this.messagesContainer.querySelectorAll('.message-display__item--reasoning');
        reasoningMessages.forEach(msg => {
            msg.style.display = this.showReasoning ? 'block' : 'none';
        });
    }

    clear() {
        // Remove all messages except empty state
        const messages = this.messagesContainer.querySelectorAll('.message-display__item');
        messages.forEach(msg => msg.remove());

        // Clear tool executions (if ToolExecution supports it)
        if (this.toolExecution && typeof this.toolExecution.clear === 'function') {
            this.toolExecution.clear();
        }

        // Show empty state
        if (this.emptyState) {
            this.emptyState.style.display = 'flex';
        }

        // Reset scroll state
        this.userHasScrolled = false;
    }
}
