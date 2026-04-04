# Change Log

All notable changes to the Copilot CLI Chat extension.

## [3.7.1] - 2026-04-04

### 🐛 Bug Fixes

- **Fixed double streaming / duplicate message content** — Messages were being appended twice into the same chat bubble when using plan mode (or any session created via `createSession` rather than `resumeSession`). Root cause: `createSessionWithModelFallback` was registering `_handleSDKEvent` via the `onEvent` config parameter *and* via `session.on()` in `setupSessionEventHandlers` — two listeners on one session. Fix: remove the redundant `onEvent` injection; the `session.on()` path (managed by `MutableDisposable`) is the canonical subscription.

### 🔧 Internal

- **SDK upgrade: 0.1.32 → 0.2.1** — Upgrades the Copilot SDK to the latest stable release. The bundled Copilot CLI runtime advances from 0.0.4xx to **1.0.17**. No breaking changes affect this extension.
- **Structured tool results fixed** — SDK 0.2.1 fixes a serialization bug where `ToolResultObject` fields (`resultType`, `toolTelemetry`) were being stringified before RPC transmission, silently losing metadata. Plan mode tool results now transmit correctly.
- **Plan mode tools: `skipPermission: true`** — All plan mode tools (file reads, bash explore, glob, grep, plan file management) are marked as safe to skip per-use permission prompts. These tools were already auto-approved via `approveAll`; this is now explicit in the tool definition.
- **Removed stale workaround comment** — `resolveCliPath()` comment no longer references the CJS/esbuild compatibility issue (SDK issue #528). That bug was fixed in SDK v0.2.0 via PR #546 (contributed by this extension's author).

## [3.7.0] - 2026-03-27

### ✨ Features

- **Session Fork** — New `⑂ Fork` button in the input area creates an independent copy of the current session. The fork has the full conversation history but diverges from this point forward. Click fork, continue on a different line of thought, and switch back to the original at any time from the session dropdown.

### 🐛 Bug Fixes

- **Model dropdown invisible** — The model selector dropdown opens upward but was silently clipped by `#input-mount { overflow: hidden }`. Changed to `overflow: visible` so the dropdown renders correctly above the input area.

### 🔧 Internal

- **`SessionService.forkSession()`** — New method in `SessionService.ts`. Copies the source session directory to a new UUID via `fs.cpSync()`, patches the `session.start` event's `sessionId` field in the cloned `events.jsonl`, and calls `ensureSessionName()` so the fork gets a distinct label in the session list.
- **`forkSession` RPC message** — New `ForkSessionPayload` type in `messages.ts`, `forkSession()` on `WebviewRpcClient`, `onForkSession()` on `ExtensionRpcRouter`, and `onDidRequestForkSession` event on `ChatViewProvider`.
- **`copilot-cli-extension.forkSession` command** — Registered in `package.json` and wired in `extension.ts` via `handleForkSession()`.
- **19 new tests** across 4 test files: `fork-session-button.test.js`, `fork-session-rpc.test.js` (×2), `session-fork.test.js` — all written RED before implementation.



### 🐛 Bug Fixes

- **Expanded troubleshooting docs** — README now covers the three most common session startup failures: wrong Node version (Node 24+ required by SDK 0.1.32 / CLI 1.0.5), expired `gh auth` tokens after reboots, and CLI auto-update behavior. Includes WSL-specific guidance.
- **Node 24+ prerequisite** — Added to README prerequisites. The SDK 0.1.32 upgrade in v3.6.0 introduced this requirement but it wasn't documented.
- **Dual CLI version logging** — Diagnostics now log both `--no-auto-update` and regular CLI versions to distinguish the Go launcher version from the delegated runtime version.

## [3.6.0] - 2026-03-15

### ✨ Features

- **File-based custom agents** — Define agents as Markdown files with YAML frontmatter. Drop them in `~/.copilot/agents/` (global) or `<workspace>/.copilot/agents/` (project-scoped). Full CRUD UI via the 🤖 Agents panel in the toolbar. Three built-in agents ship out of the box, plus an example Researcher agent (`@researcher`) in `.copilot/agents/`:
  - **Planner** — Read-only exploration; writes `plan.md`. Never edits source files.
  - **Implementer** — Reads the plan and executes it faithfully. Full file-editing access.
  - **Reviewer** — Runs tests, reads changed files, produces a concise review summary. Read-only.
  - **Researcher** *(example)* — Project-scoped file-based agent demonstrating web search and read-only codebase exploration. Try: `@researcher how does the SDK handle model switching?`
- **`@agentName` message routing** — Prefix any message with `@agentName` to route it to a specific agent for that message. The mention takes priority over the sticky agent.
- **`/agent <name>` slash command** — Set a sticky agent for the whole session. A badge in the toolbar shows the active agent. Run `/agent` with no args to clear it and return to auto-inference.
- **Color-coded conversation flow** — Each message type now has a distinct left border color for instant visual scanning:
  - 🔵 **Blue** — User messages
  - 🟢 **Green** — Assistant responses
  - 🟣 **Purple** — Tool executions and agent actions
- **Slash panel reorganized** — New "Session" category groups `/model`, `/rename`, `/agent`, `/compact` above Plan Mode. Includes an `@agent` hint row showing single-shot syntax.
- **Agent toolbar polish** — 🤖 button sits next to "Copilot CLI" title; turns green when an agent is active. Delete button is a red ✕ pushed to the right side of each agent row.

### 🔧 Internal

- **`AgentFileService`** — New backend service (`src/extension/services/AgentFileService.ts`). Reads/writes agent `.md` files from `~/.copilot/agents/` (global) and `<workspace>/.copilot/agents/` (project). Parses YAML frontmatter for name, displayName, description, and tools list.
- **`CustomAgentsService`** — Orchestrates agent lifecycle. Merges file-based agents with built-ins at runtime and exports `toSDKAgents()` for session injection.
- **`CustomAgentsPanel`** — New webview component with list and form views for the agents UI.
- **`customAgents` at session creation** — All 7 `createSessionWithModelFallback` call sites now pass `customAgents: this.customAgentsService.toSDKAgents()`, making agents available in every session including plan mode.
- **`agent.select/deselect` per message** — `sdkSessionManager.sendMessage()` calls `session.rpc.agent.select({ name })` before `sendAndWait` and `session.rpc.agent.deselect()` in a `finally` block for per-message agent routing.
- **6 new RPC message types** — `getCustomAgents`, `saveCustomAgent`, `deleteCustomAgent`, `customAgentsChanged`, `selectAgent`, `activeAgentChanged` — all wired through `ExtensionRpcRouter` and `WebviewRpcClient`.
- **`BackendState.activeAgent`** — New field tracking the sticky agent name; cleared on session reset.
- **`parseAgentMention()`** — Exported utility in `InputArea.js` using `/^@([a-z0-9_-]+)\s*(.*)/s` to extract agent name from message text.
- **`/agent` command reclassified** — Changed from `passthrough` (opens CLI terminal) to `extension` type emitting `selectAgent` event.
- **XSS protection** — `CustomAgentsPanel` uses `escapeHtml()` for all agent field rendering and sets form input values programmatically.
- **Slug validation** — `CustomAgentsService.save()` enforces `/^[a-z0-9_-]+$/` on agent names so they always match the `@mention` regex.
- **~70 new tests** — 6 new test files + 5 modified. All follow RED→GREEN TDD discipline.

## [3.5.0] - 2026-03-14

### ✨ Features

- **Real-time streaming responses** — Assistant messages render word-by-word using a safe markdown state machine. Completed constructs (paragraphs, headings, code fences, tables, images) flush progressively. A 1.5s inactivity timer force-flushes any pending buffer so partial text before a tool call appears immediately instead of waiting 60+ seconds for the tool to complete.
- **Reasoning streaming** — `assistant.reasoning_delta` events now stream reasoning content in real-time when "Show Reasoning" is enabled. Previously reasoning only appeared after the full thought was complete (`assistant.reasoning` finalization). Reasoning bubbles are keyed by `reasoningId` and finalized atomically — no duplicate elements.
- **`/compact` slash command** — Compact the current session context to reduce token usage while preserving key information. Works in both work and plan modes. Adds `/compact` to the slash command discovery panel and help text.
- **Task complete indicator** — A ✓ Task Complete card appears in the chat stream when `session.task_complete` fires, providing a clear visual signal that the agent has finished a multi-step task.
- **`copilotCLI.showReasoning`** — New boolean config (default `false`). When `true`, the "Show Reasoning" checkbox is automatically checked on startup and after session switches. The value travels via the `init` RPC payload.
- **`copilotCLI.streaming`** — New boolean config (default `true`). Set to `false` to disable delta streaming — responses appear only when complete. Useful for models or workflows where progressive rendering isn't desired.
- **Tool description fallback** — Tool cards now fall back to `args.description` when no `report_intent` label is available, so tool executions always have a meaningful label.

### 🐛 Bug Fixes

- **Suppress broken-sentence bubbles** — When the model writes a partial sentence and immediately calls a tool (`assistant.message` fires with both `content` and `toolRequests`), the fragment no longer appears as a standalone bubble mid-conversation. An empty finalization signal is still sent so any in-progress streaming bubble is correctly closed.
- **Empty assistant bubbles** — `MessageDisplay` now guards against creating empty assistant bubbles when `message:add` fires with no content (e.g., the finalization signal from the above fix).
- **`showReasoning` gate never updated** — The module-level `showReasoning` variable in `main.js` was never synced when the user toggled the checkbox (the `statusBar.on('reasoningToggle', ...)` handler was commented out and never replaced). Fixed with a direct `eventBus.on('reasoning:toggle', ...)` listener. This caused all `reasoningDelta` RPC events to be silently dropped regardless of the toggle state.
- **`onPermissionRequest` not wired in `createSessionWithModelFallback`** — The `onEvent` handler for new sessions was being set after the session object was already created, causing a race condition where early events were missed. The central config object is now built completely before `createSession` is called.
- **`assistant.reasoning` breaks open tool groups** — A reasoning event arriving while a tool group was open would leave the group in an inconsistent state. Now correctly closes the current tool group before rendering reasoning content.
- **Duplicate `assistant.message_delta` / `assistant.usage` switch cases** — Two pairs of duplicate `case` statements in `_handleSDKEvent` were shadowing each other; the second block of each would never execute. Consolidated.

### 🔧 Internal

- **SDK upgraded to 0.1.32** — Adds 6 new handled events: `subagent.deselected`, `session.task_complete`, `session.background_tasks_changed`, `system.notification`, `permission.requested`, `permission.completed`. All events are logged; `session.task_complete` drives the new task complete UI card.
- **`_onDidReceiveReasoningDelta` BufferedEmitter** — New emitter in `SDKSessionManager`. `_onDidReceiveReasoning` now fires `{reasoningId, content}` (was bare `string`) — all consumers updated atomically.
- **`ReasoningDeltaPayload`** — New RPC message type in `shared/messages.ts`. `ReasoningMessagePayload` gains optional `reasoningId?` for streaming finalization.
- **`sendReasoningDelta()`** — New method on `ExtensionRpcRouter` and `ChatViewProvider`.
- **`onReasoningDelta()`** — New handler registration on `WebviewRpcClient`.
- **`reasoningStreamingBubbles` Map** — `MessageDisplay` tracks in-flight reasoning bubbles keyed by `reasoningId`. `message:add {role:'reasoning', reasoningId}` finalizes and de-dupes.
- **`flushTimer` on streaming state** — Each streaming bubble tracks an inactivity timer. Cleared on `message:add` finalization to prevent double-render.
- **`CompactSlashHandlers`** — New slash command handler module for `/compact`.
- **ADR-006** — New architecture decision record documenting all streaming decisions: assistant delta streaming, reasoning streaming, broken-bubble suppression, and inactivity flush.
- **1302 tests** — 26 new tests covering all four features (RED → GREEN validated). Baseline was 29 failing; now 3 pre-existing unrelated failures.

## [3.4.3] - 2026-03-13

### 🐛 Bug Fixes

- **Reasoning block styling** — Reasoning content now renders with proper italic formatting and is visually distinct from regular assistant messages.
- **Typing indicator accuracy** — The animated "Thinking..." indicator now correctly tracks active token generation versus idle-between-tools state.

## [3.4.2] - 2026-03-10

### 🐛 Bug Fixes

- **Session dropdown showed raw GUIDs** — New sessions displayed an 8-char UUID prefix (e.g., `e38dbdaf`) and resumed sessions showed garbled text (e.g., `l j...`) because `session-name.txt` was only written reactively. Now `SessionService.ensureSessionName()` writes a readable default (`Session – Mar 10, 2:37 PM`) on every session start, no-clobber, sourcing the date from `workspace.yaml`'s `created_at` if available. Old sessions without a name are backfilled on next resume.
- **Plan mode reverted dropdown to GUID** — When entering plan mode, the newly-created plan session directory had no `session-name.txt`, causing the dropdown to fall through to the UUID prefix. `enablePlanMode()` now mirrors the work session's name with a `Plan:` prefix (e.g., `Plan: v3.4.2 – Session Title`).

### 🔧 Internal

- **`SessionService.ensureSessionName(sessionPath)`** — New no-throw guard method. Writes default name only if `session-name.txt` absent; parses `workspace.yaml` `created_at` for accurate timestamp. 6 unit tests.
- **Plan session name mirroring** — `enablePlanMode()` reads work session `session-name.txt` and writes prefixed copy to plan session dir. 3 wiring tests.

## [3.4.1] - 2026-03-09

### 🐛 Bug Fixes

- **Work session "not found" after plan mode** — The CLI server garbage-collects idle sessions (~1-2h TTL). When a work session sat unused during extended planning, `acceptPlan()` would hit "Session not found" and show a recovery modal. Now `disablePlanMode()` proactively verifies the session via a lightweight `abort()` check and silently recreates it if expired. Uses `ensureSessionAlive()` in `sessionErrorUtils.ts` with `classifySessionError()` to distinguish expired sessions from transient errors.
- **Session label garbled as "l j..."** — The auto-injected kickoff message ("I just finished planning...") was becoming the `workspace.yaml` summary, which truncated to garbage in the dropdown. The kickoff message now leads with the plan heading extracted from `plan.md`'s first `#` line (e.g., "v3.4.0 Release Documentation"). The heading is also written to `session-name.txt` for immediate label priority.
- **Plan mode logs appear 60s late** — "Plan accepted!" and "Implementation context injected" appeared ~55s after actual acceptance because `acceptPlan()` awaited the kickoff `sendMessage()` which blocked on `sendAndWait()`'s idle timeout. The kickoff is now fire-and-forget with `.catch()` safety net — message delivery is immediate via RPC, no need to wait for idle.
- **Session dropdown refreshes on every turn** — Every `status: 'ready'` event triggered a full session directory scan (339 sessions, filtered to 214). During agentic execution with 20+ turns, identical data was scanned and pushed to webview repeatedly. Now debounced to once per 30 seconds on `ready` events; explicit triggers (session rename, plan mode, new/switch session) always refresh immediately.

### 🔧 Internal

- **`extractPlanHeading()` + `buildKickoffMessage()`** — Pure functions in `planModeUtils.ts` for plan heading extraction and kickoff message construction. Unit tested with 8 cases.
- **`ensureSessionAlive()`** — Reusable session health check in `sessionErrorUtils.ts`. Uses lightweight `abort()` to verify session liveness (avoids `resumeSession()` which causes server-side event doubling). Falls back to `createSession()` on `session_expired`, propagates all other errors. Unit tested with 3 cases.

## [3.4.0] - 2026-03-08

### ✨ Features

- **`/rename` slash command** — Rename the current session. `/rename My Feature` renames it immediately; `/rename` with no argument shows an input prompt. The name persists in `session-name.txt` and is reflected in the session dropdown. Falls back gracefully when the CLI throws `Workspace not found` on resumed sessions ([github/copilot-cli#1865](https://github.com/github/copilot-cli/issues/1865)).
- **`plan_ready` auto-opens plan.md** — When the AI finishes presenting a plan, `plan.md` opens automatically in a new editor tab. No more needing to click the "View Plan" toolbar button.
- **Blue outline in plan mode** — The input area gets a 3px `var(--vscode-focusBorder)` outline when plan mode is active, making the mode visually distinct.
- **Animated "Thinking..." indicator** — The thinking prompt now shows a 🧠 emoji cycling through rainbow colors (hue-rotate ping-pong) and "Thinking..." text that pulses bold-white → dim. Smooth 60fps CSS animations.
- **`startNewSessionInPlanning` config** — New boolean setting (`copilotCLI.startNewSessionInPlanning`, default `false`). When enabled, new sessions automatically start in plan mode. Resume paths are never affected.

### 🐛 Bug Fixes

- **Pasted image "file not found"** — Temp image files were deleted after a 30-second timeout, causing failures if the user sent the message after 30s. Files are now cleaned up after `sendAndWait()` completes instead.
- **Session labels update live** — The session dropdown now refreshes when a session receives its first AI response (reads from `session-name.txt` > `plan.md` heading > `workspace.yaml` summary > UUID prefix).
- **Session labels strip `[Active File: ...]` prefix** — The `messageEnhancementService` prepends `[Active File: path]` to every message. The CLI uses the first message as the session title, so session labels were showing this prefix. Now stripped at two points: when the SDK fires `session.title_changed`, and when reading `workspace.yaml` summary.
- **`/rename` graceful fallback** — CLI throws `Workspace not found` on resumed sessions ([github/copilot-cli#1865](https://github.com/github/copilot-cli/issues/1865)). `session-name.txt` is now written proactively before sending `/rename` to the CLI, so the label updates even when the CLI fails.

### 🎨 UI Polish

- **Thinking indicator spacing** — Reduced top/bottom padding (`10px/14px → 4px/6px`) so the thinking prompt sits closer to the last message and input box.
- **Input controls row gap** — Halved the gap between the active-file/model row and the metrics/planning row (`8px → 4px`).

### 🔧 Internal

- **`develop-vscode-animations` skill** — New session skill documenting the animation test panel workflow. `src/animationTestPanel.ts` creates disposable light/dark WebviewPanel tabs for rapid CSS animation iteration while developing the extension using the standard VSIX build-and-install workflow. The skill covers: hue-rotate rainbow patterns, smooth text pulse (opacity + color), `animation-direction: alternate` ping-pong, common pitfalls (emoji vs CSS `color:`, explicit stop jerk at loop boundary), and input area card styling.

## [3.3.1] - 2026-02-27

### 🐛 Bug Fixes

- **Fixed CLI not found on Windows (winget installs)** — The CLI path resolver returned the bare default `"copilot"` instead of resolving the full path via `where copilot`. The SDK's `existsSync("copilot")` check (a filesystem check, not a PATH search) then failed with "Copilot CLI not found at copilot". Now the resolver falls through to the PATH lookup, correctly finding winget-installed binaries.

### 🔧 Internal

- **Extracted `resolveCliPath` as testable function** — Moved from a private class method to an exported standalone function with 9 integration tests covering all 4 resolution tiers (user config, SDK bundle, PATH lookup, failure).

## [3.3.0] - 2026-02-24

### ✨ Features

- **Mid-session model switching** — New ModelSelector dropdown in the controls bar lets you switch models without losing conversation context. The SDK resumes the session with the new model, preserving all previous messages and tool state.
- **Tier-grouped model selector** — Models are grouped by cost tier (Fast/Standard/Premium) instead of vendor, with multiplier badges (e.g., 0.5x, 1x, 3x) showing the request cost of each model. Multiplier data flows from the SDK through the full pipeline.
- **Responsive header** — Session toolbar adapts to narrow sidebars. The "Session:" label wraps above the dropdown instead of truncating the session name. All header text standardized to 12px.
- **Queued message indicator** — When you send a message while the AI is still processing, the extension now tracks queued state internally via `pending_messages.modified` SDK events. Foundation for a visible queue indicator in a future release.

### 🛡️ Reliability

- **SDK 0.1.26 permission handler** — Added `onPermissionRequest: approveAll` to all session creation and resume paths. SDK 0.1.26 silently denies all tool operations without this handler. The `availableTools` whitelist and `--yolo` flag continue to control policy at the CLI level.
- **Client name header** — All sessions now include `clientName: 'vscode-copilot-cli'` for proper UA identification in SDK telemetry.
- **Fixed `--yolo` flag logic** — The `--yolo` CLI flag is now only passed when `yolo=true` AND no `allowTools`/`denyTools` policy is configured. Previously, `--yolo` would override user-defined tool policies.
- **Compaction metric accuracy** — After context compaction, usage metrics now reflect post-compaction token counts instead of resetting to zero. The Remaining (account-level) metric is untouched since compaction only affects the session window.

### 🔧 Internal

- **New SDK event handling** — Added explicit handlers for `session.compaction_start`, `session.compaction_complete`, `pending_messages.modified`, and logging for `subagent.*`, `hook.*`, `skill.invoked`, `session.model_change` events.
- **Removed `--no-auto-update` flag** — No longer needed with SDK 0.1.26 which manages CLI version compatibility internally.
- **`currentModel` in init payload** — The webview now receives the current model ID on initialization and webview reconnect, enabling the ModelSelector to show the correct state immediately.

## [3.2.0] - 2026-02-23

### ✨ Features

- **Mermaid diagram toolbar** — Rendered mermaid diagrams now show a toolbar with "View Source" and "Save" buttons. View Source toggles between the rendered diagram and the raw mermaid syntax. Save opens a native Save As dialog to export as SVG image or `.mmd` source file.

### 🐛 Bug Fixes

- **Tool groups no longer pile up** — Fixed a regression from v3.1.0 where all tool executions accumulated in a single group div. Each assistant/user message now correctly starts a new tool group. Individual card expand/collapse state is preserved.

## [3.1.2] - 2026-02-21

### 🛡️ Reliability

- **Smart model fallback** — When the configured model is unavailable (enterprise restrictions, typos), the extension now queries your account's available models via the SDK and picks the best one from a preference order. Notifies you in the chat with which model was selected. Falls back gracefully even when `claude-sonnet-4.5` is unavailable.
- **SDK-bundled CLI resolution** — The extension now resolves the Copilot CLI binary from the SDK's bundled `@github/copilot-{platform}-{arch}` package before falling back to PATH. This prevents version mismatches where an older system-installed binary (e.g., v0.0.394) is used instead of the SDK-compatible version (v0.0.403+).
- **Connection closed recovery** — When the CLI process dies mid-session, the extension now detects "Connection is closed" errors, tears down the dead client, and recreates a fresh `CopilotClient` automatically. Previously, all recovery paths reused the dead client, causing infinite timeout loops.
- **CLI process observability** — The extension now captures CLI stderr output, process exit events, and JSON-RPC connection close events in the Output Channel. Previously the SDK silently swallowed all CLI diagnostics, making failures invisible.
- **`--no-auto-update` flag** — Passes `--no-auto-update` to the CLI to prevent the Go launcher from downloading newer versions at runtime, which caused version drift and unpredictable behavior.

### 🐛 Bug Fixes

- **Session error classification** — Added `connection_closed` error type with 5 detection patterns (`connection is closed`, `connection is disposed`, `transport closed`, `write after end`, `socket hang up`). Connection closed errors now fast-fail instead of retrying against a dead client.
- **Renamed `authUtils` → `sessionErrorUtils`** — The error classification module handles all session error types (timeouts, connection failures, expired sessions), not just authentication. Renamed for clarity.

### 📖 Documentation

- **Troubleshooting section** — Added "Session Won't Start" troubleshooting guide to README with version check and upgrade instructions. The extension requires Copilot CLI v0.0.403 or newer.
- **Copilot Memory section** — Added documentation for the Copilot Memory public preview feature to README.
- **README cleanup** — Removed pre-3.x version history, updated model count to 17.
- **README lint fixes** — Fixed all markdownlint warnings (bare URLs, emphasis-as-heading, missing blank lines, code block languages).
- **Versioning guidance** — Patch releases can include minor bug fixes and small behavior improvements.

## [3.1.1] - 2026-02-21

### ✨ Features

- **Claude Sonnet 4.6 model** — Added `claude-sonnet-4.6` to both the work-mode and plan-mode model selection dropdowns.

### 🛡️ Reliability

- **Model fallback** — When the configured model is not supported by the enterprise or contains a typo, the extension now automatically retries session creation with `claude-sonnet-4.5` and surfaces a warning notification.

## [3.1.0] - 2026-02-16

### ✨ Features

#### Inline Image Rendering

- **Agent-created images render directly in chat** — When the agent creates SVG, PNG, JPG, or other image files and mentions the path in its response, the image renders inline in the sidebar
  - Detects bare image paths in assistant messages (e.g., `images/chart.svg`) and resolves them against the session directory and workspace folder
  - Also resolves markdown image syntax `![alt](path)` to webview URIs
  - Supports PNG, JPG, JPEG, GIF, SVG, and WebP formats
  - Images auto-size to fit the sidebar width (`max-width: 100%`)

- **Clickable file path links** — Resolved image paths display as clickable links above the rendered image
  - Clicking the link opens the file in a VS Code editor tab
  - Full RPC wiring: `openFile` message type from webview to extension host

- **"File not found" annotation** — When a bare image path is detected but the file doesn't exist on disk, the path is annotated with italic *file not found* instead of silently leaving the raw text
  - Gives immediate feedback when the agent claims to have saved a file but the tool execution failed

- **SVG code block rendering** — SVG content in `` ```svg `` code blocks and inline `<svg>` tags render as actual images in the chat
  - Contained in styled `.svg-render` containers with proper sizing and borders

#### Paste Image from Clipboard

- **Ctrl+V image paste** — Paste images directly from the clipboard into the chat input
  - Detects image data in clipboard, reads as data URI
  - Emits `input:pasteImage` event with data URI, MIME type, and auto-generated filename
  - Prevents default paste behavior when image data is present

#### Tool Execution UX Improvements

- **Individual tool card collapse** — Click any tool execution header to collapse/expand that individual tool card
  - Chevron indicator shows collapse state
  - Collapsed state tracked per-card independently

- **Tool group stability fix** — Tool groups no longer auto-collapse when user or assistant messages arrive
  - Previously, manually expanding a tool group would auto-collapse on the next message
  - Groups now close naturally only when a new group starts

### 🐛 Bug Fixes

#### Workspace Path Resolution

- **Fixed image path resolution using wrong directory** — `manager.getWorkspacePath()` returned the SDK session-state directory (`~/.copilot/session-state/<id>/`) instead of the VS Code workspace folder
  - Images saved by the agent to the workspace were never found during resolution
  - Now uses `vscode.workspace.workspaceFolders[0]` for the correct workspace path

#### URL Overflow

- **Fixed long URLs overflowing message bubbles** — Added `overflow-wrap: break-word` and `word-break: break-word` to message content containers

### 🔧 Technical Changes

- **New utility: `resolveImagePaths.ts`** — Extracted image path resolution into a standalone utility with 22 TDD tests
  - Two-pass approach: Pass 1 resolves markdown image syntax, Pass 2 detects bare paths
  - Context-aware exclusions for URLs, already-resolved paths, and webview URIs
  - `tryResolve()` checks multiple directories (session dir, then workspace dir)

- **New RPC message: `openFile`** — Webview-to-extension message for opening files in the editor
  - `OpenFilePayload` type in `shared/messages.ts`
  - Handler in `ExtensionRpcRouter` and `ChatViewProvider`

- **970 tests passing** (3 pre-existing baseline failures)

## [3.0.1] - 2026-02-15

### 🐛 Bug Fixes

#### File Diff Race Condition Fix

- **Fixed empty "before" state in View Diff** — Diffs now correctly show the original file content
  - **Root Cause:** `captureFileSnapshot()` was called from `tool.execution_start`, which fires AFTER the SDK has already begun modifying the file. The snapshot captured partially-written or empty content.
  - **Fix:** Uses the SDK's `onPreToolUse` hook (introduced in SDK 0.1.20) to capture snapshots BEFORE tool execution begins. Two-phase correlation strategy bridges the gap between hook inputs (keyed by file path) and the event pipeline (keyed by `toolCallId`).
  - **Plan Mode Custom Tool Diff:** `update_work_plan` now captures a pre-write `plan.md` snapshot via `FileSnapshotService.createTempSnapshot()` and emits a diff.
    - **Paths:** `beforeUri` → temp snapshot under the snapshot tmp dir; `afterUri` → `~/.copilot/session-state/<workSessionId>/plan.md`
    - **Emission:** `emitDiff({ toolCallId, beforeUri, afterUri, title })` with `toolCallId` from invocation. If snapshot fails, write proceeds and returns success without diff.
    - **Cleanup:** Temp snapshot files are removed after the diff is displayed in the webview.
  - **New Methods:** `captureByPath()`, `correlateToToolCallId()`, `getPendingByPath()` on `FileSnapshotService`
  - **Hook Registration:** All session creation and resume paths now register `onPreToolUse` via `getSessionHooks()`
  - **9 TDD tests** covering both phases, edge cases, and the end-to-end pipeline

### 🔧 Technical Changes

#### SDK Upgrade to 0.1.22

- Upgraded `@github/copilot-sdk` from `^0.1.18` to `0.1.22`
- Enables first-class hooks system (`onPreToolUse`, `onPostToolUse`, `onSessionStart`, etc.)
- Pinned version (no caret) for reproducible builds

#### SDK Hooks Documentation

- Created `documentation/COPILOT-SDK-HOOKS.md` — comprehensive reference for all 6 SDK hooks
- Covers TypeScript signatures, input/output tables, invocation context, limitations
- Documents the missing `toolCallId` in hook inputs and the two-phase correlation workaround
- Prepared for future user-configurable hook support

#### SDK Spike Tool

- New `tests/harness/sdk-spike.mjs` — general-purpose SDK experimentation CLI
- Run prompt files against the SDK, inspect events, analyze streaming quality
- Supports `--events`, `--analyze-streaming`, `--verbose`, `--json` flags
- Interactive mode for ad-hoc prompts
- npm scripts: `test:spike`, `test:spike:streaming`, `test:spike:interactive`

#### Markdown Prompt Format

- Converted test prompts from JSON to markdown with YAML frontmatter
- Human-readable prompt files with structured metadata (`id`, `category`, `timeout`, `expectedBehavior`)
- Prompt loader utility (`tests/harness/prompt-loader.mjs`) with filtering support
- 6 sub-agent streaming test prompts in `tests/prompts/sub-agent-streaming/`

#### Sub-Agent Streaming Analysis

- Automated streaming quality analysis on SDK 0.1.22 confirms sub-agent message queueing
- All 6 test prompts assessed as BATCHED (max pauses of 9-47 seconds)
- Filed upstream: [github/copilot-sdk#477](https://github.com/github/copilot-sdk/issues/477)
- Evidence documented in `documentation/issues/BACKLOG-SUBAGENT-MESSAGE-QUEUEING.md`

## [3.0.0] - 2026-02-14

### 🚀 Major Release - Complete Architectural Overhaul

This is the biggest transformation in the extension's history — a complete rewrite that makes it faster, more reliable, and infinitely more maintainable.

#### **THE FOUNDATIONAL CHANGE - Sidebar Integration**

Migrated from standalone panel (`ChatViewPanel`) to Activity Bar sidebar (`WebviewViewProvider`):
- **Lives in Activity Bar** — Same location as native Copilot Chat and Claude Code
- **Drag Between Sidebars** — Move between left/right sidebars freely via View → Chat
- **Native Chat Experience** — Proper VS Code sidebar integration, not a floating panel
- **Complete Webview Lifecycle Rewrite** — Proper disposal chain, resource management, and state preservation
- **Fixed Massive Memory Leak** — MutableDisposable pattern eliminates accumulating event handlers from session switches

**Why this matters**: Provides a native VS Code chat experience and solves the memory leak that would crash the extension after multiple session switches.

### ✨ Features

#### Inline Diff Display in Chat Stream
- **In-Stream Diffs** — File edits show compact inline diffs directly in chat (up to 10 lines with +/- prefixes)
- **Truncation for Large Changes** — Diffs over 10 lines show "... N more lines" with "View Diff" button
- **Decision-Making in Flow** — Review, approve, or redirect the agent without leaving the conversation
- **InlineDiffService** — Dedicated service for LCS-based diff generation and formatting

#### Slash Commands (41 Commands) with Discovery Panel
- **CommandParser** — Unified parser for 41 slash commands with type-safe execution
- **SlashCommandPanel** — Type `/` to see a grouped command reference above the input; click to insert
- **Help Icon (?)** — StatusBar help button triggers `/help` for full formatted command reference in chat
- **User Commands**: `/help`, `/usage`, `/review`, `/diff`, `/mcp`, `/plan`, `/exit`, `/accept`, `/reject`, `/model`
- **CLI Passthrough**: `/delegate`, `/agent`, `/skills`, `/plugin`, `/login`, `/logout` (opens terminal)
- **Improved UX**: Unsupported commands show friendly help message instead of being sent to AI

#### Claude Opus 4.6 Model Support
- **Latest Models**: Added `claude-opus-4.6` and `claude-opus-4.6-fast`
- **Model Capabilities Service** — Caches model info to reduce API calls
- **Smart Attachment Validation** — Checks model vision capabilities before sending images

#### Auto-Resume After VS Code Reload
- **Automatic Reconnection** — CLI session resumes when VS Code reloads with sidebar open
- **History Restoration** — Previous conversation loads from Copilot CLI's event log
- **State Preservation** — Active file, plan mode status, and metrics restored across reloads

### 🏗️ Architecture

#### Component-Based UI (9 Components)
Replaced 1200+ line monolithic script with modular component architecture:
- **MessageDisplay** — Renders user/assistant messages, reasoning traces, tool execution groups
- **ToolExecution** — Collapsible tool groups with expand/collapse, diff buttons, result display
- **InputArea** — Message input with @file references, image attachments, `/` trigger panel
- **SessionToolbar** — Session dropdown, model selector, new session button, view plan button
- **AcceptanceControls** — Plan acceptance UI (accept/reject buttons, plan summary)
- **StatusBar** — Usage metrics (window %, tokens used, quota remaining), help icon (?)
- **ActiveFileDisplay** — Shows filename with full path tooltip
- **PlanModeControls** — Plan mode toggle with separate model selector
- **SlashCommandPanel** — Grouped slash command reference panel for discoverability

**EventBus Pattern** — Decoupled pub/sub communication between components and extension:
- 45+ event types defined in shared/messages.ts
- Components emit events, extension and other components listen
- Eliminates tight coupling and circular dependencies

#### Type-Safe RPC Layer
- **ExtensionRpcRouter** (520 lines) — Typed send/receive methods replacing raw postMessage
  - 31 message types with TypeScript interfaces
  - `send()`, `receive()`, `request()` methods with full type safety
  - Message tracking and debugging built-in
- **WebviewRpcClient** (390 lines) — Typed callback registration for webview
  - `on()`, `emit()`, `call()` methods matching extension router
  - Automatic message ID generation for request/response matching
- **shared/messages.ts** — Central type definitions for all 31 message types
  - Request/response pairs: `SessionListRequest`/`SessionListResponse`
  - Event notifications: `AssistantMessageEvent`, `ToolStartEvent`, etc.
  - Type guards for runtime validation

#### Service Extraction (7 Services)
Extracted from monolithic `extension.ts` for clean separation of concerns:
- **SessionService** — Session lifecycle, creation, switching, resume logic
- **InlineDiffService** — LCS-based diff generation, formatting, and display
- **fileSnapshotService** — Git snapshots for file state tracking
- **mcpConfigurationService** — MCP server configuration and discovery
- **modelCapabilitiesService** — Model info caching and attachment validation
- **planModeToolsService** — Plan mode tool definitions and whitelisting
- **messageEnhancementService** — Message formatting, @file resolution, active file injection

Each service is independently testable with clear boundaries and responsibilities.

#### MutableDisposable Pattern - Memory Leak Fix
- **Problem**: Event handlers accumulated on every session switch, causing memory growth
- **Solution**: `MutableDisposable` wrapper that disposes old handlers before setting new ones
- **Impact**: Extension can run indefinitely without memory leaks
- **Clean Disposal Chain**: Extension → Services → Components → DOM
  - Each layer properly disposes its resources when deactivated
  - No orphaned event listeners or subscriptions

### 🧪 Testing

#### Comprehensive Test Suite (710+ Tests)
- **Unit Tests** — All components, services, and utilities
- **Integration Tests** — Cross-component flows (EventBus, RPC layer)
- **E2E Tests** — Full user scenarios (session creation, message sending, plan acceptance)
- **JSDOM-Based Component Testing** — Real DOM manipulation testing without browser
- **Test Helpers Library** — Reusable mocks for scroll geometry, VS Code API, RPC clients

#### TDD Methodology Enforced
- **RED-GREEN-REFACTOR** — Every feature starts with a failing test
- **Integration Tests** — Import actual production code, not mocks
- **Flow Testing** — Tests execute full user interaction flows (click → event → handler → UI)
- **Mandatory Checklist** — Every PR must pass test quality checklist

**Test locations**:
- `tests/*.test.js` — Integration tests (must import production code)
- `tests/*.test.mjs` — SDK-specific tests (ESM modules)
- Webview tests use JSDOM to test actual DOM manipulation

### 🐛 Bug Fixes

#### Session Dropdown Fixes
- Fixed session list not updating when creating new session
- Fixed dropdown not showing current session on initial load
- Fixed race condition between session creation and dropdown render

#### View Plan Button Fixes
- Fixed button showing when no plan.md exists
- Fixed button click not opening correct plan file
- Added proper state tracking for plan file existence

#### RPC Message Extraction Fixes
- Fixed message content extraction for streaming messages
- Fixed tool execution result display for complex nested structures
- Added proper type guards for message format validation

#### Scroll Geometry Fixes
- Fixed auto-scroll not triggering after new message added
- Fixed scroll position jumping when expanding/collapsing tool groups
- Added proper scroll threshold detection (within 50px of bottom)

### 📝 Documentation

#### Updated Architecture Documentation
- Added component architecture diagram
- Documented RPC layer and message types
- Explained service layer responsibilities
- Added EventBus communication patterns

#### Test Quality Standards
- Documented TDD methodology requirements
- Added anti-patterns guide (2026-02-09 diff button bug lessons)
- Created mandatory test quality checklist
- Defined integration test requirements (JSDOM, production code import)

### 💥 Breaking Changes

- **UI Location Changed** — Extension now lives in Activity Bar sidebar (not floating panel)
  - Click icon in Activity Bar (left side by default) to show/hide chat
  - Users may need to drag to preferred sidebar location (View → Chat for right sidebar)
  - No configuration changes needed — extension automatically appears in Activity Bar

### 🔄 Migration

- **Automatic Migration** — Extension appears in Activity Bar on first launch after update
- **Session Preservation** — Previous sessions remain accessible and auto-resume works
- **No Config Changes** — All existing settings and configurations carry over
- **Sidebar Preference** — Drag to right sidebar if preferred (View → Chat)

## [2.2.3] - 2026-02-08

### ✨ Features

#### Session Resume Retry with Circuit Breaker
- Added intelligent retry logic for session resume failures
  - **Circuit Breaker Pattern:** Retries up to 3 times with exponential backoff (1s, 2s delays)
  - **Smart Error Classification:** Different strategies for different error types:
    - `session_expired`: Skip retries, create new session immediately
    - `authentication`: Fail fast (requires user to fix auth)
    - `network_timeout`: Retry with backoff (transient network issues)
    - `session_not_ready`: Retry with backoff (CLI still starting)
    - `unknown`: Retry with backoff (conservative approach)
  - **User Recovery Dialog:** When all retries fail, shows contextual dialog:
    - "Previous session not found" for expired sessions
    - "Cannot connect to Copilot CLI" for network errors
    - "Copilot CLI not ready" for CLI connection issues
    - User can choose "Try Again" or "Start New Session"
  - **Comprehensive Logging:** Detailed retry timeline in output channel for debugging

### 🐛 Bug Fixes

#### Session Resume Reliability
- Fixed session resume giving up immediately on transient errors
  - Previously: One error = new session (lost conversation history)
  - Now: Retries transient failures automatically before giving up
  - Better UX: User has final say on session fate via recovery dialog
  - No infinite loops: Maximum 3 retry attempts enforced

## [2.2.2] - 2026-02-07

### 🐛 Bug Fixes

#### Active File Display
- Fixed "Active File" showing output channel name on extension start
  - Now correctly filters initial `activeTextEditor` by scheme ('file' or 'untitled')
  - Previously only filtered in change listener, not initial value
  - Prevents output channels from being displayed as "active file"

#### Metrics Reset on New Session
- Session-level metrics (Window %, Used tokens) now reset when creating new session
  - Fixed metrics persisting across session changes
  - Account-level metric (Remaining %) correctly preserved
  - Added `resetMetrics` flag to status events

#### Image Thumbnail Positioning
- Fixed uploaded image thumbnails appearing outside user's message bubble
  - Attachments now rendered inside `.message-content` div
  - Properly contained within chat bubble styling
  - Visual grouping with message text

#### Planning Test Suite
- Fixed failing test for edit tool restriction in plan mode
  - Updated test to verify configuration instead of relying on message failures
  - Test now correctly validates that SDK whitelist excludes 'edit' tool
  - All 12 plan mode tests passing

#### View Plan Button
- Fixed "View Plan" button failing to open plan.md file
  - Was using VS Code workspace path instead of session state directory
  - Now uses correct path: `~/.copilot/session-state/{sessionId}/plan.md`
  - Works correctly when in plan mode (uses work session ID, not plan session ID)
  - Added file existence check - shows helpful message if plan.md doesn't exist yet
  - Prevents confusing "file not found" errors when no plan has been created

#### Session History Loading Race Condition
- Fixed critical bug where session history wasn't loaded on extension startup
  - **Root Cause:** Webview was created before history finished loading
  - **Symptom:** Opening chat showed blank history until switching sessions
  - **Fix:** Load history into BackendState BEFORE creating webview panel
  - Now history loads reliably on first open instead of requiring session switch
  - Prevents 138ms race condition between webview ready and file stream close events

## [Unreleased]

### 🧹 Chore

- Removed deprecated `cliProcessManager.ts` (v1.0 legacy implementation)
  - This file was superseded by `sdkSessionManager.ts` in v2.0 (January 2026)
  - No functionality lost - all features are in the SDK-based implementation
  - Historical reference preserved in git history (pre-v2.0 commits)

## [2.2.1] - 2026-02-06

### 🔐 Authentication & Enterprise Support

#### Authentication Detection & Guidance
- 🔍 **Smart Error Detection** - Automatically detects authentication failures
  - Classifies errors: authentication, session expired, network, or unknown
  - Comprehensive logging with error context for debugging
  - Different handling for environment variable auth vs. OAuth
  - **Test Coverage**: 9/9 tests passing for error classification and env var detection

#### Terminal-Based Authentication Flow
- ✨ **Interactive Authentication** - One-click authentication setup
  - Click "Authenticate Now" button in error dialog
  - Extension opens terminal with `copilot login` command pre-filled
  - Clear instructions guide users through the process
  - "Retry" button to test authentication after completion

#### Environment Variable Support
- 🔑 **Token-Based Authentication** - Detects and validates environment variables
  - Checks `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` (in priority order)
  - Logs which variable is detected (without exposing token value)
  - Shows helpful error if token is invalid or expired
  - Suggests updating token or using interactive login

#### GitHub Enterprise SSO
- 🏢 **Enterprise SSO Support** - First-class support for SSO-enabled enterprises
  - New setting: `copilotCLI.ghSsoEnterpriseSlug`
  - Automatically generates SSO login command with enterprise slug
  - Example: `copilot login --host https://github.com/enterprises/acme/sso`
  - Regex validation ensures slug format is correct
  - Clear documentation for when to use (SSO-enabled enterprises only)

#### User Experience Improvements
- 📚 **Comprehensive Documentation** - Clear auth instructions in README
  - Step-by-step guide for interactive OAuth login
  - Environment variable setup for automation/CI
  - GitHub Enterprise SSO configuration guide
  - Troubleshooting section with common issues
  - Links to official GitHub documentation

### 🐛 Bug Fixes

- Fixed: Generic "Failed to start SDK session" errors with no actionable guidance
- Fixed: No detection of authentication vs. other error types
- Fixed: No support for GitHub Enterprise SSO authentication paths
- Fixed: "Retry" button in notification disappears - now shows clear instructions in chat panel with "Start New Session" guidance

## [2.2.0] - 2026-02-06

### 🎨 New Features

#### Image Attachment Support
- 📎 **Attach Images to Messages** - Send images to vision-capable AI models
  - Click attachment button (📎) next to input box to select images
  - Preview thumbnails with filename and size before sending
  - Remove individual attachments before sending message
  - Supports PNG, JPEG, GIF, WebP formats
  - Validated against model capabilities (size limits, count limits, types)

#### Vision Model Detection
- 🤖 **Automatic Vision Capability Detection**
  - Extension detects which models support image analysis
  - Model capabilities cached for performance
  - Real-time validation prevents errors before sending
  - Clear error messages when model doesn't support images

#### Error Handling & Validation
- ✅ **Comprehensive Attachment Validation**
  - File size validation (enforced by model capabilities)
  - Image count validation (enforced by model capabilities)
  - File type validation (images only for now)
  - Clear error dialogs guide users when validation fails
  - Session remains functional after validation errors

### 🏗️ Architecture Improvements

#### Services Refactor (Phase 5.5)
- 🧹 **SDKSessionManager Reduced by 31%** (1946 → 1345 lines)
  - Extracted 4 new services with single responsibilities:
    - `MessageEnhancementService` - Message formatting and context injection
    - `FileSnapshotService` - Git snapshot generation (8/8 tests ✅)
    - `MCPConfigurationService` - MCP server configuration (9/9 tests ✅)
    - `PlanModeToolsService` - Custom tools for plan mode (22/22 tests ✅)
  - Better separation of concerns and maintainability
  - Test-driven development: 39 new tests passing

### 🐛 Bug Fixes

#### Model Capabilities Service
- Fixed critical bug in `ModelCapabilitiesService.fetchAllModels()`
  - SDK's `listModels()` returns `ModelInfo[]` directly, not `{models: []}`
  - Bug caused 0 models to be cached, resulting in "Model not found" warnings
  - All models now correctly cached and detected

### 🧪 Testing

#### Integration Tests
- Created `tests/attachment-non-vision-e2e.test.js` (5/5 tests passing)
  - Tests non-vision model (gpt-3.5-turbo) rejecting attachments
  - Validates error propagation through all layers
  - Verifies session resilience after validation errors
  - New npm script: `npm run test:attachment-error`
- Test fixture: `tests/fixtures/test-icon.png` (4.32 KB)

### 📝 Known Limitations

The following features are deferred to v2.2.1:
- Attachment button doesn't disable for non-vision models (shows error after file selection instead)
- Tool-returned images not displayed (AI can receive images but cannot return them yet)
- Attachment history not persisted (attachments don't show in session resume)
- Plan mode attachment support not tested (should work but needs validation)

## [2.1.4] - 2026-02-04

### 🐛 Bug Fixes

### Active File Context Fix

- Fixed active file context not being sent to the LLM when chat panel has focus
- Extension now tracks the last active text editor via `onDidChangeActiveTextEditor` event
- Active file context is preserved even when focus moves to the chat webview
- Plan mode sessions now receive workspace root and active file context (matching work mode)
- Added comprehensive diagnostic logging in `enhanceMessageWithContext()` method
- Technical: Both backend (`SDKSessionManager`) and UI (`extension.ts`) now use consistent `lastActiveTextEditor` pattern

## [2.1.3] - 2026-02-04

### 🐛 Bug Fixes

### Session List Filtering

- Fixed session dropdown showing all sessions regardless of workspace folder filtering setting
- When `copilotCLI.filterSessionsByFolder` is enabled, the dropdown now correctly shows only sessions for the current workspace
- Previously: Dropdown showed ALL sessions, but only workspace-specific ones were resumable (confusing UI)
- Now: Dropdown only shows sessions that match the current workspace folder (when filtering is enabled)
- Technical: `updateSessionsList()` now uses the same `filterSessionsByFolder()` utility as session resumption logic
- Added logging to show filtering status and session count changes

## [2.1.2] - 2026-02-04

### ✨ Features

### Plan Mode Model Configuration

- Added `copilotCLI.planModel` setting to use different AI models for planning vs implementation
- Plan mode can now use a faster/cheaper model (e.g., Claude Haiku 4.5) while work mode uses a more powerful one (e.g., Claude Sonnet 4.5)
- Falls back to work mode model if not specified
- Example: Use Haiku for exploration and planning, Sonnet for code implementation

### 🐛 Bug Fixes

### Session Expiration Recovery

- Fixed CLI exiting after one message following session timeout
- Session recreation now properly maintains the client connection
- Previous issue: After timeout, only one message could be sent before CLI became unresponsive
- Now: Session recreates seamlessly and continues working indefinitely
- Technical: Changed from `stop()/start()` to in-place session recreation keeping client alive

### 📝 Documentation

- Updated README.md with 2.1.1 feature highlights
- Added release process reminder to update both CHANGELOG.md and README.md before publishing

## [2.1.1] - 2026-02-04

### 🐛 Bug Fixes

### Active File Persistence

- Fixed active file disappearing when clicking in the text input box
- Active file now persists when webview gets focus (previously cleared to null)
- Only clears active file when all text editors are actually closed
- Improved logic tracks last known text editor to distinguish between "focus moved to webview" vs "all files closed"

### Session State Management

- Fixed session automatically reloading when closing and reopening the chat panel
- Chat panel now correctly preserves the active session state instead of reloading from disk
- Closing the panel with X button no longer triggers session history reload on reopen
- Session continues running in background; panel just reconnects to existing state

### Session List Cleanup

- Empty sessions (no messages) are now filtered out of the session dropdown
- Corrupt sessions that fail to parse are excluded from the session list
- Session list only shows valid, non-empty sessions
- Improved error handling when reading session metadata

### 🔧 Technical Changes

- Added `lastKnownTextEditor` module-level variable in `src/extension.ts`
- Modified `updateActiveFile()` to check `visibleTextEditors.length` before clearing
- Better handling of `onDidChangeActiveTextEditor` event when editor is undefined
- Refactored session state logic to prevent unnecessary history reloads and separate state management from webview
- Enhanced session listing with validation and filtering for empty/corrupt sessions

## [2.0.6] - 2026-02-01

### 📋 Plan Mode Enhancements

**ACE-FCA Methodology Support**

- Dedicated planning session separate from work session
- Automatically injects plan file path when accepting plan
- Work session receives message with plan location and implementation instructions
- Eliminates confusion when switching from planning to implementation

**Improved Planning UI**

- All planning buttons converted to compact icons (📝, ✅, ❌, 📋)
- Prevents text overflow when resizing window
- Tooltips provide full descriptions on hover
- Planning buttons align horizontally with other controls
- "Planning" title overlays buttons without affecting vertical position

**Enhanced Safety**

- Sandboxed environment with 11 safe tools (read-only operations only)
- Cannot modify code, install packages, or commit changes in plan mode
- Can explore codebase, read files, and create implementation plans
- Defense-in-depth validation prevents accidental modifications

**See [PLAN_MODE.md](./PLAN_MODE.md) for complete guide**

### 🎨 UI/UX Improvements

**Tool Group Behavior**

- Tool groups now default to collapsed state when overflowing
- "Expand (x more)" button correctly shows collapsed initially
- Improved visual organization of multiple tool executions

**Better Alignment**

- Consistent baseline alignment for all controls
- Metrics, Show Reasoning, and Planning controls in same row

### 🐛 Bug Fixes

- Fixed View Plan button alignment (moved into Planning group)
- Fixed tool group expand/collapse state synchronization
- Fixed plan context loss when switching from plan to work mode

## [2.0.2] - 2026-01-31

### ✨ New Features

**Active File Context**

- Automatically includes the currently active file in VS Code as context
- If text is selected, includes the selection with line numbers
- Can be disabled via `copilotCLI.includeActiveFile` setting (enabled by default)
- Provides seamless context awareness for file-specific questions

**@file_name Reference Resolution**

- Support for `@file_name` syntax in messages
- Automatically resolves file references to relative workspace paths
- Searches workspace for matching files if not found directly
- Can be disabled via `copilotCLI.resolveFileReferences` setting (enabled by default)
- Example: `@src/extension.ts` resolves to the correct path

### 🐛 Bug Fixes

**Plan Mode Timeout Fix**
- Fixed "Tool names must be unique" error causing timeouts in plan mode
- Removed duplicate `update_work_plan` tool from availableTools list
- Plan mode now works reliably without API errors

**Plan Mode Tool Improvements**
- Added `explore` tool to available tools in plan mode
- Improved system message to clearly indicate `update_work_plan` must be used instead of `create`
- Added explicit tool list to help agent understand available capabilities
- Better error guidance when wrong tools are attempted

## [2.0.1] - 2026-01-28

### ✨ New Features

**Real-Time Usage Statistics**
- Context window usage percentage (shows how much of 128k token limit is used)
- Total tokens used in session (displayed in compact k/m/b format)
- Remaining request quota percentage
- All metrics update in real-time in the status bar
- Tooltips show full numbers with details

**Tool Grouping with Expand/Collapse**
- All tool executions group into collapsible containers
- Tools stay together until user or assistant message (prevents tool spam)
- Fixed height shows 2-3 tools by default (200px max)
- "Expand (X more)" link appears when tools overflow
- Click to expand shows all tools, dynamically grows as new tools arrive
- "Contract" link to collapse back
- Smart grouping: user/assistant messages close groups, tools intersperse naturally

**Stop Button**
- Send button transforms to red Stop button while thinking
- Click to abort current generation using `session.abort()`
- Enter key still works to queue messages while thinking
- Session remains active after stopping

### 🐛 Bug Fixes

**Session Expiration Handling**
- Fixed "session not found" errors when window stays open for extended periods
- Extension now automatically creates new session when old one expires
- Shows clear visual separator between expired and new session
- Preserves conversation history for reference
- Seamless recovery without manual intervention

**Session.idle Timeout Suppression**
- Suppressed confusing timeout errors during long-running commands
- Long operations (like `code --install-extension`) now complete silently
- Only real errors are shown to users

### 📚 Documentation

**Updated Links**
- Changed feedback link from GitHub Discussions to VS Code Marketplace Q&A
- Updated README with current support channels

## [2.0.0] - 2026-01-26

### 🚀 Major Release - SDK Integration & MCP Support

Complete architectural rewrite using the official @github/copilot-sdk with extensive new features.

#### ✨ New Features

**SDK 2.0 Integration**
- Migrated from CLI process spawning to official @github/copilot-sdk v0.1.18
- Real-time event streaming (tool execution, assistant messages, reasoning)
- Event-driven architecture with JSON-RPC communication
- Better performance and reliability

**Tool Execution Visibility**
- Real-time tool execution display with status indicators (⏳ Running → ✅ Success / ❌ Failed)
- Progress updates during tool execution
- Duration tracking for each tool
- Intent display showing what the assistant is trying to accomplish

**File Diff Viewer**
- "📄 View Diff" button on file edit/create operations
- Side-by-side before/after comparison using VS Code's native diff viewer
- Supports all edit types: create, add lines, remove lines, modify
- Smart snapshot capture with automatic cleanup on session end

**MCP Server Integration**
- Built-in GitHub MCP server enabled by default (access to repos, issues, PRs)
- Configure custom MCP servers via `copilotCLI.mcpServers` setting
- Support for local (stdio) and remote (HTTP/SSE) servers
- Variable expansion (`${workspaceFolder}`) in server configuration
- Enable/disable servers individually
- Integration test with hello-mcp test server

**Reasoning Display**
- Toggle to show/hide assistant's reasoning process
- See how the assistant thinks through problems
- Persistent visibility state during session

**Prompt History Navigation**
- Use Up/Down arrow keys to cycle through last 20 messages
- Saves current draft when navigating history
- Smart boundary behavior (no wrapping)
- Auto-resizes textarea

**Planning Mode Enhancements**
- Toggle to auto-prefix messages with `[[PLAN]]`
- "📋 View Plan" button for quick access to plan.md
- Session-aware visibility

**UI Improvements**
- Right-aligned input controls with clean visual hierarchy
- Reorganized layout: Show Reasoning | Plan Mode | View Plan
- Improved thinking indicator with proper state management

#### 🐛 Bug Fixes
- Fixed duplicate message sends (handler registration issue)
- Fixed session timeout errors (session.idle event handling)
- Fixed thinking indicator disappearing after tools
- Fixed file diff race condition (snapshot cleanup timing)
- Fixed working directory (files now created in workspace folder)
- Fixed yolo setting name (copilotCLI.yolo)

#### 🔧 Technical Changes
- Added working directory support (`cwd` parameter to SDK)
- Enhanced error handling and logging
- Session turn event tracking (assistant.turn_start/end)
- Token usage monitoring (session.usage_info)
- Improved event handler lifecycle management

#### 📦 Dependencies
- Added: @github/copilot-sdk ^0.1.18
- Added: vscode-jsonrpc ^8.2.1
- Removed: node-pty (unused from v1.0)
- Updated: dompurify, marked (latest versions)

#### 📚 Documentation
- Updated README with SDK architecture and MCP configuration
- Added MCP server testing guide to HOW-TO-DEV.md
- Created 3 implementation checkpoints documenting the journey
- Updated test documentation

#### ✅ Backward Compatibility
All v1.0 settings work unchanged in v2.0:
- Session management preserved
- Markdown rendering identical
- All permission settings (yolo, allowTools, etc.)
- Model and agent selection
- Folder-based session filtering

#### 🧪 Testing
- New MCP integration test (tests/mcp-integration.test.js)
- hello-mcp test server (Node.js)
- End-to-end UAT validation
- All v1.0 features verified working

### Migration Notes
No migration needed - v2.0 is fully backward compatible. Sessions in `~/.copilot/session-state/` work as-is.

New optional setting:
```json
{
  "copilotCLI.mcpServers": {
    "my-server": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"],
      "enabled": true
    }
  }
}
```

## [1.0.2] - 2026-01-25

### Added
- **Folder-Specific Session Selection** - Sessions now filtered by workspace folder on startup
  - Automatically resumes the most recent session from the current workspace folder
  - Prevents sessions from other projects being selected when opening a workspace
  - Falls back to global latest session if no folder-specific sessions exist
  - New setting: `copilotCLI.filterSessionsByFolder` (default: `true`) to toggle this behavior
  - Session metadata extracted from `events.jsonl` without requiring CLI schema changes

### Changed
- Session selection now workspace-aware by default
- Improved logging for session selection debugging

### Technical
- Created `sessionUtils.ts` module for session metadata operations
- Refactored `loadLastSessionId()` in `cliProcessManager.ts` to use new utility functions
- Performance optimized: only reads first ~2KB of each session's `events.jsonl` file

## [1.0.1] - 2026-01-24

### Documentation
- Updated README with marketplace installation instructions
- Added marketplace badges (version, installs, rating)
- Created comprehensive development guide (HOW-TO-DEV.md)
- Removed roadmap (v1.0 is complete!)
- Fixed outdated F5 debugging instructions (now uses VSIX workflow)
- Improved Quick Start and configuration examples

## [1.0.0] - 2026-01-24

### 🎉 Initial Release

#### Features
- **Interactive Chat Panel** - Dockable webview with full markdown rendering
  - Code blocks with syntax highlighting
  - Lists, headers, links, and formatted text
  - Auto-scrolling and message history
  
- **Session Management**
  - Session dropdown showing all available sessions
  - Resume last session automatically (configurable)
  - Switch between sessions with full history loading
  - Session labels from plan.md or short ID
  - New session button (+) in header
  
- **Complete CLI Integration**
  - Uses Copilot CLI's `--prompt` mode with session resumption
  - Tracks session state via `~/.copilot/session-state/`
  - Loads full conversation history from `events.jsonl`
  - Clean text output (stats footer stripped)
  
- **Full Configuration Support**
  - All Copilot CLI flags configurable
  - YOLO mode (all permissions) - default: true
  - Auto-resume last session - default: true
  - Granular tool, path, and URL permissions
  - 14 AI models to choose from
  - Agent and custom flags support
  
- **Accessibility**
  - Screen reader optimizations
  - ARIA labels and semantic HTML
  - Live regions for dynamic content
  - Keyboard navigation support
  
- **Cross-Platform**
  - Works on Linux, macOS, and Windows
  - Uses cross-platform Node.js APIs
  - Automatic path handling for all platforms

#### Technical Details
- TypeScript with esbuild bundling
- VSIX-based development workflow (F5 debugging broken in VS Code 1.100+)
- Comprehensive logging via Output Channel
- marked.js for markdown rendering
- No dependencies on deprecated `gh copilot` extension

#### Requirements
- VS Code 1.108.1 or higher
- GitHub Copilot CLI (standalone `copilot` command)
- Active Copilot subscription

#### Known Limitations
- No real-time tool execution visibility (trade-off for clean output)
- No structured output API from CLI yet (v0.0.394)
- File change visualization not yet implemented