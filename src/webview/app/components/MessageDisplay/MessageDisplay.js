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
            <div class="thinking message-display__thinking" id="thinking" role="status" aria-live="polite">Thinking...</div>
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

        // Subscribe to reasoning:toggle event
        this.eventBus.on('reasoning:toggle', (enabled) => {
            this.showReasoning = enabled;
            this.updateReasoningVisibility();
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
        const { role, content, attachments, timestamp } = message;

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
                <button class="mermaid-toolbar__btn mermaid-toolbar__source" title="View Source">{ }</button>
                <button class="mermaid-toolbar__btn mermaid-toolbar__save" title="Save Image">\uD83D\uDCBE</button>
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
                if (svg) {
                    this.eventBus.emit('saveMermaidImage', {
                        svgContent: svg.outerHTML,
                        source: mermaidSource
                    });
                }
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
