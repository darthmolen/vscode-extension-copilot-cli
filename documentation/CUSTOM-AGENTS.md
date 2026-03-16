# Custom Agents Guide

Custom agents let you define named AI personas with their own system prompts and scoped tool access. Each agent is a simple Markdown file with YAML frontmatter.

## Quick Start

Create a file at `~/.copilot/agents/my-agent.md`:

```markdown
---
name: my-agent
displayName: My Agent
description: Does something useful
tools:
  - view
  - grep
  - glob
---

You are a helpful agent. Your job is to...
```

Open the 🤖 Agents panel in the toolbar — your agent appears immediately.

## File Format

Agent files use Markdown with YAML frontmatter. The frontmatter configures the agent; the body is the system prompt.

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Slug identifier. Lowercase, numbers, hyphens, underscores only. Must match the `@mention` regex (`/^[a-z0-9_-]+$/`). |
| `displayName` | No | Human-readable name shown in the UI. Falls back to `name` if omitted. |
| `description` | No | One-line summary shown in the agent list. |
| `tools` | No | Array of allowed tool names. If omitted, the agent has access to all tools. |

### Example: Researcher Agent

The built-in `researcher` agent demonstrates a read-only agent with web access:

```markdown
---
name: researcher
displayName: Researcher
description: Searches the web, local filesystem, and git history to gather information
tools:
  - view
  - grep
  - glob
  - web_fetch
  - plan_bash_explore
  - fetch_copilot_cli_documentation
---

You are a research agent. Your job is to gather information — not to write code or make changes.

**What you do:**
- Search the local codebase with grep, glob, and view to understand existing patterns
- Fetch web pages, docs, and GitHub issues with web_fetch
- Run read-only git commands (git log, git show, git diff, git blame) via plan_bash_explore to understand history
- Synthesise your findings into a clear, concise report

**What you do NOT do:**
- Edit, create, or delete files (except plan.md if asked to record findings)
- Install packages or run builds
- Make commits or push changes

When done, summarise your findings with: sources consulted, key facts, open questions, and a recommended next step.
```

## Where to Put Agent Files

Agents are loaded from two directories, in priority order:

| Location | Scope | Use Case |
|----------|-------|----------|
| `~/.copilot/agents/` | Global | Personal agents available in every workspace |
| `<workspace>/.copilot/agents/` | Project | Team agents shared via version control |

If two agents have the same `name`, the project-scoped version wins.

## Built-In Agents

Three agents are bundled as hardcoded defaults and are always available:

| Agent | Tools | Purpose |
|-------|-------|---------|
| **Planner** | `view`, `grep`, `glob`, `plan_bash_explore`, `update_work_plan`, `present_plan`, `create_plan_file`, `edit_plan_file`, `task_agent_type_explore` | Read-only exploration; writes `plan.md` |
| **Implementer** | All tools | Reads the plan and executes it |
| **Reviewer** | `view`, `grep`, `glob`, `plan_bash_explore` | Runs tests, reads files, posts review summary |

Built-in agents can be edited (tune their prompts) but are protected from deletion in the UI.

The **Researcher** agent (shown in the example above) ships as a project-scoped file in `.copilot/agents/researcher.md` — it demonstrates how to write a read-only agent with web access.

## Using Agents

### Single-Shot (One Message)

Prefix any message with `@agentname` to route just that message:

```
@researcher how does the SDK handle model switching?
@planner outline a refactor of the auth middleware
@reviewer check the test suite for the new feature
```

The `@mention` takes priority over the sticky agent.

### Sticky Agent (Whole Session)

Use the `/agent` slash command to set an agent for all messages in the session:

```
/agent researcher
```

The 🤖 button in the toolbar turns green while an agent is active. To clear:

```
/agent
```

### Agents Panel

Click the 🤖 button in the toolbar to open the agents panel. From here you can:

- **Browse** all available agents (built-in and custom)
- **Create** a new agent with the form
- **Edit** any agent's name, description, tools, and system prompt
- **Delete** custom agents (click the red ✕)

## Available Tools

When defining the `tools` array, use the tool names from the Copilot CLI. Common tools:

| Tool | Description |
|------|-------------|
| `view` | Read file contents |
| `grep` | Search file contents with regex |
| `glob` | Find files by pattern |
| `write` | Create or overwrite files |
| `edit` | Edit existing files |
| `shell` | Run shell commands |
| `web_fetch` | Fetch web pages |
| `plan_bash_explore` | Run read-only bash commands (git log, etc.) |
| `update_work_plan` | Update plan.md |
| `present_plan` | Present the plan to the user |
| `create_plan_file` | Create a new plan file |
| `edit_plan_file` | Edit a plan file |

If you omit the `tools` field entirely, the agent has access to all available tools (like the Implementer).

## Tips

- **Start restrictive.** Give agents only the tools they need. A reviewer shouldn't have `write` access; a researcher shouldn't have `shell`.
- **Be specific in the system prompt.** Tell the agent what it does AND what it doesn't do. This prevents scope creep.
- **Use project-scoped agents for team conventions.** A `@style-checker` or `@docs-writer` agent in `.copilot/agents/` travels with the repo.
- **Name agents for their role, not their model.** The agent's identity is its prompt and tools, not which LLM backs it.
