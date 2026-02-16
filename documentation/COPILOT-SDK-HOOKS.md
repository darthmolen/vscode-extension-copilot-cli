# Copilot SDK Hooks Reference

**SDK Version**: 0.1.20+ (hooks introduced in [v0.1.20](https://github.com/github/copilot-sdk/releases/tag/v0.1.20), Jan 30 2026)
**Our Version**: 0.1.22
**Source**: [github.com/github/copilot-sdk](https://github.com/github/copilot-sdk) | [Hooks Docs](https://github.com/github/copilot-sdk/tree/main/docs/hooks)

## What Are Hooks?

Hooks are **bidirectional interceptors** for session lifecycle events. Unlike event listeners (`session.on()`), which are read-only observers that fire *after* things happen, hooks fire *before or after* operations and can **modify behavior** — allowing/denying tools, changing arguments, transforming results.

| Aspect | Event Listeners | Hooks |
| ------ | --------------- | ----- |
| Registration | `session.on(event, handler)` | `SessionConfig.hooks` at creation |
| Timing | After events occur | Before/after operations |
| Direction | Read-only | Bidirectional (can modify) |
| Tool control | Cannot intercept | Can allow/deny/modify |
| Error handling | Observe only | Can retry/skip/abort |

## Registration

Pass hooks in `SessionConfig` when creating or resuming a session:

```typescript
import type { SessionHooks } from '@github/copilot-sdk';

const hooks: SessionHooks = {
    onPreToolUse: async (input) => { /* ... */ },
    onPostToolUse: async (input) => { /* ... */ },
    onUserPromptSubmitted: async (input) => { /* ... */ },
    onSessionStart: async (input) => { /* ... */ },
    onSessionEnd: async (input) => { /* ... */ },
    onErrorOccurred: async (input) => { /* ... */ },
};

// Works with both create and resume
const session = await client.createSession({ ...config, hooks });
const session = await client.resumeSession({ ...config, hooks });
```

All hooks are optional. Return `null` or `undefined` to take no action.

## Invocation Context

Every hook receives two parameters:

```typescript
(input: HookSpecificInput, invocation: { sessionId: string }) => Promise<HookOutput | void>
```

All hook inputs extend `BaseHookInput`:

```typescript
interface BaseHookInput {
    timestamp: number;  // Unix timestamp
    cwd: string;        // Current working directory
}
```

## Hook Reference

### onPreToolUse

Fires **before** a tool executes. Use for permission control, argument validation, file snapshots.

[Upstream docs](https://github.com/github/copilot-sdk/blob/main/docs/hooks/pre-tool-use.md)

**Input**:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `toolName` | `string` | Name of the tool (`"edit"`, `"create"`, `"bash"`, etc.) |
| `toolArgs` | `unknown` | Arguments passed to the tool |

**Output**:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `permissionDecision` | `"allow"` \| `"deny"` \| `"ask"` | Whether to permit execution |
| `permissionDecisionReason` | `string` | Explanation (shown to user for deny/ask) |
| `modifiedArgs` | `unknown` | Modified arguments to pass instead |
| `additionalContext` | `string` | Context injected into conversation |
| `suppressOutput` | `boolean` | If true, tool output hidden from conversation |

**Example**:

```typescript
onPreToolUse: async (input) => {
    if (input.toolName === 'edit') {
        const filePath = (input.toolArgs as any)?.path;
        console.log(`About to edit: ${filePath}`);
    }
    return { permissionDecision: 'allow' };
}
```

---

### onPostToolUse

Fires **after** a tool executes. Use for result transformation, logging, auditing.

[Upstream docs](https://github.com/github/copilot-sdk/blob/main/docs/hooks/post-tool-use.md)

**Input**:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `toolName` | `string` | Name of the tool that executed |
| `toolArgs` | `unknown` | Arguments that were passed |
| `toolResult` | `ToolResultObject` | Result returned by the tool |

**Output**:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `modifiedResult` | `ToolResultObject` | Modified result to use instead |
| `additionalContext` | `string` | Context injected into conversation |
| `suppressOutput` | `boolean` | If true, result hidden from conversation |

**Example**:

```typescript
onPostToolUse: async (input) => {
    if (input.toolName === 'bash' && input.toolResult?.exitCode !== 0) {
        return {
            additionalContext: 'Command failed. Check dependencies.',
        };
    }
    return null;
}
```

---

### onUserPromptSubmitted

Fires when the user sends a message. Use for prompt modification, context injection, filtering.

[Upstream docs](https://github.com/github/copilot-sdk/blob/main/docs/hooks/user-prompt-submitted.md)

**Input**:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `prompt` | `string` | The user's submitted message |

**Output**:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `modifiedPrompt` | `string` | Modified prompt to use instead |
| `additionalContext` | `string` | Context injected into conversation |
| `suppressOutput` | `boolean` | If true, suppress the assistant's response |

**Example**:

```typescript
onUserPromptSubmitted: async (input) => {
    // Expand shorthand commands
    if (input.prompt.startsWith('/fix')) {
        return { modifiedPrompt: `Fix the errors: ${input.prompt.slice(4)}` };
    }
    return null;
}
```

---

### onSessionStart

Fires when a session begins (new, resumed, or startup).

[Upstream docs](https://github.com/github/copilot-sdk/blob/main/docs/hooks/session-lifecycle.md#session-start)

**Input**:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `source` | `"startup"` \| `"resume"` \| `"new"` | How the session was started |
| `initialPrompt` | `string \| undefined` | Initial prompt if provided |

**Output**:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `additionalContext` | `string` | Context added at session start |
| `modifiedConfig` | `Record<string, unknown>` | Override session configuration |

**Example**:

```typescript
onSessionStart: async (input, invocation) => {
    console.log(`Session ${invocation.sessionId} started (${input.source})`);
    return {
        additionalContext: 'This is a TypeScript VS Code extension project.',
    };
}
```

---

### onSessionEnd

Fires when a session ends.

[Upstream docs](https://github.com/github/copilot-sdk/blob/main/docs/hooks/session-lifecycle.md#session-end)

**Input**:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `reason` | `"complete"` \| `"error"` \| `"abort"` \| `"timeout"` \| `"user_exit"` | Why the session ended |
| `finalMessage` | `string \| undefined` | Last message from the session |
| `error` | `string \| undefined` | Error message if ended due to error |

**Output**:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `suppressOutput` | `boolean` | Suppress final session output |
| `cleanupActions` | `string[]` | Cleanup actions to perform |
| `sessionSummary` | `string` | Summary for logging/analytics |

**Example**:

```typescript
onSessionEnd: async (input, invocation) => {
    console.log(`Session ${invocation.sessionId} ended: ${input.reason}`);
    return null;
}
```

---

### onErrorOccurred

Fires when errors occur during session execution.

[Upstream docs](https://github.com/github/copilot-sdk/blob/main/docs/hooks/error-handling.md)

**Input**:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `error` | `string` | Error message |
| `errorContext` | `"model_call"` \| `"tool_execution"` \| `"system"` \| `"user_input"` | Where the error occurred |
| `recoverable` | `boolean` | Whether the error can be recovered from |

**Output**:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `suppressOutput` | `boolean` | Don't show error to user |
| `errorHandling` | `"retry"` \| `"skip"` \| `"abort"` | How to handle the error |
| `retryCount` | `number` | Retry count (if `errorHandling` is `"retry"`) |
| `userNotification` | `string` | Custom message to show the user |

**Example**:

```typescript
onErrorOccurred: async (input) => {
    if (input.errorContext === 'model_call' && input.error.includes('rate')) {
        return { errorHandling: 'retry', retryCount: 3 };
    }
    return null;
}
```

## Limitations

1. **No `toolCallId` in hook inputs.** `onPreToolUse` and `onPostToolUse` provide `toolName` and `toolArgs` but not the tool call identifier. To correlate hooks with event listeners (which have `toolCallId`), use the file path or other args as a bridge key.

2. **Errors are swallowed.** If a hook throws, the SDK catches the error and returns `undefined`. The hook failure does not crash the SDK or block tool execution. (See `session.ts` lines 466-470.)

3. **Hooks are async-capable** but run synchronously in the pipeline. The SDK `await`s the hook before proceeding. Keep hooks fast.

4. **No stream/delta hooks.** Hooks only fire for complete operations (pre/post tool, full messages). For streaming deltas, continue using event listeners (`assistant.message_delta`).

5. **Hook registration is per-session.** Hooks are set via `SessionConfig` and stored on the session instance. To change hooks, create a new session.

## Our Planned Usage

### v3.0.1: `onPreToolUse` for File Snapshots

The file-diff feature has a race condition: `tool.execution_start` fires after the SDK has already started modifying files, so snapshots capture empty content.

Fix: Use `onPreToolUse` to capture snapshots before tool execution, then correlate with `toolCallId` when `tool.execution_start` fires.

See [planning/bug-file-diff.md](../planning/bug-file-diff.md) for full analysis.

### Future: User Hook Support

Expose hooks to users via VS Code settings, allowing custom pre/post-tool behavior, prompt modification, and error handling without modifying extension code.

## TypeScript Types

All types are exported from `@github/copilot-sdk`:

```typescript
import type {
    SessionHooks,
    PreToolUseHandler,
    PreToolUseHookInput,
    PreToolUseHookOutput,
    PostToolUseHandler,
    PostToolUseHookInput,
    PostToolUseHookOutput,
    UserPromptSubmittedHandler,
    UserPromptSubmittedHookInput,
    UserPromptSubmittedHookOutput,
    SessionStartHandler,
    SessionStartHookInput,
    SessionStartHookOutput,
    SessionEndHandler,
    SessionEndHookInput,
    SessionEndHookOutput,
    ErrorOccurredHandler,
    ErrorOccurredHookInput,
    ErrorOccurredHookOutput,
    BaseHookInput,
} from '@github/copilot-sdk';
```

## Source References

- Types: `node_modules/@github/copilot-sdk/dist/types.d.ts` (lines 286-460)
- Hook invocation: `node_modules/@github/copilot-sdk/dist/session.js` (`_handleHooksInvoke`)
- Research copy: `research/copilot-sdk/nodejs/src/types.ts`, `research/copilot-sdk/nodejs/src/session.ts`
