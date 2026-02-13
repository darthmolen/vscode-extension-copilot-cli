# In-Chat Stream File Diff (Phase 6: Inline Diff Display)

## Decision Locality

The core design principle behind inline diffs is **decision locality** — keeping the connection between the agent and the developer intact within the chat stream.

When a coding agent edits a file, the developer needs to understand what changed. The traditional approach forces a context switch: leave the conversation, open a diff view, evaluate the change, come back, and resume the dialogue. Every context switch is a small rupture in the collaborative flow between human and agent.

Inline diffs eliminate this rupture for the common case. When the agent modifies a file, a compact diff appears directly in the tool execution card, right in the stream of conversation. The developer sees what changed without leaving the place where they make decisions — accept, reject, ask for revisions, or continue the conversation.

Even when the developer does open the full diff view (via the "View Diff" button), that breakout page is purely informational. There are no decisions to make there. The developer reads, then returns to the stream where all decisions live. The agent stream is the single locus of control.

This is what decision locality means: the developer never has to leave the conversation to decide what happens next.

---

## Technical Pipeline

The inline diff flows through four layers: extension-side computation, RPC transport, and webview rendering.

### 1. Extension Side (Node.js)

**InlineDiffService.ts** (`src/extension/services/InlineDiffService.ts`, 162 lines) is a pure TypeScript module with no external dependencies. It implements a classic DP-based LCS (Longest Common Subsequence) algorithm.

Public API:

| Function | Description |
|---|---|
| `splitLines(content)` | Splits content into lines, handles trailing newlines |
| `lcs(a, b)` | Builds a DP table, backtracks to produce matching index pairs |
| `computeInlineDiff(beforeContent, afterContent, maxLines=10)` | Returns `{ lines: DiffLine[], truncated: boolean, totalLines: number }` |

The `DiffLine` type:

```typescript
{ type: 'add' | 'remove' | 'context', text: string }
```

The algorithm pipeline within `computeInlineDiff`:

1. **splitLines** — normalize both inputs into line arrays
2. **LCS** — compute the longest common subsequence between the two line arrays
3. **Raw diff** — walk the LCS result to produce add/remove/context lines
4. **Context filtering** — retain only 1 line of context around changes
5. **Truncation** — cap output at `maxLines` (default 10), set `truncated` flag if exceeded

**extension.ts** hooks into the `onDidProduceDiff` handler. When the SDK produces a diff (via the file edit tool), the handler reads the before and after file contents from disk, calls `computeInlineDiff()`, and attaches the result to the RPC message alongside the existing diff metadata.

### 2. RPC Layer

Three files carry the inline diff data from extension to webview:

- **messages.ts** (`src/shared/messages.ts`): The `DiffAvailablePayload` type is extended with three optional fields:
  - `diffLines?: Array<{type: 'add' | 'remove' | 'context', text: string}>`
  - `diffTruncated?: boolean`
  - `diffTotalLines?: number`

- **ExtensionRpcRouter.ts**: The `sendDiffAvailable()` method forwards the new fields transparently.

- **main.js**: The `handleDiffAvailableMessage()` function forwards `diffLines`, `diffTruncated`, and `diffTotalLines` to the `tool:complete` event via the EventBus.

### 3. Webview Rendering

**ToolExecution.js** (`src/webview/app/components/ToolExecution/ToolExecution.js`): The `buildToolHtml()` function renders an `.inline-diff` block when `toolState.diffLines` is present.

Structure of the rendered HTML:

```html
<div class="inline-diff">
  <div class="diff-line diff-context">  unchanged line</div>
  <div class="diff-line diff-remove">- old line</div>
  <div class="diff-line diff-add">+ new line</div>
  <div class="diff-line diff-context">  unchanged line</div>
  <div class="diff-truncated">... 42 more lines</div>
</div>
```

- Each line gets a `<div>` with class `diff-line` and a type-specific class (`diff-add`, `diff-remove`, `diff-context`)
- Line prefixes: `+ ` for additions, `- ` for removals, `  ` (two spaces) for context
- If the diff was truncated, a final `<div class="diff-truncated">... N more lines</div>` is appended
- All line text is passed through `escapeHtml()` to prevent XSS

**styles.css** uses VS Code theme variables for native look and feel:

| Class | Color Variable | Purpose |
|---|---|---|
| `.diff-add` | `--vscode-gitDecoration-addedResourceForeground` | Green, added lines |
| `.diff-remove` | `--vscode-gitDecoration-deletedResourceForeground` | Red, removed lines |
| `.diff-context` | `--vscode-descriptionForeground` | Muted, unchanged context lines |
| `.inline-diff` | `--vscode-editor-background`, `--vscode-panel-border` | Container with editor font, 11px, monospace |

---

## The Two Diff Views

Two diff views coexist. They serve different purposes and reinforce decision locality.

### Inline Diff (In-Stream)

- Appears directly in the tool execution card within the chat stream
- Shows up to 10 lines of changed lines with `+`/`-` prefixes
- Includes 1 line of surrounding context
- Truncation message when the diff exceeds 10 lines
- This is where the developer stays — in the conversation with the agent

### Full Diff (Breakout)

- Triggered by the "View Diff" button on the tool execution card
- Opens VS Code's native diff editor showing the complete file
- Informational only — the developer reads the full change, then returns to the stream
- No decisions are made here; all decisions happen back in the agent stream

The inline diff gives a quick glance. The button gives the full picture. Both are always available.

---

## Design Decisions

**Extension-side computation.** The diff is computed in Node.js on the extension host, not in the webview. This keeps the webview thin — it receives pre-computed diff lines and renders them. No diff algorithms ship to the browser.

**No expand/collapse.** The inline diff shows up to 10 lines. If the diff is larger, the developer clicks "View Diff" for the complete picture. There is no accordion, no "show more" button, no progressive disclosure within the stream. Simple over clever.

**First 10 lines + truncation message.** The `... N more lines` indicator tells the developer there is more to see without overwhelming the conversation stream. The number gives a sense of scale — "3 more lines" is different from "200 more lines" and may influence whether the developer opens the full diff.

**LCS without external dependencies.** The algorithm is O(n*m) where n and m are the line counts of the two files. This is acceptable for individual file edits, which are typically small (tens to low hundreds of lines changed). There is no need for a `diff` or `jsdiff` dependency. The implementation is 162 lines of self-contained TypeScript.

**1-line context window.** Only 1 line of unchanged context is kept around each change block. This is enough to orient the developer ("ah, this is near the import statements") without consuming the limited 10-line budget on unchanged code.

---

## Test Coverage

- **15 unit tests** for `computeInlineDiff()` in `tests/unit/extension/inline-diff.test.js` — covering empty inputs, additions, deletions, modifications, context filtering, truncation behavior, and edge cases around trailing newlines.
- **10 rendering tests** for ToolExecution inline diff rendering in `tests/unit/components/tool-execution-inline-diff.test.js` — covering HTML structure, CSS classes, prefix characters, truncation messages, XSS escaping, and the absence of diff blocks when no diff data is present.
