import * as path from 'path';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
// Bare image paths: optional leading /, then path segments, ending with image extension.
// All context exclusions (URLs, markdown syntax) handled in the replacement function.
const BARE_IMAGE_PATH_RE = /(?:\/[\w.\/-]+|[\w][\w.\/-]+)\.(?:png|jpg|jpeg|gif|svg|webp)\b/gi;

interface ResolvedImage {
	uri: string;
	absolutePath: string;
}

/**
 * Try resolving a relative path against multiple directories, returning the first hit.
 */
function tryResolve(
	srcPath: string,
	dirs: string[],
	resolveUri: (absolutePath: string) => string | null
): ResolvedImage | null {
	// If absolute, try directly
	if (path.isAbsolute(srcPath)) {
		const uri = resolveUri(srcPath);
		if (uri) { return { uri, absolutePath: srcPath }; }
		return null;
	}
	for (const dir of dirs) {
		const absolutePath = path.join(dir, srcPath);
		const uri = resolveUri(absolutePath);
		if (uri) {
			return { uri, absolutePath };
		}
	}
	return null;
}

/**
 * Resolve image paths in markdown content to webview URIs.
 *
 * Handles three cases:
 * 1. Markdown image syntax: `![alt](relative-path)`
 * 2. Bare image paths in plain text: `images/chart.svg`
 * 3. Absolute image paths in plain text: `/home/user/chart.png`
 *
 * Resolves relative paths against sessionDir first, then additionalDirs.
 */
export function resolveImagePaths(
	content: string,
	sessionDir: string,
	resolveUri: (absolutePath: string) => string | null,
	additionalDirs: string[] = []
): string {
	const dirs = [sessionDir, ...additionalDirs];

	// Pass 1: Resolve markdown image syntax ![alt](path)
	let result = content.replace(MARKDOWN_IMAGE_RE, (match, alt, srcPath) => {
		if (srcPath.startsWith('http://') || srcPath.startsWith('https://') || srcPath.startsWith('data:')) {
			return match;
		}

		const ext = path.extname(srcPath).toLowerCase().slice(1);
		if (!IMAGE_EXTENSIONS.has(ext)) {
			return match;
		}

		const resolved = tryResolve(srcPath, dirs, resolveUri);
		if (resolved) {
			return `![${alt}](${resolved.uri})`;
		}

		return match;
	});

	// Pass 2: Detect bare image paths not already inside markdown image syntax
	result = result.replace(BARE_IMAGE_PATH_RE, (match, offset) => {
		// Extract the non-whitespace token containing this match
		const before = result.substring(Math.max(0, offset - 200), offset);
		const after = result.substring(offset + match.length, Math.min(result.length, offset + match.length + 50));
		const tokenBefore = (before.match(/\S+$/) || [''])[0];
		const tokenAfter = (after.match(/^\S+/) || [''])[0];
		const fullToken = tokenBefore + match + tokenAfter;

		// Skip if the surrounding token is a URL
		if (/^https?:\/\//i.test(fullToken)) {
			return match;
		}
		// Skip if already inside markdown image syntax: ![...](HERE)
		if (tokenBefore.includes('](') || tokenBefore.includes('![') || before.endsWith('(')) {
			return match;
		}
		// Skip if it looks like a resolved webview URI
		if (fullToken.includes('vscode-webview://')) {
			return match;
		}

		const ext = path.extname(match).toLowerCase().slice(1);
		if (!IMAGE_EXTENSIONS.has(ext)) {
			return match;
		}

		const resolved = tryResolve(match, dirs, resolveUri);
		if (resolved) {
			const filename = path.basename(match, path.extname(match));
			return `<a class="image-file-link" data-filepath="${resolved.absolutePath}">${match}</a>\n\n![${filename}](${resolved.uri})\n\n`;
		}

		// File not found — annotate so the user knows
		return `${match} *file not found*`;
	});

	return result;
}
