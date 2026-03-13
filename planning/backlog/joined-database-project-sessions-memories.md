# Joined Database: Project Session Memories

## The Idea

Every agent session produces a per-session SQLite database. Todos, dependencies, status updates, timestamps — all structured, all consistent across sessions. What if we aggregated them?

A `session_store` — a unified read-only database that federates all per-session DBs — would give the agent a queryable memory layer across the entire project history.

## What You Could Query

```sql
-- What files did I touch last week?
SELECT DISTINCT file_path FROM edits WHERE session_date > date('now', '-7 days');

-- Which bugs came back after being marked done?
SELECT title, COUNT(*) as recurrences
FROM todos
WHERE title LIKE '%fix%' AND status = 'in_progress'
GROUP BY title HAVING recurrences > 1;

-- What open questions did I leave unresolved?
SELECT session_id, description FROM todos
WHERE status = 'blocked' ORDER BY created_at DESC;

-- Which tasks took the most sessions to close?
SELECT title, COUNT(DISTINCT session_id) as sessions_to_close
FROM todos WHERE status = 'done'
GROUP BY title ORDER BY sessions_to_close DESC;
```

## Why It's Interesting

- **Zero overhead**: The per-session DBs already exist. This is just federation.
- **Consistent schema**: `todos`, `todo_deps` are the same shape every session.
- **Cross-session pattern recognition**: Recurring bugs, unresolved questions, files that always need touching together.
- **Agent memory without RAG**: Structured SQL beats fuzzy vector search for "what did I do?" queries.
- **Audit trail**: Full history of what was planned, what changed, what got blocked and why.

## Implementation Sketch

Two approaches:

**Option A — ETL (periodic batch)**
After each session, append session data to a central `~/.copilot/session-store.db`. Simple, no runtime overhead. Query with any SQLite client.

**Option B — SQLite ATTACH (live federation)**
```sql
ATTACH DATABASE '~/.copilot/sessions/abc123.db' AS s1;
ATTACH DATABASE '~/.copilot/sessions/def456.db' AS s2;
SELECT 'abc123' as session, * FROM s1.todos
UNION ALL
SELECT 'def456' as session, * FROM s2.todos;
```
SQLite supports up to 125 ATTACHed databases. Scripted federation across all session files is trivial.

**Option C — session_store as a first-class tool**
The `sql` tool already has a `session_store` parameter (`database: "session_store"`) described as a "global read-only database containing cross-session history, files, refs, and FTS5 search." The plumbing may already exist — it just needs populating.

## Notes

- The value compounds over time. One session's todos are trivia. A year of sessions is institutional memory.
- FTS5 (full-text search) on todo titles + descriptions makes it a lightweight semantic search layer without embeddings.
- This pairs naturally with the ACE-FCA workflow: at the start of a session, query the store for related prior work before writing a plan.

## Status

Raw idea. No implementation started. Worth revisiting once the Fleet Command feature is shipped.
