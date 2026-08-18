# Backlog: Stream Sub-Agent Message/Reasoning Text into Dock Cards

**Fast-follow** to the Sub-Agent Dock (`planning/subagent-dock-implementation.md`). The dock's
first version shows a sub-agent's **status + tool calls**; this item adds its **prose** — the
streamed assistant message / reasoning text — inside the card.

## Why it's a clean follow-on

Spike-proven: a sub-agent's `assistant.message` / `assistant.message_delta` /
`assistant.reasoning_delta` events already carry the envelope **`event.agentId`** (and
`data.parentToolCallId`), exactly like its tool events (`planning/spikes/adhoc-subagent/FINDINGS.md`).
So the same `agentId` routing the dock already uses extends to message/reasoning deltas — no new
attribution work, just a new render target.

## Scope

- Extension: forward sub-agent `assistant.message`/`*_delta` events (those with `event.agentId`
  set) to the webview tagged with `agentId`, instead of letting them smear into the main
  transcript. (Today the main transcript handler is agnostic to `agentId`.)
- Webview: render the streamed text in the agent's dock card — likely a second expandable
  region ("output"/"thinking") beneath the tool feed, or interleaved with tool calls in
  timestamp order. Reasoning text behind its own toggle (it can be large/opaque).
- Decide: does the sub-agent's **final** message still also land in the transcript (result), with
  the dock showing the live stream (process)? Default: yes — keep result in transcript, stream in
  card. Revisit during design.

## Open questions (for its own brainstorm/plan when picked up)

- Interleave message text with tool calls chronologically, or separate "output" pane?
- Reasoning deltas: show at all, or tool-feed only? (They're opaque/encrypted per earlier notes.)
- Token/size caps on in-card text to avoid unbounded card growth.

## Dependencies

- Ships **after** the dock lands (status + tool calls). Reuses the dock's `agentId`→tile `Map`
  and the extension's `agentId` capture from the dock plan.
