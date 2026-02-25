# Roadmap

Feature roadmap for the VS Code Copilot CLI Extension. Items are roughly ordered by priority within each status group.

## Feature Tracker

| Status | Feature | Target | Completed | Version | Planning Doc |
| ------ | ------- | ------ | --------- | ------- | ------------ |
| :white_check_mark: | Paste images into chat | 3.1 | 2026-02-16 | 3.1.0 | — |
| :white_check_mark: | Show AI images in chat (SVG + PNG path resolution) | 3.1 | 2026-02-16 | 3.1.0 | [FEATURE-images-from-AI.md](../backlog/FEATURE-images-from-AI.md) |
| :white_check_mark: | Mermaid diagram rendering | 3.2 | 2026-02-23 | 3.2.0 | [FEATURE-mermaid-diagram-rendering.md](../backlog/FEATURE-mermaid-diagram-rendering.md) |
| :white_check_mark: | Prompt history (up/down arrow cycling, last 20) | 3.2 | 2026-02-23 | 3.2.0 | — |
| :white_check_mark: | Mid-session model switching | 3.3 | 2026-02-24 | 3.3.0 | [model-selection-dropdown.md](../backlog/model-selection-dropdown.md) |
| :white_check_mark: | Show when a message is queued, awaiting AI notice | 3.3 | 2026-02-24 | 3.3.0 | — |
| :construction: | Slash command IntelliSense / auto-complete | 3.4 | — | — | — |
| :construction: | MCP server management UI | 3.4 | — | — | [mcp-server-management-ui.md](../backlog/mcp-server-management-ui.md) |
| :construction: | Multi-session support (ACE-FCA workflows) | 3.4 | — | — | — |
| :construction: | Multiple agents — separate virtual windows (tmux-like) | 3.5 | — | — | — |
| :construction: | User hook support (custom pre/post hooks) | 3.5 | — | — | — |
| :construction: | Granular permission handler (operation-level policy) | 4.1 | — | — | [granular-permissions.md](../backlog/granular-permissions.md) |

## Bug Fix Tracker

| Status | Fix | Target | Completed | Version |
| ------ | --- | ------ | --------- | ------- |
| :white_check_mark: | Long URLs overflow message bubbles | 3.1 | 2026-02-16 | 3.1.0 |
| :white_check_mark: | Tool groups collapse when new messages arrive | 3.1 | 2026-02-16 | 3.1.0 |
| :white_check_mark: | Individual tool boxes can't be collapsed | 3.1 | 2026-02-16 | 3.1.0 |
| :white_check_mark: | Compaction end should reset metrics | 3.3 | 2026-02-24 | 3.3.0 |

## Infrastructure Tracker

| Status | Item | Target | Completed | Version | Planning Doc |
| ------ | ---- | ------ | --------- | ------- | ------------ |
| :white_check_mark: | esbuild watch for webview assets | — | — | — | [ESBUILD-WATCH-WEBVIEW-ASSETS.md](../backlog/ESBUILD-WATCH-WEBVIEW-ASSETS.md) |
| :white_check_mark: | Upgrade to @github/copilot-sdk 0.1.26 (breaking: required permission handler) | 3.3 | 2026-02-24 | 3.3.0 | [RELEASE-0.1.23.md](../../documentation/copilot-sdk/RELEASE-0.1.23.md) |
| :construction: | VS Code API opportunities audit | 3.3 | — | — | [02-vscode-api-opportunities.md](../backlog/02-vscode-api-opportunities.md) |
| :construction: | Event architecture transition (4.0) | 4.0 | — | — | [event-architecture-transition.md](../4.0/event-architecture-transition.md) |

## Legend

| Icon | Meaning |
| ---- | ------- |
| :white_check_mark: | Completed |
| :construction: | Planned / In Progress |
