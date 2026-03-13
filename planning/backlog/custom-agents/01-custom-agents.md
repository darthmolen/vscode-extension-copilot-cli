# Custom Agents — UI for Managing Agent Definitions

## Problem / Opportunity

The SDK's `customAgents` feature lets sessions define named agents with scoped tools, system prompts, and descriptions. Right now, the only way to use custom agents is to hardcode them in `sdkSessionManager.ts`. We want users to be able to create, edit, and delete their own agents — and ship three built-in agents (Planner, Implementer, Reviewer) out of the box.

Custom agents are a prerequisite for:
- The Plan / Implement / Review workflow (`agent-workflows.md`)
- Fleet command using meaningful subagent definitions instead of SDK defaults (`02-fleet-command.md`)

## Proposed Solution

### Built-in Agents (Shipped by Default)

Three agents from `agent-workflows.md` are pre-loaded and non-deletable (but editable):

| Name | Display Name | Role |
|------|-------------|------|
| `planner` | Planner | Read-only exploration; writes plan.md |
| `implementer` | Implementer | Executes plan; edits source files |
| `reviewer` | Reviewer | Reads and runs tests; posts summary |

These are not tied to any workflow by default — they are just available as agents the user can select or reference.

### Entry Point: Toolbar Icon

A new icon is added to `SessionToolbar`, to the right of the existing "View Plan" (📋) button.

```
[●]  Copilot CLI  [Session: ▼ abc123]  [+]  [📋]  [🤖]
```

Clicking the icon toggles the Custom Agents pane open/closed.

### Custom Agents Pane

The pane **pushes the chat area down** — it is not a modal or overlay. It appears between the toolbar and the messages area, collapsing back to zero height when closed.

The pane has two views: **List** and **Details**.

#### List View (default)

```
┌─ Custom Agents ─────────────────────────── [+] [✕] ┐
│  Planner        Read-only exploration          ✏️ 🗑  │
│  Implementer    Executes plan; edits files     ✏️ 🗑  │
│  Reviewer       Runs tests; posts summary      ✏️ 🗑  │
│  My Agent       Custom system prompt           ✏️ 🗑  │
└──────────────────────────────────────────────────────┘
```

- Each row shows: name, description snippet, edit icon, delete icon
- Built-in agents show edit icon only (no delete)
- `[+]` button transitions to Details view (blank form)
- `[✕]` closes the pane

#### Details View (add / edit)

Slides in over the list (obscures it). Fields:

- **Name** — unique identifier (slug, used in SDK `customAgents`)
- **Display Name** — shown in the UI
- **Description** — used by the runtime for intent matching; shown in list
- **System Prompt** — multiline textarea
- **Tools** — multi-select or comma-separated list (null = all tools)

Actions: **Save** / **Cancel** (returns to list)

## Persistence

Agent definitions are stored in VS Code workspace settings (`copilotCli.customAgents`) so they persist across restarts and are workspace-scoped. Built-in agents live in extension defaults and are merged at runtime.

## Rough Scope

### New Files
- `src/webview/app/components/CustomAgentsPanel/CustomAgentsPanel.js` — pane component (list + details views)
- `src/extension/services/CustomAgentsService.ts` — read/write agents from workspace config

### Modified Files
- `src/shared/messages.ts` — RPC messages: `getCustomAgents`, `saveCustomAgent`, `deleteCustomAgent`, `customAgentsChanged`
- `src/shared/models.ts` — `CustomAgentDefinition` interface
- `src/extension/rpc/ExtensionRpcRouter.ts` — wire agent CRUD RPC methods
- `src/chatViewProvider.ts` — add `<div id="custom-agents-mount">` between toolbar and messages; wire toolbar icon click
- `src/webview/main.js` — instantiate `CustomAgentsPanel`; wire toolbar icon toggle
- `src/webview/app/components/SessionToolbar/SessionToolbar.js` — add agents icon button
- `src/sdkSessionManager.ts` — load `customAgents` from `CustomAgentsService` when creating sessions
- `esbuild.js` — copy `CustomAgentsPanel.js` to dist

### Version
Minor bump (new feature/capability).

## Open Questions

- Should built-in agents be editable or fully locked? (Current lean: editable but not deletable — lets power users tune prompts)
- Should the Tools field be a free-text input or a constrained multi-select from known SDK tool names?
- Do we want an "active agents" indicator showing which agents are registered in the current session?
