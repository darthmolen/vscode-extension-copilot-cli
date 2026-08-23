# v5.0 Gap Register — AHP/ACP split

**Compiled:** 2026-08-15 against VS Code 1.133, AHP `main`, ACP `main`
**Companion docs:** [agent-host-ahp-watchlist.md](../backlog/vscode-apis/agent-host-ahp-watchlist.md) · [spike FINDINGS](../spikes/acp-agent/FINDINGS.md)

Every gap between where we are and the target architecture:

```text
our extension (AHP client + VS Code integration)  ──AHP──▶  host  ──ACP──▶  our agent ──▶ Copilot SDK
```

## Categories

| Cat | Meaning | What we do about it |
| --- | --- | --- |
| **a** | Already part of their plan / shipped upstream | Consume it |
| **b** | Net-new upstream, but adjacent enough to argue for | File an RFD or issue, with a confidence score |
| **c** | Net-new, we write it | Estimate difficulty and possibility |
| **d** | Actively being worked to closure upstream | Track; gauge readiness |

Confidence (b) = odds the upstream project accepts the ask.
Difficulty (c) = our build cost. Both are judgement calls, stated so they can be argued with.

---

## Category A — shipped upstream, just consume

| Gap | Where it landed | Note |
| --- | --- | --- |
| Agent discovery + distribution | **ACP Agent Registry RFD — Completed** | `agent.json` manifests, `npx`/`binary`/`uvx` distribution. The "how would anyone find and launch our agent" problem is solved and we did not have to ask. |
| Provider metadata on the wire | **ACP `_meta` propagation RFD — Completed** | `_meta` on every type, `{ [key: string]: unknown }`. Where dock extras ride. Clients must render coherently without it — a constraint on us, not a blocker. |
| Sub-agent modelling | **AHP `ChatOrigin.Tool`** | `{ kind: Tool, chat, toolCallId }` — a sub-agent is a separate chat keyed by the spawning tool call. Matches our `agentId == toolCallId` contract exactly. |
| Dock visibility semantics | **AHP `ChatInteractivity`** | `Full` / `ReadOnly` / `Hidden`. Encodes the dock's master/detail rule on the wire. |
| Inline diff data | **AHP changeset channel** | `ChangesetFile { id, edit: FileEdit, reviewed? }`, per-turn slices, `capabilities.review`. Enough to drive editor decorations. |
| Plan representation | **ACP `plan_update`** | `planId` + entries with `content`/`priority`/`status`. |
| Session multiplicity | **AHP multi-chat** | "One scope, many streams." Explicitly scoped to *observability, not agent runtime* — our loop stays ours. |
| TypeScript client | **`@microsoft/agent-host-protocol`** | `AhpClient` + `WebSocketTransport` on npm. The client half does not start from zero. |

## Category D — actively being worked to closure

Track these; they gauge how close the substrate is.

| Gap | Signal | Readiness |
| --- | --- | --- |
| AHP protocol stability | Issues titled **"1.0.0 blocker"** open *and closing* on `microsoft/agent-host-protocol` | Moving. This is the watch-list's first revisit trigger and it is live. |
| ACP permission requests | RFD `v2/permission-requests` — **Active** | Relevant if we ever front permissions through the host rather than `approveAll`. |
| ACP diff file states | RFD `v2/diff-file-states` — **Active** | Adjacent to our changeset consumption. |
| ACP plan variants | RFD `v2/plan-variants` — **Active** | Watch: could change how plan mode maps. |
| ACP tool call updates | RFD `v2/tool-call-updates` — **Active** | Shapes how our tool traffic renders in other clients. |
| ACP client filesystem/terminal capabilities | RFD `v2/client-filesystem-terminal-capabilities` — **Active** | The mechanism by which our agent could ask the *client* to do host things. Directly relevant to the FileSnapshot seam below. |
| MCP over ACP | RFD `mcp-over-acp` — **Draft** | Would let a client contribute MCP servers to an agent. |

## Category B — net-new upstream, we should argue for it

| # | Gap | Venue | Confidence | Argument |
| --- | --- | --- | --- | --- |
| B1 | **VS Code's Agent Host will not front a third-party agent** | [vscode#325827](https://github.com/microsoft/vscode/issues/325827) | **Low–Medium** | Untriaged, zero comments, no milestone, no `agentHost` proposal file exists in `vscode-dts`. But it is community-filed with a real precedent (remote hosts already discover agents from `rootState.agents`). Our contribution is the reframing: ACP is already the documented adapter seam, so this may need exposing rather than designing. |
| B2 | **No way to connect the Agents window to a localhost AHP host** | New, narrow vscode issue | **Medium** | Concrete and verifiable: `code agent host` already serves AHP over WebSocket with a token, and [#311105](https://github.com/microsoft/vscode/issues/311105) treats "VS Code + local agent host" as a supported configuration — yet the picker offers only Tunnels and SSH. Small ask, competes with nobody's design, hardest to close as a duplicate. |
| B3 | **Is ACP-as-adapter a third-party extension point or an internal detail?** | [AHP#282](https://github.com/microsoft/agent-host-protocol/issues/282) | **High** (of getting an answer) | Not a feature request — a question that costs them nothing and decides our roadmap. @joshmouch answered at length there and offered a doc PR. Either answer is useful to us. |
| B4 | **Client-published MCP servers are `MAY`, not `MUST`** | AHP issue or RFD | **Medium** | `ClientPluginCustomization` exists and MCP servers arrive as children of a client plugin, but the host *may* parse them. We need to know whether VS Code's host does, or our MCP defaults silently vanish. |

## Category C — we write it

| # | Gap | Difficulty | Possible? | Note |
| --- | --- | --- | --- | --- |
| C1 | Decouple the manager from the extension host | **Done** | ✅ | Phase 0.1. `HostBridge`, 13 sites, two `backendState` holes closed. Proven by a test that bans the `vscode` module. |
| C2 | Wrap the manager as an ACP server | **Medium** | ✅ Likely | The 16 `BufferedEmitter` events are already JSON-serializable and map onto `session/update`. Prior estimate for the *inverse* direction was ~400 LOC; outward should be comparable. Scaffolding exists in `tests/harness/acp-spike.mjs` (NDJSON framing, cancel-as-notification, double-nested permission outcome). |
| C3 | Webview becomes an AHP client | **High** | ✅ but large | The biggest item. 66 message types today, **no store/reducer anywhere** — all imperative DOM, state split across module-level `let`s, component fields, and the DOM itself. AHP demands channels, subscriptions, action envelopes, reconciliation. Overlaps almost exactly with the v4.1 React rewrite, so plan them as one job, not two. |
| C4 | `FileSnapshotService` temp files across a process boundary | **Medium** | ✅ | The host must still read both paths to compute the inline diff and hand them to `vscode.diff`. Either the agent writes to a host-readable location, or we adopt the changeset channel and stop shipping paths. The ACP `client-filesystem` RFD (Active, D above) is the principled route. |
| C5 | Sub-agent dock handles arbitrary nesting | **Medium** | ✅ | AHP permits unbounded depth and dangling `origin.chat` references. Our dock is flat and `agentId`-keyed. Needs recursive ancestry with cycle guards and missing-reference tolerance. |
| C6 | Settings snapshot + headless recovery for the agent process | **Low** | ✅ | The spike stubbed both. A real agent needs config passed in at startup and `askSessionRecovery` answered without a UI. |
| C7 | Collapse the duplicate CLI resolution | **Low** | ✅ | `SDKSessionManager.resolveCliPath()` does not use `CliBundleService`; two independent resolution paths coexist, and `ensureNodeExecPath` mutates global `process.execPath`. **Deliberately deferred** — load-bearing for launch on Windows/Node 24 and thinly covered by tests. See ticket. |
| C8 | Our own AHP host | **High** | ✅ | **Deferred** by the hybrid posture. Only needed if B1/B2 both fail. Would make us independent of Microsoft's timeline entirely. |

---

## Where the risk actually sits

Phase 0.2 cleared the risk everyone assumed was fatal — plan mode's host-side
tool closures **do** survive out-of-host (8/8, live SDK, real `plan.md` write).
So the agent half is de-risked.

What remains is not evenly distributed:

- **Category C is large but tractable**, and C3 dominates it. Nothing in C is
  blocked on anyone else.
- **Category B is the real dependency**, and B1 — the one that decides whether
  we can ever appear in VS Code's picker — has the lowest confidence of
  anything on this page.

That asymmetry is what the hybrid posture is for: **C2 pays off regardless**
(any AHP host, Zed and other ACP clients, our own host later), while B1 stays
someone else's decision.
