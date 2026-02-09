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
	if (!fs.existsSync(rpcDistDir)) {
		fs.mkdirSync(rpcDistDir, { recursive: true });
	}
	if (!fs.existsSync(handlersDistDir)) {
		fs.mkdirSync(handlersDistDir, { recursive: true });
	}
	if (!fs.existsSync(utilsDistDir)) {
		fs.mkdirSync(utilsDistDir, { recursive: true });
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
