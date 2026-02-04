# Phase 1: Extract HTML/CSS/JS to Separate Files

## Status
⏸️ Not Started

## Goal
Move embedded HTML template from `chatViewProvider.ts` to external files while maintaining exact functionality

## Context
Currently, `chatViewProvider.ts` contains ~1,670 lines of embedded HTML/CSS/JS (lines 217-1888). This makes the code difficult to maintain, lacks syntax highlighting, and prevents proper linting of the frontend code.

This phase extracts that content to proper `.html`, `.css`, and `.js` files without changing any logic or functionality.

## Tasks

### File Extraction
- [ ] Create `src/webview/` directory structure
- [ ] Extract HTML structure to `src/webview/index.html`
- [ ] Extract `<style>` block to `src/webview/styles.css`
- [ ] Extract `<script>` block to `src/webview/main.js`
- [ ] Update `getHtmlForWebview()` to load external files

### Build Configuration
- [ ] Configure webview build to bundle assets
- [ ] Set up proper CSP headers for external resources
- [ ] Handle nonce security for external scripts
- [ ] Configure file URI resolution in webview context

### Testing & Validation
- [ ] Webview opens and renders correctly
- [ ] Chat messages send/receive
- [ ] Markdown rendering works
- [ ] Code blocks with syntax highlighting work
- [ ] Plan mode toggle works
- [ ] Session switching works
- [ ] No console errors in webview DevTools
- [ ] Existing manual tests pass

## Technical Details

### File Structure
```
src/webview/
├── index.html       # HTML template
├── styles.css       # All CSS styling
└── main.js          # All JavaScript logic
```

### HTML Extraction Process
1. Copy HTML from `chatViewProvider.ts` lines ~217-1888
2. Clean up TypeScript string escaping
3. Replace `${nonce}` placeholders with proper template variables
4. Replace `${styleUri}`, `${scriptUri}` with proper URIs

### CSS Extraction Process
1. Extract everything between `<style>` and `</style>`
2. Clean up any TypeScript escaping
3. Save to `styles.css`
4. Verify all CSS selectors still work

### JavaScript Extraction Process
1. Extract everything between `<script>` and `</script>`
2. Clean up any TypeScript escaping
3. Save to `main.js`
4. Ensure vscode API acquisition still works
5. Verify message passing still functions

### Loading External Files
```typescript
getHtmlForWebview(webview: vscode.Webview): string {
  const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.html');
  const cssPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'styles.css');
  const jsPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'main.js');
  
  // Read files and construct HTML with proper CSP and nonces
}
```

### CSP Considerations
- Must allow loading local resources from `dist/webview/`
- Scripts must have nonce attribute
- Styles must have nonce attribute
- No inline scripts/styles without nonce

## Non-Goals
- ❌ Do NOT refactor JavaScript logic
- ❌ Do NOT add TypeScript to webview yet
- ❌ Do NOT change messaging contracts
- ❌ Do NOT add new features
- ❌ Do NOT change component structure

## Validation Checklist

### Visual & Functional
- [ ] Chat interface looks identical to before
- [ ] All colors and styling match original
- [ ] All interactive elements work (buttons, inputs, etc.)
- [ ] Messages render with proper formatting
- [ ] Markdown and code highlighting work
- [ ] Plan mode UI appears correctly

### Technical
- [ ] No CSP violations in console
- [ ] No 404 errors for resources
- [ ] No JavaScript errors
- [ ] File loading works in both dev and production builds
- [ ] Source maps work for debugging (if applicable)

### Edge Cases
- [ ] Webview works when extension is installed from .vsix
- [ ] Webview works in different VS Code themes
- [ ] Webview handles rapid session switches
- [ ] Webview recovers from errors gracefully

## Dependencies
- Requires Phase 0 (build infrastructure) to be complete

## Risks & Mitigations

**Risk**: CSP policy blocks external resources
**Mitigation**: Carefully configure CSP with proper URIs and nonces

**Risk**: File path resolution fails in packaged extension
**Mitigation**: Test with .vsix package, use vscode.Uri APIs

**Risk**: Nonce handling breaks security
**Mitigation**: Generate fresh nonce per webview load, apply consistently

**Risk**: Subtle HTML/JS escaping issues
**Mitigation**: Test thoroughly, use webview DevTools to debug

## Notes
- This is the biggest immediate win - removes 1,670 lines from TypeScript
- Keep changes minimal - exact copy/paste of existing code
- Focus on correctness, not perfection
- Phase 2 will add types and structure

## Success Criteria
✅ Zero embedded HTML in `chatViewProvider.ts`
✅ All functionality works exactly as before
✅ Webview code in proper `.html`, `.css`, `.js` files
✅ No visual or functional regressions
✅ Developer experience improved (syntax highlighting, linting)
