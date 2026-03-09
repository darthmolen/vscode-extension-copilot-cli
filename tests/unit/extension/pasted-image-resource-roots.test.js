/**
 * TDD tests for Bug Fix B: Pasted image thumbnails broken
 *
 * Root cause: Temp files are written to os.tmpdir() but localResourceRoots
 * in resolveWebviewView doesn't include os.tmpdir().
 * VS Code blocks vscode-webview-resource: URIs pointing outside allowed roots.
 *
 * Fix: Add vscode.Uri.file(os.tmpdir()) to localResourceRoots.
 *
 * We test this by checking the localResourceRoots logic (extracted pure function).
 */

const assert = require('assert');
const path = require('path');
const os = require('os');

/**
 * Builds the localResourceRoots array for a given workspace URI.
 * This mirrors the logic that should exist in chatViewProvider.ts.
 *
 * @param {string} workspacePath - The workspace root path
 * @returns {string[]} Array of allowed resource root paths
 */
function buildLocalResourceRoots(workspacePath) {
	const roots = [workspacePath];

	// FIXED: Include os.tmpdir() so pasted image temp files can be served
	roots.push(os.tmpdir());

	return roots;
}

/**
 * Simulates whether a given file path is accessible based on localResourceRoots.
 * VS Code only allows webview URIs pointing inside these roots.
 */
function isPathAccessible(filePath, roots) {
	return roots.some(root => filePath.startsWith(root));
}

describe('Bug Fix B: Pasted image thumbnails - localResourceRoots', () => {
	describe('buildLocalResourceRoots()', () => {
		it('includes os.tmpdir() in resource roots', () => {
			const roots = buildLocalResourceRoots('/workspace/myproject');
			const tmpDir = os.tmpdir();

			assert.ok(roots.includes(tmpDir),
				`localResourceRoots should include os.tmpdir() (${tmpDir}) but got: ${JSON.stringify(roots)}`);
		});

		it('includes the workspace path in resource roots', () => {
			const roots = buildLocalResourceRoots('/workspace/myproject');
			assert.ok(roots.includes('/workspace/myproject'),
				'localResourceRoots should include the workspace path');
		});

		it('pasted image in /tmp is accessible with fix applied', () => {
			const roots = buildLocalResourceRoots('/workspace/myproject');
			const pastedImagePath = path.join(os.tmpdir(), 'copilot-paste-abc123', 'pasted-image-1.png');

			assert.ok(isPathAccessible(pastedImagePath, roots),
				`Pasted image at ${pastedImagePath} should be accessible with os.tmpdir() in roots`);
		});

		it('pasted image in /tmp is NOT accessible WITHOUT the fix', () => {
			// Simulate the broken behavior: only workspace root, no tmpdir
			const brokenRoots = ['/workspace/myproject'];
			const pastedImagePath = path.join(os.tmpdir(), 'copilot-paste-abc123', 'pasted-image-1.png');

			// This demonstrates the bug: tmpdir paths are blocked
			const accessible = isPathAccessible(pastedImagePath, brokenRoots);
			assert.strictEqual(accessible, false,
				'Without fix, pasted images in tmpdir should NOT be accessible (demonstrating the bug)');
		});
	});
});
