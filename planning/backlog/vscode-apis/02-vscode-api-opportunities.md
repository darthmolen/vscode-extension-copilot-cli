# VS Code API Opportunities

**Assessed:** 2026-08-14 against VS Code 1.133 and the proposal set on `microsoft/vscode@main`
**Extension:** v3.11.0, engine `"vscode": "^1.108.1"`, no `enabledApiProposals` declared
**Prior assessment:** [02-vscode-api-opportunities-pre-2026-08-14.md](02-vscode-api-opportunities-pre-2026-08-14.md) (2026-02-12, pre-Agent-Host)

---

## The two constraints that decide everything

Every rating below follows from these. Read them first; the tables are just application.

**1. Proposed APIs are unreachable, not merely immature.** `vsce` hard-rejects publish when `enabledApiProposals` is present in `package.json`, and there is no public process to be added to VS Code's `extensionEnabledApiProposals` allowlist. A proposed API is therefore not a "revisit when it stabilizes" item — it is unavailable to every marketplace user we have, at any maturity level. This is a distribution constraint, not a technical one, and it dominates API maturity as a filter.

**2. We own the agent loop.** `SDKSessionManager` drives the Copilot SDK's loop; the webview renders it; the sub-agent dock keeps `agentId`-tagged traffic out of the main transcript. That is the product. APIs shaped as *"render into VS Code's chat transcript"* or *"let VS Code's harness invoke you"* move work out of the surface we differentiate on and into one we don't control.

The practical consequence: the useful question is not "is this API stable?" but **"does this API let us stay the harness while reaching more users?"** Almost nothing does.

---

## Worth acting on

| API / surface | Status | Rating | Why |
| --- | --- | --- | --- |
| `lm.registerMcpServerDefinitionProvider` | Stable | **MEDIUM** | The supported way to surface MCP servers to VS Code. We already manage them in `MCPConfigurationService`, so this publishes existing state rather than adding a subsystem. The only stable chat-adjacent API that complements the product instead of competing with it. |
| **Agent Plugins 1.0** (packaging standard, not an API) | Shipped | **MEDIUM** | Marketplace-discoverable bundles of skills, MCP servers, custom agents, hooks, and slash commands. Spans "GitHub Copilot in VS Code, GitHub Copilot CLI, and the GitHub Copilot app" — including the CLI we wrap. Needs no proposed API, so it carries no publish blocker. Settings: `chat.plugins.enabled`, `chat.plugins.marketplaces`, `chat.pluginLocations`. |

Agent Plugins is the only route here that is simultaneously open, distributable, and pointed at our stack. If anything on this page gets a spike, it is this.
→ [Agent plugins in VS Code](https://code.visualstudio.com/docs/agent-customization/agent-plugins)

---

## Available, but pointed away from the product

These are stable and adoptable today. Each one trades harness ownership for reach.

| API | Status | Rating | Why not |
| --- | --- | --- | --- |
| `chat.createChatParticipant` | Stable, not deprecated | **LOW** | Renders into VS Code's chat transcript — the surface we deliberately don't use. The `@`-mention model also predates agent sessions, and the API guide now points capability-style extensions at LM tools or MCP instead. |
| `lm.registerTool` / `lm.invokeTool` | Stable | **LOW** | This is the "contribute into VS Code's `local` harness" path. It works, but it makes us a tool vendor inside someone else's agent loop: no session ownership, no dock, no transcript control. Keep as the documented fallback if the strategy ever changes. |
| `lm.registerLanguageModelChatProvider` | Stable (v1.104) | **LOW** | VS Code 1.133 lets users switch model providers between turns. Registering as a provider buries the SDK loop underneath VS Code's harness — the inverse of the architecture. |

---

## Blocked from Marketplace (proposed)

Ratings assume the publish blocker were lifted; today all of these are effectively zero.

| API | Proposal file | Rating if reachable | Notes |
| --- | --- | --- | --- |
| Chat resources | `chatPromptFiles` | **MEDIUM** | Despite the filename, this is the chat-resources surface: `registerCustomAgentProvider`, `registerSkillProvider`, `registerInstructionsProvider`, `registerPromptFileProvider`, `registerHookProvider`, plus `getCustomAgents` / `getSkills` / `getSlashCommands` / `getHooks` / `getPlugins`. Conceptually adjacent to our `SlashCommandPanel` and plan mode. Note `registerCustomAgentProvider` lives **here**, not in the finalized API. |
| Chat Output Renderer | `chatOutputRenderer` | **LOW** | Renders custom webviews inside chat bubbles. Only pays off if we render into VS Code's chat at all; we render our own transcript and dock. |
| Chat Sessions | `chatSessionsProvider` | **NONE** | Decided against 2026-05-27: proposed API, no allowlist path, and the native chat transcript cannot carry our webview UI. Separately reshaped Jan 2026 from a provider model to a controller model (`createChatSessionItemController`). |
| Agents-window surfaces | `agentsWindowConfiguration`, `agentSessionsWorkspace`, `agentEditorComments` | **LOW** | `agentsWindowConfiguration` declares *no TypeScript API surface* — it only enables the `agentsWindow` property in `contributes.configuration` schemas. The Agents window routes local harnesses back to the main VS Code window regardless, so our sidebar is unaffected. |
| Other chat proposals | `chatHooks`, `chatSessionCustomizationProvider`, `chatContextProvider`, `chatTab`, `chatStatusItem`, `chatDebug`, `chatProvider`, `chatParticipantAdditions` | **LOW** | Same publish blocker, same wrong-surface problem. Listed so the proposal set is not a blind spot. |

---

## Does not exist

| Item | Finding |
| --- | --- |
| `lmConfiguration` | No longer present in `src/vscode-dts/`. |
| Agent Host registration | **No `agentHost` proposal file exists on `main`.** [vscode#325827](https://github.com/microsoft/vscode/issues/325827) asks for `vscode.agentHost.registerAgentProvider()` so a third-party harness can appear in the agents picker; it has produced no API surface. This is firmer evidence than the issue tracker alone that the work has not started. Detail: [agent-host-ahp-watchlist.md](agent-host-ahp-watchlist.md). |

---

## Recommended posture

1. **Spike Agent Plugins 1.0.** Open standard, no proposed API, and it reaches the Copilot CLI we already bundle via `CliBundleService`. Question to answer: can we ship our slash commands and plan-mode skills as a plugin without giving up the webview?
2. **Consider `lm.registerMcpServerDefinitionProvider`.** Small, stable, and mostly a matter of exposing what `MCPConfigurationService` already knows.
3. **Adopt nothing in the chat-transcript family.** Participants, output renderers, and session providers all assume VS Code renders the conversation. We don't want that, and the proposed ones can't ship anyway.
4. **Do not build toward the Agent Host.** AHP is draft with breaking changes promised and third-party registration does not exist. Watch list with revisit triggers: [agent-host-ahp-watchlist.md](agent-host-ahp-watchlist.md).

**Re-assess this page when:** `vsce` stops rejecting `enabledApiProposals` or a public allowlist appears (unblocks the entire proposed column at once), any listed proposal graduates to stable, or an `agentHost` proposal file lands.

---

## Samples reference

| Sample | Location | Key patterns |
| --- | --- | --- |
| chat-tutorial | `research/vscode-extension-samples/chat-tutorial/` | Minimal participant, streaming loop |
| chat-sample | `research/vscode-extension-samples/chat-sample/` | Multi-approach, tool loop, prompt-tsx |
| chat-context-sample | `research/vscode-extension-samples/chat-context-sample/` | Custom context providers |
| chat-model-provider-sample | `research/vscode-extension-samples/chat-model-provider-sample/` | Custom model backend |
| chat-output-renderer-sample | `research/vscode-extension-samples/chat-output-renderer-sample/` | Webview rendering in chat bubbles |

These remain useful as reference for how the APIs work, independent of whether we adopt them. The prior assessment contains worked code sketches for bridging each one to `SDKSessionManager`.
