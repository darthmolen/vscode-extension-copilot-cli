# Backlog: Live Tool Output (stream-tool-output-on-request)

## Problem

When the agent runs a long bash command (tests, builds, installs), the tool card shows a static "running…" 
spinner with no visibility into what's actually happening. Users have no way to see stdout/stderr until 
the tool completes and `tool.execution_complete` fires.

The SDK already emits `tool.execution_partial_result` events with cumulative stdout during execution. 
We currently discard these (just log the char count). 

## Proposed UX

**Terminal icon on each running tool card** — clicking it opens an inline expandable output drawer below 
the tool card showing the live raw output as it streams in.

```
┌─────────────────────────────────────────────┐
│ ⚙ bash  [running…]  [≡ output]  ░░░░░░░░░  │  ← ≡ icon = toggle drawer
├─────────────────────────────────────────────┤
│ $ npm test                                  │  ← drawer (hidden by default)
│                                             │
│   > copilot-cli-extension@3.5.0 test        │
│   Running 1265 tests…                       │
│   ░ 847 passing                             │
│   …                                         │
└─────────────────────────────────────────────┘
```

**Behaviour:**
- Icon only appears when `tool.execution_partial_result` has fired at least once for this tool
- Drawer hidden by default (opt-in, not forced on user)
- Clicking icon toggles drawer open/closed
- Drawer auto-scrolls to bottom as new output arrives
- Output is raw text in a `<pre>` block (monospace, no markdown processing)
- When tool completes: drawer persists, icon stays visible, scroll position preserved
- Icon disappears if tool produced no partial output (silent tools)

## Key Technical Insight: `partialOutput` Is Cumulative

From the log (`tests/logs/server/3-5-0-tool-execution-partial-results.log`):
each `tool.execution_partial_result` event contains the **full output so far**, not just a new chunk.

This means rendering is trivial — just `preEl.textContent = event.data.partialOutput` on each event.
No appending, no buffering, no diffing needed.

## Implementation Plan

### Backend (`sdkSessionManager.ts`)
- Add `partialOutput?: string` to `ToolState` interface
- In the `tool.execution_partial_result` case: look up `toolExecutions.get(toolCallId)`, 
  set `state.partialOutput = data.partialOutput`, fire `_onDidUpdateTool`
- `tool.execution_complete`: preserve `state.partialOutput` (don't clear it)

### Types (`shared/messages.ts`)
- Add `partialOutput?: string` to `ToolState` type
- No new message types needed — `_onDidUpdateTool` already sends `ToolState` to webview

### Webview (`ToolExecution.js`)
- In `_renderToolCard()`: add a toggle icon button (e.g. `⬛` or `>_`) after the tool status
  - Button only rendered if `toolState.partialOutput` is non-empty
  - Button click toggles a `.tool-output-drawer` div
- Drawer: `<pre class="tool-output-drawer">` with `display:none` by default
- On `tool:update` event: if drawer exists and is open, update `pre.textContent = state.partialOutput`
- Preserve open/closed state across updates (don't reset on each `tool:update`)

### CSS (`styles.css`)
```css
.tool-output-toggle {
    cursor: pointer;
    opacity: 0.6;
    font-size: 11px;
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid var(--vscode-widget-border);
    background: transparent;
    color: var(--vscode-foreground);
}
.tool-output-toggle:hover { opacity: 1; }

.tool-output-drawer {
    display: none;
    margin-top: 6px;
    padding: 8px;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--vscode-terminal-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-widget-border);
    border-radius: 4px;
    max-height: 300px;
    overflow-y: auto;
    color: var(--vscode-terminal-foreground, var(--vscode-foreground));
}
.tool-output-drawer.open { display: block; }
```

## Considerations

**Auto-open option?** Possibly a setting `copilotCLI.autoShowToolOutput: boolean` that auto-opens the 
drawer when output starts streaming. Defaults to `false` (opt-in).

**Icon choice:** `⬛` is too generic. Better options:
- `>_` (terminal symbol) rendered as text
- A VS Code codicon: `$(terminal)` or `$(output)` 
- Just "output" text label with the toggle styling above

**Memory:** `partialOutput` can be large for long-running tests. After `tool.execution_complete`,
consider whether to keep the full output or truncate to last N chars. Keeping it is fine for 
a normal session (one response worth of tool calls), but could be an issue for very long sessions.
A reasonable cap: keep last 50,000 chars (about 1500 lines of typical terminal output).

**Not a separate VS Code panel:** Keeping output inline in the tool card avoids tab/focus management 
complexity. The drawer approach is simpler and more discoverable. A separate panel would require 
maintaining panel lifecycle, handling panel disposal, and dealing with focus stealing.

## What's Already Done

- `tool.execution_partial_result` case added to the SDK event switch (logs char count, no-ops cleanly)
- `ToolState` types, `_onDidUpdateTool` event, and tool card rendering already exist
- The infrastructure is ready; this is purely additive

## Scope Estimate

Small-medium: 2-3 hours implementation, mostly in `ToolExecution.js` and CSS.
No new RPC message types, no new backend events, no architecture changes.
