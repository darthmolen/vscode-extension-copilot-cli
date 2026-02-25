const esbuild = require("esbuild");
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	// Create dist/webview directory structure
	const webviewDistDir = path.join(__dirname, 'dist', 'webview');
	const rpcDistDir = path.join(webviewDistDir, 'app', 'rpc');
	const handlersDistDir = path.join(webviewDistDir, 'app', 'handlers');
	const utilsDistDir = path.join(webviewDistDir, 'app', 'utils');
	const stateDistDir = path.join(webviewDistDir, 'app', 'state');
	const servicesDistDir = path.join(webviewDistDir, 'app', 'services');
	const componentsDistDir = path.join(webviewDistDir, 'app', 'components');
	const messageDisplayDistDir = path.join(componentsDistDir, 'MessageDisplay');
	const toolExecutionDistDir = path.join(componentsDistDir, 'ToolExecution');
	const inputAreaDistDir = path.join(componentsDistDir, 'InputArea');
	const sessionToolbarDistDir = path.join(componentsDistDir, 'SessionToolbar');
	const acceptanceControlsDistDir = path.join(componentsDistDir, 'AcceptanceControls');
	const statusBarDistDir = path.join(componentsDistDir, 'StatusBar');
	const activeFileDisplayDistDir = path.join(componentsDistDir, 'ActiveFileDisplay');
	const planModeControlsDistDir = path.join(componentsDistDir, 'PlanModeControls');
	const slashCommandPanelDistDir = path.join(componentsDistDir, 'SlashCommandPanel');
	const modelSelectorDistDir = path.join(componentsDistDir, 'ModelSelector');

	if (!fs.existsSync(rpcDistDir)) {
		fs.mkdirSync(rpcDistDir, { recursive: true });
	}
	if (!fs.existsSync(handlersDistDir)) {
		fs.mkdirSync(handlersDistDir, { recursive: true });
	}
	if (!fs.existsSync(utilsDistDir)) {
		fs.mkdirSync(utilsDistDir, { recursive: true });
	}
	if (!fs.existsSync(stateDistDir)) {
		fs.mkdirSync(stateDistDir, { recursive: true });
	}
	if (!fs.existsSync(servicesDistDir)) {
		fs.mkdirSync(servicesDistDir, { recursive: true });
	}
	if (!fs.existsSync(messageDisplayDistDir)) {
		fs.mkdirSync(messageDisplayDistDir, { recursive: true });
	}
	if (!fs.existsSync(toolExecutionDistDir)) {
		fs.mkdirSync(toolExecutionDistDir, { recursive: true });
	}
	if (!fs.existsSync(inputAreaDistDir)) {
		fs.mkdirSync(inputAreaDistDir, { recursive: true });
	}
	if (!fs.existsSync(sessionToolbarDistDir)) {
		fs.mkdirSync(sessionToolbarDistDir, { recursive: true });
	}
	if (!fs.existsSync(acceptanceControlsDistDir)) {
		fs.mkdirSync(acceptanceControlsDistDir, { recursive: true });
	}
	if (!fs.existsSync(statusBarDistDir)) {
		fs.mkdirSync(statusBarDistDir, { recursive: true });
	}
	if (!fs.existsSync(activeFileDisplayDistDir)) {
		fs.mkdirSync(activeFileDisplayDistDir, { recursive: true });
	}
	if (!fs.existsSync(planModeControlsDistDir)) {
		fs.mkdirSync(planModeControlsDistDir, { recursive: true });
	}
	if (!fs.existsSync(slashCommandPanelDistDir)) {
		fs.mkdirSync(slashCommandPanelDistDir, { recursive: true });
	}
	if (!fs.existsSync(modelSelectorDistDir)) {
		fs.mkdirSync(modelSelectorDistDir, { recursive: true });
	}

	// Copy CSS file (no processing needed)
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'styles.css'),
		path.join(webviewDistDir, 'styles.css')
	);

	// Copy JS file (no processing needed for now - just vanilla JS)
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'main.js'),
		path.join(webviewDistDir, 'main.js')
	);

	// Copy RPC client (for ES6 module import)
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'rpc', 'WebviewRpcClient.js'),
		path.join(rpcDistDir, 'WebviewRpcClient.js')
	);

	// Copy handler files (Phase 4.0 refactor)
	const handlers = [
		'ui-handlers.js',
		'acceptance-handlers.js',
		'message-handlers.js',
		'diff-handler.js',
		'tool-group-handler.js'
	];
	for (const handler of handlers) {
		fs.copyFileSync(
			path.join(__dirname, 'src', 'webview', 'app', 'handlers', handler),
			path.join(handlersDistDir, handler)
		);
	}

	// Copy utility files (Phase 4.0 refactor)
	const utils = [
		'webview-utils.js'
	];
	for (const util of utils) {
		fs.copyFileSync(
			path.join(__dirname, 'src', 'webview', 'app', 'utils', util),
			path.join(utilsDistDir, util)
		);
	}

	// Copy state files (Phase 4.1)
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'state', 'EventBus.js'),
		path.join(stateDistDir, 'EventBus.js')
	);

	// Copy service files (Phase 5.2)
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'services', 'CommandParser.js'),
		path.join(servicesDistDir, 'CommandParser.js')
	);

	// Copy component files (Phase 4.2, 4.3)
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'components', 'MessageDisplay', 'MessageDisplay.js'),
		path.join(messageDisplayDistDir, 'MessageDisplay.js')
	);
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'components', 'ToolExecution', 'ToolExecution.js'),
		path.join(toolExecutionDistDir, 'ToolExecution.js')
	);
	// Phase 4.4 - InputArea component
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'components', 'InputArea', 'InputArea.js'),
		path.join(inputAreaDistDir, 'InputArea.js')
	);
	// Phase 4.5 - SessionToolbar component
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'components', 'SessionToolbar', 'SessionToolbar.js'),
		path.join(sessionToolbarDistDir, 'SessionToolbar.js')
	);
	// Phase 4.6 - AcceptanceControls component
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'components', 'AcceptanceControls', 'AcceptanceControls.js'),
		path.join(acceptanceControlsDistDir, 'AcceptanceControls.js')
	);
	// Phase 4.7 - StatusBar component
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'components', 'StatusBar', 'StatusBar.js'),
		path.join(statusBarDistDir, 'StatusBar.js')
	);
	// Phase 5.0 - ActiveFileDisplay component
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'components', 'ActiveFileDisplay', 'ActiveFileDisplay.js'),
		path.join(activeFileDisplayDistDir, 'ActiveFileDisplay.js')
	);
	// Phase 5.1 - PlanModeControls component
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'components', 'PlanModeControls', 'PlanModeControls.js'),
		path.join(planModeControlsDistDir, 'PlanModeControls.js')
	);
	// Phase 5.3 - SlashCommandPanel component
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'components', 'SlashCommandPanel', 'SlashCommandPanel.js'),
		path.join(slashCommandPanelDistDir, 'SlashCommandPanel.js')
	);
	// ModelSelector component
	fs.copyFileSync(
		path.join(__dirname, 'src', 'webview', 'app', 'components', 'ModelSelector', 'ModelSelector.js'),
		path.join(modelSelectorDistDir, 'ModelSelector.js')
	);

	// Extension build context
	const extensionCtx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	if (watch) {
		await extensionCtx.watch();
	} else {
		await extensionCtx.rebuild();
		await extensionCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
