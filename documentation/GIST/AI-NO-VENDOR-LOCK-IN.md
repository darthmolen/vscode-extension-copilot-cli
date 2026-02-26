# Why I Don't Lock In, and Neither Should You

*On running out of tokens mid-session, switching AI tools without missing a beat, and what the industry accidentally got right.*

---

## The Moment

We ran out of Copilot tokens mid-feature. No warning, no graceful degradation, just done. Quota hit. Come back tomorrow.

I opened Claude Code, pointed it at the same repo, and typed the next prompt. The skills loaded. The instruction files were already there. The workflow didn't change. I kept building.

No migration. No context dump. No "let me explain the project to you." Just a different engine, same road, same destination.

That shouldn't be remarkable. But in an industry racing to lock you into ecosystems, it felt like a small act of rebellion.

---

## The Setup

Some context, because the meta layers here are worth appreciating.

I build a VS Code extension that wraps GitHub Copilot CLI. It gives Copilot a proper chat interface -- the kind of focused, opinionated experience that the official tooling doesn't provide. 230 users and growing.

The extension is built with AI. Specifically, it's built with *both* AIs. Copilot CLI builds its own home most days. When tokens run dry or when I need a different perspective, Claude Code picks up the work. Same codebase, same skills, same TDD workflow, same architectural discipline.

An extension wrapping one AI, built by two AIs, dogfooding itself along the way. I'm not going to pretend that isn't a little absurd. But it works, and the reason it works is worth examining.

---

## Why It Actually Works

The short answer: [Agent Skills](https://agentskills.io).

The longer answer starts with a file format. Agent Skills is an open standard -- originally developed by Anthropic, now community-maintained -- that defines how to package capabilities for AI coding agents. The format is a SKILL.md file: markdown with YAML frontmatter. That's it. A text file with a header and instructions.

```yaml
---
name: test-driven-development
description: Use when implementing any feature or bugfix, before writing code
---

# Test-Driven Development

Write the test first. Watch it fail. Implement the minimum...
```

Thirty-plus tools have adopted this format. Claude Code, GitHub Copilot, Cursor, Windsurf, Gemini CLI, OpenAI Codex, Roo Code, Junie, and a growing list of others. The same SKILL.md file works in all of them.

My `.claude/skills/` directory contains skills like `using-superpowers`, `test-driven-development`, and `systematic-debugging`. When I'm working in Claude Code, those skills load and shape how the agent approaches every task. When I switch to Copilot CLI, those same files load and do the same thing. The prompts that invoke them -- "use the TDD skill," "follow the debugging workflow" -- work identically in both tools.

The skills don't care which model is reading them. They're just instructions, written in the one language every LLM speaks fluently.

---

## The Part That Isn't Standardized

Now here's where I have to be honest, because the process isn't all roses.

The SKILL.md *format* is portable. The *discovery* is not.

Each tool looks for skills in its own directories:

| Tool | Where it looks |
|------|---------------|
| Claude Code | `.claude/skills/` |
| Github Copilot CLI (v2) | `.github/skills/`, `.claude/skills/`, `.agents/skills/` |
| Cursor | `.cursor/skills/` |
| Windsurf | `.windsurf/skills/` |

Notice something? GitHub Copilot CLI (v2) is the most permissive. When they adopted the Agent Skills spec in December 2025, they added `.claude/skills/` as a scan path alongside their own `.github/skills/`. That's why my workflow works -- Copilot reads Claude's skill directory by design.

Claude Code does not return the favor. It reads `.claude/skills/` and nothing else. If I had skills in `.github/skills/`, Claude wouldn't find them.

So the portability has a direction: Claude skills flow to Copilot, not the reverse. It's both a spec limitation and a market reality. The market leader sets conventions, and everyone else either adopts them or gets left behind. GitHub, to their credit, chose to adopt rather than compete on directory names.

---

## The Wider Gap

Skills are the bright spot. Everything else is still the wild west.

**Instruction files** serve the same purpose across tools but have different names: `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursorrules`. They all tell the agent "here's how this project works, follow these rules." The content is interchangeable; the filenames are not.

**Hooks, commands, and plugins** are completely fragmented. Claude Code has hooks and MCP server configs in `.claude/settings.json`. Copilot has its own extension model. Cursor has custom commands. None of these are portable. Moving a hook from one tool to another means rewriting it.

**MCP servers** are closer to portable -- the protocol itself is standardized -- but the configuration for *where* and *how* to run them differs per tool.

The pattern is consistent: the content layer is converging on open standards (markdown, JSON-RPC, SKILL.md). The configuration layer is still vendor-specific. If you're going to invest in portability, invest in the content. Write your skills, your instructions, your architectural decisions as markdown. That's the part that travels.

There is one distinct consistency in this paradigm, You are already using AI to write your code, why not use it to bridge the configuration gap? Have it write the integration layer (duplicating work to all your known locations and formats).

---

## Markdown All the Way Down

I've written about this before ([MARKDOWN-IS-THE-LANGUAGE-OF-AI.md](MARKDOWN-IS-THE-LANGUAGE-OF-AI.md)), but it keeps proving true. The reason skills are portable is that they're markdown files with YAML frontmatter -- which is itself a markdown convention. The interchange format for AI capabilities turned out to be the simplest possible thing: a text file.

No proprietary schema. No binary format. No vendor SDK required to read it. Just a file that any text editor can open and any LLM can parse.

Instruction files? Markdown. Skill definitions? Markdown with frontmatter. Planning documents? Markdown. Architecture decisions? Markdown. The entire knowledge layer of AI-assisted development is plain text, version-controlled, diffable, and portable.

That wasn't a grand design decision. It happened because markdown is what LLMs were trained on, what developers already use, and what requires zero tooling to produce. The path of least resistance turned out to be the path of maximum portability.

Sometimes the industry gets something right by accident.

*Steven Molen, Sr. Enterprise Architect*
*GIST co-authored with Claude Opus 4.6 -- after Copilot ran out of tokens, naturally.*

*This is part of a series on building VS Code extensions with AI. See also:*

- *[THE-AI-JOURNEY.md](THE-AI-JOURNEY.md) -- How AI is both a 10x multiplier and a 10x liability*
- *[AI-DEVELOPMENT-IS-SCRUM-WITH-SMALLER-ENGINEERS.md](AI-DEVELOPMENT-IS-SCRUM-WITH-SMALLER-ENGINEERS.md) -- On managing non-deterministic junior developers*
- *[MARKDOWN-IS-THE-LANGUAGE-OF-AI.md](MARKDOWN-IS-THE-LANGUAGE-OF-AI.md) -- On the millions being left on the table*
- *[VSCODE-EXTENSIONS-ARE-CLIENT-SERVER.md](VSCODE-EXTENSIONS-ARE-CLIENT-SERVER.md) -- The mental model nobody gives you*

*Agent Skills specification: [agentskills.io](https://agentskills.io)*

---
