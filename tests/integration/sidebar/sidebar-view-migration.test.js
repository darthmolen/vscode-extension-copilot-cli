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

	// Three source-scans lived here and were deleted in v3.13.0 Task 7:
	// `show()` uses `.focus`, the field is `_view: vscode.WebviewView`, and the
	// listener is `.onDidChangeVisibility(`. All three read the provider's *text*.
	//
	// The chat surface moved to `src/extension/webview/webviewChatSurface.ts` so one
	// class can serve the sidebar and an editor tab, and the container differences
	// moved behind `ChatWebviewSlot`. Those three facts are now properties of
	// `SidebarSlot`, and `chat-webview-slot.test.js` asserts each by running it:
	// revealing focuses the view id, visibility changes are forwarded, and closing a
	// sidebar slot does not end its surface — the last of which no string could
	// have expressed.

	// The 'ChatViewProvider export' block — four scans of `src/chatViewProvider.ts`
	// for `export class ChatViewProvider`, `vscode.WebviewViewProvider`, the absence
	// of `createOrShow`, and the viewType literal — was deleted 2026-08-22.
	//
	// The provider is 38 lines now and does one thing: hand its view to a
	// `WebviewChatSurface` as a `SidebarSlot`. Its registration contract with VS Code
	// is asserted below, against `package.json`, which is where that contract
	// actually lives; its behaviour is asserted by `chat-webview-slot.test.js`.

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

		/**
		 * v3.13.0 Task 8 — one control per idea in the sidebar's title bar.
		 *
		 * This used to require *New Session* and *Refresh* there. Both went:
		 *
		 *  - `newSession` ($(add)) duplicated the webview's own `+` inches away, so
		 *    the slot is repurposed for *New Tab* rather than a third add-button.
		 *  - `refreshPanel`'s stated reason for existing — that it triggered the
		 *    replay corruption — was fixed by P2, and it was re-argued rather than
		 *    actioned as written: it survives in the palette as the debug affordance
		 *    it always was, and gives up the toolbar slot.
		 */
		it('offers New Tab in the view title, and nothing that duplicates the webview', () => {
			const viewTitle = pkg.contributes.menus['view/title'];
			assert.ok(Array.isArray(viewTitle), 'Should have view/title menus');

			const newTab = viewTitle.find(m =>
				m.command === 'copilot-cli-extension.openChatInTab' &&
				m.when === 'view == copilot-cli.chatView'
			);
			assert.ok(newTab, 'Should have New Tab menu entry');

			assert.ok(
				!viewTitle.some(m => m.command === 'copilot-cli-extension.newSession'),
				'New Session duplicates the webview\'s own + button'
			);
			assert.ok(
				!viewTitle.some(m => m.command === 'copilot-cli-extension.refreshPanel'),
				'Refresh is a palette-only debug affordance'
			);
		});

		it('shows the New Tab icon whether or not the editor has focus', () => {
			// `when: editorFocus` hid it whenever focus sat in the chat — which is
			// most of the time you would reach for it. It read as the icon randomly
			// not existing.
			const editorTitle = pkg.contributes.menus['editor/title'];
			const entry = editorTitle.find(m => m.command === 'copilot-cli-extension.openChatInTab');
			assert.ok(entry, 'Should offer New Tab from the editor title bar');
			assert.notStrictEqual(entry.when, 'editorFocus', 'editorFocus hides it exactly when it is wanted');
		});

		it('should reference existing sidebar icon SVG', () => {
			const activitybar = pkg.contributes.viewsContainers.activitybar;
			const sidebar = activitybar.find(c => c.id === 'copilot-cli-sidebar');

			const iconPath = path.join(__dirname, '..', '..', '..', sidebar.icon);
			assert.ok(fs.existsSync(iconPath), `Sidebar icon should exist at ${sidebar.icon}`);
		});
	});

	describe('Extension registration', () => {
		// Two scans of `src/extension.ts` were deleted here on 2026-08-22: that it
		// imports `ChatViewProvider`, and that it mentions `registerWebviewViewProvider`
		// and `retainContextWhenHidden`. An import that is missing is a compile error,
		// which `npm run check-types` gates; the registration itself is exercised every
		// time the extension loads, and is in the live-verification list.

		// The `chatProvider.show()` scan that lived here was deleted in v3.13.0
		// Task 7. The variable is `sidebarSurface` now — the provider is only the
		// registration — so the assertion was matching a name, not a behaviour, and
		// renaming a local broke it. `chat-webview-slot.test.js` asserts what show()
		// actually has to do.
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
