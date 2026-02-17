# Mermaid Diagram Rendering in Chat

## Summary

Render mermaid code blocks in assistant messages as visual diagrams instead of showing raw mermaid syntax.

## Context

The Copilot CLI model (GPT-5) returns mermaid diagram syntax as inline text in assistant messages (confirmed via spike `svg-mermaid-output`, 2026-02-16). Currently these render as plain code blocks. The webview already renders SVG code blocks and inline SVG as visual images (v3.1.0). Mermaid rendering extends this to the mermaid format.

## Spike Findings

From `tests/logs/harness/spike-report-1771256924934.json`:
- Prompt: "Create a mermaid diagram showing data flow"
- Model returned mermaid code inline: `flowchart LR UI[User Input] --> IA[InputArea] --> ...`
- No tool execution for mermaid — it's just text in the assistant message
- Mermaid blocks appear as `` ```mermaid ... ``` `` in markdown

## Technical Approach

### Lazy-load mermaid.js from CDN

The webview CSP already allows `https://cdn.jsdelivr.net` for scripts. Mermaid is available as ESM:

```javascript
const mermaid = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
mermaid.default.initialize({ startOnLoad: false, theme: 'dark' });
await mermaid.default.run({ nodes: [element] });
```

### Implementation in MessageDisplay.js

Add `_renderMermaidBlocks(messageDiv)` as a sibling to `_renderSvgBlocks()`:

1. Find `<code class="language-mermaid">` elements (from `` ```mermaid `` code blocks)
2. Extract mermaid source from `codeEl.textContent`
3. Replace the `<pre>` parent with a `.mermaid-render` container
4. Lazy-load mermaid.js (first time only, cache the module)
5. Call `mermaid.run()` on the container

### Considerations

- **Library size**: mermaid.js is ~1MB gzipped. First load takes ~1s on good connection.
- **Offline**: CDN approach fails offline. Could bundle as fallback.
- **Theme**: Should match VS Code theme (dark/light). Use `mermaid.initialize({ theme })` based on `document.body.classList`.
- **Error handling**: Invalid mermaid syntax should show the raw code block as fallback.
- **Testing**: mermaid.js won't work in JSDOM (needs real DOM rendering). Tests should verify detection logic, not rendering output.

### CSS

```css
.mermaid-render {
    margin: 8px 0;
    max-width: 100%;
    overflow: hidden;
    border-radius: 4px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    padding: 8px;
    text-align: center;
}
```

## Files to Modify

- `src/webview/app/components/MessageDisplay/MessageDisplay.js` — add `_renderMermaidBlocks()`
- `src/webview/styles.css` — add `.mermaid-render` styles
- `tests/unit/components/message-display-mermaid-rendering.test.js` — detection tests

## Depends On

- v3.1.0 SVG rendering foundation (completed)

## References

- Spike report: `tests/logs/harness/spike-report-1771256924934.json`
- Spike prompt: `tests/prompts/vision-tests/svg-mermaid-output.md`
- Mermaid ESM: `https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs`
