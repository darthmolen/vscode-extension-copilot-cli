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
	// Create dist/webview directory
	const webviewDistDir = path.join(__dirname, 'dist', 'webview');
	if (!fs.existsSync(webviewDistDir)) {
		fs.mkdirSync(webviewDistDir, { recursive: true });
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
