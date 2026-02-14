import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';

/**
 * Tests for URI scheme filtering in updateActiveFile().
 *
 * The updateActiveFile() function in extension.ts must filter out
 * non-file editors (output channels, debug console, etc.) to prevent
 * bogus paths like "extension-output-darthmolen..." from being displayed.
 *
 * Since updateActiveFile() is a module-level function with VS Code dependencies,
 * we test the scheme-filtering logic as an extracted pure function.
 */

/**
 * Determines if an editor should be treated as a valid file editor.
 * This mirrors the scheme guard that should exist in updateActiveFile().
 */
function isValidFileEditor(editor) {
	if (!editor) return false;
	const scheme = editor.document.uri.scheme;
	return scheme === 'file' || scheme === 'untitled';
}

function createMockEditor(scheme, fsPath) {
	return {
		document: {
			uri: {
				scheme,
				fsPath
			}
		}
	};
}

describe('updateActiveFile - URI Scheme Filtering', () => {
	it('should reject output channel scheme editors', () => {
		const editor = createMockEditor('output', 'extension-output-darthmolen.copilot-cli-extension-#1-Copilot CLI');
		expect(isValidFileEditor(editor)).to.be.false;
	});

	it('should reject debug console scheme editors', () => {
		const editor = createMockEditor('debug', '/debug-console');
		expect(isValidFileEditor(editor)).to.be.false;
	});

	it('should reject vscode-settings scheme editors', () => {
		const editor = createMockEditor('vscode-settings', '/settings.json');
		expect(isValidFileEditor(editor)).to.be.false;
	});

	it('should accept file scheme editors', () => {
		const editor = createMockEditor('file', '/home/user/project/src/app.ts');
		expect(isValidFileEditor(editor)).to.be.true;
	});

	it('should accept untitled scheme editors', () => {
		const editor = createMockEditor('untitled', 'Untitled-1');
		expect(isValidFileEditor(editor)).to.be.true;
	});

	it('should return false for undefined editor', () => {
		expect(isValidFileEditor(undefined)).to.be.false;
	});

	it('should return false for null editor', () => {
		expect(isValidFileEditor(null)).to.be.false;
	});
});
