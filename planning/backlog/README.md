# Backlog

This directory contains ideas and features for **future consideration** - not actively being worked on.

## Purpose

- Capture feature ideas without cluttering active work
- Collect enhancement proposals
- Document "nice to have" improvements
- Prevent ideas from being forgotten

## Usage

- Add new ideas as markdown files here
- Keep descriptions brief - detailed planning happens when work begins
- Include rough scope and value proposition
- When ready to implement, move to `../planning/` and flesh out details

## Lifecycle

```
backlog/                   ← You are here (ideas)
  ↓ Work begins
../planning/               ← Move here and create full plan
  ↓ Implementation complete
../completed/              ← Final resting place
```

## Document Format

Simple format for backlog items:

```markdown
# Feature Name

## Problem/Opportunity
Brief description of what this would solve or enable.

## Proposed Solution
High-level idea (1-2 paragraphs).

## Value
Why this matters - user benefit or technical improvement.

## Rough Scope
- Major component 1
- Major component 2

## Dependencies
What needs to exist first (if any).
```

Keep it lightweight - detailed planning happens when promoted to `../planning/`.
