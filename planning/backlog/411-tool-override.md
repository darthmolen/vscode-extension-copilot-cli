# PR Plan: Tool Override by Name for @github/copilot-sdk

**Issue**: [copilot-sdk #411](https://github.com/github/copilot-sdk/issues/411)
**Status**: Steve willing to implement (Feb 12) — we can beat him to it
**Priority**: Medium — enables custom tool implementations that replace built-in tools

## Problem

When a consumer registers a custom tool with the same name as a built-in tool (e.g., `editFile`),
both the custom tool and the built-in tool are sent to the LLM. This causes:

1. Duplicate tools in the LLM's tool list (confusing, non-deterministic selection)
2. No way to override built-in behavior (e.g., replace `editFile` with a custom diff viewer)

## How Tools Flow Today

The SDK sends tools to the CLI via JSON-RPC `session/new` (or `session/create`):

```json
{
  "method": "session/new",
  "params": {
    "tools": [
      { "name": "myCustomTool", "description": "...", "inputSchema": {...} }
    ],
    "availableTools": [
      "editFile", "createFile", "runCommand", "myCustomTool"
    ]
  }
}
```

- `tools`: Custom tool definitions (consumer-provided via `getCustomTools()`)
- `availableTools`: Whitelist of ALL tools the agent can use (built-in + custom)

The CLI has its own built-in tool implementations for names like `editFile`, `createFile`,
`runCommand`, etc. When it sees `editFile` in `availableTools`, it adds its built-in
definition. When it also sees a custom tool named `editFile` in `tools`, it adds that too.
Result: two `editFile` tools sent to the LLM.

## Proposed Fix

### Option A: SDK-side filtering (minimal, preferred)

Before sending `availableTools` to the CLI, filter out any names that appear in the
custom `tools` array. This way the CLI only uses the custom definition.

In `src/client.ts`, in the method that constructs the `session/new` params:

```typescript
// Before
const availableTools = [...builtInToolNames, ...customToolNames];

// After
const customNames = new Set(customTools.map(t => t.name));
const availableTools = [
    ...builtInToolNames.filter(name => !customNames.has(name)),
    ...customToolNames,
];
```

### Option B: CLI-side priority (more robust, bigger change)

The CLI itself could prioritize custom tools over built-ins when names collide.
This is a CLI change (closed source) so we can't PR it — but worth mentioning in the
SDK PR as a long-term improvement.

### Recommendation: Option A

It's a ~5 line change in the SDK, fully backwards compatible, and solves the immediate
problem. The CLI doesn't need to change.

## Implementation Details

The key code path in `src/client.ts`:

1. `getCustomTools()` — consumer callback returning `Tool[]`
2. `startSession()` or similar — constructs the JSON-RPC params
3. `availableTools` array — built from a hardcoded list + custom tool names

The fix goes in step 3: filter the built-in list against custom tool names before merging.

### Built-in Tools (for reference)

The SDK's built-in tool list (from source analysis):
- `editFile`
- `createFile`
- `runCommand`
- `runTerminalCommand`
- `getErrors`
- `getFileContent`
- `listDirectory`
- `searchFiles`
- `think`

When a consumer provides a custom tool named `editFile`, the SDK should exclude `editFile`
from the built-in portion of `availableTools`.

## Testing

1. **Unit test — no collision**: Custom tool `myTool` + built-ins → both in `availableTools`
2. **Unit test — name collision**: Custom tool `editFile` → built-in `editFile` excluded from `availableTools`, custom `editFile` in `tools`
3. **Unit test — multiple collisions**: Custom tools `editFile` + `runCommand` → both built-ins excluded
4. **Integration test**: Start session with overridden tool, verify the LLM receives exactly one definition

## Files to Modify (in copilot-sdk repo)

| File | Change |
|------|--------|
| `src/client.ts` | Filter `availableTools` against custom tool names |
| `test/client.test.ts` | Add collision tests |

## Risks

- **Built-in tool behavior assumptions**: If the CLI internally depends on a built-in tool being available
  (e.g., it calls `editFile` internally, not just via LLM), removing it from `availableTools` might cause
  issues. Mitigation: the custom tool handler should implement the same interface.
- **Name matching**: Exact string match on tool names. If the CLI normalizes names (camelCase, etc.),
  the filter might miss. Low risk — current evidence shows exact match.

## PR Strategy

1. Fork `github/copilot-sdk`
2. Branch from `main`
3. Implement Option A (SDK-side filtering)
4. Add unit tests for collision scenarios
5. Reference #411 in PR description
6. Note Steve's Feb 12 comment signaling willingness — this PR implements his suggestion
