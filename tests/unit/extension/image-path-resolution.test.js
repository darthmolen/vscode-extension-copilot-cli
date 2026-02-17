const assert = require('assert');
const path = require('path');

// Will be implemented in src/extension/utils/resolveImagePaths.ts
// Compiled output at out/extension/utils/resolveImagePaths.js
let resolveImagePaths;

describe('Image Path Resolution', function () {
	const sessionDir = '/home/user/.copilot/session-state/abc-123';

	before(function () {
		try {
			const mod = require('../../../out/extension/utils/resolveImagePaths');
			resolveImagePaths = mod.resolveImagePaths;
		} catch {
			this.skip();
		}
	});

	it('should resolve relative image paths in markdown', function () {
		const content = '![chart](images/bar-chart.png)';
		const resolveUri = (absPath) => {
			if (absPath === path.join(sessionDir, 'images/bar-chart.png')) {
				return 'vscode-webview://abc/images/bar-chart.png';
			}
			return null;
		};

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.strictEqual(result, '![chart](vscode-webview://abc/images/bar-chart.png)');
	});

	it('should leave absolute URLs unchanged', function () {
		const content = '![logo](https://example.com/logo.png)';
		const resolveUri = () => null;

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.strictEqual(result, content);
	});

	it('should leave http URLs unchanged', function () {
		const content = '![logo](http://example.com/logo.png)';
		const resolveUri = () => null;

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.strictEqual(result, content);
	});

	it('should leave data URIs unchanged', function () {
		const content = '![img](data:image/png;base64,abc123)';
		const resolveUri = () => null;

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.strictEqual(result, content);
	});

	it('should handle multiple images in one message', function () {
		const content = 'First: ![a](img1.png)\n\nSecond: ![b](img2.svg)';
		const resolveUri = (absPath) => {
			if (absPath === path.join(sessionDir, 'img1.png')) {
				return 'vscode-webview://abc/img1.png';
			}
			if (absPath === path.join(sessionDir, 'img2.svg')) {
				return 'vscode-webview://abc/img2.svg';
			}
			return null;
		};

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.ok(result.includes('vscode-webview://abc/img1.png'), 'should resolve first image');
		assert.ok(result.includes('vscode-webview://abc/img2.svg'), 'should resolve second image');
	});

	it('should not resolve paths for missing files', function () {
		const content = '![missing](nonexistent.png)';
		const resolveUri = () => null; // file doesn't exist

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.strictEqual(result, content, 'should leave path unchanged when file missing');
	});

	it('should support png, jpg, jpeg, gif, svg, webp extensions', function () {
		const extensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
		for (const ext of extensions) {
			const content = `![img](test.${ext})`;
			const resolveUri = (absPath) => {
				if (absPath === path.join(sessionDir, `test.${ext}`)) {
					return `vscode-webview://resolved/test.${ext}`;
				}
				return null;
			};

			const result = resolveImagePaths(content, sessionDir, resolveUri);
			assert.strictEqual(
				result,
				`![img](vscode-webview://resolved/test.${ext})`,
				`should resolve .${ext} files`
			);
		}
	});

	it('should not resolve non-image file paths', function () {
		const content = '![doc](report.pdf)';
		const resolveUri = () => 'vscode-webview://abc/report.pdf';

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.strictEqual(result, content, 'should not resolve non-image extensions');
	});

	it('should preserve surrounding text', function () {
		const content = 'Here is the chart:\n\n![chart](output.png)\n\nAs you can see...';
		const resolveUri = (absPath) => {
			if (absPath === path.join(sessionDir, 'output.png')) {
				return 'vscode-webview://abc/output.png';
			}
			return null;
		};

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.ok(result.startsWith('Here is the chart:'), 'should keep text before');
		assert.ok(result.endsWith('As you can see...'), 'should keep text after');
		assert.ok(result.includes('vscode-webview://abc/output.png'), 'should resolve image');
	});

	it('should handle nested directory paths', function () {
		const content = '![img](files/images/diagram.png)';
		const resolveUri = (absPath) => {
			if (absPath === path.join(sessionDir, 'files/images/diagram.png')) {
				return 'vscode-webview://abc/files/images/diagram.png';
			}
			return null;
		};

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.strictEqual(result, '![img](vscode-webview://abc/files/images/diagram.png)');
	});

	it('should handle content with no images', function () {
		const content = 'Just plain text with `code` and **bold**.';
		const resolveUri = () => { throw new Error('should not be called'); };

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.strictEqual(result, content);
	});

	// --- Bare path detection ---

	it('should detect bare image paths in plain text and convert to markdown images', function () {
		const content = 'SVG saved at images/development_breakdown.svg with legend and colored slices.';
		const resolveUri = (absPath) => {
			if (absPath === path.join(sessionDir, 'images/development_breakdown.svg')) {
				return 'vscode-webview://abc/images/development_breakdown.svg';
			}
			return null;
		};

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.ok(result.includes('![development_breakdown](vscode-webview://abc/images/development_breakdown.svg)'),
			`expected markdown image in result, got: ${result}`);
	});

	it('should detect bare image paths with absolute paths', function () {
		const content = 'PNG saved at /home/user/project/images/chart.png';
		const resolveUri = (absPath) => {
			if (absPath === '/home/user/project/images/chart.png') {
				return 'vscode-webview://abc/chart.png';
			}
			return null;
		};

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.ok(result.includes('![chart](vscode-webview://abc/chart.png)'),
			`expected markdown image in result, got: ${result}`);
	});

	it('should not convert bare paths for non-image extensions', function () {
		const content = 'File saved at output/report.pdf';
		const resolveUri = () => 'vscode-webview://abc/report.pdf';

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.ok(!result.includes('!['), 'should not create markdown image for non-image extension');
		assert.strictEqual(result, content);
	});

	it('should not convert bare paths that are already inside markdown image syntax', function () {
		const content = '![chart](images/chart.png)';
		let callCount = 0;
		const resolveUri = (absPath) => {
			callCount++;
			if (absPath === path.join(sessionDir, 'images/chart.png')) {
				return 'vscode-webview://abc/chart.png';
			}
			return null;
		};

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		// Should only produce one image, not double-process
		const imageCount = (result.match(/!\[/g) || []).length;
		assert.strictEqual(imageCount, 1, `expected exactly 1 markdown image, got ${imageCount} in: ${result}`);
	});

	it('should not convert bare URLs that happen to end with image extensions', function () {
		const content = 'See https://example.com/logo.png for details';
		const resolveUri = () => { throw new Error('should not be called for URLs'); };

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.strictEqual(result, content);
	});

	it('should annotate bare paths with "file not found" when file does not exist', function () {
		const content = 'PNG saved at images/q1-sales.png with chart data.';
		const resolveUri = () => null; // file doesn't exist

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.ok(result.includes('*file not found*'),
			`expected "file not found" annotation, got: ${result}`);
		assert.ok(result.includes('images/q1-sales.png'),
			'should still show the file path');
	});

	it('should annotate absolute bare paths with "file not found" when file does not exist', function () {
		const content = 'Chart at /tmp/output/chart.png for review.';
		const resolveUri = () => null;

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.ok(result.includes('*file not found*'),
			`expected "file not found" annotation, got: ${result}`);
		assert.ok(result.includes('/tmp/output/chart.png'),
			'should preserve the original path');
	});

	it('should not annotate markdown image syntax when file does not exist', function () {
		const content = '![missing](nonexistent.png)';
		const resolveUri = () => null;

		const result = resolveImagePaths(content, sessionDir, resolveUri);
		assert.ok(!result.includes('*file not found*'),
			'markdown image syntax should not get bare path annotation');
	});

	// --- Workspace-relative resolution ---

	it('should resolve paths against workspace dir when session dir fails', function () {
		const workspaceDir = '/home/user/project';
		const content = '![chart](images/chart.png)';
		const resolveUri = (absPath) => {
			// Session dir: not found
			if (absPath === path.join(sessionDir, 'images/chart.png')) {
				return null;
			}
			// Workspace dir: found
			if (absPath === path.join(workspaceDir, 'images/chart.png')) {
				return 'vscode-webview://abc/chart.png';
			}
			return null;
		};

		const result = resolveImagePaths(content, sessionDir, resolveUri, [workspaceDir]);
		assert.strictEqual(result, '![chart](vscode-webview://abc/chart.png)');
	});

	it('should prefer session dir over workspace dir', function () {
		const workspaceDir = '/home/user/project';
		const content = '![chart](images/chart.png)';
		const resolveUri = (absPath) => {
			if (absPath === path.join(sessionDir, 'images/chart.png')) {
				return 'vscode-webview://session/chart.png';
			}
			if (absPath === path.join(workspaceDir, 'images/chart.png')) {
				return 'vscode-webview://workspace/chart.png';
			}
			return null;
		};

		const result = resolveImagePaths(content, sessionDir, resolveUri, [workspaceDir]);
		assert.strictEqual(result, '![chart](vscode-webview://session/chart.png)',
			'should use session dir when file exists there');
	});

	it('should resolve bare paths against workspace dir', function () {
		const workspaceDir = '/home/user/project';
		const content = 'SVG saved at images/chart.svg with colors.';
		const resolveUri = (absPath) => {
			if (absPath === path.join(workspaceDir, 'images/chart.svg')) {
				return 'vscode-webview://abc/chart.svg';
			}
			return null;
		};

		const result = resolveImagePaths(content, sessionDir, resolveUri, [workspaceDir]);
		assert.ok(result.includes('![chart](vscode-webview://abc/chart.svg)'),
			`expected resolved image, got: ${result}`);
	});
});
