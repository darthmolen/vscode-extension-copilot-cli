# ACP vs. Copilot SDK: Research & Evaluation Plan

## ✅ Research Complete - Recommendation: Stay with SDK

**Completion Date**: 2026-01-30  
**Status**: Phase 1 complete, decision made  
**Recommendation**: Continue with @github/copilot-sdk (no migration)

### Executive Summary

**What We Found**:

- ACP and SDK are **functionally equivalent** - both access 100% of Copilot CLI features
- The difference is **protocol-level**: SDK is a convenience wrapper, ACP is the raw open standard
- **Copilot CLI features are identical** in both modes (70+ tools, MCP servers, all models, all permissions)
- ACP offers **open standard** and **multi-agent support** (Gemini, Claude)
- SDK offers **simplicity** and **auto-management** (process spawning, reconnect, less code)

**Key Insight**: The GitHub Copilot SDK **already uses JSON-RPC internally** to communicate with Copilot CLI. ACP is essentially a **standardized, open-source version** of the same protocol.

**Decision**: **Stay with SDK** because:

1. ✅ It's working perfectly (no bugs, solid foundation)
2. ✅ Zero migration cost (vs. 22-32 hours for ACP)
3. ✅ Simpler code (5 lines vs. 20-30 lines for basic usage)
4. ✅ Auto process management (SDK handles CLI lifecycle)
5. ⚠️ Limited immediate benefit (multi-agent not a requirement)
6. ⚠️ Both in preview (SDK and ACP equally immature)

**Future Action**: Reassess in **July 2026** when ACP reaches v1.0 stable.

**Full Analysis**: See [`files/comparison-matrix.md`](files/comparison-matrix.md) (16KB, 13 sections)

---

## Problem Statement

Copilot CLI just released **Agent Client Protocol (ACP)** support (as of Jan 28, 2026 - now in public preview). Our extension recently migrated from direct CLI process spawning to using **@github/copilot-sdk** (v0.1.18) for a more robust integration.

**Question**: What are the differences between using ACP directly vs. the SDK, and should we consider migrating?

## Approach

1. **Research Phase**: Understand technical differences, tradeoffs, and capabilities
2. **Evaluation Phase**: If research reveals compelling upsides, evaluate migration feasibility and cost/benefit

---

## Workplan

### Phase 1: Technical Research ✅ **COMPLETE**

- [x] Understand what ACP is
- [x] Find ACP documentation
- [x] Identify current SDK implementation details
- [x] Deep-dive comparison: SDK vs ACP architecture
- [x] Document feature parity analysis
- [x] Analyze Copilot CLI features (identical in both modes)
- [x] List pros/cons for each approach
- [x] Identify any blockers or missing capabilities

**Status**: Phase 1 complete. See `files/comparison-matrix.md` for full analysis.

### Phase 2: Prototype/Spike ⏭️ **SKIPPED**

**Decision**: Skipping prototype phase based on Phase 1 findings.

**Rationale**:

- Phase 1 showed minimal functional benefit for migration
- 22-32 hour migration effort not justified by marginal gains
- Both SDK and ACP access identical Copilot CLI features
- Main benefits (multi-agent, open standard) are not current requirements

- [~] Create minimal ACP client proof-of-concept
- [~] Test session creation/management via ACP
- [~] Test streaming responses via ACP
- [~] Test tool execution visibility via ACP
- [~] Compare developer experience (code complexity, maintainability)
- [~] Performance testing (if needed)

**Optional Future**: May revisit as low-priority learning exercise (4-6 hours).

### Phase 3: Decision & Evaluation ✅ **COMPLETE**

- [x] Summarize findings in comparison matrix
- [x] Identify migration effort estimate (22-32 hours)
- [x] Risk assessment
- [x] **Recommendation: Stay with SDK ✅**

**Decision Summary**:

| Factor | SDK | ACP | Winner |
|--------|-----|-----|--------|
| **Current functionality** | ✅ Working perfectly | ⚠️ Requires migration | **SDK** |
| **Copilot CLI features** | ✅ 100% access | ✅ 100% access | **Tie** |
| **Developer experience** | ✅ Simple (5 lines) | ⚠️ Complex (20-30 lines) | **SDK** |
| **Migration effort** | ✅ Zero | ❌ 22-32 hours | **SDK** |
| **Multi-agent support** | ❌ Copilot only | ✅ Any agent | **ACP** |
| **Future-proofing** | ⚠️ Proprietary | ✅ Open standard | **ACP** |
| **Maturity** | ⚠️ Technical preview | ⚠️ Public preview | **Tie** |

**Final Recommendation**: **Continue with GitHub Copilot SDK**

- No compelling immediate benefit to justify migration
- Monitor ACP maturity for future reassessment (July 2026)
- Optional: Build ACP POC as learning exercise (not for production)

### Phase 4: Implementation ⏭️ **NOT APPROVED**

Migration to ACP **not recommended** at this time.

- [~] Create implementation plan for ACP migration
- [~] Design backwards compatibility strategy
- [~] Plan testing approach
- [~] Execute migration (separate detailed plan)

**Status**: On hold pending future reassessment in July 2026.

---

## Current State Analysis

### What We Currently Use: @github/copilot-sdk (v0.1.18)

**Architecture**:

```
VSCode Extension (ChatPanelProvider + SDKSessionManager)
    ↓
@github/copilot-sdk (CopilotClient + CopilotSession)
    ↓ JSON-RPC (internal)
Copilot CLI (server mode - auto-spawned by SDK)
    ↓
MCP Servers + Tools
```

**SDK Features We Rely On**:

1. **Auto-spawning**: SDK handles starting/stopping the CLI process
2. **Session Management**: `client.createSession()`, `client.resumeSession()`, `client.listSessions()`
3. **Event Streaming**: `session.on()` for `assistant.*`, `tool.*`, `session.*` events
4. **MCP Configuration**: Pass MCP server configs to session creation
5. **Working Directory**: Set `cwd` for sessions
6. **Tool Customization**: Configure allowed/denied tools
7. **Model Selection**: Choose AI models
8. **Error Handling**: Structured error responses

**Key Files**:

- `src/sdkSessionManager.ts` - Core SDK integration (~600 LOC)
- `src/extension.ts` - Extension activation & commands
- `src/chatViewProvider.ts` - Webview UI
- Dependencies: `@github/copilot-sdk@0.1.18`, `vscode-jsonrpc@8.2.1`

---

## Initial Research Findings

### What is ACP?

**Agent Client Protocol (ACP)** is a **standardized, open protocol** (like LSP for language servers) for communication between:

- **Clients** (IDEs, editors, tools - e.g., VS Code, Zed, JetBrains)
- **Agents** (AI coding assistants - e.g., Copilot CLI, Claude Code, Gemini CLI)

**Key Characteristics**:

- **Transport**: stdio (recommended for IDE integration) or TCP
- **Format**: Newline-delimited JSON (NDJSON) using JSON-RPC 2.0
- **Stateful & Session-based**: Isolated sessions with individual working directories
- **Streaming**: Real-time updates for prompts and responses
- **Permissions**: Built-in request/approval for sensitive operations
- **Bidirectional**: Both client and agent can initiate requests/notifications

**Launch Mode**:

```bash
# stdio mode (recommended for VS Code)
copilot --acp --stdio

# TCP mode
copilot --acp --port 3000
```

### ACP Ecosystem

- **Libraries Available**: TypeScript SDK (`@agentclientprotocol/sdk`), others coming
- **Agent Support**: Copilot CLI, Google Gemini CLI, Claude Code, more coming
- **Editor Support**: Zed, JetBrains (in progress), VS Code (via custom extensions)
- **Registry**: Central ACP agent registry for discoverability

**Positioning**: ACP is becoming the **industry standard** for agent-client communication (like LSP for language support).

---

## Comparison Framework

### Comparison Dimensions

We'll evaluate on these axes:

1. **Feature Parity**
   - Session management (create, resume, list, delete)
   - Streaming responses
   - Tool execution visibility
   - MCP server integration
   - Model selection
   - Permission controls
   - Working directory support
   - Event types available

2. **Developer Experience**
   - Code complexity
   - API ergonomics
   - Documentation quality
   - Type safety
   - Error handling
   - Debugging capabilities

3. **Ecosystem & Future-Proofing**
   - Open standard vs. proprietary
   - Multi-agent support potential
   - Community adoption
   - Maintenance & updates
   - Vendor lock-in risk

4. **Performance**
   - Latency (SDK overhead vs. direct protocol)
   - Resource usage
   - Startup time
   - Streaming efficiency

5. **Migration Effort**
   - Code changes required
   - Breaking changes to extension
   - Testing burden
   - Backwards compatibility

---

## Open Questions to Answer

### Technical Questions

1. **Feature parity**: Does ACP support everything the SDK does? (MCP, tools, models, permissions)
2. **Event model**: Are ACP events equivalent to SDK events? (`assistant.*`, `tool.*`, `session.*`)
3. **Type safety**: Does `@agentclientprotocol/sdk` provide TypeScript types as good as `@github/copilot-sdk`?
4. **Error handling**: How do errors propagate in ACP vs. SDK?
5. **Session lifecycle**: Can ACP resume sessions as seamlessly as SDK?
6. **Process management**: Who spawns the CLI process with ACP? (We would manage it ourselves?)

### Strategic Questions

1. **Maintenance**: Is `@github/copilot-sdk` actively maintained, or is GitHub shifting focus to ACP?
2. **Deprecation risk**: Will the SDK be deprecated in favor of ACP?
3. **Multi-agent future**: Would ACP enable us to support other agents (Claude, Gemini) in the future?
4. **Adoption**: What are other VS Code extensions doing? (Zed uses ACP natively)

### Practical Questions

1. **Migration complexity**: How hard would it be to switch? (Lines of code, testing effort)
2. **User impact**: Would users notice any difference?
3. **Configuration**: Can we preserve current settings schema?
4. **Backwards compatibility**: Can we support both SDK and ACP modes?

---

## Next Steps

1. **Deep-dive technical comparison** - Answer all open questions through docs + code exploration
2. **Create comparison matrix** - Side-by-side SDK vs. ACP on all dimensions
3. **Prototype ACP client** - Build minimal proof-of-concept to validate assumptions
4. **Decision point** - Stay with SDK, migrate to ACP, or support both?

---

## Success Criteria

This research is successful if we can answer:

1. ✅ **Feature parity**: Does ACP cover 100% of our current SDK usage?
2. ✅ **Effort estimate**: Can we quantify migration cost (hours, LOC, risk)?
3. ✅ **Compelling upside**: Is there a clear benefit to migrating (performance, features, future-proofing)?
4. ✅ **Risk assessment**: What are the risks of staying with SDK? Of migrating to ACP?
5. ✅ **Recommendation**: Clear go/no-go with justification

---

## References

### ACP Documentation

- Official Intro: <https://agentclientprotocol.com/get-started/introduction>
- Protocol Spec: <https://agentclientprotocol.com/protocol/overview>
- GitHub Docs: <https://docs.github.com/en/copilot/reference/acp-server>
- TypeScript SDK: <https://agentclientprotocol.com/libraries/typescript>
- Announcement: <https://github.blog/changelog/2026-01-28-acp-support-in-copilot-cli-is-now-in-public-preview/>

### SDK Documentation

- Current Version: `@github/copilot-sdk@0.1.18`
- Local Research: `research/copilot-sdk/nodejs/README.md`
- Migration Doc: `planning/completed/v2-copilot-sdk-migration.md`

### Current Implementation

- `src/sdkSessionManager.ts` - SDK integration layer
- `src/extension.ts` - Extension entry point
- `src/chatViewProvider.ts` - UI layer
- `package.json` - Dependencies & settings

---

## Notes & Considerations

### Potential Upsides of ACP

1. **Open Standard**: Not locked to GitHub's SDK, could support other agents (Claude, Gemini)
2. **Industry Standard**: Like LSP, ACP is becoming the universal agent protocol
3. **Direct Control**: Manage CLI process lifecycle ourselves (more control)
4. **Future-Proof**: If GitHub shifts to ACP-first, we're ahead of the curve
5. **Multi-Agent**: Could support multiple agents in one extension

### Potential Downsides of ACP

1. **More Code**: Need to manage process spawning, stdio piping, JSON-RPC manually
2. **Less Abstraction**: SDK hides complexity (auto-start, session management convenience)
3. **Testing Complexity**: Need to test against raw protocol, not SDK abstractions
4. **Migration Effort**: Non-trivial code changes (~600 LOC in sdkSessionManager alone)
5. **Maturity**: ACP is "public preview", SDK is more stable

### Potential Risks of Staying with SDK

1. **Deprecation**: GitHub might deprecate SDK in favor of ACP
2. **Limited Features**: New features might land in ACP first (or only)
3. **Vendor Lock-in**: Tied to GitHub's SDK update schedule

### Potential Risks of Migrating to ACP

1. **Preview Status**: ACP is not yet stable (breaking changes possible)
2. **Bug Surface**: Direct protocol usage = more edge cases to handle
3. **Documentation Gaps**: Less mature than SDK docs
4. **Regression Risk**: Introducing bugs during migration

---

## Timeline Estimate

- **Phase 1 (Research)**: 3-4 hours
- **Phase 2 (Prototype)**: 4-6 hours (if needed)
- **Phase 3 (Decision)**: 1-2 hours
- **Phase 4 (Implementation)**: 12-20 hours (if migration approved)

**Total**: 20-32 hours if full migration

---

*This plan will be updated as research progresses.*
