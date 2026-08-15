# Agent Host / AHP — Watch List

**Status:** Watching, not building — but the target architecture is now known, and our ACP work is on its critical path.
**Researched:** 2026-08-14 (against VS Code 1.133, released 2026-08-12; AHP `main` as of the same date)
**Predecessor:** the 2026-05-27 `chatSessionsProvider` decision — same question, earlier architecture.

## Problem/Opportunity

VS Code now runs agents in a dedicated **Agent Host** process, speaking the **Agent Host Protocol (AHP)**, and surfaces them in a dedicated **Agents window**. This extension is not in that world: our `SDKSessionManager` drives the Copilot SDK loop inside the extension host and renders to our own webview sidebar.

The open question is whether we can appear as a first-class harness alongside Copilot, Claude, and Codex — and specifically whether the `local` harness option is a slot we can occupy.

**Answer: no, and `local` is not that slot. But AHP/ACP describes a seam that fits us, and it is not yet reachable.**

## Landscape (as of 2026-08-14)

- **Agent Host — preview.** A dedicated process running agent harnesses, talking to clients over AHP (JSON-RPC; message-port for local IPC, WebSocket for remote). Gated behind `chat.agentHost.enabled`. Docs: *"under active development, and new capabilities continue to roll out."*
  → [Agent Host architecture](https://code.visualstudio.com/docs/agents/concepts/agent-host)

- **AHP spec — draft, breaking changes promised, but actively driving at 1.0.** MIT-licensed at [microsoft/agent-host-protocol](https://github.com/microsoft/agent-host-protocol), positioned as the LSP/DAP of agents. Verbatim warning: *"UNDER ACTIVE DEVELOPMENT - This protocol is under active development and is not yet stabilized. Breaking changes to wire types, actions, and state shapes are expected."* The repo carries issues explicitly titled **"1.0.0 blocker"**, so the first revisit trigger below is live, not hypothetical.
  → [What is AHP?](https://microsoft.github.io/agent-host-protocol/guide/what-is-ahp.html)

- **Agents window — shipped to stable in 1.120 (May 2026), still labelled preview.** Extensions participate only via the `extensions.supportAgentsWindow` opt-in, and must already be installed in the **default profile**. It hosts Copilot/cloud/Claude/Codex sessions that run on the Agent Host; **local harnesses are directed to the main VS Code window instead** — so our sidebar is unaffected either way.
  → [Use the Agents window (Preview)](https://code.visualstudio.com/docs/agents/run/agents-window)

- **`local` is a harness, not an extension point.** Defined as *"the built-in VS Code harness runs in the extension host and can use VS Code tools, extension-provided tools, MCP servers, and models configured in VS Code."* That is Microsoft's own agent loop. Extensions contribute *into* it — LM tools, MCP servers, `.agent.md` custom agents via `vscode.chat.registerCustomAgentProvider()`, model providers — but cannot own it. There is no seam where our SDK-driven loop becomes `local`.
  → [Agent harnesses](https://code.visualstudio.com/docs/agents/concepts/agent-harnesses)

- **ACP is the documented host-facing adapter interface.** *"The host is acting as a bridge: it speaks AHP upstream (to clients) and ACP downstream (to agents)."* So the extension point for an agent runtime is **specified**, not missing — an agent participates by speaking ACP to a host. Caveat from the maintainer on [agent-host-protocol#282](https://github.com/microsoft/agent-host-protocol/issues/282): the bridge is *"currently only described… the repo ships the protocol types, the JSON schemas, and the AHP client libraries, but **no host and no ACP code at all**."* VS Code's host implements it for its built-in adapters and exposes no way to point it at ours.
  → [AHP and ACP](https://microsoft.github.io/agent-host-protocol/guide/ahp-and-acp.html)

- **The gap is a known, open, untriaged request.** [microsoft/vscode#325827](https://github.com/microsoft/vscode/issues/325827) — "Support registration of external agents via Extension API in the agents view." Asks for `vscode.agentHost.registerAgentProvider()`. Opened 2026-07-14 by a community member, assigned @joshspicer, **zero comments, no labels, no milestone**. First-party adapters are compiled into the Agent Host process (`agentHostMain.ts`), and **no `agentHost` proposal file exists** in `src/vscode-dts/`.

- **Self-hosting exists internally but isn't pointable at us.** [microsoft/vscode#311105](https://github.com/microsoft/vscode/issues/311105) (closed, milestone 1.117.0) is a test-plan item covering "VS Code + local agent host" as a supported configuration. `code agent host` serves AHP over WebSocket with a connection token. But the Agents window picker offers only **Tunnels and SSH** — no path to a host on 127.0.0.1 that VS Code didn't start itself.

## AHP already models sub-agents — and models them the way we do

This is the most consequential finding, and it was not where we expected. It lives in `types/channels-chat/state.ts` and `docs/specification/chat-channel.md`, not in the RFCs.

```ts
export type ChatOrigin =
  | { kind: ChatOriginKind.User }
  | { kind: ChatOriginKind.Fork;     chat: URI; turnId: string }
  | { kind: ChatOriginKind.SideChat; chat: URI; turnId: string; selection?: SideChatSelection }
  | { kind: ChatOriginKind.Tool;     chat: URI; toolCallId: string };   // ← sub-agent
```

A sub-agent is a **separate chat** whose origin names the spawning chat and `toolCallId`. Our attribution contract is `agentId == spawning task's toolCallId` — the same key, arrived at independently.

| Our dock | AHP equivalent |
| --- | --- |
| `agentId`-keyed sub-agent buffer | A distinct chat, `origin: { kind: Tool, chat, toolCallId }` |
| Sub-agent traffic kept out of the main transcript | Structural — worker traffic lives on its own chat channel, never inline |
| Master/detail list | `SessionState.chats` catalog + origin edges |
| Pop-out tab | Subscribe to that chat's channel directly |
| Dock-only visibility rule | `ChatInteractivity`: `Full` / `ReadOnly` / `Hidden` |

`ChatInteractivity`'s doc comment reads almost as a description of the dock: *"Supports the agent-team pattern where a lead chat is fully interactive and worker chats are read-only (visible for observability) or hidden (internal implementation detail)."* The parent side is covered by `ToolResultSubagentContent` (forward edge to the worker chat URI; *"hosts MUST keep the two consistent"*), and `SystemNotificationResponsePart` is exampled with *"background subagent X completed."*

`docs/proposals/multi-chat.md` gives the rationale. Two framings matter to us:

- **"Scope vs. stream is the whole idea. One scope, many streams."** A session is the coordination scope (workspace, model, config); a chat is an independently-followable stream over it.
- **"The feature is about observability and interaction, not agent runtime."** Harness-internal coordination — spawning workers, routing tasks, collecting results — explicitly stays inside the harness and never crosses the wire. There is deliberately **no chat-to-chat messaging** primitive.

That second line is the important one: AHP's multi-chat occupies exactly the layer our dock occupies, and leaves the layer `SDKSessionManager` occupies alone.

Things we'd gain for free: per-chat working directory (worktree-per-worker), and an aggregated session rollup where "needs input" bubbles up from any chat to a single session status chip.

Things we'd have to build: AHP permits **arbitrary nesting depth** with no protocol cap, and origin chains may dangle (a parent can be pruned while its worker lives). Our dock is flat and `agentId`-keyed; recursive ancestry with cycle guards and missing-reference tolerance would be new work.

## Target architecture, if this opens

Today we straddle both layers: `SDKSessionManager` is the agent runtime *and* the webview is the client, joined by our own 31-message RPC in `src/shared/messages.ts`.

```text
webview  ──AHP──▶  Agent Host  ──ACP──▶  SDKSessionManager ──▶ Copilot SDK
```

- **Webview becomes an AHP client** — channels, subscriptions, action envelopes, reconciliation, replacing the bespoke RPC. Roughly the surface area the v4.1 ServiceBus + React rewrite already contemplates.
- **`SDKSessionManager` becomes an ACP agent** and *sheds* session ownership: state, sequencing, turn ownership, confirmation arbitration and reconciliation move to the host. Much of `backendState.ts` and the resume path stop being ours.
- **Reach:** any AHP client could front our agent. **Cost:** we no longer control rendering in clients that aren't ours.

This makes our **ACP work strategically load-bearing rather than a side quest** — ACP is the on-ramp to this architecture, not a detour.

Note the prior ACP evaluation needs revisiting on new grounds: [documentation/roadmap/acp/README.md](../../../documentation/roadmap/acp/README.md) is dated 2026-01-30 and concluded *"Continue with @github/copilot-sdk (no migration at this time)."* That was decided when ACP looked like an alternative transport to the SDK. It is now also the adapter interface into the Agent Host, which is a different reason to care and was not on the table in January. Related: the `feature/4.0-acp-migration` branch and spike at `tests/harness/acp-spike.mjs`; remaining known blocker cli#1574 (ACP silently ignores custom tools).

## Strategic note — the moat moved

VS Code 1.133 states the Copilot harness *"leverages the Copilot SDK, aligning with other Copilot products"* — Microsoft's first-party agent is converging on the SDK we wrap, so the plumbing was never the differentiator.

The sharper point: **the dock's differentiation was partly that Microsoft hadn't modeled agent teams. They now have, on the wire, with interactivity levels** — and VS Code 1.132's release notes already mention subagent status pills in the Agents window. Every AHP client gets correct sub-agent separation for free.

*Viability up:* adopting AHP would mean implementing a model that already matches ours rather than fighting the protocol. *Uniqueness down:* every AHP client gets correct sub-agent separation, so the dock no longer wins by being the only one that does it.

**But this is not us-vs-them, and framing it that way is a mistake.** The two surfaces optimize different axes:

| | Agents window | Sub-agent dock |
| --- | --- | --- |
| Optimized for | **Breadth** — many sessions at once | **Depth** — one session, fully instrumented |
| Feature density | Lower | Higher |
| Use it when | Checking on parallel work | Focusing on the session that matters right now |

They are complementary, and a user wants both situationally: the window to survey, the dock to work. That reframes the AHP direction substantially — becoming an AHP agent isn't "trade the dock for reach." The same session becomes visible in the breadth surface *while* the dock remains the depth surface. Both, not either.

Design consequence if we pursue this: the dock should not try to become a session browser, and we should not treat the Agents window as a competitor to feature-match. Stay the best depth view; let the breadth view be theirs.
→ [VS Code 1.133 release notes](https://code.visualstudio.com/updates/v1_133)

## Proposed solution

Do nothing structural yet — there is nothing to connect to. Track the triggers below.

The one cheap, non-structural action available: comment on #325827 while it is still untriaged, reframing the ask from "build a registration API" to "expose the ACP adapter seam that already exists" (a host-facing contribution point for an ACP-speaking agent process, or a localhost connection entry point alongside Tunnels/SSH). Zero comments on that issue means framing is still up for grabs.

## Revisit triggers

- AHP drops the "not yet stabilized" warning or tags 1.0. **(Live — "1.0.0 blocker" issues are open and being closed.)**
- #325827 gains a milestone, an API proposal file, or ships — or an `agentHost` proposal file lands in `src/vscode-dts/`.
- VS Code documents connecting to a **localhost** AHP host, or a contribution point for an ACP agent.
- The AHP repo ships a reference host or any ACP bridge code (today it ships neither).
- We leave marketplace distribution — which also removes the `enabledApiProposals` publish blocker that closed the `chatSessionsProvider` path.

## Rejected alternatives

- **Contribute into `local` as LM tools / MCP.** Ships today, but surrenders the agent loop and the dock — we would be a tool vendor inside someone else's harness.
- **`chatSessionsProvider`.** Decided against 2026-05-27: proposed API, `vsce` rejects publish with `enabledApiProposals`, no allowlist process, and the native chat transcript cannot carry our webview UI.
- **Become an ACP agent now.** The seam is specified but unreachable: VS Code's host won't front a third-party agent, and the spec repo ships no host to front it either.
- **Build an AHP host now.** Draft protocol with breaking changes promised, and no documented localhost path for VS Code to reach it. The community precedent, [maxious/opencode-plugin-agent-host-protocol](https://github.com/maxious/opencode-plugin-agent-host-protocol), is marked **"Status: Not implemented"** — a README spec, not working code.

## Dependencies

None. This item is a tracking record.
