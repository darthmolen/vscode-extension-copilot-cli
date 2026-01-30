# ACP vs SDK: Quick Reference

**Date**: 2026-01-30  
**Recommendation**: ✅ Stay with @github/copilot-sdk

---

## TL;DR

| Aspect | SDK | ACP |
| -------- | ----- | ----- |
| **What it is** | Proprietary wrapper | Open standard protocol |
| **Copilot CLI features** | 100% | 100% (identical) |
| **Code complexity** | Low (5 lines) | High (20-30 lines) |
| **Process management** | Auto | Manual |
| **Migration effort** | Zero | 22-32 hours |
| **Multi-agent** | No | Yes (Gemini, Claude) |
| **Maturity** | Technical preview | Public preview |
| **When to use** | **Now** | Maybe in 6+ months |

**Bottom Line**: They do the same thing. SDK is easier. No reason to switch now.

---

## The One Key Fact

**The GitHub Copilot SDK already uses JSON-RPC to talk to Copilot CLI.**  
**ACP is just the open-source version of that protocol.**

It's like:

- SDK = Using `fetch()` (high-level, convenient)
- ACP = Using raw WebSockets (low-level, full control)

Both talk to the same server. Same features. Different ergonomics.

---

## CLI Features (Identical in Both)

✅ **70+ built-in tools**: view, edit, create, bash, grep, glob, web_fetch, web_search, task, skill, etc.  
✅ **GitHub MCP Server**: 50+ GitHub API tools (repos, issues, PRs, actions, security, etc.)  
✅ **Custom MCP Servers**: Unlimited (filesystem, memory, custom tools)  
✅ **14 AI models**: Claude, GPT, Gemini  
✅ **All CLI flags**: --allow-all, --model, --agent, --add-dir, etc.  
✅ **Session management**: Create, resume, list, delete  
✅ **Permissions**: Granular tool/URL/path control  
✅ **Streaming**: Real-time responses  
✅ **Parallel tools**: Concurrent execution  

**No difference.** The CLI doesn't know or care whether you're using SDK or ACP.

---

## Code Example

### Creating a Session with SDK (Current)

```typescript
const client = new CopilotClient({ cwd: workspaceDir, autoStart: true });
const session = await client.createSession({ model: "gpt-5" });
```

### Creating a Session with ACP (Alternative)

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
    async requestPermission(params) { /* Your UI logic */ },
    async sessionUpdate(params) { /* Handle events */ }
  }),
  stream
);
await connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION });
const session = await connection.newSession({ cwd: workspaceDir, mcpServers: [] });
```

**6x more code. Same result.**

---

## Why SDK Wins (Today)

1. ✅ **Already working** - No migration, no risk
2. ✅ **Simpler** - Less boilerplate, cleaner code
3. ✅ **Auto-management** - SDK spawns/kills CLI, handles reconnects
4. ✅ **Save 22-32 hours** - No migration effort
5. ✅ **Feature parity** - Does everything ACP does for Copilot CLI

## Why ACP Might Win (Future)

1. ✅ **Open standard** - Not vendor-locked to GitHub
2. ✅ **Multi-agent** - Could swap Copilot for Gemini/Claude/custom agents
3. ✅ **Industry adoption** - Zed, JetBrains, VS Code will support it
4. ✅ **Future-proof** - Like LSP, this is where the ecosystem is heading
5. ✅ **Direct control** - Easier debugging, no abstraction layer

## When to Reconsider ACP

☑️ **July 2026** - 6-month checkpoint  
☑️ ACP reaches **v1.0 stable** (no breaking changes)  
☑️ GitHub **deprecates** the SDK  
☑️ You need **multi-agent support** (Gemini, Claude)  
☑️ VS Code adds **native ACP support** (like Zed)  

Until then: **SDK is the pragmatic choice.**

---

## Migration Effort (If Needed Later)

| Task | Effort |
| ------ | -------- |
| Code changes (sdkSessionManager.ts) | 12-16 hours |
| Testing (unit, integration, E2E) | 8-12 hours |
| Documentation updates | 2-4 hours |
| **Total** | **22-32 hours** |

**Not urgent.** Can be deferred until there's a compelling reason.

---

## Action Items

### Now

- [x] Research complete
- [ ] Share findings
- [ ] Decision: **Stay with SDK** ✅

### Next 3 Months

- [ ] Monitor ACP releases (GitHub notifications)
- [ ] Watch for SDK deprecation notices
- [ ] Optional: 4-6 hour ACP learning spike (low priority)

### July 2026

- [ ] **Reassessment checkpoint**
- [ ] Decide: Continue with SDK or plan migration

---

## Full Documentation

- **Detailed Analysis**: [`comparison-matrix.md`](comparison-matrix.md) (16KB, 14 sections)
- **Research Plan**: [`../plan.md`](../plan.md) (10KB, workplan + context)

---

**Questions?** Check the comparison matrix or ask!
