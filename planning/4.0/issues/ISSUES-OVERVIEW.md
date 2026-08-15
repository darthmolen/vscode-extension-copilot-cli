# v4.0 Issues — Index

Every ticket the AHP/ACP split needs, across all venues. One document per
ticket in this directory; this table is the follow-up surface.

**Compiled:** 2026-08-15 · **Gap analysis:** [gap-register.md](../gap-register.md) · **Spike:** [FINDINGS.md](../../spikes/acp-agent/FINDINGS.md)

## Legend

- **Cat** — a (shipped upstream) / b (argue for it) / c (we build it) / d (upstream, in flight)
- **Score** — confidence the ask lands (category b), or build difficulty (category c)
- **Blocking?** — does the direction stall without it

## Outbound — asks on other people's repos

| ID | Title | Venue | Cat | Score | Blocking? | Status |
| --- | --- | --- | --- | --- | --- | --- |
| [OUT-1](OUT-1-ahp-acp-adapter-question.md) | Is ACP-as-adapter a third-party extension point? | AHP [#282](https://github.com/microsoft/agent-host-protocol/issues/282) | b | Confidence **High** (of an answer) | Decides roadmap | Drafted, unsent |
| [OUT-2](OUT-2-localhost-agent-host-connection.md) | Agents window cannot connect to a localhost Agent Host | vscode — new issue | b | Confidence **Medium** | No (workaround: our own host) | Drafted, unsent |
| [OUT-3](OUT-3-comment-on-325827.md) | Support external agent registration | vscode [#325827](https://github.com/microsoft/vscode/issues/325827) | b | Confidence **Low–Medium** | Yes, for the VS Code picker | Drafted, unsent |
| OUT-4 | Do hosts parse client-published MCP customizations? | AHP — new issue | b | Confidence **Medium** | No | Not drafted |

**Sequencing:** send OUT-1 first. Its answer determines whether OUT-3 is asking
for a new API or a route to an existing one, and rewriting OUT-3 after an
authoritative answer is much cheaper than arguing the wrong shape in public.

## Inbound — work we own

| ID | Title | Cat | Difficulty | Blocking? | Status |
| --- | --- | --- | --- | --- | --- |
| IN-1 | Decouple SDKSessionManager behind HostBridge | c | — | — | ✅ **Done** (`5da6697`) |
| IN-2 | Prove plan mode survives out-of-host | c | — | — | ✅ **Done** (8/8 live) |
| [IN-3](IN-3-acp-server-wrapper.md) | Wrap the manager as an ACP server | c | **Medium** | Yes | Ready to start |
| [IN-4](IN-4-webview-ahp-client.md) | Webview becomes an AHP client | c | **High** | Yes (client half) | Blocked on IN-3 + a host to talk to |
| [IN-5](IN-5-cli-resolution-collapse.md) | Collapse duplicate CLI resolution | c | **Low** | No | Deferred — deliberately |
| IN-6 | FileSnapshot temp files across the process boundary | c | **Medium** | Yes | Not drafted — depends on IN-3 shape |
| IN-7 | Dock handles arbitrary sub-agent nesting depth | c | **Medium** | No | Not drafted |
| IN-8 | Settings snapshot + headless session recovery | c | **Low** | Yes | Not drafted — small, folds into IN-3 |
| IN-9 | Our own AHP host | c | **High** | Only if OUT-1/2/3 all fail | Deferred by hybrid posture |

## Feasibility summary

**Agent half: HIGH.** The blocking unknown is cleared — plan-mode tool closures
execute in-process with `vscode` absent, over a real SDK session (8/8).
IN-3 has no external dependency.

**Client half: MEDIUM.** IN-4 is large but tractable, and it overlaps the v4.1
React rewrite almost exactly — treat them as one job.

**Reaching VS Code's picker: LOW, and not ours to decide.** OUT-3 is untriaged
with no `agentHost` proposal file in `vscode-dts`. This is precisely why the
posture is hybrid: IN-3 pays off through any AHP host, Zed and other ACP
clients, or our own host — none of which need Microsoft to say yes.

**Recommendation:** proceed with IN-3 under the opportunistic rule. Send OUT-1
in parallel, since it is a question rather than a request and its answer is
worth more than its cost. Hold IN-4 until there is something real to talk to.
