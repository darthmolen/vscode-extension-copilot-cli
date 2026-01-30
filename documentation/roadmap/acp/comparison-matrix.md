# ACP vs. Copilot SDK: Technical Comparison Matrix

**Date**: 2026-01-30  
**Current Implementation**: @github/copilot-sdk v0.1.18  
**Alternative**: Agent Client Protocol (ACP) with @agentclientprotocol/sdk v0.13.1

---

## Executive Summary

**The Key Insight**: **The GitHub Copilot SDK already uses JSON-RPC internally** to communicate with Copilot CLI in server mode. ACP is essentially a **standardized, open-source version** of the same protocol.

**The Critical Question**: Does using the standardized ACP protocol directly offer advantages over GitHub's proprietary SDK wrapper?

---

## 1. Architecture Comparison

### Current: GitHub Copilot SDK

```
Your Extension (SDKSessionManager)
    ↓
@github/copilot-sdk (CopilotClient + Session)
    ↓ Proprietary JSON-RPC protocol
Copilot CLI (server mode - auto-spawned)
    ↓ Tools + MCP
File System + Git + Web + MCP Servers
```

**Characteristics**:

- SDK is a **convenience wrapper** around JSON-RPC
- Auto-spawns CLI process in server mode
- Uses **proprietary JSON-RPC protocol** (GitHub's implementation)
- Abstracts complexity (session management, event handling, lifecycle)

### Alternative: ACP Direct

```
Your Extension (ACP Client Implementation)
    ↓
@agentclientprotocol/sdk (ClientSideConnection)
    ↓ Open Standard ACP protocol (JSON-RPC)
Copilot CLI --acp mode (manually spawned)
    ↓ Tools + MCP
File System + Git + Web + MCP Servers
```

**Characteristics**:

- Direct protocol implementation
- You spawn `copilot --acp --stdio` yourself
- Uses **standardized ACP protocol** (JSON-RPC 2.0 spec)
- More control, less abstraction
- **Multi-agent capable** (could swap Copilot for Gemini/Claude)

---

## 2. Feature Parity Analysis

| Feature | GitHub SDK | ACP | Notes |
|---------|-----------|-----|-------|
| **Session Management** | ✅ Full | ✅ Full | Both support create, load, list |
| **Session Resume** | ✅ `client.resumeSession()` | ✅ `session/load` | Same capability |
| **Working Directory** | ✅ `cwd` parameter | ✅ `cwd` parameter | Identical |
| **MCP Servers** | ✅ `mcpServers` config | ✅ `mcpServers` config | Same format |
| **Tool Configuration** | ✅ `tools` array | ✅ Via MCP + built-in | SDK more explicit |
| **Model Selection** | ✅ `model` parameter | ✅ Model support | Same models |
| **Streaming Responses** | ✅ `assistant.message_delta` | ✅ `agent_message_chunk` | Different event names |
| **Tool Execution Events** | ✅ `tool.*` events | ✅ `tool_call` updates | Different structure |
| **Reasoning Display** | ✅ `assistant.reasoning` | ✅ Protocol support | Similar |
| **Permission Requests** | ✅ Built-in | ✅ `session/request_permission` | ACP more explicit |
| **Session Cancellation** | ⚠️ Implicit | ✅ `session/cancel` | ACP more robust |
| **Agent Plans** | ❌ No | ✅ `plan` updates | ACP has extra feature! |
| **Multi-Agent Support** | ❌ Copilot only | ✅ Any ACP agent | **ACP advantage** |
| **Auto Process Management** | ✅ SDK spawns CLI | ❌ Manual spawn | SDK convenience |
| **Auto Reconnect** | ✅ Built-in | ❌ Manual | SDK convenience |
| **Type Safety** | ✅ TypeScript types | ✅ TypeScript types | Both excellent |
| **Error Handling** | ✅ Structured errors | ✅ JSON-RPC errors | Both robust |

**Verdict**: ~95% feature parity. ACP has **agent plans** and **multi-agent** support. SDK has better **auto-management**.

---

## 3. Event Model Comparison

### GitHub SDK Events (Current)

| Event Type | Description | Your Usage |
|------------|-------------|-----------|
| `assistant.message` | Complete message | ✅ Display in UI |
| `assistant.message_delta` | Streaming chunk | ⚠️ Not using (could enable) |
| `assistant.reasoning` | Model thinking | ✅ Show/hide reasoning |
| `assistant.turn_start` | Turn begins | ✅ Show "thinking" |
| `assistant.turn_end` | Turn completes | ✅ Hide "thinking" |
| `assistant.usage` | Token usage | ✅ Display quota |
| `tool.execution_start` | Tool starts | ✅ Tool UI |
| `tool.execution_progress` | Tool progress | ✅ Progress updates |
| `tool.execution_complete` | Tool done | ✅ Tool UI completion |
| `session.start` | Session created | ✅ Logging |
| `session.resume` | Session resumed | ✅ Logging |
| `session.idle` | Session ready | ✅ Wait for completion |
| `session.error` | Error occurred | ✅ Error handling |
| `session.usage_info` | Token info | ✅ Display usage |

### ACP Events (Standardized)

| Event Type | Description | SDK Equivalent |
|------------|-------------|----------------|
| `agent_message_chunk` | Streaming text | `assistant.message_delta` |
| `user_message_chunk` | User message replay | N/A (new feature) |
| `tool_call` | Tool invocation | `tool.execution_start` |
| `tool_call_update` | Tool status update | `tool.execution_progress` + `complete` |
| `plan` | Agent's task plan | **NEW** (not in SDK) |
| `session/update` | Generic session update | Wrapper for above |
| `session/request_permission` | Permission needed | Implicit in SDK |

**Key Differences**:

1. **ACP has explicit permission model**: You must approve tools
2. **ACP has agent plans**: Shows agent's thinking/plan
3. **ACP uses `session/update` wrapper**: More structured
4. **SDK events are more granular**: Separate start/progress/complete

**Migration Impact**: Event handler code would need **significant refactoring** (~400 LOC in `sdkSessionManager.ts`).

---

## 4. Developer Experience

| Aspect | GitHub SDK | ACP | Winner |
|--------|-----------|-----|--------|
| **Setup Complexity** | Low (3 lines) | Medium (10-15 lines) | SDK |
| **Process Management** | Auto | Manual | SDK |
| **Code Example** | 5 lines for basic | 20-30 lines for basic | SDK |
| **Documentation** | Good (GitHub docs) | Excellent (agentclientprotocol.com) | ACP |
| **Type Safety** | Excellent | Excellent | Tie |
| **Error Messages** | Clear | Clear | Tie |
| **Debugging** | Harder (abstracted) | Easier (direct protocol) | ACP |
| **Learning Curve** | Low | Medium | SDK |
| **API Ergonomics** | High-level, convenient | Low-level, explicit | SDK for convenience, ACP for control |

### Code Comparison

#### Creating a Session (SDK)

```typescript
const client = new CopilotClient({ cwd: workspaceDir, autoStart: true });
const session = await client.createSession({ model: "gpt-5" });
```

#### Creating a Session (ACP)

```typescript
const copilotProcess = spawn("copilot", ["--acp", "--stdio"], {
  stdio: ["pipe", "pipe", "inherit"],
});
const stream = acp.ndJsonStream(
  Writable.toWeb(copilotProcess.stdin),
  Readable.toWeb(copilotProcess.stdout)
);
const connection = new acp.ClientSideConnection(
  (agent) => ({
    async requestPermission(params) { /* ... */ },
    async sessionUpdate(params) { /* ... */ }
  }),
  stream
);
await connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION });
const session = await connection.newSession({ cwd: workspaceDir, mcpServers: [] });
```

**Verdict**: SDK is **much more convenient** for simple use cases. ACP requires **more boilerplate** but gives **full control**.

---

## 5. Strategic Considerations

### Open Standard vs. Proprietary

| Dimension | GitHub SDK | ACP |
|-----------|-----------|-----|
| **Protocol Ownership** | GitHub (proprietary) | Open standard (Apache 2.0) |
| **Governance** | GitHub internal | Community + Zed Industries lead |
| **Adoption** | GitHub products only | Zed, JetBrains, Gemini CLI, Claude Code |
| **Future-Proofing** | Depends on GitHub | Industry standard (like LSP) |
| **Breaking Changes Risk** | GitHub's discretion | Versioned spec (lower risk) |
| **Vendor Lock-in** | High (GitHub only) | None (any ACP agent) |

### Ecosystem & Community

| Aspect | GitHub SDK | ACP |
|--------|-----------|-----|
| **Registry** | N/A | ✅ ACP Registry (central agent discovery) |
| **Multi-Editor Support** | VS Code (custom) | Zed (native), JetBrains (coming), VS Code (custom) |
| **Multi-Agent Support** | Copilot only | Copilot, Gemini, Claude, custom agents |
| **Maturity** | Technical Preview | Public Preview |
| **Release Cadence** | Unknown | Active (v0.13.1, regular updates) |
| **Community Size** | Small (GitHub internal) | Growing (Zed, Google, Anthropic) |

### Maintenance & Longevity

**GitHub SDK Risks**:

- Could be deprecated if GitHub shifts to ACP
- Limited to GitHub's roadmap
- Breaking changes in technical preview

**ACP Risks**:

- Still in public preview (breaking changes possible)
- Less mature than SDK wrapper
- More code for you to maintain

**Opportunity**:

- **If GitHub adds ACP support to Copilot CLI** (they already did! `--acp` flag), the SDK might become redundant
- ACP is the **strategic bet** for long-term ecosystem growth

---

## 6. Performance Comparison

| Metric | GitHub SDK | ACP | Notes |
|--------|-----------|-----|-------|
| **Latency** | +1 hop (SDK wrapper) | Direct protocol | ~Negligible difference |
| **Resource Usage** | +SDK process overhead | No wrapper overhead | Minimal impact |
| **Startup Time** | SDK auto-spawn | Manual spawn | Same (both spawn CLI) |
| **Streaming Efficiency** | Good | Good | Both use JSON-RPC streaming |
| **Memory Footprint** | SDK + CLI | CLI only | ~10-20MB difference (small) |

**Verdict**: Performance differences are **negligible**. Both use the same underlying Copilot CLI.

---

## 7. Migration Effort Estimate

### Code Changes Required

| File | Current LOC | Estimated Changes | Effort |
|------|-------------|------------------|---------|
| `sdkSessionManager.ts` | ~600 | ~400 (event handlers + lifecycle) | High |
| `extension.ts` | ~200 | ~50 (minor adjustments) | Low |
| `chatViewProvider.ts` | ~800 | ~20 (event data structure) | Low |
| `package.json` | - | Dependencies swap | Trivial |
| **Total** | ~1600 | ~470 | **12-16 hours** |

### Testing Burden

- **Unit Tests**: Need new test doubles for ACP protocol
- **Integration Tests**: Rewrite spawn/stdio tests
- **E2E Tests**: Same user-facing behavior (low effort)
- **Estimate**: **8-12 hours**

### Documentation Updates

- README.md (architecture section)
- HOW-TO-DEV.md (development guide)
- Code comments
- **Estimate**: **2-4 hours**

### **Total Migration Effort**: **22-32 hours**

---

## 8. Risk Assessment

### Risks of Staying with SDK

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| GitHub deprecates SDK for ACP | Medium | High | None (reactive) |
| SDK gets fewer updates | Medium | Medium | Switch to ACP later |
| Missing new ACP features (plans) | High | Low | Most features work fine |
| Vendor lock-in | High | Medium | Already committed to Copilot CLI |

### Risks of Migrating to ACP

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| ACP breaking changes (preview) | High | High | Pin version, monitor releases |
| Bugs in direct protocol usage | Medium | Medium | Thorough testing, fallback to SDK |
| Regression during migration | Medium | High | Comprehensive E2E tests |
| Maintenance burden increases | Medium | Medium | ACP is simpler protocol than SDK |

---

## 9. Pros & Cons Summary

### Advantages of ACP

| Advantage | Value | Priority |
|-----------|-------|----------|
| **Open standard** (not vendor-locked) | High | High |
| **Multi-agent support** (Gemini, Claude) | Medium | Medium |
| **Future-proof** (industry standard) | High | High |
| **Agent plans** (new feature) | Low | Low |
| **Direct control** (easier debugging) | Medium | Low |
| **Community-driven** | Medium | Medium |
| **No abstraction overhead** | Low | Low |

### Disadvantages of ACP

| Disadvantage | Severity | Priority |
|--------------|----------|----------|
| **More boilerplate code** | Medium | Medium |
| **Manual process management** | High | High |
| **Still in public preview** | High | High |
| **Migration effort** (22-32 hours) | High | High |
| **Event handler refactoring** | High | High |
| **Testing burden** | Medium | Medium |
| **Breaking changes risk** | Medium | Medium |

### Advantages of Staying with SDK

| Advantage | Value | Priority |
|-----------|-------|----------|
| **Zero migration effort** | High | **Critical** |
| **Already working well** | High | **Critical** |
| **Auto process management** | High | High |
| **Less code to maintain** | Medium | Medium |
| **Stable API** (for now) | Medium | Medium |

### Disadvantages of Staying with SDK

| Disadvantage | Severity | Priority |
|--------------|----------|----------|
| **Potential deprecation** | Medium | Medium |
| **Vendor lock-in** | Medium | Low |
| **Technical preview status** | Medium | Medium |
| **Missing agent plans** | Low | Low |

---

## 10. Decision Framework

### When to Choose ACP

✅ You want to:

- Support multiple agents (Copilot, Gemini, Claude)
- Be on the cutting edge of open standards
- Have full control over the protocol
- Future-proof against SDK deprecation
- Contribute to the ACP ecosystem

✅ You can afford:

- 22-32 hours of migration effort
- More code to maintain
- Dealing with public preview instability

### When to Stay with SDK

✅ You want to:

- Keep things simple and working
- Focus on features, not infrastructure
- Minimize maintenance burden
- Avoid breaking changes in preview software

✅ You value:

- Zero migration effort
- Auto process management
- Less boilerplate code
- Stability over flexibility

---

## 11. Recommendation

### **SHORT TERM: Stay with GitHub Copilot SDK ✅**

**Rationale**:

1. **It's working well** - No bugs, no issues, solid foundation
2. **Zero migration cost** - 22-32 hours is significant
3. **Technical preview risks** - Both SDK and ACP are in preview, but SDK is stable for you
4. **Limited upside** - Agent plans and multi-agent support are **not current requirements**
5. **Vendor lock-in is acceptable** - You're already committed to Copilot CLI ecosystem

### **LONG TERM: Monitor ACP Closely 👀**

**Action Items**:

1. **Watch for ACP v1.0 stable release** - Reduces breaking change risk
2. **Monitor GitHub's SDK roadmap** - Are they deprecating it?
3. **Track ACP adoption** - If major editors adopt (VS Code official support), reconsider
4. **Reassess in 6 months** (July 2026) - ACP will be more mature

### **MIDDLE GROUND: Prototype ACP (Low Priority) 🧪**

**Optional Side Project**:

- Spend **4-6 hours** building a minimal ACP proof-of-concept
- Don't integrate it into main extension
- Learn the protocol, validate assumptions
- Keep it as a **backup plan** if SDK gets deprecated

**Benefit**: You'll be **prepared to migrate** if circumstances change.

---

## 12. Unanswered Questions & Further Research

### Questions for GitHub

1. **Is the SDK being deprecated in favor of ACP?**
2. **What's the SDK's long-term roadmap?**
3. **Will the SDK support ACP under the hood?**
4. **Are agent plans coming to the SDK?**

### Questions for ACP Community

1. **When is ACP v1.0 stable expected?**
2. **What's the breaking change policy?**
3. **Are there VS Code examples/extensions using ACP?**

### Internal Questions

1. **Do we need multi-agent support?** (Probably not)
2. **Do we need agent plans?** (Nice to have, not critical)
3. **Can we afford 22-32 hours for migration?** (Not urgent)

---

## 13. Copilot CLI Features: ACP Mode vs. SDK Mode

**Critical Finding**: The Copilot CLI provides **identical features** whether accessed via SDK or ACP. The CLI itself doesn't change—only the communication protocol differs.

### CLI Feature Matrix

| Feature | ACP Mode | SDK Mode | Notes |
|---------|----------|----------|-------|
| **All CLI Flags** | ✅ Available | ✅ Available | `--allow-all`, `--model`, `--agent`, etc. |
| **MCP Servers** | ✅ Full support | ✅ Full support | Same MCP server configuration |
| **GitHub MCP Server** | ✅ Built-in | ✅ Built-in | Default toolsets: context, repos, issues, PRs, users |
| **Model Selection** | ✅ 14 models | ✅ 14 models | Claude, GPT, Gemini models |
| **Tool Permissions** | ✅ Full control | ✅ Full control | `--allow-tool`, `--deny-tool`, `--allow-all-tools` |
| **URL Permissions** | ✅ Full control | ✅ Full control | `--allow-url`, `--deny-url`, `--allow-all-urls` |
| **Path Permissions** | ✅ Full control | ✅ Full control | `--allow-all-paths`, `--add-dir` |
| **Custom Agents** | ✅ Supported | ✅ Supported | `--agent` flag |
| **Session Management** | ✅ Full support | ✅ Full support | Create, resume, list, delete |
| **Infinite Sessions** | ✅ Available | ✅ Available | Checkpoint/plan.md/files workspace |
| **Streaming** | ✅ Enabled | ✅ Enabled | Real-time response streaming |
| **Parallel Tool Execution** | ✅ Configurable | ✅ Configurable | `--disable-parallel-tools-execution` |
| **Working Directory** | ✅ Set via `cwd` | ✅ Set via `cwd` | Session-level working directory |
| **Logging** | ✅ Full control | ✅ Full control | `--log-level`, `--log-dir` |
| **Custom Instructions** | ✅ AGENTS.md | ✅ AGENTS.md | Repository-level instructions |
| **Skills System** | ✅ Available | ✅ Available | `/skills` commands |
| **Experimental Features** | ✅ Available | ✅ Available | `--experimental` flag |

**Verdict**: There is **zero functional difference** in what the CLI can do. ACP vs. SDK is purely about **how you communicate** with the CLI.

### CLI Built-in Tools (Identical in Both Modes)

Both ACP and SDK mode have access to the same Copilot CLI built-in tools:

| Category | Tools | Count |
|----------|-------|-------|
| **File Operations** | `view`, `edit`, `create`, `glob`, `grep` | 5 |
| **Shell** | `bash` (sync/async), `read_bash`, `write_bash`, `stop_bash` | 4 |
| **Git Operations** | Via shell tool (`git status`, `git diff`, etc.) | N/A |
| **Web Access** | `web_fetch`, `web_search` | 2 |
| **Planning** | `update_todo`, `report_intent`, `ask_user` | 3 |
| **Tasks** | `task` (explore, task, general-purpose, code-review agents) | 1 |
| **Memory** | `store_memory` | 1 |
| **Skills** | `skill` (invoke custom skills) | 1 |
| **GitHub MCP Server** | 50+ tools (repos, issues, PRs, actions, security, etc.) | 50+ |
| **Custom MCP Servers** | Unlimited (filesystem, memory, etc.) | ∞ |

**Total**: 70+ built-in tools, identical in both modes.

### GitHub MCP Server Toolsets (Available in Both)

The built-in GitHub MCP server provides these toolsets (same in both modes):

| Toolset | Description | Tools | Default |
|---------|-------------|-------|---------|
| `context` | Current user & GitHub context | `get_me`, `get_teams`, `get_team_members` | ✅ |
| `repos` | Repository operations | `get_file_contents`, `search_code`, `list_commits`, etc. | ✅ |
| `issues` | Issue management | `issue_read`, `list_issues`, `search_issues` | ✅ |
| `pull_requests` | PR operations | `pull_request_read`, `list_pull_requests`, `search_pull_requests` | ✅ |
| `users` | User operations | `search_users` | ✅ |
| `actions` | GitHub Actions | `actions_list`, `actions_get`, `get_job_logs`, `actions_run_trigger` | ❌ |
| `code_security` | Code scanning | `list_code_scanning_alerts`, `get_code_scanning_alert` | ❌ |
| `dependabot` | Dependabot alerts | `list_dependabot_alerts`, `get_dependabot_alert` | ❌ |
| `secret_protection` | Secret scanning | `list_secret_scanning_alerts`, `get_secret_scanning_alert` | ❌ |
| `discussions` | GitHub Discussions | Discussion tools | ❌ |
| `gists` | GitHub Gists | Gist tools | ❌ |
| `git` | Low-level Git API | Git operation tools | ❌ |
| `labels` | Label management | Label tools | ❌ |
| `notifications` | Notifications | Notification tools | ❌ |
| `orgs` | Organizations | Org tools | ❌ |
| `projects` | GitHub Projects | Project tools | ❌ |
| `security_advisories` | Security advisories | Advisory tools | ❌ |
| `stargazers` | Stargazers | Star tools | ❌ |

**Note**: Remote GitHub MCP Server (not available locally) adds:

- `copilot` - Copilot Coding Agent tools
- `copilot_spaces` - Copilot Spaces tools
- `github_support_docs_search` - GitHub docs search

### Permission Model Differences

| Aspect | ACP Mode | SDK Mode |
|--------|----------|----------|
| **Permission Requests** | ✅ Explicit `session/request_permission` | ⚠️ Implicit (SDK handles) |
| **User Approval** | ✅ You implement approval UI | ✅ SDK handles automatically |
| **Granularity** | ✅ Per-tool approval | ✅ Same granularity |
| **Override** | ✅ `--allow-all` flag | ✅ `--allow-all` flag |

**Key Difference**: ACP requires you to **implement permission handling** (`requestPermission` callback). SDK **abstracts this away**.

### When CLI Features Might Differ

The **only** scenario where ACP might expose features the SDK doesn't:

1. **Brand new ACP features**: If the ACP protocol spec adds new capabilities before GitHub updates their SDK
2. **Protocol-level control**: ACP gives you direct access to all protocol features (e.g., explicit cancellation, detailed stop reasons)
3. **Multi-agent support**: ACP lets you swap out Copilot CLI for other agents (Gemini, Claude) with different tool sets

**Current Reality**: Both modes expose **100% of Copilot CLI's capabilities**.

---

## 14. Action Plan (Recommended)

### Immediate (This Week)

- [x] Complete this research document
- [ ] Share findings with stakeholders/users
- [ ] Decision: Stay with SDK ✅

### Short Term (Next 1-3 Months)

- [ ] Monitor ACP releases (subscribe to GitHub repo)
- [ ] Monitor Copilot SDK updates (watch for deprecation notices)
- [ ] Bookmark ACP documentation for reference

### Medium Term (3-6 Months)

- [ ] Optional: 4-6 hour ACP proof-of-concept spike
- [ ] Reassess in July 2026 (6-month checkpoint)
- [ ] Decide: Continue with SDK or plan migration

### Long Term (If Migration Needed)

- [ ] Create detailed migration plan
- [ ] Implement ACP in feature branch
- [ ] Comprehensive testing (E2E, integration, UAT)
- [ ] Gradual rollout with beta testers
- [ ] Full migration (22-32 hours)

---

## Conclusion

**The GitHub Copilot SDK and ACP are fundamentally similar** - both use JSON-RPC to communicate with Copilot CLI. The SDK is a convenience wrapper; ACP is the standardized protocol.

**For your extension, the SDK is the right choice today** because:

- It works well
- Migration offers minimal immediate value
- ACP is still in public preview
- You don't need multi-agent support

**But keep ACP on your radar** because:

- It's the future of agent-client communication (like LSP)
- If GitHub shifts to ACP-first, you'll need to migrate anyway
- Multi-agent support could be valuable later

**Final verdict**: **Stay with SDK, monitor ACP, reassess in 6 months.** ✅

---

*Research completed: 2026-01-30*  
*Next review: July 2026*
