# Backlog: Give Back to copilot-sdk + Close #2261

Spun out of the sub-agent-visibility spike work (June 2026). Two follow-up items, both
**gated on user confirmation before any outward-facing execution**.

## 1. Answer & close copilot-cli #2261

`#2261 FLEET: fleet.start() ignores customAgents — always dispatches built-in agent types`
(we authored it). Spike-09 proves it now **works** on SDK 0.3.0 / CLI 1.0.44:
- `rpc.fleet.start` dispatched our two registered custom agents (`spike-researcher`,
  `spike-auditor`), **0 built-in**.
- The ad-hoc `task` tool also honored `agent_type: spike-researcher`.
- `rpc.agent.list()` confirmed registration.

Action: post a comment with this evidence, note it is **CLI-side** behavior (the SDK only
forwards `customAgents`), and **close** the issue. Evidence: `planning/spikes/fleet-command/results/09/`.

## 2. Contribute spike-derived examples + docs to copilot-sdk (fork → PR)

The SDK ships only `nodejs/examples/basic-example.ts` — no sub-agent or fleet example — and
the docs under-document the envelope `agentId` attribution / `includeSubAgentStreamingEvents`,
with no fleet doc at all. Our spikes are ready-made material.

- **Examples** (`nodejs/examples/`): sub-agent lifecycle tracking by `agentId`; concurrent
  sub-agents (out-of-order completion); fleet via `rpc.fleet.start` (fire-and-forget + custom
  agents). Derived from `spike-adhoc.mjs`, `spike-08-fleet-1054.mjs`, `spike-09-custom-agent-dispatch.mjs`.
- **Docs**: expand `docs/features/streaming-events.md` (envelope `agentId`,
  `includeSubAgentStreamingEvents`); add fleet coverage to `docs/features/custom-agents.md`
  (or a new `fleet.md`).
- **Scope guard:** examples + docs ONLY. `CONTRIBUTING.md` warns feature PRs must be
  roadmap-aligned; additive examples/docs are low-risk.

Detailed plan: `planning/backlog/sdk-subagent-fleet-contribution.md` (reviewed via the Tandem
workflow; review archived at `planning/needs-review/completed/2026-06-14-sdk-contribution-sub-agent-and-fleet-examples-and-docs.md`). **Parked in backlog** — not active.

## 3. Lodge an upstream issue: `session.idle` type vs runtime gap

The Node `IdleData` type declares only `aborted?: boolean`, but the runtime **does** emit
`session.idle.backgroundTasks.agents` (observed in spikes 07/08). Because the type omits it,
the only type-safe fleet-completion signal is **counting `subagent.started`/`completed`** — which
is a **stopgap, not production-worthy** (races on missed/duplicated events, no authoritative
"all done"). File a short issue on `github/copilot-sdk` asking that `IdleData` expose
`backgroundTasks` so consumers get a reliable, typed completion signal. Reference it from the
examples/docs PR. Evidence: `planning/spikes/fleet-command/results/08/`.
