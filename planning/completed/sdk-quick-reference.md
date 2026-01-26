# Copilot SDK Quick Reference

## Event Types

### Tool Execution Events
```typescript
// Tool started
{
  type: 'tool.execution_start',
  data: {
    toolCallId: 'abc123',
    toolName: 'bash',
    arguments: { command: 'ls -la' }
  }
}

// Tool progress
{
  type: 'tool.execution_progress',
  data: {
    toolCallId: 'abc123',
    progressMessage: 'Executing command...'
  }
}

// Tool completed
{
  type: 'tool.execution_complete',
  data: {
    toolCallId: 'abc123',
    success: true,
    result: { content: 'file1.txt\nfile2.txt' }
  }
}
```

### Assistant Messages
```typescript
// Streaming chunks (real-time)
{
  type: 'assistant.message_delta',
  data: {
    messageId: 'msg_001',
    deltaContent: 'Here is the '
  }
}

// Final complete message
{
  type: 'assistant.message',
  data: {
    messageId: 'msg_001',
    content: 'Here is the complete markdown response...'  // Full markdown
  }
}
```

### Session Events
```typescript
// Session started
{
  type: 'session.start',
  data: {
    sessionId: 'uuid-here',
    context: {
      cwd: '/home/user/project',
      gitRoot: '/home/user/project',
      branch: 'main'
    }
  }
}

// Session resumed
{
  type: 'session.resume',
  data: {
    resumeTime: '2026-01-25T18:00:00Z',
    eventCount: 42
  }
}
```

## Session Management API

```typescript
// List all sessions
const sessions = await client.listSessions();
// Returns: SessionMetadata[]
// [{
//   sessionId: 'uuid',
//   createdAt: '2026-01-25T10:00:00Z',
//   lastModified: '2026-01-25T15:00:00Z'
// }]

// Get last session ID
const lastId = await client.getLastSessionId();
// Returns: string | undefined

// Resume a session
const session = await client.resumeSession(sessionId, {
  tools: [], // Optional custom tools
  provider: undefined // Optional provider
});

// Create new session
const session = await client.createSession({
  model: 'claude-sonnet-4.5',
  tools: [] // Optional custom tools
});
```

## Key Differences from V1

| Feature | V1 (CLI Shelling) | V2 (SDK) |
|---------|-------------------|----------|
| **Process** | Spawn `copilot --prompt` per message | Single persistent session |
| **Events** | Parse stdout text | Structured JSON events |
| **Tools** | No visibility | Real-time progress |
| **Sessions** | Manual filesystem scan | `client.listSessions()` API |
| **Markdown** | Parse output | `event.data.content` (same!) |
