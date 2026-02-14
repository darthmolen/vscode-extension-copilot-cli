# ADR-005: Slash Commands as Parallel Path to UI Controls

**Status**: Accepted
**Date**: 2026-02-14
**Driver**: Plan mode UI broke during v2.0→v3.0 refactoring; users had no fallback to exit or advance workflows.

## Context

During the v2.0→v3.0 component refactoring, the plan mode UI buttons temporarily broke. Users who entered plan mode had no way to accept, reject, or exit — they were stuck. The only recovery was restarting the session.

This exposed a fundamental fragility: every workflow action was reachable through exactly one UI path. A single bug in a button, event handler, or component mount could leave users stranded mid-workflow.

## Decision

**Every user-facing action must be reachable via both a UI control (button, toggle, dropdown) AND a slash command.**

The slash command path operates through a separate code path (CommandParser → EventBus → handler) than the UI control path (DOM event → component method → EventBus → handler). They converge only at the EventBus/handler layer.

### Current Dual-Path Actions

| Action | UI Control | Slash Command |
| ------ | ---------- | ------------- |
| Enter plan mode | SessionToolbar toggle | `/plan` |
| Exit plan mode | SessionToolbar toggle | `/exit` |
| Accept plan | AcceptanceControls button | `/accept` |
| Reject plan | AcceptanceControls button | `/reject` |
| View plan content | (n/a) | `/review` |
| Open diff viewer | Diff button on tool cards | `/diff` |
| Show MCP config | (n/a) | `/mcp` |
| Show usage metrics | StatusBar display | `/usage` |
| Command reference | StatusBar `?` icon | `/help` |
| Change model | (future dropdown) | `/model` |

### Principle

If a published build has a UI bug that hides or breaks a button, users can still type the equivalent slash command to unblock themselves. This is especially critical for state-changing actions like plan mode transitions where being stuck means losing work.

## Consequences

**Positive:**

- Users are never stranded by a single UI bug
- Slash commands serve as both power-user shortcuts and emergency fallbacks
- Forces clean separation between "what to do" (EventBus event) and "how to trigger it" (UI vs command)
- Easier to test — each path can be validated independently

**Negative:**

- Every new workflow action requires implementing both a UI control and a slash command
- Two code paths to maintain per action (though they share handlers)
- Must keep command list and UI controls in sync

## Notes

- The 25 "not-supported" CLI commands (e.g., `/clear`, `/new`) are excluded because they map to VS Code-native UI (file explorer, session dropdown, etc.) that is outside our control and unlikely to break simultaneously.
- Discoverability of slash commands is addressed by the SlashCommandPanel (`/` trigger) and StatusBar help icon (`?`), so users can find commands without prior knowledge.
