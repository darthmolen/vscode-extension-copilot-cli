/**
 * SubagentDock Component (v2 — master/detail + pop-out)
 *
 * A persistent ledger of sub-agent activity. Each sub-agent is a COLORED bar (status icon,
 * display name, current action, tool-call counter, chevron, pop-out). Clicking a bar opens a
 * single shared read-only DETAIL pane beneath the list (one at a time), color-matched, that
 * interleaves the agent's COMMENTS and TOOL CALLS chronologically. Reasoning ("thinking") sits
 * behind a per-comment toggle, off by default. A pop-out button asks the host to open the
 * agent's full traffic in an editor tab.
 *
 * Lives OUTSIDE the message transcript, so it survives tool-group lifecycle. Sub-agent events
 * are matched by envelope `agentId` (== the spawning task's toolCallId).
 *
 * Events consumed (EventBus):
 *   subagent:start    { agentId, agentDisplayName, agentName, agentDescription }
 *   subagent:message  { agentId, content?, reasoningText? }
 *   subagent:complete { agentId, status:'complete'|'failed', model?, totalToolCalls?, totalTokens?, durationMs?, error? }
 *   tool:start/complete/progress  toolState with optional agentId
 *   subagent:sessionEnded
 * Emits:
 *   subagent:popout   { agentId }
 */

// Mirror of SUBAGENT_PALETTE in src/shared/subagentPalette.ts. The webview is
// COPIED by esbuild, not bundled, so it cannot import from src/. Exported so
// tests/unit/components/subagent-palette-drift.test.js can prove the two match.
export const PALETTE = [
	'#4FC1FF', '#C586C0', '#9CDCFE', '#CE9178', '#6A9955',
	'#DCDCAA', '#569CD6', '#D7BA7D', '#F48771', '#B5CEA8',
];

export class SubagentDock {
	constructor(container, eventBus, options = {}) {
		this.container = container;
		this.eventBus = eventBus;
		this.tiles = new Map();     // agentId -> tile record
		this.openAgentId = null;    // the agent whose detail pane is shown
		this._colorSeq = 0;
		this.minimized = !!options.minimized;
		this._onMinimizeChange = options.onMinimizeChange || (() => {});

		this._build();
		this._attach();
		this._refresh();
	}

	_build() {
		this.el = document.createElement('div');
		this.el.className = 'subagent-dock subagent-dock--hidden';
		this.el.innerHTML = `
			<div class="subagent-dock__bar">
				<span class="subagent-dock__title">🚀 Running Sub-Agents</span>
				<span class="subagent-dock__summary"></span>
				<button class="subagent-dock__minimize" type="button" title="Minimize" aria-label="Minimize sub-agent dock"><span aria-hidden="true">▾</span></button>
			</div>
			<div class="subagent-dock__list">
				<div class="subagent-dock__active"></div>
				<div class="subagent-dock__done"></div>
			</div>
			<div class="subagent-dock__detail subagent-dock__detail--hidden"></div>
		`;
		this.activeEl = this.el.querySelector('.subagent-dock__active');
		this.doneEl = this.el.querySelector('.subagent-dock__done');
		this.summaryEl = this.el.querySelector('.subagent-dock__summary');
		this.detailEl = this.el.querySelector('.subagent-dock__detail');
		if (this.minimized) this.el.classList.add('subagent-dock--minimized');
		this.el.querySelector('.subagent-dock__minimize').addEventListener('click', () => this.toggleMinimize());
		this.container.appendChild(this.el);
	}

	_attach() {
		this.eventBus.on('subagent:start', (d) => this.handleStart(d));
		this.eventBus.on('subagent:message', (d) => this.handleMessage(d));
		this.eventBus.on('subagent:complete', (d) => this.handleComplete(d));
		this.eventBus.on('tool:start', (d) => this.routeTool(d));
		this.eventBus.on('tool:complete', (d) => this.routeTool(d));
		this.eventBus.on('tool:progress', (d) => this.routeTool(d));
		this.eventBus.on('subagent:sessionEnded', () => this.handleSessionEnded());
	}

	// ---- minimize ----
	minimize() { this._setMinimized(true); }
	restore() { this._setMinimized(false); }
	toggleMinimize() { this._setMinimized(!this.minimized); }
	_setMinimized(v) {
		if (this.minimized === v) return;
		this.minimized = v;
		this.el.classList.toggle('subagent-dock--minimized', v);
		this.el.querySelector('.subagent-dock__minimize').textContent = v ? '▸' : '▾';
		this._onMinimizeChange(v);
	}

	_key(d) { return d && (d.agentId || d.parentToolCallId); }
	owns(d) { const k = this._key(d); return !!k && this.tiles.has(k); }

	// ---- master bars ----
	handleStart(d) {
		const id = d && d.agentId;
		if (!id || this.tiles.has(id)) return;
		this.restore(); // surface the dock on a new sub-agent

		const color = d.color || PALETTE[this._colorSeq++ % PALETTE.length];
		const el = document.createElement('div');
		el.className = 'subagent-dock__tile subagent-dock__tile--running';
		el.setAttribute('data-agent-id', id);
		el.style.setProperty('--agent-color', color);
		el.innerHTML = `
			<div class="subagent-dock__header">
				<span class="subagent-dock__chevron">▸</span>
				<span class="subagent-dock__icon">⏳</span>
				<span class="subagent-dock__name"></span>
				<span class="subagent-dock__action"></span>
				<span class="subagent-dock__counter">0 tool calls</span>
				<button class="subagent-dock__popout" type="button" title="Open in editor tab" aria-label="Open sub-agent in editor tab"><span aria-hidden="true">⤢</span></button>
			</div>
		`;
		el.querySelector('.subagent-dock__name').textContent = d.agentDisplayName || d.agentName || id;

		const tile = {
			id, el, color,
			actionEl: el.querySelector('.subagent-dock__action'),
			counterEl: el.querySelector('.subagent-dock__counter'),
			iconEl: el.querySelector('.subagent-dock__icon'),
			chevronEl: el.querySelector('.subagent-dock__chevron'),
			status: 'running',
			toolCount: 0,
			events: [], // chronological { kind:'tool'|'comment', ... }
		};
		this.tiles.set(id, tile);
		this.activeEl.appendChild(el);

		el.querySelector('.subagent-dock__header').addEventListener('click', (e) => {
			if (e.target.closest('.subagent-dock__popout') || e.target.closest('.subagent-dock__clear')) return;
			this.toggleDetail(id);
		});
		el.querySelector('.subagent-dock__popout').addEventListener('click', (e) => {
			e.stopPropagation();
			this.eventBus.emit('subagent:popout', { agentId: id });
		});

		this._refresh();
	}

	routeTool(toolState) {
		if (!toolState) return;
		const id = this._key(toolState);
		if (!id || !this.tiles.has(id)) return;
		const tile = this.tiles.get(id);

		const known = tile.events.some((it) => it.kind === 'tool' && it.toolCallId === toolState.toolCallId);
		if (!known) {
			tile.events.push({ kind: 'tool', toolCallId: toolState.toolCallId, toolName: toolState.toolName, arguments: toolState.arguments });
			tile.toolCount += 1;
			tile.counterEl.textContent = this._countLabel(tile.toolCount);
			if (this.openAgentId === id) this._appendDetailRow(tile.events[tile.events.length - 1]);
		}
		tile.actionEl.textContent = this._actionLine(toolState);
	}

	handleMessage(d) {
		const id = d && d.agentId;
		const tile = id && this.tiles.get(id);
		if (!tile) return;
		if (!d.content && !d.reasoningText) return;
		const item = { kind: 'comment', content: d.content || '', reasoningText: d.reasoningText || '' };
		tile.events.push(item);
		if (this.openAgentId === id) this._appendDetailRow(item);
	}

	// ---- detail pane ----
	toggleDetail(id) {
		if (this.openAgentId === id) { this._closeDetail(); return; }
		const tile = this.tiles.get(id);
		if (!tile) return;
		this.openAgentId = id;
		// mark which bar is expanded
		for (const t of this.tiles.values()) t.el.classList.toggle('subagent-dock__tile--open', t.id === id);
		this.detailEl.innerHTML = '';
		this.detailEl.setAttribute('data-agent-id', id);
		this.detailEl.style.setProperty('--agent-color', tile.color);
		this.detailEl.classList.remove('subagent-dock__detail--hidden');
		for (const item of tile.events) this._appendDetailRow(item);
	}

	_closeDetail() {
		this.openAgentId = null;
		this.detailEl.classList.add('subagent-dock__detail--hidden');
		this.detailEl.removeAttribute('data-agent-id');
		this.detailEl.innerHTML = '';
		for (const t of this.tiles.values()) t.el.classList.remove('subagent-dock__tile--open');
	}

	_appendDetailRow(item) {
		const row = item.kind === 'tool' ? this._toolRow(item) : this._msgRow(item);
		this.detailEl.appendChild(row);
		this.detailEl.scrollTop = this.detailEl.scrollHeight;
	}

	_toolRow(item) {
		const div = document.createElement('div');
		div.className = 'subagent-dock__tool';
		div.setAttribute('data-tool-id', item.toolCallId);
		div.textContent = `🔧 ${[item.toolName, this._argPreview(item)].filter(Boolean).join(' ')}`.trim();
		return div;
	}

	_msgRow(item) {
		const div = document.createElement('div');
		div.className = 'subagent-dock__msg';
		const content = document.createElement('div');
		content.className = 'subagent-dock__msg-content';
		content.textContent = `💬 ${item.content}`.trim();
		div.appendChild(content);
		if (item.reasoningText) {
			const toggle = document.createElement('button');
			toggle.type = 'button';
			toggle.className = 'subagent-dock__think-toggle';
			toggle.setAttribute('aria-label', 'Toggle agent reasoning');
			toggle.textContent = '▸ show thinking';
			const think = document.createElement('div');
			think.className = 'subagent-dock__think subagent-dock__think--hidden';
			think.textContent = item.reasoningText;
			toggle.addEventListener('click', () => {
				const hidden = think.classList.toggle('subagent-dock__think--hidden');
				toggle.textContent = hidden ? '▸ show thinking' : '▾ hide thinking';
			});
			div.appendChild(toggle);
			div.appendChild(think);
		}
		return div;
	}

	// ---- completion / cleanup ----
	handleComplete(d) {
		const id = d && d.agentId;
		const tile = id && this.tiles.get(id);
		if (!tile) return;
		const failed = d.status === 'failed';
		tile.status = failed ? 'failed' : 'complete';
		tile.el.classList.remove('subagent-dock__tile--running');
		tile.el.classList.add(`subagent-dock__tile--${tile.status}`);
		tile.iconEl.textContent = failed ? '❌' : '✅';
		if (failed) {
			tile.actionEl.textContent = d.error || 'Failed';
			tile.counterEl.textContent = this._countLabel(d.totalToolCalls ?? tile.toolCount);
		} else {
			tile.actionEl.textContent = '';
			tile.counterEl.textContent = this._receipt(d, tile);
		}
		if (!tile.el.querySelector('.subagent-dock__clear')) {
			const clear = document.createElement('button');
			clear.type = 'button';
			clear.className = 'subagent-dock__clear';
			clear.title = 'Clear';
			clear.setAttribute('aria-label', 'Clear sub-agent card');
			clear.textContent = '✕';
			clear.addEventListener('click', (e) => { e.stopPropagation(); this.removeTile(tile.id); });
			tile.el.querySelector('.subagent-dock__header').appendChild(clear);
		}
		this.doneEl.insertBefore(tile.el, this.doneEl.firstChild);
		this._refresh();
	}

	handleSessionEnded() {
		for (const tile of this.tiles.values()) {
			if (tile.status === 'running') {
				this.handleComplete({ agentId: tile.id, status: 'failed', error: 'Session ended' });
			}
		}
	}

	removeTile(id) {
		const tile = this.tiles.get(id);
		if (!tile) return;
		if (this.openAgentId === id) this._closeDetail();
		tile.el.remove();
		this.tiles.delete(id);
		this._refresh();
	}

	// ---- helpers ----
	_countLabel(n) { return `${n} tool call${n === 1 ? '' : 's'}`; }
	_actionLine(ts) { return [ts.toolName, this._argPreview(ts)].filter(Boolean).join(' '); }
	/**
	 * One line saying what a tool actually did.
	 *
	 * Ordered most-specific first: a shell `command` or a search `pattern` answers
	 * the question better than the paraphrase sitting next to it. `description` is
	 * the fallback because `sql` and `task` carry a human-written one and nothing
	 * else legible — before it was consulted those rows, plus `skill`, rendered as
	 * a bare tool name.
	 *
	 * The final case keeps a new tool from showing nothing at all: a single
	 * distinctive argument is printed rather than dropped.
	 */
	_argPreview(ts) {
		const a = ts.arguments;
		if (!a || typeof a !== 'object') return '';
		if (a.pattern) return `"${a.pattern}"`;
		if (a.path) return a.path;
		if (a.command) return a.command;
		if (a.description) return a.description;
		if (a.skill) return a.skill;
		if (a.url) return a.url;

		// Unknown tool: show its one argument if it has exactly one worth showing.
		const entries = Object.entries(a).filter(([, v]) => typeof v === 'string' || typeof v === 'number');
		if (entries.length === 1) return String(entries[0][1]);
		return '';
	}
	_receipt(d, tile) {
		const calls = d.totalToolCalls ?? tile.toolCount;
		const parts = [this._countLabel(calls)];
		if (d.durationMs != null) parts.push(this._dur(d.durationMs));
		if (d.totalTokens != null) parts.push(`${Math.round(d.totalTokens / 1000)}k tok`);
		if (d.model) parts.push(d.model);
		return parts.join(' · ');
	}
	_dur(ms) {
		const s = Math.round(ms / 1000);
		return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
	}

	_refresh() {
		const running = [...this.tiles.values()].filter((t) => t.status === 'running').length;
		const done = this.tiles.size - running;
		if (this.summaryEl) this.summaryEl.textContent = `${running} running · ${done} done`;
		this.el.classList.toggle('subagent-dock--hidden', this.tiles.size === 0);
	}
}
