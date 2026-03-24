# Fleet Mode — Gaps & Unknowns (Iced)

**Status:** Iced — too many unknowns to prioritize now  
**Research date:** 2026-03-17  
**Full research:** `planning/spikes/fleet-command/results/07/`

---

## What Fleet Is

Fleet mode is a Copilot CLI SDK concept that activates multi-agent parallelism for a session. A single call to `session.rpc.fleet.start({ prompt? })` tells the CLI backend to spawn multiple concurrent sub-agents to work on different parts of a task simultaneously.

This is **distinct** from custom agent selection (`/agent`), which selects a named persona for a session or single message.

---

## What Exists in the SDK

- `session.rpc.fleet.start({ prompt?: string }) → { started: boolean }` — fire-and-forget; returns when fleet *activates*, not when it completes (per Steve Sanderson)
- `subagent.started` / `subagent.completed` / `subagent.failed` session events — carry `toolCallId`, `agentName`, `agentDisplayName`, `error`
- `subagent.selected` / `subagent.deselected` — lifecycle events for per-agent selection

---

## What Is NOT Wired in This Extension

| Gap | Detail |
|-----|--------|
| No `fleet.start()` call | SDKSessionManager has no wrapper; nothing in the extension calls it |
| No ExtensionRpcRouter methods | No `sendFleetStart` / `onFleetStart` — the RPC contract doesn't mention fleet |
| No webview trigger | No button, slash command, or UI element to launch fleet |
| Subagent events not forwarded | `subagent.*` events are received by SDKSessionManager and **logged only** — never emitted upstream or surfaced in the UI |

---

## Known Unknowns

1. **Billing model** — Community reports rate-limit anxiety and account suspension fear. Fleet spawns multiple agents; the cost multiplier is unclear and undocumented.
2. **Quota behavior** — Does fleet consume N× the rate limit? Does it share the session quota or create new ones? Unknown.
3. **Subagent result aggregation** — How does the CLI merge subagent outputs back into the main session? SDK docs are silent on this.
4. **Error handling semantics** — If one subagent fails, does fleet abort, retry, or continue? `subagent.failed` event exists but behavior is undocumented.
5. **Prompt design for fleet** — The optional `prompt` parameter in `fleet.start` appears to be orchestration instructions, but no examples exist in official docs.
6. **VS Code constraints** — The "squad" framework explicitly rejected fleet due to CLI-only limitation. Whether fleet works identically inside a VS Code extension process is unverified.
7. **Discoverability UX** — The top Reddit comment on fleet is "What is fleet anyway?" We'd need to design a UI that explains what's happening, which is non-trivial.

---

## Community Signal

- **Enthusiasm is real but stalled.** A Reddit thread titled "Opus 4.6 fast and /fleet has changed my workflow" got 24 upvotes and 33 comments — but the most-upvoted reply asks "What is fleet anyway?"
- **Case study:** One blog (htek.dev) built a 14-stage video pipeline in 20 minutes with 2 prompts using fleet.
- **No VS Code integration exists anywhere** in the community. This extension would be first.
- Devin AI included fleet in a "Stage 8 agentic orchestration" landscape comparison.

---

## Why We're Icing It

- The billing/quota unknowns are a user safety risk. Accidentally burning through quotas or triggering rate limits in a VS Code sidebar would be a bad user experience and could destroy trust.
- Subagent result aggregation is opaque — we don't know how to present parallel work in the chat UI without this.
- The SDK's `fleet.start` is fire-and-forget with no completion signal — we'd need to poll or infer state from `subagent.*` events, which we haven't modeled.
- Community discoverability problem is ours to solve, not just the CLI's — requires intentional UX design.
- Zero precedent for fleet in a VS Code extension (not just ours — anyone's).

---

## When to Revisit

- When SDK docs on fleet billing/quota are published
- When we understand subagent result aggregation
- When a community VS Code integration attempt exists to learn from
- When we have spare UX design bandwidth for the discoverability problem

---

## Related Files

- `planning/spikes/fleet-command/results/07/fleet-rpc-workflow.md` — full RPC call path + mermaid diagram
- `planning/spikes/fleet-command/results/07/community-speaks-about-fleet-in-copilot-cli.md` — community research
- `planning/spikes/fleet-command/results/07/community-issues-about-fleet-in-copilot-cli.md` — GitHub issues
