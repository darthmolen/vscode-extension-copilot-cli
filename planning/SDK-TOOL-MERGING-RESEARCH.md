# SDK Tool Merging Research

## Purpose
Document the ACTUAL behavior of how the Copilot SDK/CLI merges tools from different sources.

## Source Code References

### 1. SDK Client - createSession (client.ts:427-470)
**File**: `research/copilot-sdk/nodejs/src/client.ts`
**Lines**: 427-470

The SDK client simply passes all parameters through to the CLI via JSON-RPC:

```typescript
const response = await this.connection!.sendRequest("session.create", {
    model: config.model,
    sessionId: config.sessionId,
    tools: config.tools?.map(...),              // Custom tools
    availableTools: config.availableTools,       // Whitelist
    excludedTools: config.excludedTools,         // Blacklist
    mcpServers: config.mcpServers,              // MCP servers
    // ... other params
});
```

**Key Insight**: The SDK does NOT merge tools. It sends everything to the CLI.

### 2. SessionConfig Interface (types.ts:342-431)
**File**: `research/copilot-sdk/nodejs/src/types.ts`
**Lines**: 373-382

```typescript
/**
 * List of tool names to allow. When specified, only these tools will be available.
 * Takes precedence over excludedTools.
 */
availableTools?: string[];

/**
 * List of tool names to disable. All other tools remain available.
 * Ignored if availableTools is specified.
 */
excludedTools?: string[];
```

**Key Insights**:
1. `availableTools` is a **WHITELIST** - when specified, ONLY those tools are available
2. `availableTools` takes precedence over `excludedTools`
3. If `availableTools` is NOT specified, all built-in tools are available (minus any in `excludedTools`)

### 3. SDK Test - availableTools Behavior (session.test.ts:72-85)
**File**: `research/copilot-sdk/nodejs/test/e2e/session.test.ts`  
**Lines**: 72-85

```typescript
it("should create a session with availableTools", async () => {
    const session = await client.createSession({
        availableTools: ["view", "edit"],
    });

    await session.sendAndWait({ prompt: "What is 1+1?" });

    // It only tells the model about the specified tools and no others
    const traffic = await openAiEndpoint.getExchanges();
    expect(traffic[0].request.tools).toMatchObject([
        { function: { name: "view" } },
        { function: { name: "edit" } },
    ]);
});
```

**Key Insight**: When `availableTools: ["view", "edit"]` is specified, the API request contains ONLY those two tools. Nothing else.

## Merging Behavior - What We Know

Based on the documentation and tests:

| Scenario | Custom Tools | availableTools | Result |
|----------|--------------|----------------|--------|
| 1 | None | Not specified | All built-in SDK tools |
| 2 | `[tool1]` | Not specified | tool1 + All built-in SDK tools |
| 3 | None | `["view", "edit"]` | Only view, edit |
| 4 | `[tool1]` | `["view", "edit"]` | tool1 + view + edit |

## CRITICAL DISCOVERY (2026-02-01)

**Finding**: When `availableTools` is specified, custom tools are NOT automatically made available to the AI!

**Test Evidence**:
- Created session with `tools: [update_work_plan, task]` and `availableTools: ["view", "grep", "glob"]`
- Asked AI to list available tools
- **Result**: AI only sees view, grep, glob - NOT update_work_plan or task!

**Implication**: The `availableTools` parameter is a whitelist for SDK built-in tools ONLY. Custom tools defined in the `tools` parameter are registered as handlers but NOT exposed to the AI unless... (need to investigate further)

## The Critical Question

**What happens when a custom tool has the SAME NAME as a built-in tool?**

Scenario 2 would give us:
- Custom `bash` tool
- Built-in `bash` tool  
= **DUPLICATE NAMES**

The test at line 79 says "It only tells the model about the specified tools" - but what if a custom tool has the same name as a whitelisted tool?

## Hypothesis

Based on the code comment in our extension (sdkSessionManager.ts:1296):
```typescript
// NOTE: We do NOT use availableTools because custom tools override SDK tools with the same name
```

This assumes custom tools "override" SDK tools. But there's no evidence of this in the SDK documentation or tests.

**My hypothesis**: Custom tools do NOT override SDK tools. They are added alongside them. If names collide, you get duplicates, which causes the API error.

## Tests Needed

We need to create a bare-bones test that verifies:

1. **Test 1**: Custom tool with unique name + no availableTools
   - Expected: Custom tool + all SDK tools
   
2. **Test 2**: Custom tool with name "bash" + no availableTools  
   - Expected: Either ERROR or one bash tool (which one?)
   
3. **Test 3**: Custom tool with name "bash" + availableTools ["view", "grep"]
   - Expected: Custom bash + view + grep (no duplicate)
   
4. **Test 4**: Custom tools + availableTools + MCP
   - Match our production scenario

## Next Steps

1. Create minimal SDK test to validate hypothesis
2. Run test against real CLI
3. Document actual behavior
4. Design fix based on facts, not assumptions
