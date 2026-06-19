# Ad-hoc Sub-Agent Emissions — Spike Findings

**Date:** 2026-06-14
**SDK:** `@github/copilot-sdk` 0.3.0 (installed) · vendored `research/copilot-sdk` refreshed to tag `v0.3.0` (2026-06-14)
**CLI:** local `node_modules/@github/copilot` **1.0.44** (satisfies SDK peer-dep `^1.0.36-0`); PATH `copilot` is stale 1.0.5 and was NOT used.
**Driver:** real `task`-tool dispatch — A1 via the `plan-intake-review` skill (faithful to the original bug report), A2 via an explicit 3-way parallel-review prompt.
**Scripts:** `spike-adhoc.mjs a1` / `a2`. Raw event envelopes captured to `results/<label>-events.jsonl`, summaries to `results/<label>-summary.json`.

## Headline result

**Ad-hoc sub-agents are attributed by the envelope `agentId` field, and for an ad-hoc `task`-tool sub-agent `agentId === the spawning `task` tool's `toolCallId`.**

Every event originating inside the sub-agent — its `tool.execution_start/complete`, AND its `assistant.message` / streaming deltas — carries that same top-level `agentId`. `data.parentToolCallId` on child tool events carries the *same* value (the task id), so the two keys agree. Main-agent / session-level events have `agentId` absent (`∅`).

This is the post-#477 / #2265 behavior: sub-agent text is now streamed and attributed, not aggregated-at-end.

## A1 — skill-driven single sub-agent (plan-intake-review)

- The skill dispatched one `task` tool call: `name: "plan-reviewer", agent_type: "general-purpose", mode: "background"`, `toolCallId = toolu_…UGnK1rdr`.
- `subagent.started` fired with envelope `agentId = toolu_…UGnK1rdr` (= the task `toolCallId`); `data.toolCallId` = same.
- Child tool events (e.g. `report_intent`, `view`) carried envelope `agentId = toolu_…UGnK1rdr` AND `data.parentToolCallId = toolu_…UGnK1rdr`.
- `assistant.message` events from the sub-agent carried envelope `agentId` (sub-agent text is attributed).
- `session.background_tasks_changed` fired repeatedly with `agentId = ∅` and empty data (confirmed useless signal, matches prior fleet findings).
- **`subagent.started` data:** `{ toolCallId, agentName: "general-purpose", agentDisplayName: "General Purpose Agent", agentDescription: "…" }` (no `model` on start).
- **`subagent.completed` data (the receipt):** `{ toolCallId, agentName, agentDisplayName, model: "claude-sonnet-4.6", totalToolCalls: 13, totalTokens: 282777, durationMs: 87168 }`. All dock-receipt fields present.
- Sub-agent `assistant.message` data also carries `parentToolCallId` (= task id) **in addition to** the envelope `agentId` — dual attribution on messages, not just tools.
- Timing: `subagent.started` @53.0s → `subagent.completed` @140.2s (~87s runtime); 363 total events, 130 of them the useless empty `background_tasks_changed`.
- (Note: `sendAndWait` timeout is the **2nd positional arg** — `sendAndWait(opts, ms)`, not a field in `opts`; the first run defaulted to 60s and was cut off.)

## A2 — concurrent sub-agents (3 in parallel)

**Concurrency + disambiguation both confirmed.**
- 3 `task` dispatches fired **simultaneously @15.4s** (`review-cache-layer`, `review-status-debounce`, `review-retry-cli-install`), all `agent_type: general-purpose, mode: background`, each with a distinct `toolCallId`.
- **3 distinct envelope `agentId`s**, each equal to its task's `toolCallId`:
  `…01PNBB18…`, `…01WKGukL…`, `…014iDTLR…`.
- **Out-of-order completion:** completed @29.6s, @35.3s, @37.6s — completion order ≠ start order (genuinely async).
- Every child event (tools + messages) carried exactly one of the 3 `agentId`s; per-agent attribution is clean even while interleaved. `subagent.started`×3 and `subagent.completed`×3 each tagged by their own `agentId`.

**→ Validates the pinned-dock design: one tile per `agentId`, created on `subagent.started`, fed by any event whose envelope `agentId` matches, finalized on `subagent.completed`. Out-of-order completion is handled naturally because each tile is keyed independently.**

## Implications for the extension

- **Single attribution key: envelope `event.agentId`.** Route any event whose `agentId` is set into that sub-agent's dock tile (tools AND messages/deltas). `agentId`-less events stay on the main transcript path. `data.parentToolCallId` is a redundant fallback for tool events only.
- The `task` tool call's own `toolCallId` (an `agentId`-less main-agent tool event) is the dock tile's identity and equals the children's `agentId` — so the tile can be created from `subagent.started` and matched to children by `agentId`.
- `includeSubAgentStreamingEvents` default `true` is sufficient; no config change needed to receive sub-agent traffic.

## Ad-hoc vs Fleet comparison (Phase B)

Driver: `planning/spikes/fleet-command/spike-08-fleet-1054.mjs` — `session.rpc.fleet.start({prompt})` on the same SDK 0.3.0 / CLI 1.0.44, identical capture code.

**Fleet emits the SAME attribution contract as ad-hoc sub-agents.** Both paths are renderable by one dock keyed on envelope `agentId`.

| Aspect | Ad-hoc (`task` tool) | Fleet (`rpc.fleet.start`) |
|---|---|---|
| Concurrency observed | 3 dispatched @15.4s | 3 dispatched @17.8s |
| Completion order | out-of-order (29.6/35.3/37.6s) | out-of-order (25.9/26.2/26.6s) |
| `agentId` === sub-agent's `toolCallId` | yes | yes |
| envelope `agentId` on child **tools** | yes | yes |
| envelope `agentId` on child **messages** | yes | yes |
| `data.parentToolCallId` (redundant) | yes | yes |
| `subagent.started`/`completed` lifecycle | yes | yes |
| agent type the orchestrator picked | `general-purpose` | `explore` |
| `subagent.completed` receipt (model/tokens/calls/durationMs) | yes | yes |
| `session.idle` waits for all to finish (#2263 fix) | yes | yes |

**Issue status on current version:**
- ✅ **#2261 — fleet (and ad-hoc) now dispatch USER-DEFINED custom agents** on CLI 1.0.44 (spike-09). This was the biggest fleet blocker. NOTE: this is a **CLI-side** behavior (the issue is filed on `github/copilot-cli` and is still **OPEN** on the tracker; the SDK only forwards `customAgents` to the CLI). Treat as *empirically working on 1.0.44* and **gate on CLI version**, not SDK version. See below.
- ❌ **#2264** still reproduces — no `fleet.*` lifecycle events (`fleetWildcardEvents: []`). Infer state from `subagent.*` counts.
- ❌ **#2262** still reproduces — `session.task_complete` does NOT fire after fleet (`taskCompleteFired: false`). Use `subagent.completed` count + `session.idle`.

### Custom-agent dispatch (#2261) — spike-09

Driver: `planning/spikes/fleet-command/spike-09-custom-agent-dispatch.mjs`. Registered two
distinctively-named `customAgents` (`spike-researcher`, `spike-auditor`, `infer:true`) via the
SDK `createSession({ customAgents })`, confirmed them via `rpc.agent.list()`, then triggered
both fleet and an ad-hoc `task` dispatch.

| Path | Custom agents dispatched | Built-in dispatched |
|---|---|---|
| **Fleet** (`rpc.fleet.start`) | 2 (`spike-researcher`, `spike-auditor`) | 0 |
| **Ad-hoc** (`task` tool, `agent_type: spike-researcher`) | 1 | 0 |

- `subagent.started.agentName` / `agentDisplayName` carry the **custom** agent's name (e.g. `Spike Researcher`) — the dock tile can label tiles with the real agent identity.
- The orchestrator selects which registered agent to dispatch from the agent's `name`/`description` (fleet has no agent-selection param — `FleetStartRequest` is just `{ prompt? }`).
- `fleet.start` is still **blocking** (returned @118s, sub-agents started @10.9s) — must be fire-and-forget in the extension.
- Two ways to register agents: SDK `customAgents` (programmatic — what the extension would use) and CLI markdown files in `.copilot/agents/` & `~/.copilot/agents/` (auto-discovered). When `customAgents` was passed, `rpc.agent.list()` returned exactly those.

**Implication for the dock:** tiles are labelled by `agentName`/`agentDisplayName` straight from `subagent.started` — works identically whether the agent is built-in, a custom `customAgents` entry, or (presumably) a markdown agent. No special-casing needed.

The only differences between fleet and ad-hoc are the **trigger** (`task` tool vs `rpc.fleet.start`) and the **agent type** the orchestrator selects. The event/attribution contract is identical → a single `agentId`-keyed dock renders both. Fleet support is essentially free once the dock exists.

## Decision-gate inputs (for review — not yet decided)

1. **Attribution key = envelope `event.agentId`** (equals the sub-agent's spawning `toolCallId`; `data.parentToolCallId` is a redundant fallback on tool/message events). Proven for both ad-hoc and fleet, single and concurrent.
2. **Shared path = YES.** One dock renders ad-hoc sub-agents and fleet; no split needed.
3. **Concurrent UX already chosen:** pinned dock, one tile per `agentId`, created on `subagent.started`, fed by matching-`agentId` events, finalized on `subagent.completed`. Out-of-order completion handled by independent keying.
4. **Completion signal:** `subagent.completed` per tile; session-wide "all done" via `completed === started` and/or `session.idle` with empty `backgroundTasks`. Do NOT rely on `task_complete` or `fleet.*` (still absent).
