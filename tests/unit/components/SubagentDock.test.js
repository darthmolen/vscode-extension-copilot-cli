/**
 * SubagentDock Component Tests (v2 — master/detail + pop-out)
 *
 * The dock is a persistent ledger of sub-agent activity. Each agent is a COLORED bar
 * (status + current action + counter + chevron + pop-out). Clicking a bar opens ONE shared
 * read-only detail pane beneath the list, color-matched, interleaving the agent's COMMENTS
 * and TOOL CALLS chronologically (reasoning behind a per-message toggle, off by default).
 *
 * Run: npx mocha tests/unit/components/SubagentDock.test.js --timeout 10000
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { SubagentDock } from '../../../src/webview/app/components/SubagentDock/SubagentDock.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

const A1 = { agentId: 'a1', agentDisplayName: 'Code Review Agent', agentDescription: 'Reviews.' };
const A2 = { agentId: 'a2', agentDisplayName: 'Explore Agent', agentDescription: 'Explores.' };

const tool = (agentId, toolCallId, toolName, args) => ({ agentId, toolCallId, toolName, arguments: args || {}, status: 'running' });
const bar = (c, id) => c.querySelector(`.subagent-dock__tile[data-agent-id="${id}"]`);

describe('SubagentDock Component (v2)', () => {
	let dom, container, eventBus, dock;

	beforeEach(() => {
		dom = new JSDOM(`<!DOCTYPE html><div id="container"></div>`);
		global.document = dom.window.document;
		global.window = dom.window;
		container = document.getElementById('container');
		eventBus = new EventBus();
		dock = new SubagentDock(container, eventBus);
	});
	afterEach(() => { delete global.document; delete global.window; });

	describe('bars (master list)', () => {
		it('renders .subagent-dock, hidden when empty', () => {
			expect(container.querySelector('.subagent-dock')).to.not.be.null;
			expect(container.querySelector('.subagent-dock').classList.contains('subagent-dock--hidden')).to.be.true;
		});

		it('subagent:start creates a bar keyed by agentId and shows the dock', () => {
			eventBus.emit('subagent:start', A1);
			const b = bar(container, 'a1');
			expect(b).to.not.be.null;
			expect(b.textContent).to.contain('Code Review Agent');
			expect(b.classList.contains('subagent-dock__tile--running')).to.be.true;
			expect(container.querySelector('.subagent-dock').classList.contains('subagent-dock--hidden')).to.be.false;
		});

		it('assigns distinct colors to different agents', () => {
			eventBus.emit('subagent:start', A1);
			eventBus.emit('subagent:start', A2);
			const c1 = bar(container, 'a1').style.getPropertyValue('--agent-color');
			const c2 = bar(container, 'a2').style.getPropertyValue('--agent-color');
			expect(c1).to.not.equal('');
			expect(c1).to.not.equal(c2);
		});

		it('uses the color from the start payload when provided (authoritative)', () => {
			eventBus.emit('subagent:start', { ...A1, color: '#abcdef' });
			expect(bar(container, 'a1').style.getPropertyValue('--agent-color')).to.equal('#abcdef');
		});

		it('header reads "Running Sub-Agents"', () => {
			expect(dock.el.querySelector('.subagent-dock__title').textContent).to.contain('Running Sub-Agents');
		});

		it('each bar has a pop-out button and a chevron affordance', () => {
			eventBus.emit('subagent:start', A1);
			const b = bar(container, 'a1');
			expect(b.querySelector('.subagent-dock__popout'), 'pop-out button').to.not.be.null;
			expect(b.querySelector('.subagent-dock__chevron'), 'chevron affordance').to.not.be.null;
		});

		it('counter + current action update on the bar as tools arrive (even with detail closed)', () => {
			eventBus.emit('subagent:start', A1);
			eventBus.emit('subagent:start', A1); // dedupe
			eventBus.emit('tool:start', tool('a1', 't1', 'grep', { pattern: 'foo' }));
			eventBus.emit('tool:start', tool('a1', 't2', 'view', { path: 'x.ts' }));
			const b = bar(container, 'a1');
			expect(b.querySelector('.subagent-dock__counter').textContent).to.match(/2 tool calls/);
			expect(b.querySelector('.subagent-dock__action').textContent).to.contain('view');
		});

		it('ignores tools with no agentId', () => {
			eventBus.emit('tool:start', { toolCallId: 'x', toolName: 'bash', status: 'running' });
			expect(container.querySelectorAll('.subagent-dock__tile').length).to.equal(0);
			expect(container.querySelector('.subagent-dock').classList.contains('subagent-dock--hidden')).to.be.true;
		});
	});

	describe('detail pane (master/detail)', () => {
		it('clicking a bar opens the single detail pane for that agent; clicking again closes it', () => {
			eventBus.emit('subagent:start', A1);
			const header = bar(container, 'a1').querySelector('.subagent-dock__header');
			header.click();
			const detail = container.querySelector('.subagent-dock__detail');
			expect(detail.classList.contains('subagent-dock__detail--hidden')).to.be.false;
			expect(detail.getAttribute('data-agent-id')).to.equal('a1');
			header.click();
			expect(detail.classList.contains('subagent-dock__detail--hidden')).to.be.true;
		});

		it('only one detail open at a time — opening another agent switches', () => {
			eventBus.emit('subagent:start', A1);
			eventBus.emit('subagent:start', A2);
			bar(container, 'a1').querySelector('.subagent-dock__header').click();
			bar(container, 'a2').querySelector('.subagent-dock__header').click();
			const detail = container.querySelector('.subagent-dock__detail');
			expect(detail.getAttribute('data-agent-id')).to.equal('a2');
		});

		it('detail interleaves comments and tool calls chronologically', () => {
			eventBus.emit('subagent:start', A1);
			eventBus.emit('tool:start', tool('a1', 't1', 'grep', { pattern: 'foo' }));
			eventBus.emit('subagent:message', { agentId: 'a1', content: 'plan looks sound' });
			eventBus.emit('tool:start', tool('a1', 't2', 'bash', { command: 'npm test' }));
			bar(container, 'a1').querySelector('.subagent-dock__header').click();
			const detail = container.querySelector('.subagent-dock__detail');
			const rows = [...detail.querySelectorAll('.subagent-dock__tool, .subagent-dock__msg')];
			expect(rows.length).to.equal(3);
			expect(rows[0].classList.contains('subagent-dock__tool')).to.be.true; // grep
			expect(rows[1].classList.contains('subagent-dock__msg')).to.be.true;  // comment
			expect(rows[1].textContent).to.contain('plan looks sound');
			expect(rows[2].classList.contains('subagent-dock__tool')).to.be.true; // bash
		});

		it('live-appends to the open detail as new events arrive', () => {
			eventBus.emit('subagent:start', A1);
			bar(container, 'a1').querySelector('.subagent-dock__header').click();
			eventBus.emit('subagent:message', { agentId: 'a1', content: 'hello' });
			const detail = container.querySelector('.subagent-dock__detail');
			expect(detail.textContent).to.contain('hello');
		});

		it('a comment with reasoningText shows a thinking toggle, hidden by default, revealed on click', () => {
			eventBus.emit('subagent:start', A1);
			eventBus.emit('subagent:message', { agentId: 'a1', content: 'done', reasoningText: 'because the types omit it' });
			bar(container, 'a1').querySelector('.subagent-dock__header').click();
			const detail = container.querySelector('.subagent-dock__detail');
			const think = detail.querySelector('.subagent-dock__think');
			const toggle = detail.querySelector('.subagent-dock__think-toggle');
			expect(toggle, 'thinking toggle present').to.not.be.null;
			expect(think.classList.contains('subagent-dock__think--hidden'), 'reasoning hidden by default').to.be.true;
			toggle.click();
			expect(think.classList.contains('subagent-dock__think--hidden')).to.be.false;
			expect(think.textContent).to.contain('because the types omit it');
		});
	});

	describe('pop-out', () => {
		it('clicking the pop-out button emits subagent:popout with the agentId (not toggling detail)', () => {
			eventBus.emit('subagent:start', A1);
			let popped = null;
			eventBus.on('subagent:popout', (d) => { popped = d; });
			bar(container, 'a1').querySelector('.subagent-dock__popout').click();
			expect(popped).to.deep.equal({ agentId: 'a1' });
			// pop-out must not open the inline detail
			expect(container.querySelector('.subagent-dock__detail').classList.contains('subagent-dock__detail--hidden')).to.be.true;
		});
	});

	describe('lifecycle retained from v1', () => {
		it('completion renders a receipt and flips status', () => {
			eventBus.emit('subagent:start', A1);
			eventBus.emit('subagent:complete', { agentId: 'a1', status: 'complete', durationMs: 87168, totalToolCalls: 13, totalTokens: 282777, model: 'claude-sonnet-4.6' });
			const b = bar(container, 'a1');
			expect(b.classList.contains('subagent-dock__tile--complete')).to.be.true;
			expect(b.textContent).to.contain('13');
			expect(b.textContent).to.contain('1m27s');
			expect(b.textContent).to.contain('claude-sonnet-4.6');
		});

		it('failure shows the error', () => {
			eventBus.emit('subagent:start', A2);
			eventBus.emit('subagent:complete', { agentId: 'a2', status: 'failed', error: 'boom' });
			expect(bar(container, 'a2').classList.contains('subagent-dock__tile--failed')).to.be.true;
			expect(bar(container, 'a2').textContent).to.contain('boom');
		});

		it('subagent:sessionEnded fails still-running bars, leaves completed ones', () => {
			eventBus.emit('subagent:start', A1);
			eventBus.emit('subagent:start', A2);
			eventBus.emit('subagent:complete', { agentId: 'a2', status: 'complete', durationMs: 1, totalToolCalls: 1 });
			eventBus.emit('subagent:sessionEnded');
			expect(bar(container, 'a1').classList.contains('subagent-dock__tile--failed')).to.be.true;
			expect(bar(container, 'a1').textContent).to.contain('Session ended');
			expect(bar(container, 'a2').classList.contains('subagent-dock__tile--complete')).to.be.true;
		});

		it('bar survives a main-agent message:add', () => {
			eventBus.emit('subagent:start', A1);
			eventBus.emit('tool:start', tool('a1', 't1', 'grep'));
			eventBus.emit('message:add', { role: 'assistant', content: 'x' });
			eventBus.emit('tool:start', tool('a1', 't2', 'view'));
			expect(bar(container, 'a1')).to.not.be.null;
			expect(bar(container, 'a1').querySelector('.subagent-dock__counter').textContent).to.match(/2 tool calls/);
		});

		it('concurrent agents are independent and complete out of order', () => {
			eventBus.emit('subagent:start', A1);
			eventBus.emit('subagent:start', A2);
			eventBus.emit('subagent:start', { agentId: 'a3', agentDisplayName: 'Third' });
			expect(container.querySelectorAll('.subagent-dock__tile').length).to.equal(3);
			eventBus.emit('subagent:complete', { agentId: 'a2', status: 'complete', durationMs: 1, totalToolCalls: 1 });
			eventBus.emit('subagent:complete', { agentId: 'a1', status: 'complete', durationMs: 1, totalToolCalls: 1 });
			expect(bar(container, 'a3').classList.contains('subagent-dock__tile--running')).to.be.true;
		});

		it('active bars sit above completed; completed most-recent-first', () => {
			eventBus.emit('subagent:start', A1);
			eventBus.emit('subagent:start', A2);
			eventBus.emit('subagent:start', { agentId: 'a3', agentDisplayName: 'Third' });
			eventBus.emit('subagent:complete', { agentId: 'a1', status: 'complete', durationMs: 1, totalToolCalls: 1 });
			eventBus.emit('subagent:complete', { agentId: 'a2', status: 'complete', durationMs: 1, totalToolCalls: 1 });
			const order = [...container.querySelectorAll('.subagent-dock__tile')].map((t) => t.getAttribute('data-agent-id'));
			expect(order).to.deep.equal(['a3', 'a2', 'a1']);
		});

		it('minimize/restore + force-restore on new start', () => {
			eventBus.emit('subagent:start', A1);
			dock.minimize();
			expect(dock.el.classList.contains('subagent-dock--minimized')).to.be.true;
			eventBus.emit('subagent:start', A2);
			expect(dock.el.classList.contains('subagent-dock--minimized')).to.be.false;
		});

		it('persisted minimize round-trips via onMinimizeChange / minimized option', () => {
			const states = [];
			const d2 = new SubagentDock(container, eventBus, { onMinimizeChange: (v) => states.push(v) });
			d2.minimize(); d2.restore();
			expect(states).to.deep.equal([true, false]);
			const d3 = new SubagentDock(container, eventBus, { minimized: true });
			expect(d3.minimized).to.be.true;
		});

		it('per-card clear on completed cards removes them; clearing last hides the dock', () => {
			eventBus.emit('subagent:start', A1);
			expect(bar(container, 'a1').querySelector('.subagent-dock__clear'), 'no × while running').to.be.null;
			eventBus.emit('subagent:complete', { agentId: 'a1', status: 'complete', durationMs: 1, totalToolCalls: 1 });
			bar(container, 'a1').querySelector('.subagent-dock__clear').click();
			expect(bar(container, 'a1')).to.be.null;
			expect(dock.el.classList.contains('subagent-dock--hidden')).to.be.true;
		});

		it('clearing the open agent also closes its detail pane', () => {
			eventBus.emit('subagent:start', A1);
			eventBus.emit('subagent:complete', { agentId: 'a1', status: 'complete', durationMs: 1, totalToolCalls: 1 });
			bar(container, 'a1').querySelector('.subagent-dock__header').click();
			bar(container, 'a1').querySelector('.subagent-dock__clear').click();
			expect(container.querySelector('.subagent-dock__detail').classList.contains('subagent-dock__detail--hidden')).to.be.true;
		});
	});
});

/**
 * Every tool row should say what it did.
 *
 * `_argPreview` shipped in v3.10.0 reading exactly three keys — `pattern`, `path`,
 * `command` — so `bash`, `rg` and `view` rows carried their arguments while
 * `skill`, `sql` and `task` rows showed a bare tool name and nothing else. `sql`
 * and `task` carry a human-written `description` the dock simply never looked at.
 *
 * Surfaced by a sub-agent-heavy run, where those three are most of the traffic.
 */
describe('SubagentDock — tool rows say what the tool did', () => {
	let dom, container, eventBus, dock;

	beforeEach(() => {
		dom = new JSDOM(`<!DOCTYPE html><div id="container"></div>`);
		global.document = dom.window.document;
		global.window = dom.window;
		container = document.getElementById('container');
		eventBus = new EventBus();
		dock = new SubagentDock(container, eventBus);
		eventBus.emit('subagent:start', A1);
	});
	afterEach(() => { delete global.document; delete global.window; });

	/** The bar's action line is what a collapsed dock shows for the latest tool. */
	const actionLine = () => bar(container, 'a1').querySelector('.subagent-dock__action').textContent;

	it('shows the description a sql call carries', () => {
		eventBus.emit('tool:start', tool('a1', 't1', 'sql', {
			description: 'Load plan tasks into todos', query: 'INSERT INTO todos …'
		}));

		expect(actionLine()).to.contain('Load plan tasks into todos');
	});

	it('shows the description a task call carries, not its prompt', () => {
		eventBus.emit('tool:start', tool('a1', 't2', 'task', {
			name: 'plan-reviewer', agent_type: 'rubber-duck',
			description: 'Review plan: Shared spine S1–S3', prompt: 'You are reviewing…'
		}));

		const line = actionLine();
		expect(line).to.contain('Review plan: Shared spine S1–S3');
		expect(line).to.not.contain('You are reviewing');
	});

	it('names the skill a skill call invoked', () => {
		eventBus.emit('tool:start', tool('a1', 't3', 'skill', { skill: 'plan-intake-review' }));

		expect(actionLine()).to.contain('plan-intake-review');
	});

	it('still prefers the command for a shell call', () => {
		eventBus.emit('tool:start', tool('a1', 't4', 'bash', {
			command: 'ls -la', description: 'List files'
		}));

		// `command` is the more specific answer to "what did it do" — a description
		// would hide the actual command behind a paraphrase.
		expect(actionLine()).to.contain('ls -la');
	});

	it('falls back to a single distinctive argument rather than showing nothing', () => {
		eventBus.emit('tool:start', tool('a1', 't5', 'mystery_tool', { target: 'the-thing' }));

		expect(actionLine()).to.contain('the-thing');
	});

	it('says nothing extra when a tool genuinely has no arguments', () => {
		eventBus.emit('tool:start', tool('a1', 't6', 'reload_agents', {}));

		expect(actionLine().trim()).to.equal('reload_agents');
	});
});
