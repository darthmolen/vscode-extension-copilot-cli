# Backlog: esbuild Watch Mode Doesn't Re-Copy Webview Assets

**Source**: Copilot PR review on PR #14
**Priority**: Low (DX improvement)
**Status**: Backlog

## Problem

In `esbuild.js`, webview assets (`src/webview/**`) are copied to `dist/webview/` only once at startup of `main()`. When running in `--watch` mode, `extensionCtx.watch()` rebuilds TypeScript changes, but there is no watcher for the copied webview files.

This means editing `src/webview/**` (JS, CSS, HTML) won't update `dist/webview/**` unless the build script is manually re-run.

## Impact

- Developer must restart `node esbuild.js --watch` after changing webview files
- Only affects development workflow, not production builds
- Workaround: Run `node esbuild.js` manually after webview changes

## Proposed Solutions

**Option A**: Add an esbuild plugin that copies assets on each rebuild cycle.

**Option B**: Add a lightweight file watcher (e.g., chokidar or `fs.watch`) in watch mode to re-copy webview files on changes.

**Option C**: Use esbuild's `onEnd` plugin hook to re-run the copy logic after each rebuild.

## Notes

- The current copy-on-startup approach works fine for production builds (`./test-extension.sh`)
- This is a quality-of-life improvement for active webview development
