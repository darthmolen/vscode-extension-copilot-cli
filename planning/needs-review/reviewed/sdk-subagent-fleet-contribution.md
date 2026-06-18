---
type: plan
---

# SDK Contribution: Sub-Agent and Fleet Examples and Docs

## Context

While building sub-agent visibility for this VS Code extension, we ran spikes (June 2026, SDK
0.3.0 / CLI 1.0.44) that produced reusable, novel material the upstream `github/copilot-sdk`
lacks:

- The SDK ships exactly one example: `nodejs/examples/basic-example.ts`. There is **no**
  sub-agent or fleet example anywhere (`nodejs/examples/`, `nodejs/samples/`).
- `docs/features/streaming-events.md` documents `parentToolCallId` as the sub-agent
  attribution mechanism but **under-documents** the envelope `agentId` field and the
  `includeSubAgentStreamingEvents` session option (default `true`) — which our spikes show is
  the cleaner, universal key (present on tools *and* messages, stable per sub-agent).
- There is **no fleet documentation** beyond a one-line table row in
  `docs/troubleshooting/compatibility.md`; `rpc.fleet.start` is `@experimental` with no usage
  example in any language (only a mocked Python timeout unit test).

We also have an issue of our own (`copilot-cli #2261`) that the spikes now resolve.

**Goal:** give back — contribute runnable, spike-derived examples and targeted doc
improvements, and close the resolved issue. **Outward-facing execution (GitHub comment/close,
fork, PR) is gated on explicit user confirmation.**

**Scope guard:** examples + documentation ONLY. `CONTRIBUTING.md` states feature PRs must be
pre-aligned with the team's roadmap and kept in sync across all four language SDKs; additive
examples and docs avoid that risk and need no cross-language parity.

## Phase 1 — Answer and close copilot-cli #2261

`#2261 FLEET: fleet.start() ignores customAgents — always dispatches built-in agent types`
(authored by us). Spike-09 evidence (`planning/spikes/fleet-command/results/09/`):

- `rpc.fleet.start` dispatched both registered custom agents (`spike-researcher`,
  `spike-auditor`), 0 built-in; ad-hoc `task` tool honored `agent_type: spike-researcher`;
  `rpc.agent.list()` confirmed registration. Tested on SDK 0.3.0 / CLI 1.0.44.

Tasks (gated):
1. `gh issue comment 2261 --repo github/copilot-cli` with the evidence summary, noting it is
   **CLI-side** (the SDK only forwards `customAgents`; gate consumers on **CLI version**), and
   that `fleet.start` still blocks until completion (fire-and-forget recommended).
2. `gh issue close 2261 --repo github/copilot-cli` with wording narrowed to the **tested
   evidence**: "verified working on CLI 1.0.44 (SDK 0.3.0)" — NOT a broad "1.0.x". State the
   exact version range we observed and that earlier versions may differ; invite maintainers to
   confirm the lower bound. (It is our issue, so we may close it; keep the claim precise.)

## Phase 2 — Fork and contribute examples + docs to copilot-sdk

### 2a. Fork & branch
- Fork `github/copilot-sdk`; clone; branch `feature/subagent-fleet-examples`.
- Follow `CONTRIBUTING.md`: `cd test/harness && npm ci`; install `nodejs/` deps; confirm a
  clean build + lint baseline before changes.

### 2b. Examples — `nodejs/examples/` (match `basic-example.ts` style; TypeScript)
- `subagent-tracking.ts` — dispatch one sub-agent (via a `task`-driven prompt); subscribe to
  all events; group by **envelope `agentId`**; render a live child-tool feed and a completion
  receipt (`model`, `totalToolCalls`, `totalTokens`, `durationMs`) from `subagent.completed`.
  Derived from `planning/spikes/adhoc-subagent/spike-adhoc.mjs` (a1).
- `concurrent-subagents.ts` — three concurrent sub-agents; show that `agentId` cleanly
  disambiguates interleaved events and that completion is handled out-of-order. Derived from
  spike-adhoc (a2).
- `fleet.ts` — `session.rpc.fleet.start({ prompt })` **fire-and-forget**; detect completion in a
  **type-safe** way by counting `subagent.started` vs `subagent.completed`/`subagent.failed`
  (do NOT key on `session.idle.backgroundTasks` — that shape is emitted at runtime but is
  **not** in the Node `IdleData` type, so it would not typecheck; see Risks). Demonstrate that
  fleet dispatches **registered custom agents**. Derived from `spike-08-fleet-1054.mjs` +
  `spike-09-custom-agent-dispatch.mjs`.
- Each example: header comment explaining intent, `cliPath`/auth notes, run via **`tsx`**
  (matching `basic-example.ts`, which imports `../src/index.js`). NOTE: `examples/` is outside
  the repo's lint/tsconfig scope (`lint` = `src/**`+`test/**`; tsconfig `include` = `src/**`),
  so "lint/typecheck clean via repo tooling" does NOT apply. Validate examples by **running them
  live** (Verification); optionally add a dedicated `examples/tsconfig.json` for `tsc --noEmit`
  only if maintainers want typecheck coverage (flag in PR — it's a tooling change, not in our
  examples/docs scope by default).

### 2c. Docs
- `docs/features/streaming-events.md`:
  - Add the envelope **`agentId`** attribution (the universal per-sub-agent key, present on
    tools *and* messages) and the **`includeSubAgentStreamingEvents`** option (default `true`),
    alongside the existing `parentToolCallId` material.
  - **Fix the incomplete `subagent.completed` field table** (currently lists only
    `toolCallId`/`agentName`/`agentDisplayName` at ~line 593, and again in the summary at
    ~line 793): add `model`, `totalToolCalls`, `totalTokens`, `durationMs` — fields present in
    the generated types that the completion-receipt example depends on.
  - Cross-link the new examples.
- `docs/features/custom-agents.md`:
  - Add a **"Fleet / parallel dispatch"** section: `rpc.fleet.start` usage, its
    blocking/fire-and-forget behavior, **type-safe completion via `subagent.*` counting**, and
    that fleet dispatches the session's registered custom agents (`@experimental` caveat).
  - **Reconcile the existing "Building an Agent Tree UI" section (~line 681)**, which keys the
    tree on `toolCallId`. Clarify that the envelope **`agentId` equals the sub-agent's
    `toolCallId`** and is *additionally* present on message/delta events — so it is the more
    universal attribution key. This **augments** the existing pattern (no contradiction), not a
    rewrite, avoiding inconsistent guidance in the same doc set.
  - Default to editing this existing file; do **not** create a new `docs/features/fleet.md`
    unless maintainers request it.

### 2d. PR (gated)
- **Scoped checks only** (do NOT run the full multi-language matrix for a docs+Node-examples
  change): `nodejs/` build + `nodejs/` lint (`src`/`test` scope is unaffected by our additions),
  plus live-run validation of the new examples. Markdown/doc-link check for the edited docs. The
  shared `test/harness` (`cd test/harness && npm ci`) is only needed if a reviewer asks for the
  e2e suite — flag, don't assume.
- DCO sign-off on commits (`git commit -s`); confirm whether a CLA is also required before pushing.
- Open PR to `github/copilot-sdk` titled for examples+docs, linking the spike findings and
  noting it adds **no API surface** (examples/docs only). Reference #2261's resolution.

## Risks / open questions

- **Roadmap-alignment rule** (CONTRIBUTING) — mitigated by examples/docs-only scope; flag in PR.
- **Fleet is `@experimental`** — examples/docs must state the API may change.
- **DCO/CLA** sign-off likely required — confirm before pushing.
- **Doc placement** — default to extending `custom-agents.md`; only add `fleet.md` if reviewers ask.
- **Example runner / validation** — examples are `.ts` run via **`tsx`** (resolved). `examples/`
  is NOT in the repo's `lint`/tsconfig scope, so there is no automated typecheck for them today
  (same as `basic-example.ts`). Validation is live-run; a dedicated `examples/tsconfig.json` for
  `tsc --noEmit` is optional and reviewer-driven.
- **`session.idle` type vs runtime gap (FLAG)** — the runtime emits `session.idle.backgroundTasks`
  (observed in spike-07/08) but the Node `IdleData` type only declares `aborted?: boolean`. The
  fleet example avoids this by counting `subagent.*`. Separately, this is a genuine type-vs-runtime
  bug worth reporting upstream — but a type/schema fix is **outside** our examples/docs scope and
  could trip the roadmap-alignment rule. **Decision for the user:** mention it in the PR
  description only, file a small standalone issue, or leave it. (Recommendation: file a short
  issue + mention in PR; cheap and accurate.)

## Verification

- Examples run end-to-end against a live CLI (Node 24, local `@github/copilot` ≥ 1.0.44),
  producing the documented output (attributed sub-agent feed; fleet completion).
- `nodejs/` build + `nodejs/` lint pass (our additions don't touch `src`/`test`, so existing
  lint stays green); examples validated by **live run**, not by repo lint/typecheck (out of scope).
- Docs render; internal links and example references resolve; the updated `subagent.completed`
  field tables and the reconciled agent-tree section are internally consistent.
- #2261 shows our evidence comment and a closed state.

---

## Plan Review

**Reviewed:** 2026-06-14 18:13
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

**Evidence-based approach (Context, Phase 1):** The plan is grounded in concrete spike evidence from `planning/spikes/fleet-command/results/09/` and `planning/spikes/adhoc-subagent/`, with reproducible findings on SDK 0.3.0 / CLI 1.0.44. The #2261 issue resolution is backed by verifiable test data showing custom agent dispatch working.

**Scoped defensively (Context, Scope guard):** The plan explicitly limits itself to examples + docs only, deliberately avoiding feature PRs that would require cross-language parity and roadmap alignment per CONTRIBUTING.md. This is architecturally sound given the upstream constraints.

**Phase 1 precision (Phase 1 tasks):** The issue comment/close tasks are properly scoped with exact version claims ("verified working on CLI 1.0.44") and correctly identify this as a CLI-side behavior requiring CLI version gating, not SDK version gating.

**Type-safety awareness (Phase 2b fleet.ts, Risks):** The plan correctly identifies the `IdleData` type gap (runtime emits `backgroundTasks` but type only declares `aborted?`) and proposes counting `subagent.*` events instead of relying on untyped runtime fields. This is the right defensive pattern.

**Verification is concrete (Verification section):** Live-run validation of examples, explicit build+lint scoping (nodejs/ only, not full matrix), and clear deliverable checks.

**Doc placement is conservative (Phase 2c, Risks):** Defaulting to extending existing `custom-agents.md` rather than creating a new `fleet.md` follows the principle of minimal disruption unless maintainers request otherwise.

### Issues

#### Critical (Must Address Before Implementation)

None. The plan is architecturally sound and implementable.

#### Important (Should Address)

**Phase 2b: Example style compliance is unverified**
- Section/task: Phase 2b examples, Verification
- What's missing: The plan claims examples will "match `basic-example.ts` style" but doesn't specify the key conventions: header comment format, cliPath override pattern, auth notes, or console logging style. Spike code is raw research with different conventions than polished examples.
- Why it matters: Stylistic mismatches will trigger maintainer feedback rounds, slowing acceptance.
- Fix: Before implementation, read `basic-example.ts` line-by-line to extract the header comment template, cliPath pattern, console logging style, and error handling approach. Document these as mini-requirements in Phase 2b.

**Phase 2b: "tsx" execution claim needs verification**
- Section/task: Phase 2b examples
- What's wrong: The plan states "run via **tsx** (matching `basic-example.ts`)" but `basic-example.ts` has no shebang, no package.json script, and no documentation of how to run it. The plan assumes tsx is the runner without evidence.
- Why it matters: If upstream convention is `node --loader ts-node/esm` or `tsc + node dist/`, the examples won't match project patterns.
- Fix: Before implementation, check upstream README or CI for any example-running documentation. If no convention exists, propose one in the PR and flag it for maintainer confirmation.

**Phase 2c: Field table fix scope is unclear (subagent.completed optional fields)**
- Section/task: Phase 2c docs, subagent.completed
- What's ambiguous: `SubagentCompletedData` declares the proposed additions (`model`, `totalToolCalls`, `totalTokens`, `durationMs`) as **optional** fields. The doc tables need to reflect optionality correctly, not just add the fields.
- Why it matters: Incorrect required/optional markers will mislead SDK users, causing runtime errors when they assume fields are always present.
- Fix: When editing the field tables at lines 593 and 793, mark these fields as optional, matching the existing doc pattern for optional fields.

**Phase 2c: Agent tree reconciliation is vague (custom-agents.md ~line 681)**
- Section/task: Phase 2c docs, agent tree section
- What's unclear: The plan says "clarify that `agentId` equals the sub-agent's `toolCallId`" but doesn't specify whether this requires code example updates or just a prose note.
- Why it matters: Half-done clarifications create confusion. If the tree code stays unchanged with only a prose note, users won't know when to use which key.
- Fix: Before editing, decide: (1) add a comment above the existing tree code stating "`agentId` on event envelopes equals the sub-agent's `toolCallId`", or (2) extend the example to show both attribution patterns side-by-side. Document this decision.

**Phase 2d: DCO/CLA verification is deferred without a trigger**
- Section/task: Phase 2d PR, Risks
- What's missing: The plan says "confirm whether a CLA is also required before pushing" but doesn't specify how/when to check. This is gated work that could block PR submission at the worst moment.
- Fix: Add a pre-task at the start of Phase 2a: "Check `github/copilot-sdk` CONTRIBUTING.md for CLA/DCO requirements and authenticate gh CLI with appropriate scopes for PR creation."

#### Minor (Consider)

**Phase 2b: "concurrent-subagents.ts" is a near-duplicate**
- Both `subagent-tracking.ts` and `concurrent-subagents.ts` use the same attribution logic — the second just scales to three agents. Upstream may prefer one comprehensive example over two incremental ones.
- Suggestion: Consider merging into a single example that demonstrates both patterns in sequence, or flag the split explicitly in the PR for maintainer input.

**Phase 1: Issue closure wording is overly cautious**
- Claiming "verified on CLI 1.0.44; earlier versions may differ; invite maintainers to confirm lower bound" is technically correct but creates extra work. "Verified working on CLI 1.0.44 (SDK 0.3.0 peer-dep `^1.0.36-0`). Recommend gating on CLI ≥1.0.36, though exact lower bound untested" is more actionable.

**Risks: IdleData type bug — contain scope if you file the issue**
- Filing a 2-sentence repro issue is cheap and correct. But if maintainers pull you into schema/type-generation discussion, that IS scope creep. File with a one-line repro + spike link and don't engage further unless explicitly asked.

### Recommendations

- **Add a Phase 2e: Local pre-validation** — Before opening the PR, clone the fork locally, install deps, run `npm run build && npm run lint`, and live-run each example. Catch import path mistakes and missing dependencies before maintainers see them.
- **Document the spike-to-example transformation** — Add a 3-line header comment in each example: `// Derived from planning/spikes/<path> — simplified for SDK example style`. Helps maintainers trace provenance.
- **Gate Phase 1 with an explicit confirmation checkpoint** — Before running `gh issue comment`/`gh issue close`, emit "Ready to post evidence and close #2261. Continue?" and wait for user input. Prevents accidental public actions.
- **Consider a pre-fork spike-run refresh** — If time has passed since the spikes, re-run spike-09 before forking to confirm the evidence still holds on current SDK/CLI versions.

### Assessment

**Implementable as written?** Yes, with fixes

**Reasoning:** The plan is architecturally sound, evidence-backed, and correctly scoped to avoid upstream friction. The Important issues are clarifications and a missing CLA pre-check — not fundamental gaps. Address those before starting Phase 2b and execution is straightforward.
