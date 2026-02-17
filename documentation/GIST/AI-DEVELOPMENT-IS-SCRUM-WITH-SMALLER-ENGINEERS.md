# AI Development Is Just Scrum With Smaller Engineers

*On managing non-deterministic junior developers who never sleep, never push back, and never remember yesterday's standup.*

---

## The Pattern I Couldn't Unsee

I've been running Scrum teams for the better part of two decades. Somewhere around week three of building a VS Code extension with AI agents, I stopped mid-prompt and laughed out loud.

I was writing acceptance criteria. I was timeboxing a spike. I was reviewing output and sending it back with notes. I was managing a backlog, tracking what was done, and planning the next iteration.

I was running a Sprint. My team just happened to be artificial.

The more I worked with AI agents -- Claude, Copilot, whatever -- the more the patterns mapped. Not loosely. Not metaphorically. *Precisely.* The same management failures that kill human Scrum teams kill AI-assisted projects. The same disciplines that make human teams effective make AI workflows productive.

Thirty years of building software taught me how to manage teams. Turns out, the same skills transfer directly. You just need to adjust for the fact that your developers have no memory, no judgment, and unlimited enthusiasm for terrible ideas.

---

## The Rosetta Stone: Scrum Meets AI

If you've run a Scrum team, you already know how to manage AI. You just need the vocabulary mapping.

| Scrum Concept | AI Development Equivalent |
|---|---|
| Sprint Planning | Prompt design and task decomposition |
| Product Backlog | `planning/backlog/` folder with structured task files |
| Sprint Backlog | Current prompt context and active plan files |
| Daily Standup | Reviewing AI output, re-establishing context after session restarts |
| Sprint Review | Evaluating AI output against acceptance criteria |
| Sprint Retrospective | Adjusting prompts, rules, and constraints based on what went wrong |
| Definition of Done | Explicit acceptance criteria in your prompt or plan file |
| Scrum Master | You, removing blockers and enforcing process |
| Product Owner | You, defining requirements and priorities |
| Development Team | Your AI agents |
| Team Norms / Working Agreement | CLAUDE.md, .copilot-instructions, rules files |
| Spike | Bounded research task with explicit deliverables |
| Timebox | "Try this three times, then stop and report findings" |
| Kanban Board | `planning/` folder with `backlog/`, `in-progress/`, `completed/` |
| User Stories | Structured prompts with context, constraints, and acceptance criteria |
| Impediment | Missing context, locked-down documentation, hallucinated APIs |
| Velocity Tracking | Observing how many tasks complete cleanly per session |

Read that table once. Now every Scrum instinct you have applies to AI development.

---

## Treat AI Like a Brilliant Junior Developer

This is the single most useful mental model I've found. Your AI agent is a junior developer who is brilliant, tireless, and well-read -- but lacks judgment, context, and the ability to see past the current task.

Every experienced tech lead knows that junior developers share a set of traits. They work fast. They produce output. They follow instructions literally. They miss the forest for the trees. They chase the interesting problem instead of the important one. They need structure, boundaries, and clear requirements to do their best work.

AI is all of these things, amplified. Faster output. More literal interpretation. Bigger blind spots. Shorter attention span. Greater need for structure.

The management approach is identical: clear requirements, firm boundaries, frequent check-ins, and an experienced lead who knows when the output smells wrong even if it compiles clean.

---

## Requirements, Requirements, Requirements

I have never seen a junior developer succeed without clear requirements. Not once in thirty years. AI is the same, except worse.

A junior developer will at least *ask* when confused. AI will guess. And because it's non-deterministic, it will guess differently each time. One run produces a clean service class. The next run produces a 400-line god object that imports half the project. Same prompt, different day, different result.

The fix is the same fix it's always been: nail down the requirements before anyone writes a line of code.

For a human team, that means user stories with acceptance criteria. For AI, that means structured prompts with explicit constraints: what to build, where it goes, what patterns to follow, what to avoid, and what "done" looks like.

I've found that the more specific I am with AI, the less time I spend on rework. That's not a new insight. It's the oldest lesson in software engineering, relearned with a new tool.

---

## Team Norms: Your AI Working Agreement

Every good Scrum team has a working agreement. Code style, branching strategy, test coverage expectations, commit message format. The norms that keep a team rowing in the same direction.

AI agents need the same thing, written down, in a file they read before every session.

Claude has `CLAUDE.md`. Copilot has `.copilot-instructions.md`. Every agent framework has some version of a manifest or rules file. These are your working agreements. Treat them that way.

Here's what goes in mine:

- Project architecture and mental model ("This is a client-server app. Extension host is the backend. Webview is the frontend.")
- Code style expectations ("Use TypeScript interfaces for all message types. No `any`.")
- File organization rules ("Handlers go in `handlers/`. Services go in `services/`. Nothing goes in `extension.ts` except startup.")
- Testing expectations ("Every new function gets a unit test. Run `npm test` before declaring done.")
- Anti-patterns to avoid ("Do not create god objects. Do not put business logic in the UI layer. Do not use untyped message passing.")
- Good and bad examples (show a clean handler, show a messy one, explain why)

Junior developers thrive with more instruction and clearer boundaries. AI is identical. The teams I've seen struggle with AI are the same ones that struggle with onboarding junior developers: no documentation, no norms, no structure. "Just look at the code and figure it out" works for senior engineers. It fails catastrophically for juniors and AI alike.

---

## Ask Questions Before Giving Orders

This one surprised me. I started getting better AI output when I stopped giving instructions and started asking questions.

Instead of "implement a caching layer for the SDK session," I'd write: "We're seeing redundant SDK calls on every message. What caching strategies could we use here? What are the tradeoffs of each? Which fits best with our existing session lifecycle?"

The AI produces a thoughtful analysis. I read it, pick the approach that fits, and *then* give the implementation order with the chosen strategy as a constraint.

This works for the same reason it works with human developers. When you ask a junior dev "how would you approach this?", you accomplish two things: you get their perspective (which is sometimes surprisingly good), and you give them ownership of the solution. With AI, you get the first benefit. The "ownership" part is irrelevant, but the quality of the output is measurably better because the AI has worked through the problem space before generating code.

Questions produce better context. Better context produces better code. This isn't AI magic. It's basic communication.

---

## Spikes: Bounded Exploration

In Scrum, a spike is a timeboxed investigation. You don't know enough to estimate a story, so you spend a fixed amount of time learning. The deliverable is knowledge, not code.

AI spikes work the same way, and they're one of the most underused techniques in AI-assisted development.

When I don't know enough about a library, an API, or an architectural approach, I tell the AI: "This is a spike. Spend no more than 30 minutes exploring the Copilot SDK's session management API. I want to understand: what events are available, what the lifecycle looks like, and whether we can hook into session termination. Produce a summary document, not code."

The deliverable is a research document in the `research/` folder. I read it, ask follow-up questions, and *then* plan the implementation.

You'd be surprised what comes back. AI is excellent at reading documentation and synthesizing findings. It's terrible at knowing what to do with those findings. The spike separates the research from the decision-making, and that separation is the key.

---

## Build a Library for Your AI

Here's a practical problem nobody talks about. AI agents operate in a world that increasingly locks them out.

Websites block AI crawlers. Documentation sites throw CAPTCHAs. API references sit behind authentication. Stack Overflow answers get paywalled. The information your AI needs to do its job is steadily becoming harder for it to access.

I solve this the old-fashioned way: I build a reference library.

I maintain a `research/` folder in my project, added to `.gitignore`, where I drop anything the AI might need. SDK source code it can't reach. Documentation pages saved as Markdown. API response examples. Architecture diagrams exported as text. Relevant Stack Overflow threads, stripped of formatting noise.

Think of it as a reference shelf for your junior developer. You wouldn't expect a new hire to figure everything out from Google alone, especially if half the results are behind a paywall. You'd point them to the team wiki, hand them relevant docs, maybe print out a few key API references. The same courtesy extends to your AI.

This takes five minutes per resource and saves hours of hallucinated API calls and fabricated method signatures.

---

## Plan the Work, Work the Plan

Junior developers love structure. Give a junior dev a vague requirement and they'll wander. Give them a step-by-step plan with clear milestones and they'll execute cleanly. AI behaves the same way.

I plan every significant piece of work before the AI touches code. The plan lives in a file. It has numbered steps, expected outcomes, and explicit dependencies. The last step of every plan is: "Write the completed plan to `planning/completed/` with notes on what changed during execution."

This does three things:

First, it constrains the AI's attention. Instead of trying to solve the whole problem at once (and producing a tangled mess), it solves one step at a time within a defined boundary.

Second, it creates a paper trail. When the AI session crashes -- and it will crash, always at the worst moment -- the plan file tells the next session exactly where we left off.

Third, it forces me to think through the work before generating code. Planning is the part most developers skip, and it's the part that prevents the most rework. This is true with human teams. It's doubly true with AI, which will cheerfully sprint in the wrong direction for hours if you let it.

---

## Timebox Everything

In Scrum, we timebox everything. Sprints, meetings, spikes, research. Not because time pressure improves quality, but because unbounded work is how teams burn cycles on the wrong things.

AI needs the same discipline. Without explicit boundaries, an AI agent will chase a failing approach for twenty iterations, each one more creative and less useful than the last. I've watched Claude try fourteen increasingly baroque workarounds for a problem that required a one-line config change. It never occurred to the model to stop and reconsider the approach.

So I timebox. "Try to resolve this test failure. If you can't fix it in three attempts, stop. Summarize what you tried, what failed, and what you think the root cause is. Then we'll discuss."

This is the "fail fast" principle, applied to AI. Three attempts, not thirty. Report back, don't spiral.

The output from a failed timebox is often more valuable than a successful one. The AI's failure analysis tells me where the real problem is, which is usually somewhere the AI couldn't see because it lacked the architectural context to look there.

---

## The Mini Kanban: Surviving AI Amnesia

AI agents have no persistent memory across sessions. Every conversation starts from zero. This is the single biggest operational challenge in AI-assisted development, and almost nobody addresses it systematically.

My solution is a mini Kanban board in the project structure:

```text
planning/
  backlog/          -- tasks not yet started
  in-progress/      -- the current task (with detailed plan and progress notes)
  completed/        -- finished tasks (with execution notes and outcomes)
  roadmap/          -- future direction and architectural decisions
```

The workflow is simple. Before starting work, the AI reads the in-progress task. The last step of every task is to update the plan file with progress notes. When the task completes, it moves to `completed/`. When a session crashes, the next session reads the in-progress file and picks up where the previous one left off.

This is not revolutionary. It's a Kanban board. Developers have been using them for decades to track work across team members. The only difference is that one of my "team members" gets amnesia every four hours and needs to re-read the board.

The planning folder is also my insurance policy. I've had sessions where the AI made significant progress on a complex refactor, then crashed. Without the plan file, I'd have lost all of that context and started over. With it, the next session resumed in under two minutes.

---

## The Uncomfortable Truth

None of these techniques are new. Requirements gathering, working agreements, spikes, timeboxing, Kanban boards, structured planning -- these are established engineering management practices. Some are decades old. None require AI expertise to understand or apply.

The uncomfortable truth is that AI-assisted development is not a new discipline. It's software engineering management, applied to a different kind of team member. The developers who struggle with AI are, overwhelmingly, the same developers who struggle with team management: unclear requirements, no process, no structure, no review.

The developers who thrive with AI are the ones who already knew how to run a team. They just got a new team member who types faster.

---

## What I Learned

**AI is a team member, not a tool.** Treat it like a developer on your team -- with onboarding, norms, requirements, and code review -- and you'll get team-quality output.

**Structure beats speed.** Ten minutes of planning saves two hours of rework. This was true with human teams. It's true with AI teams.

**The best AI prompt is a good user story.** Context, constraints, acceptance criteria. If it would make a good Jira ticket, it makes a good prompt.

**Process is not overhead.** The developers who skip planning, skip norms, and skip review are the same ones who complain that AI produces garbage. The AI isn't the problem. The process is.

**Scrum works because humans need structure.** AI needs it more.

---

*Steven Molen, Sr. Enterprise Architect*
*GIST written with Claude Opus 4.6 -- because thirty years of managing developers turns out to be the best training for managing AI, and I'd rather spend my time building than writing about building.*

*This is part of a series on building VS Code extensions with AI. See also:*
- *[THE-AI-JOURNEY.md](THE-AI-JOURNEY.md) -- How AI is both a 10x multiplier and a 10x liability*
- *[VSCODE-EXTENSIONS-ARE-CLIENT-SERVER.md](VSCODE-EXTENSIONS-ARE-CLIENT-SERVER.md) -- The mental model nobody gives you*
- *[MARKDOWN-IS-THE-LANGUAGE-OF-AI.md](MARKDOWN-IS-THE-LANGUAGE-OF-AI.md) -- On the millions being left on the table*

---
