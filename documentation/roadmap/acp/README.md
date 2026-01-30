# ACP (Agent Client Protocol) Roadmap Research

**Research Date**: 2026-01-30  
**Status**: Research Complete  
**Decision**: Continue with @github/copilot-sdk (no migration at this time)

---

## Overview

This folder contains research and analysis comparing the **Agent Client Protocol (ACP)** with the current **GitHub Copilot SDK** approach used in this extension.

### What is ACP?

The Agent Client Protocol (ACP) is an open, standardized protocol (similar to LSP) for communication between:

- **Clients** (IDEs, editors, tools - e.g., VS Code, Zed, JetBrains)
- **Agents** (AI coding assistants - e.g., Copilot CLI, Claude Code, Gemini CLI)

As of January 28, 2026, GitHub Copilot CLI added ACP support via the `--acp` flag, prompting this evaluation.

---

## Documents in This Folder

### 📋 [Research Plan](research-plan.md) (13KB)

The complete research plan outlining the investigation approach, workplan, and decision-making process.

**Key Sections**:

- Problem statement and approach
- Current state analysis (SDK v0.1.18)
- Initial research findings
- Comparison framework (5 dimensions)
- Open questions to answer
- Success criteria

**Status**: All phases complete, decision finalized.

### 📊 [Comparison Matrix](comparison-matrix.md) (23KB)

Comprehensive technical comparison of SDK vs. ACP across 14 major sections.

**Key Sections**:

1. Architecture Comparison
2. Feature Parity Analysis (protocol level)
3. Event Model Comparison
4. Developer Experience
5. Strategic Considerations (open standard vs. proprietary)
6. Performance Comparison
7. Migration Effort Estimate (22-32 hours)
8. Risk Assessment
9. Pros & Cons Summary
10. Decision Framework
11. Recommendation
12. Unanswered Questions
13. **Copilot CLI Features** (identical in both modes - 70+ tools)
14. Action Plan

**Bottom Line**: ACP and SDK provide 100% feature parity with Copilot CLI. The difference is protocol-level abstraction.

### 🚀 [Quick Reference](quick-reference.md) (5KB)

TL;DR version with the essential facts and decision.

**Contents**:

- One-page summary table
- The one key fact (SDK uses JSON-RPC internally, ACP is the open standard version)
- CLI features comparison
- Code example comparison (5 lines vs. 20-30 lines)
- Why SDK wins today
- Why ACP might win in the future
- When to reconsider ACP
- Action items

**Perfect for**: Quick reference or sharing with stakeholders.

---

## Executive Summary

### Decision: Stay with GitHub Copilot SDK ✅

**Rationale**:

1. ✅ **Working perfectly** - No bugs, no issues, solid foundation
2. ✅ **Zero migration cost** - vs. 22-32 hours for ACP migration
3. ✅ **Simpler code** - SDK has better developer ergonomics
4. ✅ **Feature parity** - Both access 100% of Copilot CLI capabilities
5. ⚠️ **Limited immediate benefit** - Multi-agent support not a current requirement
6. ⚠️ **Both in preview** - SDK and ACP equally immature (technical preview vs. public preview)

### Key Finding

**The Copilot CLI provides identical features in both modes.**

| Feature Category | SDK | ACP |
|-----------------|-----|-----|
| Built-in Tools (70+) | ✅ | ✅ |
| GitHub MCP Server (50+ tools) | ✅ | ✅ |
| Custom MCP Servers | ✅ | ✅ |
| 14 AI Models | ✅ | ✅ |
| All CLI Flags | ✅ | ✅ |
| Session Management | ✅ | ✅ |
| Permissions (tool/URL/path) | ✅ | ✅ |
| Streaming Responses | ✅ | ✅ |
| Parallel Tool Execution | ✅ | ✅ |

**The difference**:

- **SDK** = High-level wrapper (convenient, auto-managed, proprietary)
- **ACP** = Raw protocol (open standard, full control, more code)

---

## When to Reassess

### Immediate Action (Done)

- [x] Complete research
- [x] Document findings
- [x] Make decision

### Short Term (Next 3 Months)

- [ ] Monitor ACP releases (subscribe to GitHub notifications)
- [ ] Watch for SDK deprecation notices
- [ ] Optional: Build ACP proof-of-concept as learning exercise (4-6 hours, low priority)

### Medium Term Checkpoint

- [ ] **July 2026**: Reassess ACP maturity
  - Is ACP v1.0 stable released?
  - Has GitHub deprecated the SDK?
  - Do we need multi-agent support?
  - Has VS Code added native ACP support?

### Triggers for Reconsideration

1. ⚠️ GitHub deprecates the SDK in favor of ACP
2. ✨ ACP reaches v1.0 stable (breaking changes freeze)
3. 🎯 Need multi-agent support (Gemini, Claude, custom agents)
4. 🔧 VS Code adds native ACP support (like Zed)
5. 📊 Significant new features land in ACP-only

---

## Migration Path (If Needed)

### Estimated Effort: 22-32 hours

| Task | Effort |
|------|--------|
| Code changes (sdkSessionManager.ts + event handlers) | 12-16 hours |
| Testing (unit, integration, E2E) | 8-12 hours |
| Documentation updates | 2-4 hours |

### Migration Steps (Future)

1. Create detailed implementation plan
2. Implement ACP client in feature branch
3. Comprehensive testing
4. Gradual rollout with beta testers
5. Full migration

**Status**: On hold until reassessment triggers are met.

---

## Strategic Considerations

### Advantages of ACP (Future-Looking)

| Advantage | Value | Priority |
|-----------|-------|----------|
| **Open standard** (not vendor-locked) | High | High |
| **Multi-agent support** (Gemini, Claude) | Medium | Medium |
| **Future-proof** (industry standard like LSP) | High | High |
| **Agent plans** (new ACP-exclusive feature) | Low | Low |
| **Direct control** (easier debugging) | Medium | Low |
| **Community-driven** | Medium | Medium |

### Advantages of SDK (Current Reality)

| Advantage | Value | Priority |
|-----------|-------|----------|
| **Zero migration effort** | High | **Critical** |
| **Already working well** | High | **Critical** |
| **Auto process management** | High | High |
| **Less code to maintain** | Medium | Medium |
| **Stable API** (for now) | Medium | Medium |

---

## Technical Details

### Architecture: SDK

```
Extension (SDKSessionManager)
    ↓
@github/copilot-sdk (CopilotClient + Session)
    ↓ Proprietary JSON-RPC
Copilot CLI (server mode - auto-spawned)
    ↓
Tools + MCP Servers
```

### Architecture: ACP

```
Extension (ACP Client Implementation)
    ↓
@agentclientprotocol/sdk (ClientSideConnection)
    ↓ Open Standard ACP (JSON-RPC 2.0)
Copilot CLI --acp mode (manually spawned)
    ↓
Tools + MCP Servers
```

**Key Insight**: Both use JSON-RPC to communicate with the same Copilot CLI. The difference is abstraction level.

---

## References

### ACP Documentation

- Official Site: <https://agentclientprotocol.com>
- Protocol Spec: <https://agentclientprotocol.com/protocol/overview>
- GitHub Docs: <https://docs.github.com/en/copilot/reference/acp-server>
- TypeScript SDK: <https://agentclientprotocol.com/libraries/typescript>
- npm Package: @agentclientprotocol/sdk (v0.13.1)

### SDK Documentation

- Current Version: @github/copilot-sdk v0.1.18
- Local Research: `research/copilot-sdk/nodejs/README.md`
- Migration Doc: `planning/completed/v2-copilot-sdk-migration.md`

### GitHub Announcements

- ACP Launch: <https://github.blog/changelog/2026-01-28-acp-support-in-copilot-cli-is-now-in-public-preview/>
- ACP Issue: <https://github.com/github/copilot-cli/issues/222>

---

## Questions?

For detailed technical comparisons, see [comparison-matrix.md](comparison-matrix.md).  
For quick answers, see [quick-reference.md](quick-reference.md).

**Maintained by**: Extension development team  
**Last Updated**: 2026-01-30  
**Next Review**: 2026-07-30 (6-month checkpoint)
