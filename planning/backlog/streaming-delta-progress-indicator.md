# Backlog: Streaming Progress Indicator (assistant.streaming_delta)

**Priority**: Low  
**Prerequisite**: Fleet command (02-fleet-command.md) implemented

## Problem

During long-running model turns — especially fleet subagent tasks that can run 400+ seconds — 
the only feedback is a blinking "Thinking..." indicator. Users have no way to distinguish 
"actively generating" from "stalled waiting for a tool result."

The SDK emits `assistant.streaming_delta` on every response chunk with a `totalResponseSizeBytes` 
field (cumulative, monotonically increasing). It fires even during tool use when no 
`assistant.message_delta` is emitted — meaning it's a true heartbeat for any model activity.

## Opportunity

Use `totalResponseSizeBytes` to drive a subtle progress signal on the Thinking... indicator 
and/or on subagent task cards in SubagentTracker:

1. **Thinking... byte counter** — replace or augment the blinking dot with a small growing 
   byte count ("~1.2 KB generated") so users can see the model is alive
2. **SubagentTracker liveness** — for a subagent card showing no recent tool activity, 
   show last-active timestamp from the most recent `streaming_delta` to distinguish 
   "working silently" from "stalled"
3. **Stall detection** — if `streaming_delta` stops firing for >10s while status is still 
   `running`, surface a "may be stalled" warning on the affected agent card

## What We Know

- `assistant.streaming_delta` payload: `{ totalResponseSizeBytes: number }` — no text content
- Fires alongside `assistant.message_delta` during normal turns
- Fires **without** `message_delta` during long tool calls (e.g. `update_plan`, bash)
- Currently handled with a no-op `case` in `sdkSessionManager.ts` (silenced in fleet impl)
- Does not carry subagent context — unclear if it fires per-subagent during fleet 
  (needs a spike if subagent-level granularity is wanted)

## Open Questions

1. Does `streaming_delta` fire per-subagent during fleet, or only for the orchestrator?  
   If per-subagent: SubagentTracker liveness is straightforward.  
   If orchestrator-only: only useful for the top-level Thinking... indicator.
2. Is `totalResponseSizeBytes` reset between tool calls within a turn, or is it truly 
   cumulative for the whole turn?

## Scope (when prioritized)

- Spike: confirm subagent granularity of `streaming_delta` during fleet
- `sdkSessionManager.ts`: emit `_onDidStreamingDelta({ totalBytes, timestamp })` 
- `ExtensionRpcRouter`: `sendStreamingDelta(totalBytes)`
- `MessageDisplay`: update Thinking... indicator with byte count or pulse animation
- `SubagentTracker`: per-card last-active time + stall detection (post-fleet only)