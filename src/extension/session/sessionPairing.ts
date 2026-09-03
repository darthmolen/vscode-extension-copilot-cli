/**
 * Which sessions are halves of the same conversation.
 *
 * Plan mode starts a second CLI session, and the only thing connecting it to the
 * conversation it belongs to is that its id ends in `-plan`. Measured, that is
 * **38% of this workspace's dropdown** and **22% of the whole store** — half a
 * conversation, listed as a whole one.
 *
 * **The convention had two readers, and how the second one happened is the whole
 * argument for this file.** It was `sdkSessionManager.ts` alone until Lane A
 * shipped `session/list` over ACP and filtered plan halves with the same
 * `id.endsWith('-plan')` string match — *without knowing the convention existed*.
 * Their unit fixtures held no plan sessions, so the suite was green; a live run
 * listing 909 sessions is what showed it. That is exactly the failure mode a
 * convention has and a contract does not: invisible until it bites, and the second
 * reader learns it by accident.
 *
 * So this is the one place that knows what `-plan` means, and the count goes back
 * to one. The payoff Lane A named: *the cost of ever adopting the CLI's native
 * plan mode is however many places currently know.*
 *
 * **Batch is the only entry point.** `session/list` walks 909 entries and would
 * call a per-id function for every one; a per-id API that is only ever called in a
 * loop is the shape that grows a cache later, and the cache is where the staleness
 * bugs live. The SDK made the same choice with `sessions.checkInUse`, which takes
 * a set of ids and returns the subset in use.
 *
 * **There is no `planIdsFor`.** Records point child→parent, so the reverse
 * direction is a scan of every session — and nothing needs it. The dropdown groups
 * by bucketing on `workIdFor` in this same pass, and `↳ Plan: <parent name>` needs
 * parent→label, not parent→children. Shipping a full scan behind a plural-sounding
 * name is how it would have become a hot path by accident.
 *
 * Free of `vscode` on purpose, and this one has a second named consumer with no
 * choice about it: Lane A's ACP agent is a separate process with no extension host
 * — the same constraint that forced `HostBridge`.
 */

import * as fs from 'fs';
import * as path from 'path';

export type SessionRole = 'work' | 'plan';

/** The `-plan` convention, in the one place still allowed to know it. */
const PLAN_SUFFIX = '-plan';

/** What `session-pairing.json` holds. Untrusted input — it is a file on disk. */
interface PairingRecord {
    workSessionId?: unknown;
}

export interface PairingIndex {
    /**
     * Whether this session is a conversation or the plan half of one.
     *
     * Lane A's `session/list` needs only this.
     */
    roleOf(sessionId: string): SessionRole;
    /**
     * The group this session belongs to — itself, if it is a work session.
     *
     * Answers *"which group does this belong to"*, so an orphaned plan half whose
     * parent is not in the resolved set returns **itself**: bucketing under an id
     * nobody has would make it unreachable in the dropdown. `roleOf` stays
     * truthful about it either way.
     */
    workIdFor(sessionId: string): string;
}

/** What startup needs to know about the one session it is about to resume. */
export interface StartupPairing {
    role: SessionRole;
    /** The work half's id — the session itself, when it is already the work half. */
    workId: string;
}

/**
 * Resolve the single session startup is about to bring back.
 *
 * **Why this is not the per-id API the batch rule forbids.** That rule is about a
 * function *only ever called in a loop* — `session/list` walking 909 entries. This
 * is called once, for one id, on the resume path. The alternative is stripping
 * `-plan` at the call site in `sdkSessionManager`, which is exactly the fourth raw
 * reader of the convention this module exists to prevent; the third is the one it
 * replaces.
 *
 * **It differs from `workIdFor` on purpose.** That answers *"which group does this
 * belong to"* for the dropdown, so an orphan collapses to itself rather than
 * bucketing under an id nobody has. Startup is not bucketing: it needs the parent
 * id even when that parent has no directory, because the work session may be one
 * it has yet to mint. A plan half therefore always reports its parent here.
 */
export function resolveStartupPairing(sessionStateDir: string, sessionId: string): StartupPairing {
    const recorded = readRecordedParent(sessionStateDir, sessionId);
    if (recorded !== undefined) {
        // A record naming itself means "this is a work session", which is how a
        // work session the user happened to name `...-plan` corrects the guess.
        return recorded === sessionId
            ? { role: 'work', workId: sessionId }
            : { role: 'plan', workId: recorded };
    }

    if (sessionId.endsWith(PLAN_SUFFIX) && sessionId.length > PLAN_SUFFIX.length) {
        return { role: 'plan', workId: sessionId.slice(0, -PLAN_SUFFIX.length) };
    }

    return { role: 'work', workId: sessionId };
}

/**
 * Resolve a whole set of session ids in one directory pass.
 *
 * The record wins where there is one; the `<id>-plan` suffix is a **read-only
 * fallback that rides indefinitely**. Not a stopgap: the CLI's `sessions.*` surface
 * has no mutate path — no update, no patch, no setDetached, and `enrichMetadata`
 * only backfills summary and context on read — so the ~197 plan halves that already
 * exist can never be flagged, and the fallback is the only thing that will ever
 * answer for them. A reconciliation resolver, tested in code, rather than two
 * writers kept in step by memory.
 */
export function resolvePairings(sessionStateDir: string, ids: string[]): PairingIndex {
    /** child → the parent it claims, before we know whether that parent exists. */
    const claimedParent = new Map<string, string>();
    const known = new Set(ids);

    for (const id of ids) {
        const recorded = readRecordedParent(sessionStateDir, id);
        if (recorded !== undefined) {
            // A record naming itself means "this is a work session", which is how a
            // work session the user happened to name `...-plan` corrects the guess.
            if (recorded !== id) {
                claimedParent.set(id, recorded);
            }
            continue;
        }
        if (id.endsWith(PLAN_SUFFIX) && id.length > PLAN_SUFFIX.length) {
            claimedParent.set(id, id.slice(0, -PLAN_SUFFIX.length));
        }
    }

    return {
        roleOf: (sessionId) => claimedParent.has(sessionId) ? 'plan' : 'work',
        workIdFor: (sessionId) => {
            const parent = claimedParent.get(sessionId);
            return parent !== undefined && known.has(parent) ? parent : sessionId;
        }
    };
}

/**
 * The parent this session's record names, or `undefined` if it has no usable one.
 *
 * Never throws. A missing directory, an unreadable file and malformed JSON all mean
 * the same thing to the caller — fall back to the suffix — and distinguishing them
 * would only give the dropdown a way to fail.
 */
function readRecordedParent(sessionStateDir: string, sessionId: string): string | undefined {
    try {
        const recordPath = path.join(sessionStateDir, sessionId, 'session-pairing.json');
        if (!fs.existsSync(recordPath)) {
            return undefined;
        }
        const record = JSON.parse(fs.readFileSync(recordPath, 'utf-8')) as PairingRecord;
        const workSessionId = record?.workSessionId;
        return typeof workSessionId === 'string' && workSessionId.length > 0
            ? workSessionId
            : undefined;
    } catch {
        return undefined;
    }
}
