/**
 * Maps `SDKSessionManager`'s emitters onto ACP `session/update` notifications
 * (IN-3 scope item 3).
 *
 * Pure functions on purpose. The protocol plumbing lives in `CopilotAcpAgent`; this
 * file only decides *shape*, which makes every variant testable without a CLI, a
 * manager or a connection.
 *
 * ## The sub-agent decision
 *
 * Our sub-agent dock deliberately keeps sub-agent traffic **out of the main
 * transcript** — that separation is a product differentiator, not an accident. A
 * generic ACP host has no dock and renders whatever `session/update` it receives.
 *
 * Rather than choosing one reader over the other, sub-agent content is sent as an
 * **ordinary update** — so a generic host shows it inline and loses nothing — and
 * **tagged in the envelope's `_meta`**, so our own client can route it to the dock
 * instead of the transcript.
 *
 * ACP makes that safe: `_meta` is "reserved … to attach additional metadata", and
 * implementations "MUST NOT make assumptions about values at these keys". So the
 * transcript reads correctly wherever `_meta` is ignored, which is the ticket's
 * stated requirement.
 *
 * Note `_meta` belongs on the **SessionNotification envelope**, not on the update
 * variant — the variants have no `_meta` in the schema.
 */

/**
 * Namespace for our `_meta` keys.
 *
 * `_meta` is a shared extension point: any agent may write to it. A bare `agentId`
 * would collide with anyone else who had the same idea, and ACP explicitly tells
 * implementations not to assume anything about keys they did not write.
 */
const META_NS = 'copilotCliChat';
const META_AGENT_ID = `${META_NS}.agentId`;
const META_KIND = `${META_NS}.subagentEvent`;
const META_ERROR = `${META_NS}.error`;

/** A `session/update` notification, ready to hand to `client.notify`. */
export interface SessionUpdateNotification {
    sessionId: string;
    update: Record<string, unknown>;
    _meta?: Record<string, unknown>;
}

/** Our tool status vocabulary → ACP's `ToolCallStatus` enum. */
const TOOL_STATUS: Record<string, 'pending' | 'in_progress' | 'completed' | 'failed'> = {
    pending: 'pending',
    running: 'in_progress',
    complete: 'completed',
    failed: 'failed'
};

function textChunk(sessionId: string, variant: string, text: string, meta?: Record<string, unknown>): SessionUpdateNotification {
    const n: SessionUpdateNotification = {
        sessionId,
        update: { sessionUpdate: variant, content: { type: 'text', text } }
    };
    if (meta) {
        n._meta = meta;
    }
    return n;
}

// ── Main transcript ────────────────────────────────────────────
// Deliberately untagged. Tagging these would send ordinary assistant output to the
// dock and empty the transcript.

export function messageDeltaUpdate(sessionId: string, e: { messageId: string; deltaContent: string }): SessionUpdateNotification {
    return textChunk(sessionId, 'agent_message_chunk', e.deltaContent);
}

/** ACP has a distinct variant for thinking; folding it into message text misrepresents it. */
export function reasoningDeltaUpdate(sessionId: string, e: { reasoningId: string; deltaContent: string }): SessionUpdateNotification {
    return textChunk(sessionId, 'agent_thought_chunk', e.deltaContent);
}

// ── Tools ──────────────────────────────────────────────────────

interface ToolState {
    toolCallId: string;
    toolName: string;
    status: string;
    arguments?: unknown;
    result?: string;
    error?: { message: string; code?: string };
}

function toolFields(t: ToolState): Record<string, unknown> {
    return {
        toolCallId: t.toolCallId,
        // `title` is required by the schema and is what a host renders. The tool
        // name is the most honest thing we have; inventing prose would be worse.
        title: t.toolName,
        name: t.toolName,
        // Unknown statuses fall back to `pending` rather than passing ours through:
        // a value outside the enum is something a strict client may reject.
        status: TOOL_STATUS[t.status] ?? 'pending',
        ...(t.arguments === undefined ? {} : { rawInput: t.arguments }),
        ...(t.result === undefined ? {} : { rawOutput: { output: t.result } })
    };
}

export function toolStartUpdate(sessionId: string, t: ToolState): SessionUpdateNotification {
    return { sessionId, update: { sessionUpdate: 'tool_call', ...toolFields(t) } };
}

/** A later state of the SAME call — `tool_call_update`, not a second `tool_call`. */
export function toolUpdateUpdate(sessionId: string, t: ToolState): SessionUpdateNotification {
    return { sessionId, update: { sessionUpdate: 'tool_call_update', ...toolFields(t) } };
}

// ── Sub-agent traffic: ordinary updates, tagged in _meta ───────

function subagentMeta(agentId: string, kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
    return { [META_AGENT_ID]: agentId, [META_KIND]: kind, ...(extra ?? {}) };
}

/**
 * Sub-agent output. An ordinary chunk so a generic host renders it, tagged so our
 * dock can lift it out of the transcript.
 */
export function subagentMessageUpdate(
    sessionId: string,
    e: { agentId: string; content?: string; reasoningText?: string }
): SessionUpdateNotification {
    const isThought = !e.content && !!e.reasoningText;
    return textChunk(
        sessionId,
        isThought ? 'agent_thought_chunk' : 'agent_message_chunk',
        e.content ?? e.reasoningText ?? '',
        subagentMeta(e.agentId, isThought ? 'reasoning' : 'message')
    );
}

/** Lifecycle, so the dock knows when to open a card. */
export function subagentStartUpdate(
    sessionId: string,
    e: { agentId: string; agentName?: string; agentDisplayName?: string; agentDescription?: string }
): SessionUpdateNotification {
    const label = e.agentDisplayName ?? e.agentName ?? 'sub-agent';
    return textChunk(sessionId, 'agent_message_chunk', `Started ${label}.`,
        subagentMeta(e.agentId, 'start', {
            [`${META_NS}.agentName`]: e.agentName,
            [`${META_NS}.agentDisplayName`]: e.agentDisplayName
        }));
}

/** …and when to close it. */
export function subagentCompleteUpdate(
    sessionId: string,
    e: { agentId: string; status: 'complete' | 'failed'; agentDisplayName?: string; error?: string }
): SessionUpdateNotification {
    const label = e.agentDisplayName ?? 'sub-agent';
    const text = e.status === 'failed'
        ? `${label} failed${e.error ? `: ${e.error}` : '.'}`
        : `${label} finished.`;
    return textChunk(sessionId, 'agent_message_chunk', text,
        subagentMeta(e.agentId, 'complete', { [`${META_NS}.status`]: e.status }));
}

// ── Usage and errors ───────────────────────────────────────────

/**
 * Context accounting.
 *
 * ACP requires both numbers, so the caller decides whether it has them; this only
 * shapes what it was given. See `SdkSessionBackend` for why a percentage alone is
 * not enough to construct either.
 */
export function usageUpdate(
    sessionId: string,
    e: { used: number; size: number }
): SessionUpdateNotification {
    return { sessionId, update: { sessionUpdate: 'usage_update', used: e.used, size: e.size } };
}

/**
 * A session error.
 *
 * ACP has **no error variant** — every `session/update` case was checked, and
 * `session_info_update` carries a title and a timestamp. So an error either rides the
 * transcript or does not reach the host at all, and silence is the worse of the two.
 *
 * Tagged rather than disguised as model output, exactly as sub-agent traffic is: a
 * generic host renders it inline and loses nothing, and a client that knows the tag
 * can draw it as an error instead. Namespaced for the same reason — `_meta` is a
 * shared extension point and ACP tells implementations not to assume anything about
 * keys they did not write.
 */
export function errorUpdate(sessionId: string, e: { message: string }): SessionUpdateNotification {
    return textChunk(sessionId, 'agent_message_chunk', e.message, { [META_ERROR]: true });
}

// ── Diffs ──────────────────────────────────────────────────────

/** A file edit, with both sides already read. */
export interface DiffEvent {
    toolCallId: string;
    path: string;
    /** `null` for a file that did not exist before — ACP's documented "None for new files". */
    oldText: string | null;
    newText: string;
}

/**
 * A file edit as ACP diff content.
 *
 * An *update*, not a new `tool_call`: the edit already announced itself when the tool
 * started, and a second `tool_call` carrying the same id would either duplicate the
 * entry in a host's list or overwrite what it has already drawn. `tool_call_update`
 * is the protocol's own answer to "more is now known about this call".
 */
export function diffUpdate(sessionId: string, e: DiffEvent): SessionUpdateNotification {
    return {
        sessionId,
        update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: e.toolCallId,
            content: [{
                type: 'diff',
                path: e.path,
                oldText: e.oldText,
                newText: e.newText
            }]
        }
    };
}

// ── Replay ─────────────────────────────────────────────────────

/** One stored turn, as `session/load` replays it. */
export interface ReplayTurn {
    role: 'user' | 'assistant';
    content: string;
}

/**
 * A stored turn, attributed to whoever said it.
 *
 * ACP has a distinct `user_message_chunk` variant, and using it is not cosmetic:
 * replaying a user's own words as `agent_message_chunk` would render a transcript in
 * which the assistant appears to be talking to itself.
 */
export function replayTurnUpdate(sessionId: string, turn: ReplayTurn): SessionUpdateNotification {
    return textChunk(
        sessionId,
        turn.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
        turn.content
    );
}

// ── Plan ───────────────────────────────────────────────────────

/** ACP's closed status set. The CLI's column is free text and has to be funnelled into it. */
type AcpPlanStatus = 'pending' | 'in_progress' | 'completed';

/**
 * One row of the CLI's todo table → one ACP plan entry.
 *
 * `pending` is the safe unknown: it says "not finished", which is true of anything we
 * cannot classify. Guessing `completed` would tick a box nobody ticked.
 */
function planStatus(raw: string | undefined): AcpPlanStatus {
    // A SQL column has no schema to enforce one spelling, so normalise before
    // comparing rather than listing every casing and separator we have seen.
    const normalised = (raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (normalised === 'completed' || normalised === 'complete' || normalised === 'done') {
        return 'completed';
    }
    if (normalised === 'in_progress' || normalised === 'inprogress' || normalised === 'active'
        || normalised === 'running' || normalised === 'started') {
        return 'in_progress';
    }
    return 'pending';
}

/**
 * ACP requires a priority; the CLI's todo table has no such column.
 *
 * The same value for every entry, deliberately. Deriving a spread — from wording, from
 * position — would make the plan look ranked by something the source never expressed,
 * and a reader would believe it.
 */
const UNRANKED_PRIORITY = 'medium';

/** Plan-mode progress. ACP models a plan as entries a host can render as a checklist. */
export function planUpdate(
    sessionId: string,
    e: {
        todos: Array<{ id?: string; title?: string; description?: string; status?: string }>;
        dependencies?: Array<{ todoId: string; dependsOn: string }>;
    }
): SessionUpdateNotification {
    const dependencies = e.dependencies ?? [];

    const entries = e.todos.map(todo => {
        const entry: Record<string, unknown> = {
            // A blank row still renders. Dropping it would silently shorten the plan,
            // which reads as progress that did not happen.
            content: todo.title || todo.description || '(untitled step)',
            status: planStatus(todo.status),
            priority: UNRANKED_PRIORITY
        };

        // ACP has no field for ordering between entries, and the fetch is literally
        // `readSqlTodosWithDependencies` — asking for the edges and then discarding
        // them would throw away the only record of which step waits on which.
        const dependsOn = dependencies.filter(d => d.todoId === todo.id).map(d => d.dependsOn);
        if (dependsOn.length) {
            entry._meta = { [`${META_NS}.dependsOn`]: dependsOn };
        }
        return entry;
    });

    return { sessionId, update: { sessionUpdate: 'plan', entries } };
}
