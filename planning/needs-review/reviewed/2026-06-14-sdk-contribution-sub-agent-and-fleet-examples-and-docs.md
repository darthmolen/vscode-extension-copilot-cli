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
2. `gh issue close 2261 --repo github/copilot-cli` with a short "resolved as of CLI 1.0.x" note.

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
- `fleet.ts` — `session.rpc.fleet.start({ prompt })` **fire-and-forget**; detect completion via
  `session.idle` with empty `backgroundTasks.agents`; demonstrate that fleet dispatches
  **registered custom agents**. Derived from `spike-08-fleet-1054.mjs` + `spike-09-custom-agent-dispatch.mjs`.
- Each example: header comment explaining intent, `cliPath`/auth notes, runnable via
  `node`/`tsx`; typecheck + lint clean.

### 2c. Docs
- `docs/features/streaming-events.md` — add the envelope **`agentId`** attribution (the
  universal per-sub-agent key, present on tools and messages) and the
  **`includeSubAgentStreamingEvents`** option (default `true`), alongside the existing
  `parentToolCallId` material. Cross-link the new examples.
- `docs/features/custom-agents.md` — add a **"Fleet / parallel dispatch"** section:
  `rpc.fleet.start` usage, its blocking/fire-and-forget behavior, completion via `session.idle`,
  and that fleet dispatches the session's registered custom agents (with the `@experimental`
  caveat). (If reviewers prefer, split into a new `docs/features/fleet.md`.)

### 2d. PR (gated)
- Run tests + linters per `CONTRIBUTING.md`; ensure examples build. DCO sign-off on commits.
- Open PR to `github/copilot-sdk` titled for examples+docs, linking the spike findings and
  noting it adds no API surface (examples/docs only). Reference #2261's resolution.

## Risks / open questions

- **Roadmap-alignment rule** (CONTRIBUTING) — mitigated by examples/docs-only scope; flag in PR.
- **Fleet is `@experimental`** — examples/docs must state the API may change.
- **DCO/CLA** sign-off likely required — confirm before pushing.
- **Doc placement** — extend `custom-agents.md` vs new `fleet.md`; let reviewers steer.
- **Example runner** — `.ts` via the repo's existing toolchain (tsx/build) vs `.mjs`; match
  whatever `basic-example.ts` uses.

## Verification

- Examples run end-to-end against a live CLI (Node 24, local `@github/copilot` ≥ 1.0.44),
  producing the documented output (attributed sub-agent feed; fleet completion).
- `nodejs/` build + lint pass; repo test harness green per CONTRIBUTING.
- Docs render; internal links and example references resolve.
- #2261 shows our evidence comment and a closed state.

---

## Plan Review

**Reviewed:** 2026-06-18 17:24
**Reviewer:** Claude Code (plan-review-intake)

### Strengths

**Evidence-based with verifiable spike work (Context, Phase 1):** Grounded in concrete spike findings from `planning/spikes/fleet-command/results/09/` and `planning/spikes/adhoc-subagent/`, with reproducible evidence on SDK 0.3.0 / CLI 1.0.44.

**Defensively scoped (Context, Scope guard):** The plan explicitly limits itself to examples + documentation only, correctly avoiding feature PRs requiring cross-language parity and roadmap alignment per upstream CONTRIBUTING.md.

**Phase structure is logical:** Phase 1 (issue closure) before Phase 2 (contribution) creates a natural checkpoint for user confirmation before any outward-facing actions.

**Gating acknowledgment (Context, Phase 1, Phase 2d):** GitHub operations are correctly identified as requiring explicit user confirmation before execution.

### Issues

#### Critical (Must Address Before Implementation)

**Phase 2b: `fleet.ts` uses untyped runtime field (`session.idle.backgroundTasks`)**
- Section/task: Phase 2b, fleet.ts example
- What's wrong: The plan says fleet.ts should "detect completion via `session.idle` with empty `backgroundTasks.agents`". This field is **not present in the Node SDK `IdleData` type** — only `aborted?: boolean` exists. This creates a TypeScript example that would fail typecheck or require unsafe type assertions.
- Why it matters: SDK examples must be type-safe. Relying on undocumented runtime fields that aren't in the type definitions is a pattern upstream maintainers will reject.
- Fix: Use type-safe `subagent.*` event counting instead — track `subagent.started` vs `subagent.completed`/`subagent.failed` counts to detect completion. The spike already tracks these counters; key on those, not `backgroundTasks`.

**Phase 2c: Missing doc fix for `subagent.completed` field table**
- Section/task: Phase 2c docs, streaming-events.md
- What's missing: The plan adds `agentId` and `includeSubAgentStreamingEvents` but does NOT mention fixing the existing incomplete `subagent.completed` field table. Current SDK docs list only `toolCallId`/`agentName`/`agentDisplayName` at ~lines 593 and 793, omitting `model`, `totalToolCalls`, `totalTokens`, `durationMs` — fields the subagent-tracking.ts example will depend on.
- Why it matters: If the example uses `subagent.completed.totalTokens` but the docs don't document that field, the contribution looks incomplete and users will be confused.
- Fix: Add task to Phase 2c: "Fix the incomplete `subagent.completed` field tables at ~lines 593 and 793 in streaming-events.md — add `model`, `totalToolCalls`, `totalTokens`, `durationMs` as optional fields."

**Phase 2c: Missing agent tree reconciliation task**
- Section/task: Phase 2c docs, custom-agents.md
- What's missing: The plan adds fleet documentation promoting `agentId` as "the universal key" but doesn't address the existing "Building an Agent Tree UI" section (~line 681) which keys attribution on `toolCallId`. This creates inconsistent guidance within the same document.
- Why it matters: Two attribution patterns with no reconciliation will confuse users about which to use and when.
- Fix: Add reconciliation task: "Clarify in the existing tree section that the envelope `agentId` equals the sub-agent's `toolCallId` and is additionally present on message/delta events — making it the more universal key. Augment, don't rewrite the existing pattern."

#### Important (Should Address)

**Phase 1: Issue close wording is too broad ("CLI 1.0.x")**
- Section/task: Phase 1, task 2
- What's wrong: Claiming "resolved as of CLI 1.0.x" is an untested assertion — spike evidence is only for CLI 1.0.44 specifically.
- Fix: Narrow to: "verified working on CLI 1.0.44 (SDK 0.3.0 peer-dep `^1.0.36-0`). Earlier 1.0.x versions may differ; maintainers can confirm lower bound."

**Phase 2b: Example style matching is unverified**
- Section/task: Phase 2b examples
- What's unclear: "match `basic-example.ts` style" is not defined — header comment format, cliPath pattern, auth notes, console logging style, and error handling conventions are all unspecified.
- Fix: Add pre-task to Phase 2b: "Read `basic-example.ts` to extract style conventions and apply them consistently to all new examples."

**Phase 2b: Examples lint/typecheck scope is ambiguous**
- Section/task: Phase 2b examples, Phase 2d PR checks
- What's unclear: "typecheck + lint clean" is asserted but `nodejs/examples/` may be outside the repo's lint/tsconfig scope. No validation path is specified if repo tooling doesn't cover examples.
- Fix: Clarify that examples are validated by **live-run**. Note that `examples/` may be out of repo tooling scope; optionally propose a dedicated `examples/tsconfig.json` in the PR as a reviewer-driven improvement, but don't block on it.

**Phase 2b: "tsx" runner assumed without verification**
- Section/task: Phase 2b examples
- What's wrong: "runnable via `node`/`tsx`" is asserted but the upstream convention for `basic-example.ts` is unverified.
- Fix: Add pre-task to Phase 2a: "Check `basic-example.ts` and upstream README/CI for example execution conventions before writing new examples."

**Phase 2d: DCO/CLA check deferred without trigger**
- Section/task: Phase 2d PR, Risks
- What's missing: No specific when/how for confirming DCO/CLA requirements — could block PR at the worst moment.
- Fix: Move to Phase 2a as a pre-task: "Check `github/copilot-sdk` CONTRIBUTING.md for DCO/CLA requirements and ensure gh CLI auth scopes support PR creation."

**Verification: Missing pre-validation step**
- Section/task: Verification
- What's missing: No step for locally validating the fork before opening the PR.
- Fix: Add Phase 2e: "Clone the fork, install deps, run `npm run build && npm run lint` (nodejs/ scope), and live-run each example. Catch import path or dependency issues before the PR is open."

#### Minor (Consider)

**Phase 2b: Two similar examples may be redundant** — `subagent-tracking.ts` (1 sub-agent) and `concurrent-subagents.ts` (3 sub-agents) share the same core attribution logic. Consider merging or explicitly flagging the split in the PR for maintainer feedback.

**Risks: IdleData type bug — contain scope** — If you file an upstream issue about the `backgroundTasks` type gap, limit it to a 2-sentence repro + spike link. Disengage unless maintainers explicitly ask for more; schema-generation discussions are scope creep.

**Phase 1: Explicit confirmation checkpoint missing** — Add an explicit "Stop and wait for user input: 'Ready to post evidence and close #2261. Continue?'" before running `gh issue comment`/`gh issue close`.

### Recommendations

1. **Fix the Critical issues before any implementation** — The `backgroundTasks` type mismatch is a fundamental flaw that will cause fleet.ts to be rejected upstream. The missing doc tasks make the contribution incomplete as-is.
2. **Add explicit confirmation checkpoints** for Phase 1 GitHub actions and Phase 2d PR submission.
3. **Verify conventions early in Phase 2a** — Read `basic-example.ts`, confirm runner pattern, DCO/CLA before writing any example code.
4. **Add Phase 2e for pre-validation** before PR submission.
5. **Document spike provenance** — Add header comments: `// Derived from planning/spikes/<path> — adapted for SDK example style`.

### Assessment

**Implementable as written?** No

**Reasoning:** The fleet.ts example design relies on `session.idle.backgroundTasks` which does not exist in the SDK's TypeScript `IdleData` type — upstream will reject this as type-unsafe. Combined with the missing `subagent.completed` field table fixes and the absent agent tree reconciliation task, the contribution would be incomplete. These are fundamental flaws requiring fixes before implementation can proceed.
