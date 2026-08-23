# OUT-1 — Is ACP-as-adapter a third-party extension point?

**Venue:** [microsoft/agent-host-protocol#282](https://github.com/microsoft/agent-host-protocol/issues/282) (comment on the existing thread)
**Category:** b · **Confidence of getting an answer:** High · **Status:** ✅ **POSTED 2026-08-15**
**Link:** [issue #282, comment 5303296347](https://github.com/microsoft/agent-host-protocol/issues/282#issuecomment-5303296347)
Sent first, as planned — its answer determines the shape of OUT-3 and how deeply Lane B invests in Slice 2.

## Why this one first

It is a **question, not a request**. It costs the maintainers nothing to answer,
it is on-topic for a thread they already engaged with at length, and either
answer is decision-useful to us:

- *"Yes, third parties can implement ACP agents"* → OUT-3 becomes "expose the
  seam you documented", a far cheaper ask than "design us an `IAgent` API".
- *"No, it is an internal detail of the first-party adapters"* → we stop
  planning around it and go straight to IN-9 (our own host) or drop the
  VS Code-picker ambition entirely.

@joshmouch already wrote the definitive layering explanation on #282 and offered
a doc PR, so the thread is live and the audience is right.

## Draft

```markdown
Thanks — the layering diagram above answered the question I came here with, and
raised a sharper one.

The guide says the host "speaks AHP upstream (to clients) and ACP downstream
(to agents)", which reads as ACP being the host-facing adapter interface. If
that is the intent, then an agent runtime participates by speaking ACP, and no
new host-side plugin API is needed.

What I cannot tell from the docs is whether that is meant as a **third-party
extension point** or as an implementation detail of the first-party adapters.
The caveat above — that the repo ships the types, schemas and client libraries
but "no host and no ACP code at all" — leaves it genuinely ambiguous.

Concretely: we maintain a VS Code extension that drives the Copilot CLI through
the Copilot SDK, with our own session manager owning the agent loop. We've
verified it runs outside the extension host — including our plan-mode custom
tools, whose handlers still execute in-process when the SDK is driven from a
plain Node process. The question that decides our roadmap is whether a host is
*expected* to be pointable at an ACP agent it did not compile in, or whether
that seam is internal by design.

Is there an intended answer here? Happy to help document it either way.
```

## Outcome

Posted the sharper variant, which cites the Phase 0.2 spike rather than asserting
the claim: plan-mode custom tool handlers execute in-process when the SDK is
driven from a plain Node process.

**What each answer means for us:**

| If they say | Then |
| --- | --- |
| ACP-as-adapter **is** a third-party extension point | OUT-3 becomes "expose the seam you documented" rather than "design us an `IAgent` API" — a far cheaper ask. IN-3 gains a real destination. |
| It's an **internal detail** | Stop planning around the VS Code picker. IN-3 still pays off via Zed and other ACP clients, but the priority drops and Lane B's chat-in-a-tab becomes the near-term value. |
| **No answer in ~2 weeks** | Treat as the second case. Do not idle on someone else's inbox. |

## Notes for the sender

- Posted as `darthmolen`.
- Deliberately does **not** ask VS Code to do anything; wrong repo for that.
- Deliberately does **not** link the extension. Naming it is enough to establish
  standing without reading as promotion.
