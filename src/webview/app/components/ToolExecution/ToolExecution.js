/**
 * ToolExecution Component
 *
 * Manages tool execution groups, rendering tool states, expand/collapse,
 * and diff button functionality.
 *
 * Usage:
 *   const toolExec = new ToolExecution(container, eventBus);
 *   eventBus.emit('tool:start', { toolCallId, toolName, arguments, startTime });
 *   eventBus.emit('tool:complete', { toolCallId, status, result, endTime });
 */

export class ToolExecution {
    constructor(container, eventBus) {
        this.container = container;
        this.eventBus = eventBus;
        this.currentToolGroup = null;
        this.toolGroupExpanded = false;
        this.tools = new Map(); // Track tool states by toolCallId
        this.collapsedCards = new Set(); // Track individually collapsed card IDs

        this.attachListeners();
    }

    attachListeners() {
        // Close current tool group when a new message arrives.
        // This ensures each assistant response gets its own tool group.
        // Individual card expand/collapse state is preserved (tracked by collapsedCards Set).
        this.eventBus.on('message:add', (message) => {
            if (message.role === 'user' || message.role === 'assistant') {
                this.closeCurrentToolGroup();
            }
        });

        this.eventBus.on('tool:start', (data) => {
            this.handleToolStart(data);
        });

        this.eventBus.on('tool:complete', (data) => {
            this.handleToolComplete(data);
        });

        this.eventBus.on('tool:progress', (data) => {
            this.handleToolProgress(data);
        });
    }

    handleToolStart(toolState) {
        // Store initial tool state
        this.tools.set(toolState.toolCallId, {
            ...toolState,
            status: toolState.status || 'running'
        });

        // Add or update tool in DOM
        this.addOrUpdateTool(toolState.toolCallId);
    }

    handleToolComplete(update) {
        // Merge with existing tool state
        const existing = this.tools.get(update.toolCallId);
        if (existing) {
            const updated = { ...existing, ...update };
            this.tools.set(update.toolCallId, updated);
            this.addOrUpdateTool(update.toolCallId);
        }
    }

    handleToolProgress(update) {
        const existing = this.tools.get(update.toolCallId);
        if (existing) {
            existing.progress = update.progress;
            this.tools.set(update.toolCallId, existing);
            this.addOrUpdateTool(update.toolCallId);
        }
    }

    closeCurrentToolGroup() {
        if (this.currentToolGroup) {
            // Don't update toggle - just mark as closed
            // The toggle's closure already has the right container reference
            this.currentToolGroup = null;
            this.toolGroupExpanded = false;
        }
    }

    getOrCreateToolGroup() {
        if (!this.currentToolGroup) {
            // Create new tool group
            const toolGroup = document.createElement('div');
            toolGroup.className = 'tool-group tool-execution__group';

            const container = document.createElement('div');
            container.className = 'tool-group-container tool-execution__container';

            toolGroup.appendChild(container);
            this.container.appendChild(toolGroup);

            this.currentToolGroup = {
                element: toolGroup,
                container: container,
                toolCount: 0
            };
        }
        return this.currentToolGroup;
    }

    addOrUpdateTool(toolCallId) {
        const toolState = this.tools.get(toolCallId);
        if (!toolState) return;

        // Check if this tool already exists anywhere in the DOM
        let toolDiv = this.container.querySelector(`[data-tool-id="${toolCallId}"]`);

        const toolHtml = this.buildToolHtml(toolState);

        if (toolDiv) {
            // Update existing tool (status change)
            toolDiv.innerHTML = toolHtml;

            // Restore collapsed state after innerHTML replacement
            if (this.collapsedCards.has(toolCallId)) {
                toolDiv.classList.add('collapsed');
            }

            // Re-attach header collapse listener
            this.attachHeaderCollapseListener(toolDiv, toolCallId);

            // Re-attach diff button listener if present
            this.attachDiffButtonListener(toolDiv, toolState);

            // Update toggle if this tool group is current
            if (this.currentToolGroup && this.currentToolGroup.container.contains(toolDiv)) {
                this.updateToolGroupToggle();
            }
        } else {
            // Add to current tool group
            const group = this.getOrCreateToolGroup();

            const toolExecution = document.createElement('div');
            toolExecution.className = 'tool-execution tool-execution__item';
            toolExecution.setAttribute('data-tool-id', toolCallId);
            toolExecution.innerHTML = toolHtml;

            // Attach header collapse listener
            this.attachHeaderCollapseListener(toolExecution, toolCallId);

            // Attach diff button listener if present
            this.attachDiffButtonListener(toolExecution, toolState);

            group.container.appendChild(toolExecution);
            group.toolCount++;

            // Update toggle after adding tool
            this.updateToolGroupToggle();
        }

        // Scroll to show new tool
        this.container.scrollTop = this.container.scrollHeight;
    }

    attachDiffButtonListener(toolDiv, toolState) {
        const diffBtn = toolDiv.querySelector('.tool-execution__diff-btn');
        if (diffBtn) {
            diffBtn.addEventListener('click', () => {
                // Emit viewDiff event with diff data
                this.eventBus.emit('viewDiff', toolState.diffData || {});
            });
        }
    }

    /**
     * Attach click handler on a tool card header to toggle individual collapse.
     * Clicking the header toggles the 'collapsed' class on the .tool-execution__item
     * and updates the collapse indicator chevron.
     */
    attachHeaderCollapseListener(toolDiv, toolCallId) {
        const header = toolDiv.querySelector('.tool-execution__header');
        if (!header) return;

        header.addEventListener('click', (e) => {
            // Do not collapse when clicking buttons inside the header (e.g. View Diff)
            if (e.target.closest('button')) return;

            const isCollapsed = toolDiv.classList.toggle('collapsed');

            if (isCollapsed) {
                this.collapsedCards.add(toolCallId);
            } else {
                this.collapsedCards.delete(toolCallId);
            }

            // Update the chevron indicator
            const indicator = toolDiv.querySelector('.tool-execution__collapse-indicator');
            if (indicator) {
                indicator.textContent = isCollapsed ? '\u25B6' : '\u25BC';
            }
        });
    }

    buildToolHtml(toolState) {
        const statusIcon = toolState.status === 'complete' ? '\u2705' :
                          toolState.status === 'failed' ? '\u274C' :
                          toolState.status === 'running' ? '\u23F3' : '\u23F8\uFE0F';

        const duration = toolState.endTime ?
            `${((toolState.endTime - toolState.startTime) / 1000).toFixed(2)}s` : '';

        const argsPreview = this.formatArgumentsPreview(toolState.toolName, toolState.arguments);
        const hasDetails = toolState.arguments || toolState.result || toolState.error;

        let html = `
            <div class="tool-header tool-execution__header">
                <span class="tool-execution__collapse-indicator">\u25BC</span>
                <span class="tool-icon tool-execution__icon">${statusIcon}</span>
                <span class="tool-name tool-execution__name">${this.escapeHtml(toolState.toolName)}</span>
                ${toolState.intent ? `<span class="tool-intent tool-execution__intent">${this.escapeHtml(toolState.intent)}</span>` : ''}
                ${duration ? `<span class="tool-duration tool-execution__duration">${duration}</span>` : ''}
                ${toolState.hasDiff ? `<button class="view-diff-btn tool-execution__diff-btn" data-tool-id="${toolState.toolCallId}">\uD83D\uDCC4 View Diff</button>` : ''}
            </div>
        `;

        // Wrap all content below the header in a collapsible content wrapper
        html += '<div class="tool-execution__content">';

        if (argsPreview) {
            html += `<div class="tool-args-preview tool-execution__args">${this.escapeHtml(argsPreview)}</div>`;
        }

        if (toolState.progress) {
            html += `<div class="tool-progress tool-execution__progress">${this.escapeHtml(toolState.progress)}</div>`;
        }

        if (toolState.diffLines && toolState.diffLines.length > 0) {
            html += '<div class="inline-diff">';
            for (const line of toolState.diffLines) {
                const typeClass = line.type === 'add' ? 'diff-add' :
                                  line.type === 'remove' ? 'diff-remove' : 'diff-context';
                const prefix = line.type === 'add' ? '+ ' :
                               line.type === 'remove' ? '- ' : '  ';
                html += `<div class="diff-line ${typeClass}">${prefix}${this.escapeHtml(line.text)}</div>`;
            }
            if (toolState.diffTruncated) {
                const remaining = toolState.diffTotalLines - toolState.diffLines.length;
                html += `<div class="diff-truncated">... ${remaining} more lines</div>`;
            }
            html += '</div>';
        }

        if (hasDetails) {
            html += `
                <details class="tool-details tool-execution__details">
                    <summary>Show Details</summary>
                    <div class="tool-details-content tool-execution__details-content">
            `;

            if (toolState.arguments) {
                html += `
                    <div class="tool-detail-section">
                        <strong>Arguments:</strong>
                        <pre>${this.escapeHtml(JSON.stringify(toolState.arguments, null, 2))}</pre>
                    </div>
                `;
            }

            if (toolState.result) {
                html += `
                    <div class="tool-detail-section">
                        <strong>Result:</strong>
                        <pre>${this.escapeHtml(toolState.result)}</pre>
                    </div>
                `;
            }

            if (toolState.error) {
                html += `
                    <div class="tool-detail-section error">
                        <strong>Error:</strong>
                        <pre>${this.escapeHtml(toolState.error.message)}</pre>
                        ${toolState.error.code ? `<div>Code: ${this.escapeHtml(String(toolState.error.code))}</div>` : ''}
                    </div>
                `;
            }

            html += `
                    </div>
                </details>
            `;
        }

        html += '</div>'; // close .tool-execution__content

        return html;
    }

    formatArgumentsPreview(toolName, args) {
        if (!args) return null;

        try {
            // Format based on tool type
            if (toolName === 'bash' || toolName.startsWith('shell')) {
                return `$ ${args.command || JSON.stringify(args)}`;
            } else if (toolName === 'grep') {
                return `pattern: "${args.pattern}"${args.path ? ` in ${args.path}` : ''}`;
            } else if (toolName === 'edit' || toolName === 'create') {
                return `${args.path || 'unknown file'}`;
            } else if (toolName === 'view') {
                return `${args.path || 'unknown path'}`;
            } else if (toolName === 'web_fetch') {
                return `${args.url || JSON.stringify(args)}`;
            } else if (toolName === 'glob') {
                return `pattern: "${args.pattern}"`;
            } else {
                // Generic preview
                const keys = Object.keys(args);
                if (keys.length === 1) {
                    return `${keys[0]}: ${args[keys[0]]}`;
                } else {
                    return `${keys.length} parameters`;
                }
            }
        } catch (e) {
            return null;
        }
    }

    updateToolGroupToggle() {
        if (!this.currentToolGroup) return;

        const { element, container } = this.currentToolGroup;

        // Remove existing toggle if present
        const existingToggle = element.querySelector('.tool-execution__toggle');
        if (existingToggle) {
            existingToggle.remove();
        }

        // Check if content overflows (use tool count as proxy for testing)
        const toolCount = element.querySelectorAll('.tool-execution__item').length;
        const isOverflowing = container.scrollHeight > 200 || toolCount > 3;

        if (isOverflowing) {
            // Ensure container starts collapsed
            if (!this.toolGroupExpanded) {
                container.classList.remove('expanded');
            }

            const toggle = document.createElement('div');
            toggle.className = 'tool-group-toggle tool-execution__toggle';

            const hiddenTools = toolCount - Math.floor(200 / 70);
            const displayCount = Math.max(1, hiddenTools);

            toggle.textContent = this.toolGroupExpanded ? 'Contract' : `Expand (${displayCount} more)`;

            // Store container reference in closure so toggle works after group is closed
            toggle.addEventListener('click', () => {
                this.handleToolGroupToggle(toggle, container, element);
            });

            element.appendChild(toggle);
        } else {
            // Not overflowing - remove height restriction
            container.classList.add('expanded');
        }
    }

    handleToolGroupToggle(toggle, container, element) {
        // Check if container is currently expanded
        const isExpanded = container.classList.contains('expanded');

        if (isExpanded) {
            // Contract
            container.classList.remove('expanded');
            this.toolGroupExpanded = false;
            const toolCount = element.querySelectorAll('.tool-execution__item').length;
            const hiddenTools = toolCount - Math.floor(200 / 70);
            const displayCount = Math.max(1, hiddenTools);
            toggle.textContent = `Expand (${displayCount} more)`;
        } else {
            // Expand
            container.classList.add('expanded');
            this.toolGroupExpanded = true;
            toggle.textContent = 'Contract';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
