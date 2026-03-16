# Accessibility Overhaul

## Status: Backlog

## Problem

The extension's webview has inconsistent accessibility support. Some components have partial ARIA attributes; most lack keyboard navigation, focus management, and screen reader support. No component is fully accessible.

## Current State by Component

| Component | ARIA roles | aria-label | aria-live | Keyboard nav | Focus mgmt |
|-----------|-----------|------------|-----------|-------------|------------|
| SessionToolbar | `role="banner"`, `role="status"` | Yes (buttons, dropdown) | `aria-live="polite"` on status | No | No |
| MessageDisplay | `role="log"`, `role="article"` | Yes (messages) | `aria-live="polite"` on messages | No | No |
| InputArea | None | Dynamic on send btn | No | Yes (Escape, Enter, arrows) | Yes (auto-focus) |
| ModelSelector | None | None | No | Escape only | No |
| CustomAgentsPanel | `role="region"` (added 3.6.1) | Yes (added 3.6.1) | No | Escape (added 3.6.1) | Form focus (added 3.6.1) |
| SlashCommandPanel | None | None | No | No | No |
| AcceptanceControls | None | None | No | No | No |
| StatusBar | None | None | No | No | No |
| PlanModeControls | None | None | No | No | No |
| ActiveFileDisplay | None | None | No | No | No |
| ToolExecution | None | `aria-hidden` on icons | No | No | No |

## What Needs to Be Done

### Phase 1: ARIA Foundation (all components)

Every interactive component needs:

1. **Semantic roles** — `role="region"`, `role="toolbar"`, `role="listbox"`, etc.
2. **aria-label on all emoji buttons** — Screen readers read emoji as gibberish. Every button with an emoji icon needs `aria-label`.
3. **aria-hidden="true" on decorative emoji** — Icons inside labelled buttons, empty state decorations.
4. **aria-expanded on collapsible sections** — CustomAgentsPanel (done), model dropdown, slash command panel.

Affected files:
- `src/webview/app/components/SessionToolbar/SessionToolbar.js` — plan button, agents button need aria-label
- `src/webview/app/components/InputArea/InputArea.js` — attach button needs aria-label
- `src/webview/app/components/PlanModeControls/PlanModeControls.js` — all 4 buttons need aria-label
- `src/webview/app/components/ActiveFileDisplay/ActiveFileDisplay.js` — file icon needs aria-hidden
- `src/webview/app/components/StatusBar/StatusBar.js` — help icon, reasoning icon need aria-label/aria-hidden
- `src/webview/app/components/ModelSelector/ModelSelector.js` — dropdown needs aria-expanded, options need role="option"
- `src/webview/app/components/MessageDisplay/MessageDisplay.js` — attachment icons, mermaid save button need aria-label
- `src/webview/app/components/ToolExecution/ToolExecution.js` — collapse toggle needs aria-expanded, diff button needs aria-label

### Phase 2: Keyboard Navigation

1. **Escape to close** — ModelSelector dropdown, SlashCommandPanel, CustomAgentsPanel (done)
2. **Arrow keys** — SlashCommandPanel (up/down to select command), ModelSelector (up/down to select model)
3. **Enter to activate** — SlashCommandPanel (select highlighted command), agent rows (open edit)
4. **Tab trapping** — When a modal-like panel is open (model dropdown, slash panel), Tab should cycle within it

Affected files:
- `src/webview/app/components/ModelSelector/ModelSelector.js` — arrow key navigation, Enter to select
- `src/webview/app/components/SlashCommandPanel/SlashCommandPanel.js` — arrow key navigation, Enter to select, Escape to close

### Phase 3: Focus Management

1. **Auto-focus on open** — When a panel opens, focus the first interactive element
2. **Focus restore on close** — When a panel closes, return focus to the element that opened it
3. **Focus after dynamic updates** — After agent save/delete, after session switch, after message send

### Phase 4: Screen Reader Announcements

1. **aria-live regions** for dynamic content:
   - Agent list after save/delete
   - Model switch confirmation
   - Session switch confirmation
   - Tool execution status changes
2. **Status announcements** — "Thinking...", "Message sent", "Plan mode enabled"

### Phase 5: CSS Accessibility

1. **`:focus-visible`** — Show focus rings only for keyboard navigation (not mouse clicks). Currently all focus uses `:focus` which shows rings on click too.
2. **`prefers-reduced-motion`** — Disable/reduce animations for users who request it. Affects:
   - CustomAgentsPanel open/close transition
   - Thinking indicator animation
   - Tool execution expand/collapse
   - Message scroll behavior
3. **High contrast mode** — Test with VS Code's high contrast themes. The extension uses `--vscode-*` CSS variables which should adapt, but needs verification.

## Emoji Inventory (all need aria-label or aria-hidden)

| Emoji | Component | Purpose | Needs |
|-------|-----------|---------|-------|
| 💬 | MessageDisplay | Empty state icon | `aria-hidden="true"` |
| 🧠 | MessageDisplay, StatusBar | Thinking/reasoning | `aria-hidden="true"` |
| 📎 | InputArea, MessageDisplay | Attach / attachment | `aria-label="Attach files"` |
| 📋 | SessionToolbar | View plan | `aria-label="View plan"` |
| 🤖 | SessionToolbar | Manage agents | Already has `aria-label` |
| 💡 | PlanModeControls | Enter planning | `aria-label="Enter planning mode"` |
| ❌ | PlanModeControls | Exit planning | `aria-label="Exit planning mode"` |
| ✅ | PlanModeControls | Accept plan | `aria-label="Accept plan"` |
| 🚫 | PlanModeControls | Reject plan | `aria-label="Reject plan"` |
| 📄 | ActiveFileDisplay, ToolExecution | File icon / view diff | `aria-hidden="true"` / `aria-label` |
| ✏️ | CustomAgentsPanel | Edit agent | Already has `aria-label` (3.6.1) |
| 🗑 | CustomAgentsPanel | Delete agent | Already has `aria-label` (3.6.1) |
| ✕ | CustomAgentsPanel | Close panel | Already has `aria-label` (3.6.1) |
| ▾ | ModelSelector | Dropdown arrow | `aria-hidden="true"` |
| ✓ | ModelSelector | Current item | `aria-hidden="true"` |
| ▶/▼ | ToolExecution | Expand/collapse | `aria-label="Expand/Collapse"` |
| ⏳ | ToolExecution | Running | `aria-label="Running"` |
| 💾 | MessageDisplay | Save diagram | `aria-label="Save diagram"` |
| + | SessionToolbar, CustomAgentsPanel | New session/agent | Already has `aria-label` |
| ? | StatusBar | Help | `aria-label="Help"` |

## Testing Strategy

1. **Automated** — Add accessibility assertions to existing component tests (check aria attributes exist)
2. **Screen reader** — Manual testing with NVDA (Windows) or VoiceOver (Mac)
3. **Keyboard-only** — Navigate entire UI without mouse
4. **VS Code high contrast** — Verify all elements visible

## Priority

Medium. No users have reported accessibility issues, but this is the right thing to do and will improve the extension for all users. The emoji `aria-label` pass (Phase 1) is the highest ROI — small changes, big impact for screen reader users.
