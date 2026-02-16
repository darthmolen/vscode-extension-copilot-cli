# In-Chat Stream File Diff (Phase 6: Inline Diff Display)

## Decision Locality

The core design principle behind inline diffs is **decision locality** — keeping the connection between the agent and the developer intact within the chat stream.

When a coding agent edits a file, the developer needs to understand what changed. The traditional approach forces a context switch: leave the conversation, open a diff view, evaluate the change, come back, and resume the dialogue. Every context switch is a small rupture in the collaborative flow between human and agent.

Inline diffs eliminate this rupture for the common case. When the agent modifies a file, a compact diff appears directly in the tool execution card, right in the stream of conversation. The developer sees what changed without leaving the place where they make decisions — accept, reject, ask for revisions, or continue the conversation.

Even when the developer does open the full diff view (via the "View Diff" button), that breakout page is purely informational. There are no decisions to make there. The developer reads, then returns to the stream where all decisions live. The agent stream is the single locus of control.

This is what decision locality means: the developer never has to leave the conversation to decide what happens next.

---

## File Snapshot Capture: The Race Condition and the Fix

The diff pipeline needs a "before" snapshot of every file the agent modifies. Without it, there's nothing to diff against.

### v3.0.0: The Race Condition

In v3.0.0, the snapshot was captured inside `handleToolStart()`, which fires when the SDK emits `tool.execution_start`. The problem: this event fires **after the SDK has already modified the file**. For fast local operations like `edit` and `create`, the file on disk already contains the new content by the time our handler runs.

```text
Time ──────────────────────────────────────────────────────►

SDK receives tool call from model
  │
  ├─ SDK executes tool (writes to disk)     ◄── file modified HERE
  │
  └─ SDK emits tool.execution_start         ◄── we hear about it HERE
       │
       └─ handleToolStart() runs
            │
            └─ captureFileSnapshot()         ◄── too late, file already changed
```

Result: the "before" snapshot captures the *modified* file. The diff shows zero changes or diffs the modified content against itself.

### v3.0.1: Three-Tier Snapshot Capture Pipeline

SDK v0.1.20 introduced **hooks** — interceptors that fire *before* tool execution. The original plan was to use the `onPreToolUse` hook as the sole pre-execution capture point. During implementation, we discovered a **race condition within the SDK itself**: the `tool.execution_start` notification (fire-and-forget) consistently arrives before the `hooks.invoke` request (requires round-trip) on the same JSON-RPC connection. This is the "see-saw" — the event and the hook race each other, and the event wins.

Rather than rely on any single capture point, we built a three-tier pipeline where each tier catches what the previous one might miss:

```text
Time ──────────────────────────────────────────────────────►

Model returns tool call in API response
  │
  ├─ assistant.message event fires           ◄── Tier 1: PRIMARY capture
  │    │   (contains toolRequests[] with         (most reliable — arrives
  │    │    tool name, args, and file path)        before any execution)
  │    └─ captureByPath(toolName, filePath)
  │
  ├─ onPreToolUse hook fires                 ◄── Tier 2: SAFETY NET
  │    │   (skips if pending snapshot             (hooks.invoke round-trip
  │    │    already exists for this path)          may lose the race)
  │    └─ captureByPath() — only if needed
  │
  ├─ SDK executes tool (writes to disk)      ◄── file modified
  │
  └─ tool.execution_start event fires        ◄── Tier 3: FALLBACK + correlate
       │                                          (last resort if neither
       └─ handleToolStart() runs                   Tier 1 nor 2 fired)
            ├─ correlateToToolCallId()
            └─ captureByPath() — only if
               no snapshot exists yet
```

**Tier 1 — `assistant.message` (Primary):** The `assistant.message` event carries `toolRequests[]` — a list of tools the model is about to call, including their arguments. This arrives **before** any tool execution begins, giving us a reliable window to copy the original file. This is the primary capture path.

**Tier 2 — `onPreToolUse` hook (Safety Net):** The hook fires before tool execution by design. However, due to the "see-saw" race (hooks.invoke request vs. notification delivery order on the JSON-RPC connection), it sometimes arrives after `tool.execution_start`. The hook checks `getPendingByPath()` and skips capture if Tier 1 already handled it, avoiding duplicate work.

**Tier 3 — `handleToolStart` fallback (Last Resort):** If neither Tier 1 nor Tier 2 captured a snapshot (e.g., the `assistant.message` format changes, or the session was resumed without hooks), `handleToolStart()` attempts a fallback capture. This has a race condition (the file may already be modified), but a partial diff is better than no diff at all. A warning is logged when this path fires.

After capture, `correlateToToolCallId()` re-keys the snapshot from file path to `toolCallId`. Everything downstream is unaware of which tier captured the snapshot.

### Deduplication

All three tiers avoid duplicate work:

| Tier | Deduplication check |
|------|-------------------|
| Tier 1 (`assistant.message`) | `captureByPath()` cleans up any previous pending snapshot for the same path |
| Tier 2 (`onPreToolUse` hook) | Skips if `getPendingByPath(filePath)` returns non-null |
| Tier 3 (`handleToolStart` fallback) | Skips if `getSnapshot(toolCallId)` returns non-null after correlation |

### Hook Registration

Every session creation and resume call passes hooks via `getSessionHooks()` in `sdkSessionManager.ts`:

```typescript
private getSessionHooks() {
    return {
        onPreToolUse: (input: any, _invocation: any) => {
            if (input.toolName === 'edit' || input.toolName === 'create') {
                const filePath = (input.toolArgs as any)?.path;
                if (filePath && !this.fileSnapshotService.getPendingByPath(filePath)) {
                    this.fileSnapshotService.captureByPath(input.toolName, filePath);
                }
            }
            return { permissionDecision: 'allow' };
        }
    };
}
```

This is registered at all session creation/resume points (new session, resume, plan mode entry, plan mode exit, etc.) to ensure coverage regardless of how a session starts.

### Snapshot Service Methods

`fileSnapshotService.ts` exposes four methods for the capture-and-correlate flow:

| Method | Purpose |
| ------ | ------- |
| `captureByPath(toolName, filePath)` | Copy file to temp dir, store in `pendingByPath` map keyed by file path |
| `getPendingByPath(filePath)` | Check if a pending snapshot exists (used for deduplication) |
| `correlateToToolCallId(filePath, toolCallId)` | Re-key from file path to toolCallId for downstream consumers |
| `getSnapshot(toolCallId)` | Retrieve snapshot for diff computation |

Implementation details:

- **Cleanup before create.** If a pending snapshot already exists for the same path (e.g., the model edits the same file twice quickly), the old temp file is deleted before the new one is created.
- **Unique ID = timestamp + counter.** `Date.now()` alone causes collisions when two captures happen in the same millisecond. A monotonic `nextId` counter guarantees unique temp filenames.
- **New file handling.** For `create` tool calls, an empty temp file represents "no previous content." The diff shows all lines as additions.
- **Orphan cleanup.** If a capture fires but `tool.execution_start` never comes (SDK error, tool denied), the orphaned snapshot is cleaned up when `cleanupAllSnapshots()` runs at session end.

### The "See-Saw" Race Condition

The race was discovered through diagnostic logging. In the SDK's JSON-RPC connection:

1. `tool.execution_start` is a **notification** (fire-and-forget) — the server sends it and moves on
2. `hooks.invoke` is a **request** (needs round-trip) — the server sends it and waits for the client's response

On the same connection, the notification consistently arrives first. The hook fires *after* `handleToolStart()` has already processed the tool. This is why two-phase correlation alone was insufficient — the hook provided the timing guarantee (fires before execution) but lost the delivery race on the transport layer.

The `assistant.message` event avoids this entirely because it fires at a completely different stage — when the model returns its response, before any tool execution begins.

### SDK Limitation

The `toolCallId` exists at hook invocation time — it's parsed from the model's API response before the hook runs — but the SDK intentionally omits it from hook inputs because hooks are designed for permission decisions, not execution tracking. We filed [github/copilot-sdk#477](https://github.com/github/copilot-sdk/issues/477) requesting this field. If accepted, the three-tier pipeline simplifies to a single capture in the hook.

See: [COPILOT-SDK-HOOKS.md](COPILOT-SDK-HOOKS.md) for the full hooks reference.

---

## Technical Pipeline

The inline diff flows through four layers: snapshot capture, extension-side computation, RPC transport, and webview rendering.

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
- **9 snapshot tests** for the capture-and-correlate pipeline in `tests/unit/extension/file-snapshot-hooks.test.js` — covering `captureByPath` (existing file copy, new file empty marker, non-edit rejection, overwrite cleanup), `correlateToToolCallId` (pending-to-final promotion, map cleanup, missing path no-op), and end-to-end flows (full capture-correlate cycle, race condition proof).
