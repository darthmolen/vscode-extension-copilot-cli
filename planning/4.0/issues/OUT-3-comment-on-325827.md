# OUT-3 — Support external agent registration (comment on #325827)

**Venue:** [microsoft/vscode#325827](https://github.com/microsoft/vscode/issues/325827) — **comment**, not a new issue
**Category:** b · **Confidence:** Low–Medium · **Status:** drafted, unsent
**Send after OUT-1.** Its answer changes what we should be asking for here.

## Etiquette constraint — read before sending

#325827 is **ThePlenkov's proposal**, filed 2026-07-14, assigned @joshspicer,
with **zero comments and no labels or milestone**. We agree with their *problem*
and would reframe their *solution*.

Posting a long alternative design on an untriaged thread reads as hijacking, and
it backfires mechanically: a maintainer triaging "author wants X, stranger wants
Y" defers the whole thing as unsettled, which hurts their ask and ours.

So: **short, supportive, additive.** The substantive alternative belongs in
OUT-1 (protocol venue) and OUT-2 (its own narrow issue).

## Redundancy check against the original

Already in their issue — do **not** restate:

- Agent Host providers require modifying `agentHostMain.ts` (their point 2, with the file path)
- `registerCustomAgentProvider` covers prompt-based agents only (their point 1)
- The proposed `vscode.agentHost.registerAgentProvider()` shape
- **Remote agent hosts already discover agents dynamically from `rootState.agents`** — their strongest argument, in Notes

Genuinely ours to add:

- A real shipping extension that is blocked (they argue from architecture)
- ACP may already be the documented adapter seam, so this may need exposing rather than designing

## Draft

```markdown
Supporting this with a concrete case, and one question that might change its shape.

We ship a VS Code extension that drives the Copilot CLI through the Copilot SDK —
our own session manager owns the agent loop and our webview renders it. We have
verified it runs correctly outside the extension host, so the only thing standing
between it and the agents picker is registration. Exactly the gap described here.

The question: the AHP docs designate ACP as the host-facing adapter interface —
"the host is acting as a bridge: it speaks AHP upstream (to clients) and ACP
downstream (to agents)". If that is intended as a third-party extension point,
this issue might not need a new `IAgent` surface at all, just a way to point the
Agent Host at an ACP-speaking agent. I have asked which is intended over on
agent-host-protocol#282; whichever way that lands seems worth knowing before
design work starts here.

Also worth noting your point about remote hosts already discovering agents from
`rootState.agents` has a local mirror: `code agent host` serves AHP over
WebSocket on localhost and #311105 treats "VS Code + local agent host" as
supported, but the workspace picker only offers Tunnels and SSH. Filed
separately as <OUT-2 link> since it stands on its own.
```

## Notes for the sender

- Posts as `darthmolen`.
- Fill in the OUT-2 link before sending; if OUT-2 has not been filed, cut that
  paragraph rather than forward-referencing.
- If OUT-1 has already been answered, replace the middle paragraph with the
  answer — far stronger than an open question.
- Keep it this short. The temptation to add the full argument is the failure mode.
