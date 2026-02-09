# AI Is a 10x Multiplier — For Better and For Worse

*How 30 years of instinct saved a project from the slop spiral, and what the industry needs to hear.*

---

AI is a 10x force multiplier for developers who know what they're doing.

AI is a 10x force multiplier for chaos for developers who don't.

I just proved both truths with the same project.

## The Story

Copilot CLI had just been released and my company was looking to empower developers with AI. Claude was $150/seat for the best tier. Copilot was $20-$50. Now, I hated the Copilot experience in VS Code — too much swiss army knife, not enough focused workflow — but the new CLI was clearly built by people influenced by Claude Code. It just didn't have a VS Code extension to match.

I'd never written a VS Code extension before. Too much hand-waving in the docs, and most of my career lived in Visual Studio. But I had a new toy without a toybox, so I let Copilot build its own home.

By version 2.2, we had a functional extension. Three files, 2,500 lines each. Features worked. Tests passed. Users could click buttons.

My every instinct was screaming.

## The Slop Timeline

**Versions 1–2: "It works!"**

AI generates 2,500 lines in one file. Giant switch statement with 200+ cases. No type safety. Tests pass, users can click buttons. Ship it.

Reality: a proof of concept masquerading as production code.

**Versions 3–4: "Getting messy..."**

Need to add feature X. AI adds 500 more lines to the monolith. Tests still pass, barely. File hits 3,000 lines. Each AI addition makes the next one worse.

**Version 5: The turning point.**

I forced a refactor. We extracted an untyped 200-line switch statement into typed RPC handlers. I noticed the RPC logs in Chrome DevTools and the extension logs in the Output window. Then I looked at the messaging layer and realized it was pub/sub.

Wait. Chrome DevTools? That's because the webview *is* a browser.

Then it snapped: this whole thing is client-server. Node.js backend, browser frontend, RPC in between. They just called everything weird names. No black box. No voodoo. Just a web app.

Once I had the right mental model, 30 years of experience kicked in and the architecture fell into place in hours.

**The alternate timeline (no refactor):**

AI can't understand the 5,000-line mess it created. Each fix breaks three other things. Tests become flaky. "Just rewrite the whole thing." Project dead within 12 months.

## What AI Slop Actually Is

AI slop is code that works but can't survive:

| ✅ What AI delivers | ❌ What AI misses |
|---------------------|-------------------|
| Functions that run | Architecture that scales |
| Features as requested | Where features belong |
| Passing tests | Testable systems |
| Short-term solutions | Long-term coherence |
| Local optimization | Global design |
| Syntax correctness | Semantic structure |

AI creates **locally optimal, globally terrible** code.

The fundamental asymmetry: AI can answer "how do I do X?" It cannot answer "should we do X, or is there a better approach?" That second question requires architectural judgment, which requires experience, which AI doesn't have.

## How Instinct Caught What AI Couldn't

**Red flag:** 2,500 lines in one file.
AI says: "Added feature successfully!"
My gut: "This file is too big. Something's wrong."

**Red flag:** 200-line switch statement.
AI says: "Handled all message types!"
My gut: "There's a better pattern."

**Red flag:** No type safety on messages.
AI says: "JavaScript works fine!"
My gut: "We're in TypeScript. Why isn't this typed?"

**Red flag:** Mixed concerns everywhere.
AI says: "All the code is in one place!"
My gut: "UI, logic, and networking shouldn't live together."

At version 4, I had a choice. Keep adding features with AI — fast short-term, dead in 12 months. Or stop and refactor — slow short-term, sustainable forever.

I chose the refactor.

## Before and After

**Before (AI slop):**

```text
extension.ts (800 lines) — everything mixed together
webview/main.js (2500 lines) — UI + business logic + networking
No type safety, giant switch statements, zero separation of concerns
```

**After (human architecture):**

```text
Server (extension/)
├── ExtensionRpcRouter (450 lines) — type-safe API endpoints
├── SDKSessionManager (600 lines) — session lifecycle
└── extension.ts (150 lines) — startup only

Client (webview/)
├── WebviewRpcClient (390 lines) — type-safe RPC calls
├── main.js (900 lines) — 18 small handlers
└── styles.css (500 lines)

Shared (shared/)
├── messages.ts (400 lines) — TypeScript types for 31 message types
└── models.ts (200 lines) — domain models
```

Full type safety. Compile-time validation. Every file has one job. Can add features without fear.

All achieved by applying web development patterns I've used for decades — not AI magic.

## The Honest Accounting

**Time invested:**

- AI generation: ~20 hours
- Human refactoring: ~60 hours
- Total: ~80 hours for a production-ready codebase

**Alternative (no refactor):**

- AI generation: ~20 hours
- Death spiral: 6-12 months of increasing pain
- Eventual rewrite: ~200+ hours
- Total: much worse outcome

The refactor cost 60 hours. Skipping it would have cost the project.

## The Part Nobody Wants to Admit

"Vibe coding" is just another way to say "shipping a POC as production code." And right now, the industry is rewarding it.

The marketing pitch says AI writes production code, developers are 10x faster, traditional software engineering is obsolete. The spreadsheet says 2,500 lines in 2 hours at $75/hour — that's a 160x productivity gain! Fire half the team!

The spreadsheet doesn't track maintainability. It doesn't track the refactoring cost at month 7. It doesn't track the senior engineers who quit because they don't want to maintain slop. It doesn't track the project that dies at month 12.

None of these appear on the spreadsheet until it's too late.

## The Right Way: Architect First, Generate Second

**Human sets the architecture:**

> "This is a client-server app. Extension host is the Node.js backend. Webview is the browser frontend. RPC layer handles type-safe communication."

**AI generates within constraints:**

> "Generating server-side service class... Creating RPC endpoint with TypeScript types... Implementing client-side handler..."

**Human reviews for architecture:**

> "This belongs in the services layer, not RPC. Extract this to a helper. Add type safety here."

**AI refines based on feedback.**

The pattern is simple: human drives, AI accelerates. Not the other way around.

The test is equally simple: can you explain the architecture to a junior dev? If the answer is "I don't know, AI made it this way" — you don't own it. And if you don't own it, you can't maintain it.

## What I Learned

**Working code is the first requirement, not the last.** AI checks three boxes: it runs, it passes tests, it implements the feature. Humans check ten: is it maintainable, scalable, debuggable, testable, understandable, and will it survive six months?

**Instinct beats velocity.** 30 years of experience telling me "this feels wrong" was worth more than 30 minutes of AI generation.

**Slop compounds exponentially.** Technical debt grows faster than you can pay it off. Don't borrow.

**Architecture requires humans.** AI can implement patterns. It cannot create them, choose between them, or know when to abandon them.

## Where This Project Stands Now

The extension is production-ready. Full type safety across the client-server boundary. 18 extracted handlers, all tested. RPC layer with compile-time validation. Clean separation of concerns. Features get added without fear.

And I'm using the extension to build the extension. Copilot CLI, running inside the VS Code extension I built with Copilot CLI, writing the next version of itself.

The tool works. But it only works because a human with 30 years of instinct refused to let it produce garbage.

**Architect first. Generate second. Maintain forever.**

And for heaven's sake, don't ship POC code to production.

---

This article was distilled from a conversation between a human and an AI. If you want to see the raw exchange — the human's unfiltered prompt and the AI's unedited response — read [HUMAN-CONTEXT-AI-RESPONSE.md](HUMAN-CONTEXT-AI-RESPONSE.md).

---

*Steven Molen, Sr. Enterprise Architect*
*Written with Copilot CLI using Sonnet 4.5 — because the human provided the insight, and the AI provided the articulation.*

*[View the codebase](https://github.com/darthmolen/vscode-extension-copilot-cli) — the before and after commits are the proof.*

---
