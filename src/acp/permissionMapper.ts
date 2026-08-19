/**
 * Maps Copilot permission requests onto ACP `session/request_permission`, and the
 * host's answer back onto a Copilot decision (IN-3 scope item 4).
 *
 * Pure functions on purpose, exactly like `sessionUpdateMapper.ts`: the protocol
 * plumbing lives in `CopilotAcpAgent`, the translation lives here, and every one of
 * the ten Copilot variants is testable without a CLI, a manager or a connection.
 *
 * ## Two decisions this file encodes
 *
 * **The title states what is being authorised, not why.** ACP renders `title` as the
 * headline of a security prompt. Copilot supplies an `intention` — model-authored
 * prose in which the model explains itself — and that is the least trustworthy field
 * in the request. Putting it in the position of authority would let a prompt read
 * "Tidy up harmlessly" over a `rm -rf`. The command, the file or the URL goes in the
 * title; `intention` still reaches the host verbatim inside `rawInput`.
 *
 * **We offer only what we can honour.** `reject_always` is never offered, because the
 * Copilot `PermissionDecision` union has no session-scoped reject — a host would
 * render a button whose promise we could not keep. For the same reason `allow_always`
 * is withheld wherever no session-scoped approval shape exists (`hook`), wherever the
 * CLI says it cannot be offered (`canOfferSessionApproval`), and for a URL we cannot
 * derive a domain from.
 */

/** ACP's `ToolKind` union, restricted to the members we actually emit. */
export type AcpToolKind = 'read' | 'edit' | 'execute' | 'fetch' | 'other';

/** ACP `PermissionOption`. */
export interface AcpPermissionOption {
    optionId: string;
    name: string;
    kind: 'allow_once' | 'allow_always' | 'reject_once';
}

/** ACP `RequestPermissionRequest`, ready to hand to `client.request`. */
export interface AcpPermissionRequest {
    sessionId: string;
    toolCall: {
        toolCallId: string;
        kind: AcpToolKind;
        title: string;
        rawInput: unknown;
        locations?: { path: string }[];
    };
    options: AcpPermissionOption[];
}

/** ACP `RequestPermissionOutcome`, as it arrives inside the response. */
export type AcpPermissionOutcome =
    | { outcome: 'cancelled' }
    | { outcome: 'selected'; optionId: string };

/**
 * A Copilot permission request. Structural rather than imported: the generated SDK
 * types live behind an ESM-only package, and this file is required from CommonJS
 * tests that must not load the SDK.
 */
export interface CopilotPermissionRequest {
    kind: string;
    toolCallId?: string;
    [field: string]: unknown;
}

/** A Copilot `PermissionRequestResult`, as `onPermissionRequest` must return it. */
export interface CopilotPermissionDecision {
    kind: string;
    [field: string]: unknown;
}

/**
 * Option ids are fixed strings rather than generated ones because the reverse
 * mapping has to recognise them without carrying state between the two directions.
 */
export const PERMISSION_OPTION_IDS = {
    allowOnce: 'copilot-allow-once',
    allowAlways: 'copilot-allow-session',
    rejectOnce: 'copilot-reject-once'
} as const;

const OPTION_ALLOW_ONCE: AcpPermissionOption = {
    optionId: PERMISSION_OPTION_IDS.allowOnce,
    name: 'Allow once',
    kind: 'allow_once'
};

const OPTION_ALLOW_ALWAYS: AcpPermissionOption = {
    optionId: PERMISSION_OPTION_IDS.allowAlways,
    // The scope has to be legible from the label alone, or the two allow options are
    // indistinguishable at the moment of choosing.
    name: 'Allow for the rest of this session',
    kind: 'allow_always'
};

const OPTION_REJECT_ONCE: AcpPermissionOption = {
    optionId: PERMISSION_OPTION_IDS.rejectOnce,
    name: 'Reject',
    kind: 'reject_once'
};

const TOOL_KINDS: Record<string, AcpToolKind> = {
    shell: 'execute',
    write: 'edit',
    read: 'read',
    url: 'fetch'
};

function str(v: unknown, fallback = ''): string {
    return typeof v === 'string' && v ? v : fallback;
}

/** The action a user is being asked to authorise, phrased for a security prompt. */
function titleFor(r: CopilotPermissionRequest): string {
    switch (r.kind) {
        case 'shell':
            return `Run: ${str(r.fullCommandText, '(unspecified command)')}`;
        case 'write':
            return `Edit ${str(r.fileName, '(unspecified file)')}`;
        case 'read':
            return `Read ${str(r.path, '(unspecified file)')}`;
        case 'url':
            return `Fetch ${str(r.url, '(unspecified URL)')}`;
        case 'mcp':
            return `${str(r.serverName, 'MCP server')}: ${str(r.toolTitle) || str(r.toolName, 'tool')}`;
        case 'memory':
            return `Remember: ${str(r.fact, '(unspecified fact)')}`;
        case 'custom-tool':
            return `Run tool ${str(r.toolName, '(unnamed)')}`;
        case 'hook':
            return `Run ${str(r.toolName, '(unnamed tool)')}`;
        case 'extension-management': {
            const name = str(r.extensionName);
            return name
                ? `${str(r.operation, 'Manage')} extension ${name}`
                : `${str(r.operation, 'Manage')} an extension`;
        }
        case 'extension-permission-access': {
            const caps = Array.isArray(r.capabilities) ? (r.capabilities as string[]).join(', ') : '';
            const name = str(r.extensionName, 'An extension');
            return caps ? `${name} requests access to ${caps}` : `${name} requests additional access`;
        }
        default:
            return `Permission requested: ${r.kind}`;
    }
}

/** The one file a variant is about, where it has one. */
function locationsFor(r: CopilotPermissionRequest): { path: string }[] | undefined {
    const p = r.kind === 'write' ? str(r.fileName) : r.kind === 'read' ? str(r.path) : '';
    // An empty array would be rendered by a host as "affects 0 files", which is a
    // different claim from "we do not know which files this affects".
    return p ? [{ path: p }] : undefined;
}

/**
 * The session-scoped approval a variant supports, or `null` if it supports none.
 *
 * Doubles as the gate on offering `allow_always` at all: if there is nothing to
 * return here, the option is not offered, so the two directions cannot disagree
 * about what was promised.
 *
 * Payload shapes are verbatim from the SDK's `PermissionDecisionApproveForSession`
 * union; a shape we invented would be rejected by the CLI at the moment of use,
 * which is the worst possible time to find out.
 */
export function sessionApprovalFor(
    r: CopilotPermissionRequest
): { approval?: Record<string, unknown>; domain?: string } | null {
    switch (r.kind) {
        case 'shell':
            // Conservative on purpose: only an explicit `true` opens the option. A
            // missing flag is not evidence that session approval is safe.
            if (r.canOfferSessionApproval !== true) {
                return null;
            }
            return {
                approval: {
                    kind: 'commands',
                    commandIdentifiers: Array.isArray(r.commands)
                        ? (r.commands as { identifier: string }[]).map(c => c.identifier)
                        : []
                }
            };
        case 'write':
            if (r.canOfferSessionApproval !== true) {
                return null;
            }
            return { approval: { kind: 'write' } };
        case 'read':
            return { approval: { kind: 'read' } };
        case 'memory':
            return { approval: { kind: 'memory' } };
        case 'mcp':
            return {
                approval: { kind: 'mcp', serverName: str(r.serverName), toolName: str(r.toolName) || null }
            };
        case 'custom-tool':
            return { approval: { kind: 'custom-tool', toolName: str(r.toolName) } };
        case 'extension-management':
            return { approval: { kind: 'extension-management', operation: str(r.operation) } };
        case 'extension-permission-access':
            return { approval: { kind: 'extension-permission-access', extensionName: str(r.extensionName) } };
        case 'url': {
            // `domain`, not `approval` — the SDK documents that field as "URL prompts
            // only". With no parseable domain there is nothing to scope the approval
            // to, and inventing one would grant more than the user agreed to.
            const domain = hostnameOf(str(r.url));
            return domain ? { domain } : null;
        }
        default:
            // `hook` lands here, and so does any variant a future CLI adds. Both are
            // cases where we do not know what a session-wide grant would mean.
            return null;
    }
}

function hostnameOf(url: string): string | null {
    try {
        return new URL(url).hostname || null;
    } catch {
        return null;
    }
}

/**
 * Copilot request → ACP request.
 *
 * `fallbackToolCallId` covers the mismatch that `toolCallId` is optional on every
 * Copilot variant but required by ACP. Emitting a request without one would be
 * malformed, and a strict client is entitled to reject it — turning a missing id
 * into a denied permission.
 */
export function toAcpPermissionRequest(
    sessionId: string,
    request: CopilotPermissionRequest,
    fallbackToolCallId: string
): AcpPermissionRequest {
    const options: AcpPermissionOption[] = [OPTION_ALLOW_ONCE];
    if (sessionApprovalFor(request)) {
        options.push(OPTION_ALLOW_ALWAYS);
    }
    options.push(OPTION_REJECT_ONCE);

    const toolCall: AcpPermissionRequest['toolCall'] = {
        toolCallId: str(request.toolCallId, fallbackToolCallId),
        kind: TOOL_KINDS[request.kind] ?? 'other',
        title: titleFor(request),
        // Verbatim rather than a curated subset: the host is the party deciding, and
        // a field we chose not to forward is a field it cannot show.
        rawInput: request
    };
    const locations = locationsFor(request);
    if (locations) {
        toolCall.locations = locations;
    }

    return { sessionId, toolCall, options };
}

/**
 * ACP outcome → Copilot decision.
 *
 * The request is passed back in because a session-scoped grant is variant-shaped:
 * "allow always" means `{ kind: 'commands', commandIdentifiers: [...] }` for a shell
 * and `{ kind: 'write' }` for an edit, and only the original request knows which.
 *
 * **Nothing unrecognised becomes an approval.** An option id we never offered, an
 * `allow_always` on a variant that was never offered one, a missing id, an outcome
 * shape ACP does not define — each rejects. Consent we cannot account for is not
 * consent, and the cost of being wrong is asymmetric: an unintended denial stalls a
 * turn, an unintended approval runs a command nobody agreed to.
 */
export function fromAcpOutcome(
    request: CopilotPermissionRequest,
    outcome: AcpPermissionOutcome | undefined
): CopilotPermissionDecision {
    if (!outcome || typeof outcome !== 'object') {
        return { kind: 'reject' };
    }
    if (outcome.outcome === 'cancelled') {
        // Distinct from a rejection: the user declined to answer rather than
        // answering "no", and Copilot has a kind that says exactly that.
        return { kind: 'cancelled' };
    }
    if (outcome.outcome !== 'selected') {
        return { kind: 'reject' };
    }

    switch ((outcome as { optionId?: string }).optionId) {
        case PERMISSION_OPTION_IDS.allowOnce:
            return { kind: 'approve-once' };
        case PERMISSION_OPTION_IDS.rejectOnce:
            return { kind: 'reject' };
        case PERMISSION_OPTION_IDS.allowAlways: {
            // Re-derived rather than remembered, from the same function that decided
            // whether to offer the option in the first place. That is what stops the
            // two directions from disagreeing about what was promised: if the option
            // could not have been offered, it cannot be honoured either.
            const scope = sessionApprovalFor(request);
            return scope ? { kind: 'approve-for-session', ...scope } : { kind: 'reject' };
        }
        default:
            return { kind: 'reject' };
    }
}
