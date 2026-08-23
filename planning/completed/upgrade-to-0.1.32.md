# Upgrade to @github/copilot-sdk 0.1.32

**Status**: node_modules already updated to 0.1.32 (2026-03-12). Extension code has NOT been updated yet.
**Blocked**: Fleet command integration deferred until this upgrade is complete.
**Research source**: `research/copilot-sdk/` (pulled HEAD 2026-03-12), spike results in `planning/spikes/fleet-command/`.

---

## What Changed (0.1.26 → 0.1.32)

### 1. `customAgents` in `SessionConfig` / `ResumeSessionConfig`

Define named agents with scoped tools, system prompts, and MCP servers. The CLI runtime auto-selects them as sub-agents based on user intent, or you select them explicitly.

```typescript
interface CustomAgentConfig {
    name: string;            // unique identifier
    displayName?: string;    // shown in subagent.* events
    description?: string;    // runtime uses this for intent matching
    tools?: string[] | null; // null = all tools
    prompt: string;          // system prompt for this agent
    mcpServers?: Record<string, MCPServerConfig>;
    infer?: boolean;         // default true — allow runtime to auto-select
}
```

Added to: `SessionConfig.customAgents`, `ResumeSessionConfig.customAgents`

### 2. `agent` parameter in `SessionConfig` / `ResumeSessionConfig`

Pre-select which custom agent is active at session start. Equivalent to calling `rpc.agent.select()` after creation but avoids the extra round-trip and ensures the agent is active before the first message.

```typescript
const session = await client.createSession({
    customAgents: [...],
    agent: "planner",  // starts in planner mode
});
```

### 3. `session.rpc.agent.*` — programmatic agent switching

```typescript
await session.rpc.agent.list()            // → { agents: [{name, displayName, description}] }
await session.rpc.agent.getCurrent()      // → { agent: {...} | null }
await session.rpc.agent.select({ name })  // → { agent: {...} }
await session.rpc.agent.deselect()        // → {} (back to default agent)
```

### 4. `session.rpc.compaction.compact()`

Manual compaction trigger. Separate from the automatic `infiniteSessions` background compaction.

```typescript
const result = await session.rpc.compaction.compact();
// → { success: boolean, tokensRemoved: number, messagesRemoved: number }
```

### 5. New session events

| Event | Data | Notes |
|-------|------|-------|
| `session.task_complete` | `{ summary?: string }` | Agent completed its task |
| `subagent.deselected` | `{}` | Runtime returned from sub-agent to parent |
| `assistant.streaming_delta` | `{ totalResponseSizeBytes: number }` | Ephemeral, requires `streaming: true` in SessionConfig |

### 6. `onEvent` in `SessionConfig`

Early event handler registered before the session.create RPC fires. Ensures events emitted during session creation (e.g. `session.start`) are not missed. We currently wire `setupSessionEventHandlers()` AFTER `createSession()` returns — that's a race condition this fixes.

```typescript
const session = await client.createSession({
    onEvent: (event) => { /* fires before session.create returns */ },
    onPermissionRequest: approveAll,
});
```

### 7. `streaming` option in `SessionConfig`

When `true`, enables `assistant.message_delta` and `assistant.reasoning_delta` ephemeral events for real-time response streaming. Currently unused in extension; relevant for streaming UI.

---

## Immediate Integration Tasks

These are mechanical — no design decisions required. Do these first to unblock fleet.

### Task 1: Handle new events in `setupSessionEventHandlers()`

**File**: `src/sdkSessionManager.ts`

Currently `subagent.selected`, `subagent.started`, `subagent.completed`, `subagent.failed` are logged but not forwarded to the webview. With fleet coming, these need to be emitted. But first, just add the new event types to the existing handler so they don't fall through to `default`:

```typescript
case 'subagent.deselected':
    this.logger.info(`[SDK Event] ${event.type}: ${JSON.stringify(event.data)}`);
    break;

case 'session.task_complete':
    this.logger.info(`[SDK Event] task_complete: ${event.data?.summary ?? '(no summary)'}`);
    // TODO: emit to webview when fleet is implemented
    break;
```

### Task 2: Fix early-event race condition with `onEvent`

**File**: `src/sdkSessionManager.ts`

`createSessionWithModelFallback()` calls `createSession(config)` then `setupSessionEventHandlers()` after it resolves. Any events emitted during creation are lost. Fix:

```typescript
// In createSessionWithModelFallback, add onEvent to the config:
const configWithEarlyHandler = {
    ...config,
    onEvent: (event: any) => this.handleSDKEvent(event),
};
const session = await withTimeout(
    this.client.createSession(configWithEarlyHandler),
    SDK_TIMEOUT_MS,
    'createSession'
);
// setupSessionEventHandlers() still registers the persistent listener,
// but onEvent catches anything fired during creation.
```

### Task 3: Expose `rpc.compaction.compact()` to extension commands

**File**: `src/sdkSessionManager.ts`, `src/extension.ts`

1. Add a `compactSession()` method and wire it to a VS Code command. Useful manually and required before long fleet runs.

```typescript
async compactSession(): Promise<{ tokensRemoved: number; messagesRemoved: number } | null> {
    if (!this.session) return null;
    try {
        const result = await this.session.rpc.compaction.compact();
        this.logger.info(`[Compaction] Freed ${result.tokensRemoved} tokens, removed ${result.messagesRemoved} messages`);
        return result;
    } catch (err) {
        this.logger.error('[Compaction] Failed', err);
        return null;
    }
}
```

2. Add a /compact command and all that entails, including adding it to the panel that shows up when you type slash. This should invoke the vs code command.

---

## Bigger Opportunities

### Opportunity A: Expose `session.task_complete` in the UI

This event fires when an agent completes its task and optionally includes a `summary`. It's the natural moment to:
- Show a "task complete" indicator in the UI
- Display the summary as a collapsible "what I did" callout

Currently `session.task_complete` falls through to the `default` log-only case in `setupSessionEventHandlers`.

### Opportunity B: Streaming Deltas for Responsive UI

Setting `streaming: true` in `SessionConfig` enables `assistant.message_delta` and `assistant.reasoning_delta` events. This would let the webview render assistant responses as they stream in (character by character) instead of waiting for the full `assistant.message` event. Higher priority for long fleet synthesis responses where users currently see nothing for 30+ seconds.

### Opportunity C: Reasoning when turned on should break up the tools

Currently if you enable reasoning, they show up below the large tool block that is being created. The only thing that breaks that block up is an agent reply. Reasoning text (if enabled) should also break up these tool executions.

---

## Suggested Work Order

1. **Mechanical integration** (unblocks fleet):
   - Handle `subagent.deselected` and `session.task_complete` in event handler
   - Fix early-event race with `onEvent`
   - Add `compactSession()` method + command

2. **Prepping for fleet command** (needs task 1):
   - Wire up `rpc.fleet.start()` fire-and-forget
   - Forward `subagent.*` events to webview

3. **Streaming deltas**
   - Enable `streaming: true`
   - Handle `assistant.message_delta` in webview for real-time rendering
