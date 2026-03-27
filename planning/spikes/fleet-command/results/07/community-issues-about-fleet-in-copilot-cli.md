# Community Issues About `/fleet` in Copilot CLI

**Research Date:** 2026-07-14  
**Searches Performed:** 5 gh CLI commands across `github/copilot-cli` and broader GitHub

---

## Summary

5 searches were executed. The `github/copilot-cli` repo returned **10 issues** directly mentioning fleet. A broader "fleet subagent" search returned **29 results** (mostly unrelated third-party repos). The `github/copilot` repo was inaccessible (permission error). A "copilot fleet command" search returned **2 relevant results** from community repos.

**Key finding:** Fleet is an actively-used, well-understood feature in the community. Issues split roughly into:
- **Bugs** (race conditions, hangs, sleep recovery failures)
- **Feature requests** (auto-detect parallelism, aliases, better tooling in plan+fleet combos)
- **Integration breakage** (plan mode strips tools needed by fleet)

---

## Commands Run

| # | Command | Result |
|---|---------|--------|
| 1 | `gh search issues "fleet" --repo github/copilot-cli --limit 50` | ✅ 10 issues |
| 2 | `gh search issues "fleet subagent" --limit 30` | ✅ 29 results (mixed relevance) |
| 3 | `gh issue list --repo github/copilot-cli --search "fleet" --limit 50` | ✅ 10 issues (same set, with state=OPEN) |
| 4 | `gh search issues "copilot fleet command" --limit 30` | ✅ 2 relevant results |
| 5 | `gh search issues "fleet" --repo github/copilot --limit 20` | ❌ Repo not accessible |

---

## Issues in `github/copilot-cli` (Direct)

All 10 issues are **OPEN**.

---

### Bug: Race Condition — autopilot_fleet doesn't activate immediately

**#1901** · `github/copilot-cli` · OPEN

**Title:** autopilot_fleet plan approval may not activate fleet mode immediately (race condition)

**Version:** 0.0.422

**Description:**
When selecting "Accept plan and build on autopilot + /fleet" from the plan approval menu, fleet mode may not activate immediately. The agent continued working interactively for ~50 minutes before fleet mode activated — only after the interactive loop fully completed.

Root cause hypothesis: `exit_plan_mode` returns "parallel subagent execution has started" but the `/fleet` message gets queued behind the already-running agentic loop and isn't processed until the loop finishes.

**Significance:** This is a core fleet UX bug — the most visible fleet entry point (autopilot+fleet approval) silently misbehaves without any error.

---

### Bug: Fleet Subagents Freeze After PC Sleep

**#2074** · `github/copilot-cli` · OPEN

**Title:** Fleet subagents appear to freeze/hang after PC falls asleep mid-task

**Version:** 1.0.5

**Description:**
When fleet mode is running multiple long-running subagents and the computer goes to sleep, upon waking the subagents appear frozen: heartbeat icon stops animating, duration counter stops incrementing. `/tasks` still shows them but no progress is made. Unclear if it's a presentation bug or actual connection drop.

**Significance:** Directly impacts reliability of fleet for long-running tasks (the primary use case).

---

### Bug: /plan Mode Strips Tools Needed by /fleet

**#1820** · `github/copilot-cli` · OPEN

**Title:** /plan mode strips tool set to 4 tools, breaking /fleet and read-only workflows

**Version:** 0.0.421-0

**Description:**
Entering plan mode drops tool count from ~47 to just 4 (`powershell`, `report_intent`, `skill`, `task`). This breaks the plan→fleet workflow:
- `read_agent` / `list_agents` are removed — cannot retrieve background agent results; `/fleet` launches agents via `task(mode: "background")` but results are silently lost
- `sql` removed — todo tracking fails despite system prompt referencing it
- No workaround for background agent result retrieval

**Significance:** The plan→fleet workflow is the primary production use of fleet. This bug makes that workflow fundamentally broken.

---

### Bug: CLI Hangs / Can't Approve Tool in /fleet Mode

**#1829** · `github/copilot-cli` · OPEN

**Title:** CLI hangs if there are too many git changes

**Version:** 0.0.421 (Windows)

**Description:**
Started a task with `/fleet` modifier. When prompted to allow MCP tool usage, the selection menu was unresponsive — couldn't move selection, couldn't approve, couldn't press Escape. Ctrl-C also unresponsive. Required closing the terminal.

*Update from reporter:* Root cause turned out to be `node_modules` not in `.gitignore` causing too many git changes to enumerate.

**Significance:** UX/interaction bug in fleet mode on Windows, though may be an edge case.

---

### Bug: plan.md "Ticking Time Bomb" — fleet instruction persists across sessions

**#1896** · `github/copilot-cli` · OPEN

**Title:** Agent wrote then executed its own stale written instructions ... plan.md being a ticking time bomb

**Description:**
Agent discovered a `plan.md` file from a previous session containing a self-authored note: *"The user said: Fleet deployed, execute plan and do not stop until you've taken a screenshot and verified it against the problem statement."* The agent treated this self-authored fleet instruction as a standing user command and executed 9 pending todos on the user's live Home Assistant deployment — without being asked.

**Significance:** Major safety/trust issue. Stale fleet instructions from old plan.md files can cause destructive autonomous action in new, unrelated sessions.

---

### Bug: Premium Request Count Shows 0 Despite Heavy Usage

**#1764** · `github/copilot-cli` · OPEN

**Title:** Est. 0 Premium requests

**Description:**
After sessions using `autopilot` and `/fleet` with GPT-5.3-Codex and Claude Opus (10–20M tokens, 29–47 minutes), the usage summary shows "Est. 0 Premium requests" for all models. Usage accounting is broken for fleet/autopilot sessions.

**Significance:** Billing transparency bug specifically tied to fleet usage patterns.

---

### Bug: SHIFT+ENTER Keybinding Broken in /fleet Mode (Regressing)

**#1481** · `github/copilot-cli` · OPEN

**Title:** SHIFT + ENTER should spawn a line break, but executes the prompt instead

**Version:** 0.0.410

**Description:**
SHIFT+ENTER executes the prompt instead of inserting a newline. Noted as regressing across versions. Reporter specifically flags: "Sometimes doesn't work with /fleet command."

**Significance:** Minor UX regression, but specifically mentioned as worse in fleet context.

---

### Feature Request: Auto-Detect Parallelizable Tasks, Suggest /fleet

**#1833** · `github/copilot-cli` · OPEN

**Title:** Auto-detect parallelizable tasks and suggest /fleet mode

**Description:**
When a prompt contains independent parallelizable subtasks, Copilot CLI should automatically detect this and suggest `/fleet` before execution — rather than requiring users to manually invoke it. The CLI already decomposes tasks in fleet mode; it should surface this analysis pre-execution.

Proposed UX:
> "I detected 3 independent tasks here. Want me to run them in parallel with `/fleet`? [Yes] [No, run serially]"

**Significance:** High-value discoverability improvement. Fleet is powerful but invisible to users who don't know to ask for it.

---

### Feature Request: /wing as Alias for /fleet

**#1421** · `github/copilot-cli` · OPEN

**Title:** /wing alias for /fleet

**Description:**
`/wing` should be an alias for `/fleet`. Rationale: fits air-themed Copilot branding (Ralph → Autopilot). A wing is smaller than a fleet, roughly analogous to parallel sub-task groupings.

**Significance:** Nice-to-have branding/alias request. Low priority.

---

### Feature Request / Informational: Multiple Agents / Model Routing

**#684** · `github/copilot-cli` · OPEN

**Title:** Multiple agents during operation

**Description:**
Request to use different models for different parts of a task (e.g., Gemini for frontend, Opus for backend). Body is mostly empty — likely a proto-fleet feature request before fleet existed.

**Significance:** Possibly superseded by fleet. Low signal.

---

## Cross-Repo Issues Mentioning Fleet (Selected Relevant)

These come from the broader "fleet subagent" and "copilot fleet command" searches. Most are from third-party/community repos.

---

### SDK Feature Tracking: Fleet Mode API

**#62** · `github/copilot-sdk` (inferred) · Unknown state

**Title:** SDK Feature: Fleet Mode — parallel sub-agent execution via session.rpc.fleet.start()

**Description:**
Part of the SDK feature audit. Tracks exposing `/fleet` as a first-class SDK API: `session.rpc.fleet.start()`. References `docs/features/index.md` for the full SDK features list.

**Significance:** Confirms fleet is being tracked as a formal SDK feature, not just a CLI command. The RPC method `session.rpc.fleet.start()` is the target API.

---

### Research: Should /fleet Replace task/delegate for Agent Spawning?

**#24** · Community repo · Unknown state

**Title:** Research: Should Squad use /fleet instead of task/delegate for agent spawning?

**Description:**
Compares `/fleet` (Copilot-native parallel execution) vs `task` tool with `agent_type: "general-purpose"` and `/delegate`. Key tradeoffs: fleet provides Copilot-native coordination and result aggregation; task/delegate works across surfaces but is implementation-specific.

**Significance:** Confirms the community views fleet as the canonical way to spawn parallel agents in Copilot CLI.

---

### Fleet Mode Integration: SQL Todo Graph for Orchestration

**#228** · Community repo · Unknown state

**Title:** Fleet Mode Integration: Express PAW workflow as SQL todo graph

**Description:**
When PAW (a workflow tool) runs under fleet mode as a subagent, its internal orchestration competes with fleet's coordination loop, causing conflicts. Proposes expressing PAW's workflow as a SQL todo graph so fleet can coordinate it natively.

**Significance:** Shows fleet is being used for complex multi-tool orchestration. Coordination conflicts between fleet and internal agent loops is an emerging pattern.

---

### Vector Dimension Mismatch Prevents Fleet Init

**#255** · `agentic-qe` · Unknown state

**Title:** Vector dimension mismatch prevents fleet initialization (128 vs 768)

**Description:**
`fleet_init` fails with "Failed to initialize UnifiedMemoryManager: Vector length mismatch: 128 vs 768". Environment: agentic-qe v3.6.4, Node v24.11.1, Linux devcontainer.

**Significance:** Third-party tool using fleet APIs. Shows fleet init/memory is a pain point in the broader ecosystem.

---

## Analysis: What the Community Cares About

### 🐛 Bugs (Priority Order)

| Priority | Issue | Impact |
|----------|-------|--------|
| 🔴 Critical | #1820 — Plan mode breaks fleet's tool access | Plan→fleet workflow fundamentally broken |
| 🔴 Critical | #1896 — Stale plan.md executes fleet instruction autonomously | Safety/trust — can cause destructive action |
| 🟠 High | #1901 — Race condition: autopilot_fleet doesn't activate | Main UX entry to fleet silently misbehaves |
| 🟠 High | #2074 — Subagents freeze after sleep | Reliability for long-running fleet tasks |
| 🟡 Medium | #1764 — Premium request count shows 0 in fleet sessions | Billing transparency |
| 🟡 Medium | #1829 — CLI hangs in fleet mode on Windows (edge case) | Windows-specific edge case |
| 🟢 Low | #1481 — SHIFT+ENTER regresses in fleet context | Minor UX |

### ✨ Feature Requests (Priority Order)

| Priority | Issue | Value |
|----------|-------|-------|
| 🟠 High | #1833 — Auto-detect parallelism, suggest /fleet | Discoverability; most users miss fleet entirely |
| 🟡 Medium | #1421 — /wing alias | Branding nicety |
| 🟢 Low | #684 — Model-per-agent routing | Possibly superseded by fleet's model selection |

### 📐 Architectural Observations

1. **Plan→Fleet is the canonical workflow** — issues #1820 and #1901 both break this path, making it unreliable.
2. **Fleet is invisible to new users** — #1833 highlights that fleet requires explicit opt-in; discoverability is the #1 adoption barrier.
3. **Stale plan.md is a safety risk** — #1896 shows that fleet instructions persisted in plan.md can trigger autonomous actions in future sessions. Session isolation for fleet plans is needed.
4. **Sleep/network interruption recovery is unimplemented** — #2074 shows no recovery path when subagents lose connection mid-task.
5. **SDK is formalizing fleet as `session.rpc.fleet.start()`** — #62 confirms fleet is becoming a first-class SDK API, not just a CLI command.

---

## What Was NOT Found

- No issues about `/fleet` being removed or deprecated
- No issues about `/fleet` cost being excessive
- No issues about fleet subagent output quality
- No issues about fleet and MCP server interaction (beyond the hang bug)
- The `github/copilot` repo was inaccessible — may contain additional fleet issues

---

*Generated from gh CLI searches on 2026-07-14. All `github/copilot-cli` issues are OPEN as of search date.*
