# ADR-001: Copilot SDK with CLI Server Mode

**Status**: Accepted
**Date**: 2026-01-25 (v2.0.0)
**Driver**: The v1.0 approach of spawning `gh copilot chat` as a subprocess with stdin/stdout parsing was unreliable and gave no visibility into tool execution.

## Context

In v1.0 (commit `b549306`, Jan 24 2026), the extension communicated with the Copilot CLI by spawning it as a child process via `CLIProcessManager`. The class used Node.js `spawn('gh', ['copilot', 'chat', ...flags])` and piped messages through stdin. Responses came back as unstructured text on stdout that had to be parsed line by line.

This was disheartening because we knew there was a communication architecture inside the CLI — structured events, tool execution, session management — but there was no way to trigger it to emit structured data. The `--prompt` flag approach (sending a prompt string and getting text back) was essentially treating a rich interactive agent as a dumb text pipe.

Then we stumbled across `@github/copilot-sdk`. What a horrible name for a package — it's not a "SDK" in the traditional sense. It's the JSON-RPC communication layer for talking with the Copilot CLI in **server mode**. Also not in the documentation was the ability to use the CLI as a server at all. We discovered it by cracking open the package and reading the source.

The SDK revealed:

- `CopilotClient` that auto-spawns the CLI in server mode via JSON-RPC
- `session.on()` with structured events: `tool.execution_start`, `tool.execution_progress`, `tool.execution_complete`, `assistant.message`, `session.usage_info`
- `client.listSessions()` and `client.resumeSession()` for session management
- `event.data.content` returns markdown strings — same format v1 was already rendering

## Decision

**Replace `CLIProcessManager` (stdin/stdout spawning) with `SDKSessionManager` (JSON-RPC via `@github/copilot-sdk`).**

The SDK gives us:

1. Structured event streams instead of stdout text parsing
2. Real-time tool execution visibility (start, progress, complete)
3. Official session management APIs instead of manually scanning `~/.copilot/session-state/`
4. Process lifecycle handled by the SDK (auto-spawn, reconnect)

The CLI runs as a persistent server process. The SDK communicates with it over JSON-RPC. This is the architecture the CLI was designed for — we just couldn't find it documented anywhere.

### Architecture Change

```text
v1.0:  Extension → spawn('gh copilot chat') → parse stdout text
v2.0:  Extension → CopilotClient → JSON-RPC → CLI (server mode)
```

### Key Implementation Detail

The SDK is an ESM module, but VS Code extensions bundle as CJS. We use dynamic `import()` to load it at runtime:

```typescript
async function loadSDK() {
    const sdk = await import('@github/copilot-sdk');
    CopilotClient = sdk.CopilotClient;
    CopilotSession = sdk.CopilotSession;
    defineTool = sdk.defineTool;
}
```

## Consequences

**Positive:**

- Real-time tool execution visibility — users see what the AI is doing as it happens
- Structured events eliminate fragile stdout parsing
- Session resume works reliably via SDK APIs
- Foundation for every feature that followed: plan mode (ADR-003), MCP integration, file diffs
- The CLI's actual architecture (client/server over JSON-RPC) is now exposed to the extension

**Negative:**

- Dependency on an undocumented, rapidly evolving package (`@github/copilot-sdk` v0.1.x)
- ESM/CJS mismatch requires dynamic import workaround and `skipLibCheck` in tsconfig
- SDK types are incomplete — many event payloads typed as `any`
- No official documentation for server mode or the SDK's event protocol

## Notes

- The `CLIProcessManager` was deleted entirely in the v2.0 migration (commit `d4dabca`)
- The discovery that the CLI could run as a server was the foundational insight that made this extension viable as a real product rather than a stdin/stdout hack
- The SDK migration planning doc is preserved at `planning/completed/v2-copilot-sdk-migration.md`
