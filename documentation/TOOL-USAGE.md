# Tool Usage in This Extension

This document explains how tool access is controlled — both in the planning session and for custom agents. Two mechanisms exist. Understanding how they interact (and how agent selection ties them together) is essential for working with the SDK correctly.

---

## The Three Parameters

```typescript
await client.createSession({
    tools: [...],           // register custom tool handler implementations
    availableTools: [...],  // session-level hard whitelist (optional)
    customAgents: [...],    // define named agent personas with per-agent tool scopes
});
```

### `tools` — Register Custom Handler Implementations

This is where you define tools that don't exist in the SDK. You provide a name, a JSON schema, and a handler function. Registering a tool here makes the SDK able to execute it when the CLI backend requests it — but does not, by itself, restrict or grant anything.

```typescript
tools: [
    defineTool({
        name: 'plan_bash_explore',
        description: 'Read-only bash for exploration',
        parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
        handler: async ({ command }) => { /* ... */ }
    })
]
```

### `availableTools` — Session-Level Hard Whitelist

An optional array of tool names the CLI backend will advertise to the model. Any tool not in this list — built-in or custom — is invisible to the model for the lifetime of the session. Enforcement is server-side (CLI backend), not in the Node.js SDK client.

If omitted, no session-level restriction applies and the model can see all tools.

```typescript
availableTools: ['view', 'grep', 'glob', 'plan_bash_explore']
// model can only see these four tools — bash, edit, create, etc. are hidden
```

**Custom tools must be listed here too.** Registering a tool via `tools:` does not automatically whitelist it. If `availableTools` is set, a custom tool name must appear in it or the model will never see it.

**Updating after session creation:** `availableTools` can be changed on a live session without destroying it via `client.resumeSession(sessionId, { availableTools: [...] })`.

**Built-in name collision:** If a custom tool shares a name with a built-in SDK tool, set `overridesBuiltInTool: true` in the tool definition or the CLI backend will return an error.

### `customAgents` — Named Agent Personas with Tool Scopes

An array of agent definitions, each with a name, system prompt, and optional `tools` array. These are registered with the CLI backend at session creation time.

```typescript
customAgents: [
    { name: 'reviewer', prompt: 'You review code...', tools: ['view', 'grep', 'glob'] },
    { name: 'implementer', prompt: 'You implement...', tools: null },  // null = inherit session
]
```

**Defining an agent is not the same as selecting one.** A registered agent has no effect until explicitly activated.

---

## Agent Selection: The Missing Piece

The most important thing to understand: **`customAgents` registration and agent activation are separate steps.**

Creating a session with `customAgents` defined does not make any agent active. The model operates under the session's `availableTools` (or sees all tools if none is set) until an agent is explicitly selected via RPC:

```typescript
await session.rpc.agent.select({ name: 'reviewer' });
```

Only after this call does the agent's `tools` array take effect.

### What the model sees, by state

| State | Model sees |
|-------|-----------|
| No agent selected, no `availableTools` | All tools |
| No agent selected, `availableTools` set | Session whitelist only |
| Agent selected, `agent.tools = null` | Same as no agent selected (inherits session) |
| Agent selected, `agent.tools = [...]` | Agent's tools array — intersection with session `availableTools` |

### The intersection rule (when an agent is selected with a tools array)

```
effective tools = agent.tools ∩ availableTools  (if availableTools is set)
effective tools = agent.tools                    (if no availableTools)
```

Plus: CLI runtime tools (`skill`, `report_intent`) are always injected by the backend regardless of either restriction.

### Deselecting / one-shot

```typescript
await session.rpc.agent.deselect();           // clear agent, revert to session tools
```

For one-shot per-message agent switching (as used by `@agent` mentions), select before `sendAndWait` and restore in a `finally` block:

```typescript
const prevAgent = this._sessionAgent;
await session.rpc.agent.select({ name: agentName });
try {
    await session.sendAndWait({ prompt });
} finally {
    prevAgent
        ? await session.rpc.agent.select({ name: prevAgent })
        : await session.rpc.agent.deselect();
}
```

---

## The Merge Requirement

When an agent has a restricted `tools` array, it only sees what's explicitly listed — including custom tools. **Custom tools are not automatically available to a restricted agent even though they're registered in the session.**

If you want a restricted agent to call a custom tool, you must include the custom tool name in the agent's `tools` array:

```typescript
// ❌ reviewer cannot call plan_bash_explore — not in its tools array
{ name: 'reviewer', tools: ['view', 'grep'] }

// ✅ reviewer can call plan_bash_explore
{ name: 'reviewer', tools: ['view', 'grep', 'plan_bash_explore'] }
```

The session's `tools:` parameter only provides the handler implementation. The agent's `tools:` array is what controls visibility. Both must include the name.

---

## How This Extension Uses These Mechanisms

### Planning Session

Plan mode creates a **separate session** (`planSession`) alongside the work session. The plan session has a strict `availableTools` whitelist — this is the primary enforcement mechanism.

```typescript
// sdkSessionManager.ts
this.planSession = await client.createSession({
    tools: this.planModeToolsService.getTools(),       // 6 custom handlers
    availableTools: this.planModeToolsService.getAvailableToolNames(),  // 12-item whitelist
    customAgents: this.customAgentsService.toSDKAgents(),
});
```

The 12-item whitelist is a blend of custom tools (which need handlers) and safe built-in tools (which don't):

| Type | Tools |
|------|-------|
| Custom handlers (need `tools:`) | `plan_bash_explore`, `task_agent_type_explore`, `edit_plan_file`, `create_plan_file`, `update_work_plan`, `present_plan` |
| Built-in SDK tools (no handler needed) | `view`, `grep`, `glob`, `web_fetch`, `fetch_copilot_cli_documentation`, `report_intent` |

The custom tool handlers have their own enforcement layer too — `plan_bash_explore` has an explicit allowlist/blocklist of shell commands at the handler level. This is defense-in-depth: the session whitelist prevents the model from knowing about `bash`; the handler logic prevents abuse even if somehow called.

Plan mode does not rely on `customAgents[n].tools` for restriction — the session `availableTools` is the hard gate.

### Custom Agents (Planner, Reviewer, Implementer)

Custom agents are registered at work session creation time and activated on demand via `rpc.agent.select`. The work session has no `availableTools` restriction, so per-agent tool scoping is entirely controlled by each agent's `tools` array — which only takes effect when that agent is selected.

Built-in agent tool scopes:

| Agent | `tools` | Notes |
|-------|---------|-------|
| `planner` | `view`, `grep`, `glob`, `plan_bash_explore`, `update_work_plan`, `present_plan`, `create_plan_file`, `edit_plan_file`, `task_agent_type_explore` | Exploration + plan writing. Custom tools explicitly merged in. |
| `reviewer` | `view`, `grep`, `glob`, `plan_bash_explore` | Read-only + safe bash. |
| `implementer` | `null` | Inherits full session — no restriction. |

Note `planner` and `reviewer` include `plan_bash_explore` explicitly — without this, they couldn't call it even though it's a registered custom tool.

User-defined agents follow the same pattern. An agent file with:
```yaml
tools:
  - view
  - grep
  - plan_bash_explore
```
...will only see those three tools when selected. Any custom tool it needs must be listed.

### Why Plan Mode Uses a Separate Session (Not Just Agent Tools)

Agent tool restriction only applies when that agent is selected. If a user deselects the agent mid-session, or if an agent calls `rpc.agent.deselect`, the model would revert to seeing all work session tools — including `bash`, `edit`, `create`, etc.

Plan mode uses a dedicated session with `availableTools` because:
- The restriction must hold for the entire session regardless of agent state
- Security-sensitive: cannot allow bash/edit/commit to slip through if agent state changes
- Cleaner session history isolation between planning and implementation

---

## Common Mistakes

**Custom tool not visible to a restricted agent**  
Add the custom tool name to `agent[n].tools`. Registration via `tools:` is not enough — restricted agents only see what's in their `tools` array.

**`availableTools` set but custom tool still unreachable**  
Add the custom tool name to `availableTools`. It must appear in both `availableTools` and the handler's registration in `tools:`.

**Agent defined but has no effect**  
Call `session.rpc.agent.select({ name })` after session creation. Defining an agent in `customAgents` does not activate it.

**`agent.tools = null` unexpectedly sees everything**  
`null` means "inherit the session" — the agent sees whatever `availableTools` allows (or all tools if not set). Use an explicit array to restrict.

**Trying to restrict two agents differently in one session**  
Both agents are in the same session and share the same `availableTools`. You can restrict each agent's `tools` array differently, and the intersection rule applies when each is selected. But the session `availableTools` is a ceiling for both. For completely separate tool ceilings, use separate sessions.

---

## Related Files

| File | Purpose |
|------|---------|
| `src/sdkSessionManager.ts` | Session creation, agent selection, one-shot logic |
| `src/extension/services/PlanModeToolsService.ts` | Plan mode custom tool definitions and whitelist |
| `src/extension/services/CustomAgentsService.ts` | Agent loading, built-in agents, `toSDKAgents()` |
| `documentation/CUSTOM-AGENTS.md` | End-user guide: agent file format, usage |
| `research/copilot-sdk/nodejs/src/types.ts` | `SessionConfig`, `CustomAgentConfig`, `MessageOptions` type definitions |
| `planning/spikes/tool-intersection-enforcement/` | Spike code and results verifying intersection behaviour |
