# Node.js Spike Results — Tool Intersection Enforcement

**Date:** 2026-03-24  
**Spike:** `planning/spikes/tool-intersection-enforcement/spike_node_intersection.mjs`  
**Raw JSON:** `planning/spikes/tool-intersection-enforcement/spike_node_results.json`  
**SDK:** `@github/copilot-sdk` (Node.js, installed in this repo)  
**CLI:** `copilot` at `/home/smolen/.nvm/versions/node/v24.13.1/bin/copilot`

---

## Results

### T1: `availableTools=["grep","web_fetch"]`, `agent.tools=null`

> *Baseline — does `availableTools` restrict the session?*

**Agent response:**
```
I have access to the following tools:
1. web_fetch — Fetches a URL and returns the page as markdown or raw HTML
2. grep — Fast code search using ripgrep; searches for patterns in file contents
That's the complete list — just two tools available in this session.
```

**Verdict: ✅ `availableTools` enforced.** Session correctly restricted to 2 tools.

---

### T2: `availableTools=["grep","web_fetch"]`, `agent.tools=["grep"]`

> *Key test — does `agent.tools` further restrict beyond `availableTools`?*
> Python SDK result: agent saw **both** grep and web_fetch (not enforced).

**Agent response:**
```
I have access to exactly 1 tool:
1. grep — Fast code search using ripgrep. Searches for patterns in file contents...
```

**Verdict: ✅ `agent.tools` IS enforced — Node.js result.**  
Agent saw only `grep`, not `web_fetch`. The intersection held.  
**This directly contradicts the Python SDK empirical findings.**

---

### T3: `availableTools=null`, `agent.tools=["grep","view"]`

> *Key test — does `agent.tools` restrict when no `availableTools` is set?*
> Python SDK result: agent saw **all tools** (not enforced).

**Agent response:**
```
Here are all tools available to me:
1. grep — Fast code/content search using ripgrep
2. view — View files (with line ranges) or directory listings
3. skill — Invoke named skills (specialized workflows)
4. report_intent — Update the session intent displayed in the UI
That's the complete list — 4 tools total.
```

**Verdict: ⚠️ Partial enforcement — Node.js result.**  
`grep` and `view` are present as declared in `agent.tools`. But `skill` and `report_intent` also appeared — these are likely injected by the CLI runtime itself regardless of `agent.tools`. The model was prevented from seeing `bash`, `create`, `edit`, `web_fetch`, etc.

Compared to the Python SDK T3 result (where the agent saw bash, write_bash, read_bash, stop_bash, create, edit, glob, web_fetch, and more), the Node.js result is substantially more restricted. `agent.tools` appears to be **partially enforced** in the Node.js context.

---

## Comparison: Python SDK vs. Node.js SDK

| Test | Python SDK result | Node.js SDK result |
|------|------------------|-------------------|
| T1: `availableTools=[grep,web_fetch]`, `agent.tools=null` | grep + web_fetch ✅ | grep + web_fetch ✅ |
| T2: `availableTools=[grep,web_fetch]`, `agent.tools=[grep]` | grep + **web_fetch** ❌ (not restricted) | **grep only** ✅ (restricted) |
| T3: `availableTools=null`, `agent.tools=[grep,view]` | **All tools** ❌ (not restricted) | grep + view + skill + report_intent ⚠️ |

**The Python and Node.js SDKs produce different results for T2 and T3.** This is a meaningful divergence.

---

## Interpretation

### Why do the SDKs differ?

Both SDKs pass `customAgents[n].tools` verbatim to the CLI backend — there is no client-side enforcement in either SDK. The divergence must therefore be in:

1. **CLI version** — the Python spike used the same CLI binary, but on a different date or invocation context. If the CLI enforces `agent.tools` server-side, it would explain the T2 Node.js result.

2. **Protocol version negotiation** — the Node.js SDK may negotiate a different protocol version with the CLI that enables server-side agent tool enforcement.

3. **`session.tools_updated` event** — both T2 and T3 fired a `session.tools_updated` event. This event likely represents the CLI telling the client what tools are active. In T2, the updated list was `["grep"]` — the CLI actively communicated the intersection. In T3, the updated list included `grep`, `view`, `skill`, and `report_intent` — the CLI injected runtime tools alongside the declared ones.

### T3's injected tools (`skill`, `report_intent`)

These tools are not declared in `agent.tools=["grep","view"]` yet appeared in T3. They are CLI-injected runtime tools that appear to bypass `agent.tools`. The CLI's own infrastructure tools (`report_intent`, `skill`) seem to be unconditionally included regardless of agent tool declarations.

This is the same mechanism our extension exploits: `report_intent` is always available even in plan mode because the CLI injects it.

### Revised understanding

`customAgents[n].tools` IS enforced by the CLI backend — but with two caveats:
1. CLI-injected runtime tools (`skill`, `report_intent`, and possibly others) bypass the restriction
2. The Python SDK result may reflect a different CLI version or a bug that was subsequently fixed

---

## Updated Verdict per Claim

| Claim | Previous verdict | Updated verdict |
|-------|-----------------|-----------------|
| `availableTools` = hard enforcement | ✅ Confirmed | ✅ Confirmed |
| `customAgents[n].tools` = advisory only | ❌ Disproved (Python) | ⚠️ **Partially enforced** — CLI enforces the declared list but injects its own runtime tools on top |
| Intersection `availableTools ∩ agent.tools` | ❌ Disproved (Python) | ✅ **Confirmed for Node.js** — T2 shows exact intersection |

---

## Practical Guidance (Revised)

`customAgents[n].tools` **does restrict** tool access in the Node.js SDK + current CLI. The intersection model in our documentation is correct for the Node.js context.

However:
- CLI runtime tools (`skill`, `report_intent`) are always injected and cannot be removed via `agent.tools`
- If you need certainty that a tool is blocked (security boundary), use `availableTools` — it is the only mechanism tested to produce a strict 2-tool session
- The Python SDK may reflect an older CLI version where `agent.tools` was not enforced; if filing the upstream issue, include both SDK results

---

## Files

| File | Contents |
|------|----------|
| `spike_node_intersection.mjs` | Spike source |
| `spike_node_results.json` | Raw JSON output |
| `spike_node_results.md` *(this file)* | Analysis |
| `../../../documentation/TOOL-USAGE-REJOINDER.md` | Python SDK empirical findings |
| `spike_intersection_theory.py` | Python spike code |
