/**
 * SlashCommandPanel - Displays grouped slash commands for discovery
 *
 * Shows when user types '/' as first character in the input.
 * Clicking a command triggers onSelect callback.
 */

const CATEGORY_LABELS = {
	session: 'Session',
	plan: 'Plan Mode',
	code: 'Code & Review',
	config: 'Configuration',
	cli: 'CLI (terminal)',
};

const CATEGORY_ORDER = ['session', 'plan', 'code', 'config', 'cli'];

export class SlashCommandPanel {
	constructor(container) {
		this.container = container;
		this.onSelect = null;
		this.render();
	}

	render() {
		this.container.innerHTML = '<div class="slash-command-panel" style="display: none;"></div>';
		this.panelEl = this.container.querySelector('.slash-command-panel');
	}

	show(commands) {
		const grouped = this.groupByCategory(commands);

		this.panelEl.innerHTML = CATEGORY_ORDER
			.filter(cat => grouped[cat] && grouped[cat].length > 0)
			.map(cat => {
				const rows = grouped[cat].map(cmd => `
					<div class="slash-command-item" data-command="${cmd.name}">
						<span class="slash-command-name">/${cmd.name}</span>
						<span class="slash-command-desc">${cmd.description}</span>
					</div>
				`).join('');

				// Add @agent hint after the session group
				const atHint = cat === 'session' ? `
					<div class="slash-command-item slash-command-hint">
						<span class="slash-command-name">@agent</span>
						<span class="slash-command-desc">Single-shot agent: @name your prompt</span>
					</div>
				` : '';

				return `
					<div class="slash-command-group">
						<div class="slash-command-group-label">${CATEGORY_LABELS[cat]}</div>
						${rows}${atHint}
					</div>
				`;
			}).join('');

		this.panelEl.style.display = '';
		this.attachClickHandlers();
	}

	hide() {
		this.panelEl.style.display = 'none';
	}

	groupByCategory(commands) {
		const groups = {};
		for (const cmd of commands) {
			if (!groups[cmd.category]) {
				groups[cmd.category] = [];
			}
			groups[cmd.category].push(cmd);
		}
		return groups;
	}

	attachClickHandlers() {
		this.panelEl.querySelectorAll('.slash-command-item').forEach(item => {
			item.addEventListener('click', () => {
				if (this.onSelect) {
					this.onSelect(item.dataset.command);
				}
			});
		});
	}
}
