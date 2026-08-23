# v5.0 References — acronyms, technologies, and live sources

**Checked against upstream: 2026-08-16.** Everything below with a date was verified that day against
the linked source or the GitHub API, not recalled. The protocol landscape is moving monthly, so
**re-check anything load-bearing before you plan around it** rather than trusting this file's age.

Written because the 4.0 docs name Zed five times, ACP forty-six times and AHP thirty-seven times
without ever defining any of them.

---

## The one diagram that resolves most confusion

Both protocols exist, they are not competitors, and **clients never speak ACP**:

```text
  UI Client ──AHP──▶ AHP Host ──ACP──▶ Agent Runtime
      ▲                  ▲                  ▲
      │                  │                  └─ e.g. Claude Code, Copilot CLI, OUR IN-3 agent
      │                  └─ e.g. VS Code's Agent Host (the reference server)
      └─ e.g. VS Code's Agents window, or OUR webview (IN-4)
```

- **ACP appears in exactly one place:** the host↔agent link.
- **AHP is a "mutex over ACP"** — the host serializes N clients into ACP's 1:1 conversation model.
- The **agent event mapper** inside the host translates ACP events (`session/update`, tool calls,
  permissions) into AHP actions (`chat/delta`, `chat/toolCallStart`, `chat/toolCallReady`).

Source: [AHP and the Agent Client Protocol](https://microsoft.github.io/agent-host-protocol/guide/ahp-and-acp)
plus the maintainer's expanded answer in [AHP#282](https://github.com/microsoft/agent-host-protocol/issues/282).

**Why this matters to us:** it is precisely the shape we want. IN-3 makes our session manager an
**ACP agent** (bottom right), so any AHP host can front it. IN-4 makes our webview an **AHP client**
(top left). We are not choosing between the protocols; we are implementing one of each, at opposite
ends.

---

## Protocols

### ACP — Agent Client Protocol

| | |
| --- | --- |
| **What** | How *one* client talks to *one* coding agent: initialize, prompt, streaming updates, tool calls, permissions. Point-to-point and stateful. |
| **Who** | Created by **Zed Industries**, released **August 2025**. JetBrains joined shortly after. |
| **Transport** | JSON-RPC 2.0 over stdio, **NDJSON framed** (newline-delimited — *not* LSP's `Content-Length` headers). |
| **Licence** | Apache 2.0 |
| **Spec** | [agentclientprotocol.com](https://agentclientprotocol.com) · [zed-industries/agent-client-protocol](https://github.com/zed-industries/agent-client-protocol) |
| **Analogy** | Explicitly modelled on **LSP**: turns N×M (agents × editors) into N+M. |

**Registry.** Zed and JetBrains co-launched the [ACP Registry](https://zed.dev/blog/acp-registry) in
**January 2026** — register an agent once, every ACP client can use it. Listed agents include Claude
Code, Codex CLI, **GitHub Copilot CLI**, Gemini CLI, OpenCode, Goose.

**The SDK to use: `@agentclientprotocol/sdk`** (Apache-2.0, **zero dependencies**, v1.3.0 as of
2026-08-16). Serves both halves — `acp.agent()` for the agent side, `acp.client()` for the client —
and `clientApp.connect(agentApp)` gives an in-process link with no transport, which is how IN-3 is
unit-tested. **`@zed-industries/agent-client-protocol` is deprecated**; npm says it was renamed, and
it last published 2025-10. Two behaviours that will bite you, both proven in
[FINDINGS-acp-sdk.md](../spikes/acp-agent/FINDINGS-acp-sdk.md): `notify()`'s escape-hatch overload
means a **typo'd method name compiles clean**, and **`initialize` is not guaranteed to run**.

**Framing gotchas we already proved** (in `tests/harness/acp-spike.mjs`, and they survive the
direction flip IN-3 makes):

- NDJSON, not `Content-Length`
- cancel arrives as a **notification**, not a request
- permission replies use the double-nested `{ outcome: { outcome, optionId } }` shape

### AHP — Agent Host Protocol

| | |
| --- | --- |
| **What** | Upstream's words: *"how a portable, standalone **sessions server** communicates with its clients"* — plural `sessions`, and worth keeping as spelled, since that is the term to grep the spec for. Coordination across many clients, not conversation with an agent. |
| **Who** | **Microsoft**, open-sourced under **MIT**, positioned alongside LSP and DAP. |
| **Status** | **Pre-1.0**; VS Code's Agents window is still **Preview**. |
| **Rollout** | Agent-host process began rolling out in **VS Code 1.129 (2026-07-15)** for Copilot, Claude and Codex; further shipped in **1.133 (2026-08-12)**. |
| **Spec** | [microsoft.github.io/agent-host-protocol](https://microsoft.github.io/agent-host-protocol/) · [microsoft/agent-host-protocol](https://github.com/microsoft/agent-host-protocol) |

**Official client SDKs** ([implementations](https://microsoft.github.io/agent-host-protocol/guide/implementations.html)) —
relevant to IN-4, which no longer has to hand-roll a client:

| Language | Package |
| --- | --- |
| TypeScript | `@microsoft/agent-host-protocol` (npm) |
| Rust | `ahp-types`, `ahp`, `ahp-ws` (crates.io) |
| Kotlin/JVM | `com.microsoft.agenthostprotocol:agent-host-protocol` (Maven Central) |
| Swift | `AgentHostProtocol` (SwiftPM) |
| Go | `github.com/microsoft/agent-host-protocol` |
| CLI/Node | **AHPX** — session-management client |

> **Two caveats straight from the AHP maintainer** ([AHP#282](https://github.com/microsoft/agent-host-protocol/issues/282), 2026-07-07) — both load-bearing:
>
> 1. **The repo ships protocol types, JSON schemas and client libraries — but no host and no ACP
>    code at all.** The agent event mapper is *intended architecture for host implementers*, not
>    something Microsoft ships or exemplifies. Do not plan as though a reference bridge exists.
> 2. **The guide's action names are stale.** It says `session/delta`; the current spec uses
>    `chat/delta` (streaming moved to the chat channel). Trust the schemas over the prose.

### MCP — Model Context Protocol

Anthropic's protocol for giving a model **tools and context** (servers expose tools; the agent calls
them). Orthogonal to both above: MCP is agent↔tools, ACP is host↔agent, AHP is clients↔host. We
already ship MCP support — `MCPConfigurationService`, `ManagedMCPRegistry`, the server-management UI.

### LSP / DAP

Language Server Protocol and Debug Adapter Protocol — Microsoft's earlier N×M→N+M protocols. Cited
constantly as the template both ACP and AHP are consciously imitating. LSP frames with
`Content-Length` headers; **ACP does not** — a trap if you port framing code.

---

## Who builds what

### Zed

A **VS Code competitor**, and the reason ACP exists at all — which is why it appears throughout
these docs.

| | |
| --- | --- |
| **What** | Code editor from **Zed Industries**. Reached **1.0 on 2026-04-29**. |
| **Who** | Nathan Sobo, Antonio Scandurra, Max Brunsfeld — **the creators of Atom *and* Electron**. |
| **Built on** | Rust, with **GPUI**, their own GPU-accelerated UI framework. Metal on macOS, DirectX on Windows, Vulkan on Linux. |
| **Not** | Not a VS Code fork. **No Electron, no Chromium, no WebView, no DOM** — the whole UI, down to the tab bar and settings panel, renders through GPUI. |

**The distinction worth holding onto** is exactly the one that matters for us:

| Editor | Foundation |
| --- | --- |
| VS Code | Electron (Chromium + Node) |
| **Cursor** | a **fork of VS Code** — so also Electron/Chromium |
| **Zed** | **built from scratch in Rust**; shares no lineage with either |

Cursor competes with VS Code by *forking* it. Zed competes by *replacing* it. The team wrote
Electron, spent a decade watching Atom lose to VS Code on performance, and then deliberately built
the next one without the web stack. Reported figures (from reviews rather than primary
benchmarks — treat as directional): ~120fps rendering, ~0.12s cold start, ~2ms input latency.

**Why it matters to v5.0**, in descending order of importance:

1. **Zed created ACP**, so their editor is the protocol's reference client. It is the only
   independent implementation we can test IN-3 against — see the verification note below.
2. **It is a shipping ACP host today.** If VS Code never opens up, Zed can drive our agent anyway.
   That is the concrete form of "IN-3 pays off under every outcome."
3. Its agent panel runs **multiple agents in parallel** as of 1.0 — the same breadth-vs-depth
   question our sub-agent dock sits on.

> **The verification consequence.** A scripted harness tests our ACP implementation against *our own
> reading of the spec* — if we misread it, the harness misreads it identically and passes. Zed is an
> independent implementation **by the people who wrote the protocol**. Since the AHP repo ships no
> host and no ACP code at all (see the caveats above), Zed is the *only* cheap way to find out we are
> wrong. Run it early, against a walking skeleton — a protocol misread found after all five IN-3
> pieces are built is expensive.

### Cursor

VS Code fork with AI features. Named here only to keep the contrast straight: **Cursor is Electron,
Zed is not.** Not otherwise relevant to v5.0 — it is not an ACP host and not an AHP client.

---

## Terms

| Term | Meaning |
| --- | --- |
| **RFD** | *Request for Discussion* — ACP's spec-change process. Tiers: Draft → Active → Preview → **Completed**. `_meta` and the agent registry are Completed; that is why IN-3 may rely on them. |
| **Agent event mapper** | The host-internal translation layer, ACP events → AHP actions. Named in the AHP docs; not implemented by the AHP repo. |
| **NDJSON** | Newline-delimited JSON. One JSON value per line, no length prefix. ACP's framing. |
| **JSON-RPC 2.0** | The request/response/notification envelope both protocols use. We already depend on `vscode-jsonrpc`. |
| **Agents window** | VS Code's multi-session UI over the Agent Host. Preview. Less featured than our sub-agent dock but shows many sessions at once — [deliberately treated as complementary](../acp-ahp-chat-tabs-dual-stream-work-order.md), not competing. |
| **Agent Host** | VS Code's standalone agent process — "the reference AHP server implementation". |
| **Harness** | An agent loop. VS Code's `local` harness is its own loop, **not an extension point** — see [the watch-list](../backlog/vscode-apis/agent-host-ahp-watchlist.md). |

### Ours, not theirs

| Term | Meaning |
| --- | --- |
| **HostBridge** | Our injection seam between the session manager and its host (`src/extension/hostBridge.ts`). What makes the manager runnable with `vscode` absent — the precondition for IN-3. |
| **BufferedEmitter** | Queues events until the webview is ready, then replays. Its payloads are plain JSON structs, which is what makes the emitters→`session/update` mapping mechanical. |
| **CopilotClientProvider** | Owns the CLI client lifecycle (spine S4). Lets N managers share one CLI process. |
| **agentId** | Sub-agent attribution, `agentId == spawning toolCallId`. Must survive the ACP boundary; dock extras ride in `_meta`. |
| **VSIX** | The packaged extension. Installed globally by extension ID — hence the one-lane-at-a-time constraint in the work order. |

---

## Live external references

State as of **2026-08-16**. Re-check with `gh api repos/<owner>/<repo>/issues/<n>`.

| Ref | State | Subject | Why we track it |
| --- | --- | --- | --- |
| [AHP#282](https://github.com/microsoft/agent-host-protocol/issues/282) | **open**, 2 comments | Relationship between ACP and AHP | **This is OUT-1.** The layering was answered 2026-07-07. Our sharper follow-up — *is ACP a third-party extension point or an implementation detail of first-party adapters?* — was posted 2026-08-15 and is **unanswered**. Its answer sets IN-3's priority. |
| [vscode#325827](https://github.com/microsoft/vscode/issues/325827) | **open**, 0 comments, no milestone | Register external agents via Extension API in the agents view | The third-party registration ask. Untriaged since 2026-07-14. This is OUT-3's target. |
| [cli#1574](https://github.com/github/copilot-cli/issues/1574) | **open** | ACP agent ignores custom JSON-RPC methods | Killed the abandoned client-side branch. **Off IN-3's path** — we never invoke `copilot --acp`. |
| [cli#1607](https://github.com/github/copilot-cli/issues/1607) | **open** | ACP lacks session-level tool permission primitives `--headless` had | Same: a defect in *Copilot's* ACP agent, not in ours. |
| [cli#222](https://github.com/github/copilot-cli/issues/222) | — | Support for ACP | Why `copilot --acp` exists at all, and why Copilot CLI is in the ACP registry. |

**Do not confuse the two directions.** cli#1574 and #1607 are defects in GitHub's ACP *agent*. IN-3
builds our own ACP agent over the SDK, so neither applies:

```text
DEAD (feature/4.0-acp-migration):  our client ──ACP──▶ copilot --acp     ← cli#1574 lives here
IN-3:                              host ──ACP──▶ our agent ──SDK──▶ CLI  ← and cannot reach here
```

---

## Sources

- [Agent Host Protocol — home](https://microsoft.github.io/agent-host-protocol/) · [AHP and ACP](https://microsoft.github.io/agent-host-protocol/guide/ahp-and-acp) · [Implementations](https://microsoft.github.io/agent-host-protocol/guide/implementations.html)
- [AHP#282 — Relationship between ACP and AHP](https://github.com/microsoft/agent-host-protocol/issues/282)
- [Agent Client Protocol](https://agentclientprotocol.com) · [zed-industries/agent-client-protocol](https://github.com/zed-industries/agent-client-protocol) · [Zed — ACP](https://zed.dev/acp)
- [The ACP Registry is Live — Zed's Blog](https://zed.dev/blog/acp-registry) · [GitHub Copilot — ACP Agent](https://zed.dev/acp/agent/github-copilot)
- [VS Code Agent Host architecture](https://code.visualstudio.com/docs/agents/concepts/agent-host)
- Zed 1.0 / GPUI: [Zed 1.0 review](https://chatforest.com/reviews/zed-1-0-ai-code-editor-parallel-agents-rust-review/) · [Rust-based editor reaches 1.0](https://www.programming-helper.com/tech/zed-editor-2026-ai-native-code-editor-performance) · [Complete guide to Zed 2026](https://note.com/snake_dragon/n/n21504046b929?hl=en)
- [VS Code 1.133 — Agent Host architecture shift](https://www.ntcompatible.com/story/visual-studio-code-1133-released-major-agent-host-architecture-shift-and-open-ai-protocol) · [Microsoft decouples AI agents from the editor](https://devops.com/microsoft-decouples-ai-agents-from-the-vs-code-editor-in-latest-release/)
