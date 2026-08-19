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

// ── Plan ───────────────────────────────────────────────────────

/** Plan-mode progress. ACP models a plan as entries a host can render as a checklist. */
export function planUpdate(
    sessionId: string,
    e: { entries: Array<{ content: string; status: string; priority: string }> }
): SessionUpdateNotification {
    return { sessionId, update: { sessionUpdate: 'plan', entries: e.entries } };
}
