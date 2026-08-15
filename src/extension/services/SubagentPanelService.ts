import * as vscode from 'vscode';
import { SUBAGENT_PALETTE } from '../../shared/subagentPalette';
import type {
	SubagentStartData,
	SubagentMessageData,
	SubagentCompleteData,
	ToolExecutionState,
} from '../../sdkSessionManager';

type Item =
	| { kind: 'tool'; toolCallId: string; toolName: string; preview: string }
	| { kind: 'comment'; content: string; reasoningText?: string };

interface AgentBuffer {
	agentId: string;
	displayName: string;
	title: string; // displayName, disambiguated with #N when names collide
	color: string;
	status: 'running' | 'complete' | 'failed';
	receipt?: string;
	items: Item[];
}



/**
 * Buffers each sub-agent's traffic (comments + tools + reasoning) and, on request, opens it in a
 * full-width webview tab in the editor area. The tab streams live and is read-only history after.
 * Independent of the sidebar dock; both are fed by the same SDK emitters.
 */
export class SubagentPanelService implements vscode.Disposable {
	private readonly buffers = new Map<string, AgentBuffer>();
	private readonly panels = new Map<string, vscode.WebviewPanel>();
	private colorSeq = 0;

	constructor(private readonly storageUri: vscode.Uri) {}

	private get iconDir(): vscode.Uri { return vscode.Uri.joinPath(this.storageUri, 'subagent-icons'); }

	// ---- buffering (call from extension.ts emitter subscriptions) ----
	onStart(d: SubagentStartData & { color?: string }): void {
		if (this.buffers.has(d.agentId)) return;
		const displayName = d.agentDisplayName || d.agentName || d.agentId;
		const sameName = [...this.buffers.values()].filter((b) => b.displayName === displayName).length;
		this.buffers.set(d.agentId, {
			agentId: d.agentId,
			displayName,
			title: sameName > 0 ? `${displayName} #${sameName + 1}` : displayName,
			color: d.color || SUBAGENT_PALETTE[this.colorSeq++ % SUBAGENT_PALETTE.length],
			status: 'running',
			items: [],
		});
	}

	onTool(toolState: ToolExecutionState): void {
		const id = toolState.agentId;
		if (!id) return;
		const buf = this.buffers.get(id);
		if (!buf) return;
		if (buf.items.some((it) => it.kind === 'tool' && it.toolCallId === toolState.toolCallId)) return;
		const item: Item = { kind: 'tool', toolCallId: toolState.toolCallId, toolName: toolState.toolName, preview: this.preview(toolState.arguments) };
		buf.items.push(item);
		this.post(id, { type: 'item', item });
	}

	onMessage(d: SubagentMessageData): void {
		const buf = this.buffers.get(d.agentId);
		if (!buf) return;
		if (!d.content && !d.reasoningText) return;
		const item: Item = { kind: 'comment', content: d.content || '', reasoningText: d.reasoningText };
		buf.items.push(item);
		this.post(d.agentId, { type: 'item', item });
	}

	onComplete(d: SubagentCompleteData): void {
		const buf = this.buffers.get(d.agentId);
		if (!buf) return;
		buf.status = d.status;
		buf.receipt = d.status === 'failed'
			? (d.error || 'Failed')
			: [`${d.totalToolCalls ?? buf.items.filter((i) => i.kind === 'tool').length} tool calls`,
			   d.durationMs != null ? this.dur(d.durationMs) : null,
			   d.totalTokens != null ? `${Math.round(d.totalTokens / 1000)}k tok` : null,
			   d.model].filter(Boolean).join(' · ');
		this.post(d.agentId, { type: 'status', status: buf.status, receipt: buf.receipt });
	}

	// ---- open / reveal a panel ----
	open(agentId: string): void {
		const buf = this.buffers.get(agentId);
		if (!buf) return;
		const existing = this.panels.get(agentId);
		if (existing) { existing.reveal(vscode.ViewColumn.Active); return; }

		const panel = vscode.window.createWebviewPanel(
			'copilotSubagent',
			buf.title,
			{ viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		panel.webview.html = this.html(buf);
		void this.setTabIcon(panel, buf.color); // colored dot in the editor tab, matching the bar
		this.panels.set(agentId, panel);
		panel.onDidDispose(() => this.panels.delete(agentId));
	}

	/** Generate (once) a colored-dot SVG for this color and use it as the tab icon. */
	private async setTabIcon(panel: vscode.WebviewPanel, color: string): Promise<void> {
		try {
			const name = `dot-${color.replace('#', '')}.svg`;
			const fileUri = vscode.Uri.joinPath(this.iconDir, name);
			try {
				await vscode.workspace.fs.stat(fileUri);
			} catch {
				const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="${color}"/></svg>`;
				await vscode.workspace.fs.createDirectory(this.iconDir);
				await vscode.workspace.fs.writeFile(fileUri, Buffer.from(svg, 'utf8'));
			}
			panel.iconPath = fileUri;
		} catch {
			// best-effort; the in-panel sticky color header still conveys the agent color
		}
	}

	private post(agentId: string, msg: unknown): void {
		const panel = this.panels.get(agentId);
		if (panel) { void panel.webview.postMessage(msg); }
	}

	private preview(args: unknown): string {
		const a = args as Record<string, unknown> | undefined;
		if (!a || typeof a !== 'object') return '';
		if (typeof a.pattern === 'string') return `"${a.pattern}"`;
		if (typeof a.path === 'string') return a.path;
		if (typeof a.command === 'string') return a.command;
		return '';
	}

	private dur(ms: number): string {
		const s = Math.round(ms / 1000);
		return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
	}

	private esc(s: string): string {
		return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
	}

	private html(buf: AgentBuffer): string {
		// Sub-agent content is untrusted (model/tool output). Escape `<` so a literal `</script>`
		// can't break out of the inline <script> block (modern webview engines accept U+2028/9 in strings).
		const initial = JSON.stringify({ items: buf.items, status: buf.status, receipt: buf.receipt })
			.replace(/</g, '\\u003c');
		// Pop-out shows reasoning ON by default.
		return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
			body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
			.head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px;
				padding: 8px 16px; background: var(--vscode-editor-background);
				border-bottom: 3px solid ${buf.color}; }
			.dot { width: 12px; height: 12px; border-radius: 50%; background: ${buf.color}; flex: 0 0 auto; }
			.title { font-size: 1.1em; font-weight: 600; }
			.content { padding: 12px 16px; }
			.receipt { color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
			.tool { font-family: var(--vscode-editor-font-family, monospace); padding: 2px 0; }
			.msg { padding: 6px 0; white-space: pre-wrap; }
			.think { margin: 4px 0 4px 14px; padding: 6px 8px; border-left: 2px solid var(--vscode-panel-border);
				color: var(--vscode-descriptionForeground); white-space: pre-wrap;
				font-family: var(--vscode-editor-font-family, monospace); }
			.label { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
		</style></head><body>
			<div class="head"><span class="dot"></span><span class="title">${this.esc(buf.title)}</span></div>
			<div class="content">
				<div class="receipt" id="receipt"></div>
				<div id="feed"></div>
			</div>
			<script>
				const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
				const feed = document.getElementById('feed');
				const receiptEl = document.getElementById('receipt');
				function renderItem(it) {
					const d = document.createElement('div');
					if (it.kind === 'tool') {
						d.className = 'tool';
						d.textContent = '🔧 ' + [it.toolName, it.preview].filter(Boolean).join(' ');
					} else {
						d.className = 'msg';
						let h = '💬 ' + esc(it.content);
						if (it.reasoningText) {
							h += '<div class="label">thinking:</div><div class="think">' + esc(it.reasoningText) + '</div>';
						}
						d.innerHTML = h;
					}
					feed.appendChild(d);
					window.scrollTo(0, document.body.scrollHeight);
				}
				function setStatus(status, receipt) {
					receiptEl.textContent = (status === 'failed' ? '❌ ' : status === 'complete' ? '✅ ' : '⏳ ') + (receipt || 'running…');
				}
				const initial = ${initial};
				initial.items.forEach(renderItem);
				setStatus(initial.status, initial.receipt);
				window.addEventListener('message', (e) => {
					const m = e.data;
					if (m.type === 'item') renderItem(m.item);
					else if (m.type === 'status') setStatus(m.status, m.receipt);
				});
			</script>
		</body></html>`;
	}

	dispose(): void {
		for (const p of this.panels.values()) p.dispose();
		this.panels.clear();
		this.buffers.clear();
	}
}
