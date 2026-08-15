# OUT-1 — Is ACP-as-adapter a third-party extension point?

**Venue:** [microsoft/agent-host-protocol#282](https://github.com/microsoft/agent-host-protocol/issues/282) (comment on the existing thread)
**Category:** b · **Confidence of getting an answer:** High · **Status:** drafted, unsent
**Send first.** Its answer determines the shape of OUT-3.

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
the Copilot SDK, with our own session manager owning the agent loop. We have
verified it runs fine outside the extension host. The question that decides our
roadmap is whether a host is *expected* to be pointable at an ACP agent it did
not compile in, or whether that seam is internal by design.

Is there an intended answer here? Happy to help document it either way.
```

## Notes for the sender

- Posts as `darthmolen` — edit until it sounds like you.
- Deliberately does **not** ask VS Code to do anything; wrong repo for that.
- Deliberately does **not** link the extension. Naming it is enough to establish
  standing without reading as promotion.
