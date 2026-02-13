/**
 * Sidebar View Migration Tests
 *
 * Verifies that ChatViewProvider implements the WebviewViewProvider contract
 * and exposes the correct API surface for sidebar rendering.
 *
 * These tests load the compiled extension code and verify:
 * 1. ChatViewProvider is exported (not ChatPanelProvider)
 * 2. It implements resolveWebviewView (not createOrShow)
 * 3. show() focuses the sidebar view
 * 4. Package.json declares correct sidebar contributions
 * 5. Extension registers as WebviewViewProvider
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('Sidebar View Migration', () => {

	describe('ChatViewProvider export', () => {
		it('should export ChatViewProvider, not ChatPanelProvider', () => {
			const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'chatViewProvider.ts');
			const content = fs.readFileSync(srcPath, 'utf8');

			assert.ok(content.includes('export class ChatViewProvider'),
				'Should export ChatViewProvider class');
			assert.ok(!content.includes('export class ChatPanelProvider'),
				'Should NOT export ChatPanelProvider class');
		});

		it('should implement WebviewViewProvider interface', () => {
			const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'chatViewProvider.ts');
			const content = fs.readFileSync(srcPath, 'utf8');

			assert.ok(content.includes('vscode.WebviewViewProvider'),
				'Should implement vscode.WebviewViewProvider');
			assert.ok(content.includes('resolveWebviewView'),
				'Should have resolveWebviewView method');
		});

		it('should NOT have createOrShow method', () => {
			const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'chatViewProvider.ts');
			const content = fs.readFileSync(srcPath, 'utf8');

			// Should not define createOrShow as a method
			assert.ok(!content.match(/^\s*(public\s+)?createOrShow\s*\(/m),
				'Should NOT have createOrShow method');
		});

		it('should have show() that uses executeCommand to focus sidebar', () => {
			const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'chatViewProvider.ts');
			const content = fs.readFileSync(srcPath, 'utf8');

			assert.ok(content.includes('.focus'),
				'show() should use .focus command');
		});

		it('should have static viewType matching package.json', () => {
			const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'chatViewProvider.ts');
			const content = fs.readFileSync(srcPath, 'utf8');

			assert.ok(content.includes("viewType = 'copilot-cli.chatView'"),
				'viewType should be copilot-cli.chatView');
		});

		it('should use _view (WebviewView) not panel (WebviewPanel)', () => {
			const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'chatViewProvider.ts');
			const content = fs.readFileSync(srcPath, 'utf8');

			assert.ok(content.includes('_view: vscode.WebviewView'),
				'Should use _view: WebviewView');
			assert.ok(!content.includes('panel: vscode.WebviewPanel'),
				'Should NOT use panel: WebviewPanel');
		});

		it('should listen for onDidChangeVisibility, not onDidChangeViewState', () => {
			const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'chatViewProvider.ts');
			const content = fs.readFileSync(srcPath, 'utf8');

			assert.ok(content.includes('.onDidChangeVisibility('),
				'Should call onDidChangeVisibility');
			// Allow mentions in comments, but should not call the method
			assert.ok(!content.includes('.onDidChangeViewState('),
				'Should NOT call onDidChangeViewState');
		});
	});

	describe('Package.json sidebar contributions', () => {
		let pkg;

		before(() => {
			const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
			pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
		});

		it('should declare sidebar view container in activitybar', () => {
			const activitybar = pkg.contributes.viewsContainers.activitybar;
			assert.ok(Array.isArray(activitybar), 'Should have activitybar array');

			const sidebar = activitybar.find(c => c.id === 'copilot-cli-sidebar');
			assert.ok(sidebar, 'Should have copilot-cli-sidebar container');
			assert.ok(sidebar.icon, 'Should have icon');
			assert.ok(sidebar.title, 'Should have title');
		});

		it('should declare webview view under sidebar container', () => {
			const views = pkg.contributes.views['copilot-cli-sidebar'];
			assert.ok(Array.isArray(views), 'Should have views array');

			const chatView = views.find(v => v.id === 'copilot-cli.chatView');
			assert.ok(chatView, 'Should have copilot-cli.chatView view');
			assert.strictEqual(chatView.type, 'webview', 'View type should be webview');
		});

		it('should have view/title menu entries for New Session and Refresh', () => {
			const viewTitle = pkg.contributes.menus['view/title'];
			assert.ok(Array.isArray(viewTitle), 'Should have view/title menus');

			const newSession = viewTitle.find(m =>
				m.command === 'copilot-cli-extension.newSession' &&
				m.when === 'view == copilot-cli.chatView'
			);
			assert.ok(newSession, 'Should have New Session menu entry');

			const refresh = viewTitle.find(m =>
				m.command === 'copilot-cli-extension.refreshPanel' &&
				m.when === 'view == copilot-cli.chatView'
			);
			assert.ok(refresh, 'Should have Refresh menu entry');
		});

		it('should reference existing sidebar icon SVG', () => {
			const activitybar = pkg.contributes.viewsContainers.activitybar;
			const sidebar = activitybar.find(c => c.id === 'copilot-cli-sidebar');

			const iconPath = path.join(__dirname, '..', '..', '..', sidebar.icon);
			assert.ok(fs.existsSync(iconPath), `Sidebar icon should exist at ${sidebar.icon}`);
		});
	});

	describe('Extension registration', () => {
		it('should import ChatViewProvider (not ChatPanelProvider)', () => {
			const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'extension.ts');
			const content = fs.readFileSync(srcPath, 'utf8');

			assert.ok(content.includes("import { ChatViewProvider }"),
				'Should import ChatViewProvider');
			assert.ok(!content.includes("import { ChatPanelProvider }"),
				'Should NOT import ChatPanelProvider');
		});

		it('should register with registerWebviewViewProvider', () => {
			const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'extension.ts');
			const content = fs.readFileSync(srcPath, 'utf8');

			assert.ok(content.includes('registerWebviewViewProvider'),
				'Should use registerWebviewViewProvider');
			assert.ok(content.includes('retainContextWhenHidden'),
				'Should set retainContextWhenHidden option');
		});

		it('should use chatProvider.show() not createOrShow()', () => {
			const srcPath = path.join(__dirname, '..', '..', '..', 'src', 'extension.ts');
			const content = fs.readFileSync(srcPath, 'utf8');

			assert.ok(!content.includes('createOrShow()'),
				'Should NOT call createOrShow()');
			assert.ok(content.includes('chatProvider.show()'),
				'Should call chatProvider.show()');
		});
	});

	describe('Responsive CSS', () => {
		it('should have @media rules for narrow sidebar', () => {
			const cssPath = path.join(__dirname, '..', '..', '..', 'src', 'webview', 'styles.css');
			const content = fs.readFileSync(cssPath, 'utf8');

			assert.ok(content.includes('@media (max-width: 350px)'),
				'Should have @media (max-width: 350px) rule');
		});

		it('should constrain tool groups to max-width: 100% in narrow mode', () => {
			const cssPath = path.join(__dirname, '..', '..', '..', 'src', 'webview', 'styles.css');
			const content = fs.readFileSync(cssPath, 'utf8');

			// Find the media query section
			const mediaIdx = content.indexOf('@media (max-width: 350px)');
			const mediaSection = content.substring(mediaIdx);

			assert.ok(mediaSection.includes('max-width: 100%'),
				'Should set max-width: 100% for tool groups in narrow mode');
		});

		it('should reduce session selector min-width in narrow mode', () => {
			const cssPath = path.join(__dirname, '..', '..', '..', 'src', 'webview', 'styles.css');
			const content = fs.readFileSync(cssPath, 'utf8');

			const mediaIdx = content.indexOf('@media (max-width: 350px)');
			const mediaSection = content.substring(mediaIdx);

			assert.ok(mediaSection.includes('.session-selector select'),
				'Should adjust session-selector select in narrow mode');
		});
	});

	describe('vscode-mock supports WebviewViewProvider', () => {
		it('should have registerWebviewViewProvider in window mock', () => {
			const mock = require('../../helpers/vscode-mock');

			assert.ok(typeof mock.window.registerWebviewViewProvider === 'function',
				'Mock should have registerWebviewViewProvider');
		});

		it('registerWebviewViewProvider should return a disposable', () => {
			const mock = require('../../helpers/vscode-mock');
			const result = mock.window.registerWebviewViewProvider('test', {});

			assert.ok(result, 'Should return an object');
			assert.ok(typeof result.dispose === 'function',
				'Should return a disposable');
		});
	});
});
