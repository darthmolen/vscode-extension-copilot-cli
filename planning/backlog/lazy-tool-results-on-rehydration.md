# Backlog: Fetch tool results on demand when a transcript rehydrates

Deferred out of the v3.13.0 P2 work (`planning/in-progress/v3.13.0-p2-tool-replay.md`) on
2026-08-17. P2 ships **truncation** instead, which fixes the bug; this is the richer version of the
same idea and is worth doing only if someone actually misses the full output.

## Problem

A replayed transcript rebuilds tool chips from the session event log. `tool.execution_complete`
carries `data.result`, which is unbounded — a `bash` that printed a build log, a `view` of a large
file. Carrying every result inline means a session with 48 tool calls ships all of that output to the
webview on every rehydration, including the sidebar hide/show path where nothing on screen changed.

**P2's shipped answer:** `buildSessionTranscript` truncates each result to a cap and marks it. Bounded
payload, one line of code, real output visible for the great majority of tools, whose output is small.

**What truncation does not give you:** the tail of a long result is gone. Expanding a replayed chip
shows the first N characters and nothing else, forever.

## The deferred design

Carry no result at all on rehydration; fetch one when the user expands that chip. Every event in the
log is keyed by `toolCallId`, so a single result is directly addressable.

```
init          → { kind:'tool', tool: { toolName, status, arguments, error, startTime, endTime } }
user expands  → eventBus.emit('tool:resultNeeded', { toolCallId })
main.js       → rpc.getToolResult(toolCallId)
extension     → findToolResult(eventsPath, toolCallId) → rpc.sendToolResult(...)
main.js       → eventBus.emit('tool:result', { toolCallId, result })
ToolExecution → fills that chip's details region
```

`ToolExecution` never learns RPC exists — it takes `(container, eventBus)` like every component, and
`main.js` stays the only place that touches `rpc`, matching the existing
`rpc.onSubagentStart(p => eventBus.emit('subagent:start', …))` pattern at `main.js:702`.

### Surfaces it touches

| File | Change |
| --- | --- |
| `src/shared/messages.ts` | two message types: `getToolResult` (webview→ext), `toolResult` (ext→webview) |
| `src/extension/rpc/ExtensionRpcRouter.ts` | one receive handler, one send method |
| `src/webview/app/rpc/WebviewRpcClient.js` | the mirrored pair |
| `src/extension/rpc/registerChatHandlers.ts` | one registration, answering from the log |
| `sessionTranscriptBuilder.ts` | `findToolResult(eventsPath, toolCallId)` |
| `ToolExecution.js` | expand handler emits when a chip has no result yet |

### One thing already worked out

**No "is this replayed?" flag is needed.** The state already distinguishes the two cases: a replayed
chip has a terminal status (`complete`/`failed`) **and** no result; a live chip has no result because
it is still `running`. So the trigger is `status is terminal && result === undefined`, with no extra
field to set or keep in sync. (A review of P2 assumed a flag would be required; it is not.)

## Why it was deferred

Six touch points and a new RPC round-trip, to avoid carrying strings, when the bug under repair is
*"replayed tools render as a wall of 'Tool execution'"* — which truncation fixes just as completely.
The lazy path stays available at any time because `toolCallId` is in the log either way; nothing in
P2 forecloses it.

## When to pick this up

- Someone reports a truncated result they needed.
- Or transcript sizes grow enough that even truncated results bloat init — at which point pair this
  with transcript **paging**, which is the same shape of problem. The SDK's own
  `session.eventLog.read` is cursor-paged with a `types` filter and a 1000-event cap, which is the
  platform saying long histories get paged rather than materialised.

## Related

- `planning/in-progress/v3.13.0-p2-tool-replay.md` — §5.2/§5.4, where truncation lands
- `planning/spikes/tool-replay-reader/FINDINGS.md` — the event-log shapes this depends on
