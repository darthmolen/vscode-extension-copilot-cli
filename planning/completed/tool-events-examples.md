# Tool Execution Events - Examples

## Example 1: File Edit Operation

```typescript
// 1. Tool starts
{
  type: 'tool.execution_start',
  data: {
    toolCallId: 'tc_001',
    toolName: 'edit',
    arguments: {
      path: 'src/index.ts',
      changes: [/* edit instructions */]
    }
  }
}

// 2. Progress update (optional)
{
  type: 'tool.execution_progress',
  data: {
    toolCallId: 'tc_001',
    progressMessage: 'Analyzing file...'
  }
}

// 3. Completion
{
  type: 'tool.execution_complete',
  data: {
    toolCallId: 'tc_001',
    success: true,
    result: {
      content: 'Successfully edited src/index.ts'
    }
  }
}
```

## Example 2: Bash Command

```typescript
// 1. Starts
{
  type: 'tool.execution_start',
  data: {
    toolCallId: 'tc_002',
    toolName: 'bash',
    arguments: {
      command: 'git status'
    }
  }
}

// 2. Partial output (streaming)
{
  type: 'tool.execution_partial_result',
  data: {
    toolCallId: 'tc_002',
    partialOutput: 'On branch main\n'
  }
}

// 3. More output
{
  type: 'tool.execution_partial_result',
  data: {
    toolCallId: 'tc_002',
    partialOutput: 'Your branch is up to date\n'
  }
}

// 4. Completion
{
  type: 'tool.execution_complete',
  data: {
    toolCallId: 'tc_002',
    success: true,
    result: {
      content: 'Command completed successfully'
    }
  }
}
```

## Example 3: Multiple Tools in Sequence

```typescript
// User asks: "Update the README and run tests"

// Step 1: Edit README
{
  type: 'tool.execution_start',
  data: { toolCallId: 'tc_003', toolName: 'edit', arguments: { path: 'README.md' } }
}
{
  type: 'tool.execution_complete',
  data: { toolCallId: 'tc_003', success: true }
}

// Step 2: Run tests
{
  type: 'tool.execution_start',
  data: { toolCallId: 'tc_004', toolName: 'bash', arguments: { command: 'npm test' } }
}
{
  type: 'tool.execution_progress',
  data: { toolCallId: 'tc_004', progressMessage: 'Running test suite...' }
}
{
  type: 'tool.execution_complete',
  data: { toolCallId: 'tc_004', success: true, result: { content: 'All tests passed!' } }
}

// Finally: Assistant message
{
  type: 'assistant.message',
  data: {
    content: 'I've updated the README and all tests are passing! ✅'
  }
}
```

## UI Rendering Example

For the extension, we track these in a map and display:

```
┌─ Tool Execution ─────────────────────────┐
│                                           │
│  ✅ edit README.md (1.2s)                 │
│  ✅ bash npm test (3.5s)                  │
│     └─ All tests passed!                  │
│                                           │
└───────────────────────────────────────────┘
```

Active tools show with spinner:
```
┌─ Tool Execution ─────────────────────────┐
│                                           │
│  ✅ edit README.md (1.2s)                 │
│  ⏳ bash npm test                         │
│     └─ Running test suite...              │
│                                           │
└───────────────────────────────────────────┘
```
