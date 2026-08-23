# Backlog: Todo/Progress Panel from the Session SQL Database

**Previously abandoned; the blocking objection is gone.** This was considered and dropped because the
CLI's todo state was heavy preview with no public interface — surfacing it would have meant reading
the session sqlite file directly and reverse-engineering its schema. **That is no longer true.** The
SDK now exposes a typed RPC, a change event, and documented usage.

Re-checked 2026-08-16 against SDK 1.0.5 as installed (not just the `research/` checkout).

## What exists now

**Read:**

- `session.plan.readSqlTodosWithDependencies()` → `{ rows: PlanSqlTodosRow[], dependencies: PlanSqlTodoDependency[] }`
  — the SDK describes this verbatim as *"for structured progress UI"*.
- `session.plan.readSqlTodos()` → rows only.

**Change signal:** `session.todos_changed` (`TodosChangedEvent`). Signal-only, no payload. Its own doc
prescribes the pattern:

> No payload — clients should call `session.plan.readSqlTodosWithDependencies()` to fetch the current
> state. Events arrive in order; clients can debounce on arrival if needed.

and

> Clients should call this on session start and after every `session.todos_changed` event to refresh
> structured-UI rendering.

**Row shape:** `id`, `title`, `description`, `status` — all optional, plus dependency edges between
todo ids. `todo_deps` makes this a **dependency graph**, not a flat list.

## Where the data comes from

The CLI's built-in `sql` tool. Measured across `tests/logs/server/*.log`, it is the CLI's task-list
mechanism, backed by `node:sqlite` (which is why the extension requires Node 24). Real calls look like:

```sql
INSERT INTO todos (id, title, description, status) VALUES ('impl-planning-config', …, 'pending');
UPDATE todos SET status = 'in_progress' WHERE id = 'test-planning-config';
```

Worth recording to prevent re-confusion: `sql` is **not** the sub-agent tool. Three distinct built-ins
that are easy to conflate — `sql` (todo list, 24 calls observed), `task` (spawns sub-agents:
`{name, agent_type, mode, prompt}`, 9 calls), `read_agent` (collects a background agent's result:
`{agent_id, wait}`, 15 calls). None are MCP; none are namespaced.

There is also an older `update_todo` tool taking a markdown blob of `- [ ]` items, last seen
2026-02-11 and superseded by `sql` from 2026-03-08. Do not build against it.

## Why it is worth doing

The CLI maintains a queryable task DAG for every session and the extension renders none of it. Claude
Code surfaces its todo list; we show nothing, so the user has no view of what the agent thinks it is
doing or how far along it is.

This fits the "thoughtful" principle squarely — group by usefulness, show decision-relevant data. A
dependency graph is genuinely more informative than a checklist: it can show what is blocked and why,
not just what is pending. That is a differentiator, not a me-too feature.

Unusually for a feature idea, **the data already exists and is already queryable** — this is
presentation work, not plumbing.

## Risk: still `@experimental`

All four type definitions (`PlanReadSqlTodosResult`, `PlanSqlTodosRow`,
`PlanReadSqlTodosWithDependenciesResult`, `PlanSqlTodoDependency`) carry `@experimental` — the same
status `sessions.fork` had when v3.12.0 shipped on it.

Two reasons that is tolerable here:

1. **The API degrades itself.** *"Returns empty arrays when the database, tables, or columns aren't
   available"*; *"all fields are optional because the SQL schema is best-effort."* An empty result is
   indistinguishable from "no todos", which for a panel is the correct failure mode — render nothing.
   No capability gate, no version constant. (Same conclusion the v3.14.0 fork plan reached: prefer a
   self-degrading call over a gating signal.)
2. **Precedent exists.** v3.12.0 shipped on an `@experimental` RPC with a runtime probe and fallback.
   This needs less machinery than that did.

## Proposed Solution

Spike first, per CLAUDE.md's SDK-first rule — `planning/spikes/session-todos/`: confirm our bundled
CLI 1.0.68 answers the RPC, that `session.todos_changed` actually fires, and capture a real
`{rows, dependencies}` payload to design against.

Then: forward the event through `SDKSessionManager` → `ChatViewProvider` → RPC → a webview panel.
Rendering should show blocked-vs-ready state from the dependency edges rather than a flat checklist —
otherwise there is no reason to prefer this over the markdown the agent already prints.

## Notes for whoever picks this up

- `TodosChangedEvent` is `ephemeral: true` — **not persisted to `events.jsonl`.** Todo state cannot be
  reconstructed from session history; the RPC is the only source. Call it on session start.
- That fits v3.13.0's tab-restore contract cleanly: "call on session start" is already what Task 6
  specifies for restoring a surface, so a todo panel restores by the same rule.
- `TodosChangedEvent` carries `agentId`, so sub-agent todos are distinguishable from the main agent's
  — relevant if this should feed the sub-agent dock rather than the main panel.
- Adding a webview component means updating `esbuild.js` (dist dir const + `mkdirSync` + per-file
  `copyFileSync`) or the sidebar silently renders blank.
