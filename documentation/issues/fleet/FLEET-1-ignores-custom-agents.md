# FLEET: `fleet.start()` ignores `customAgents` — always dispatches built-in agent types

**Repo:** `github/copilot-sdk` (Node.js SDK)
**Severity:** High
**Affects:** `@github/copilot-sdk` Node.js ≥ 0.1.x

---

## Summary

When a session is created with `customAgents` defined, calling `rpc.fleet.start()` **ignores the registered custom agents entirely**. Sub-agents are dispatched as built-in types (`explore`, `general-purpose`, etc.), never as the custom agents registered in the session config.

This makes fleet unusable for any workflow requiring custom agent personas, restricted tool sets, or domain-specific system prompts.

---

## Steps to Reproduce

```javascript
import { CopilotClient } from '@github/copilot-sdk';

const client = new CopilotClient();
await client.connect();

const session = await client.createSession({
    onPermissionRequest: async () => ({ approved: true }),
    customAgents: [{
        name: 'my-researcher',
        displayName: 'My Researcher',
        description: 'A custom agent that only reads files and searches the web.',
        prompt: 'You are a focused research agent. Only read files and search the web. Do not modify anything.',
        tools: ['view', 'grep', 'web_fetch'],
        infer: false,
    }],
});

// Verify: custom agent IS registered
const agentList = await session.rpc.agent.list();
console.log(agentList.agents.map(a => a.name));
// → ["my-researcher", "general-purpose", "explore", ...]  ✓ agent is registered

// Start fleet
await session.rpc.fleet.start({
    prompt: 'Research how grep and view are used in this codebase'
});

// Observe subagent.started events:
session.on('subagent.started', (data) => {
    console.log(data.agentName);
    // → "explore"      ← always a built-in, never "my-researcher"
    // → "explore"
});
```

---

## Observed Behaviour

Fleet dispatches built-in `explore` agents regardless of `customAgents` config.

From spike-06 output (`planning/spikes/fleet-command/results/spike-06-output.json`):

```json
{
  "q1_fleetDispatchesCustomAgents": {
    "question": "Does rpc.fleet.start() dispatch custom agents defined in customAgents?",
    "agentNamesObserved": ["explore", "explore"],
    "subagentCount": 2,
    "answer": "PARTIAL — subagents dispatched but with built-in names, not custom names"
  }
}
```

The custom agent (`spike06-researcher`) was confirmed present via `rpc.agent.list()` immediately before the fleet call.

---

## Expected Behaviour

One of the following:

1. `fleet.start()` uses custom agents from `customAgents` config when they are registered
2. `fleet.start()` accepts an explicit `agentNames: string[]` parameter to select which agents to dispatch
3. Documentation clarifies that fleet only uses built-in agent types and custom agents are not supported in fleet context

---

## Impact

- Custom agent tool restrictions (`customAgents[n].tools`) cannot be applied to fleet workers
- Custom system prompts (`customAgents[n].prompt`) are ignored during fleet
- Fleet workers always get unrestricted built-in agent capabilities regardless of session config
- There is no way to influence what agent type fleet dispatches

---

## Environment

- `@github/copilot-sdk` Node.js (version from package-lock.json)
- CLI: `copilot` 
- Spike date: 2026-03-17
