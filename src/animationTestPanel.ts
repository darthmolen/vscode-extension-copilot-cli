import * as vscode from 'vscode';

export function createAnimationTestPanel(theme: 'light' | 'dark'): vscode.WebviewPanel {
	const title = theme === 'light' ? 'Animation Test (Light)' : 'Animation Test (Dark)';
	const panel = vscode.window.createWebviewPanel(
		'copilot-cli.animationTest',
		title,
		vscode.ViewColumn.One,
		{ enableScripts: false }
	);

	const bg = theme === 'light' ? '#ffffff' : '#1e1e1e';
	const fg = theme === 'light' ? '#1e1e1e' : '#d4d4d4';
	const fgMuted = theme === 'light' ? '#6e7681' : '#8b949e';

	panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	body {
		background: ${bg};
		color: ${fg};
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		margin: 0;
		gap: 60px;
	}

	h2 {
		font-size: 18px;
		font-weight: 400;
		opacity: 0.5;
		margin: 0;
	}

	.demo-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
	}

	.demo-row {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	/* ---- Rainbow brain ---- */
	@keyframes rainbow-cycle {
		0%   { filter: hue-rotate(0deg) saturate(2); }
		100% { filter: hue-rotate(360deg) saturate(2); }
	}

	.brain-icon {
		font-size: 64px;
		line-height: 1;
		animation: rainbow-cycle 3s linear infinite alternate;
	}

	.brain-icon-small {
		font-size: 14px;
		line-height: 1;
		animation: rainbow-cycle 3s linear infinite alternate;
	}

	/* ---- Thinking pulse (improved — no font-weight change) ---- */
	@keyframes thinking-pulse {
		0%, 100% {
			opacity: 1;
			color: ${fg};
		}
		50% {
			opacity: 0.5;
			color: ${fgMuted};
		}
	}

	.thinking-text-large {
		font-size: 48px;
		font-style: italic;
		animation: thinking-pulse 3s ease-in-out infinite;
	}

	.thinking-text-actual {
		font-size: 12px;
		font-style: italic;
		animation: thinking-pulse 3s ease-in-out infinite;
	}

	/* ---- Actual-size preview ---- */
	.actual-size {
		border: 1px solid ${theme === 'light' ? '#e0e0e0' : '#333'};
		border-radius: 10px;
		padding: 16px 20px;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.label {
		font-size: 12px;
		opacity: 0.4;
		text-transform: uppercase;
		letter-spacing: 1px;
	}
</style>
</head>
<body>
	<h2>${theme.toUpperCase()} THEME &mdash; Animation Test</h2>

	<div class="demo-block">
		<span class="label">Large Preview</span>
		<div class="demo-row">
			<span class="brain-icon">🧠</span>
			<span class="thinking-text-large">Thinking...</span>
		</div>
	</div>

	<div class="demo-block">
		<span class="label">Actual Size (12px)</span>
		<div class="actual-size">
			<span class="brain-icon-small">🧠</span>
			<span class="thinking-text-actual">Thinking...</span>
		</div>
	</div>
</body>
</html>`;

	return panel;
}
