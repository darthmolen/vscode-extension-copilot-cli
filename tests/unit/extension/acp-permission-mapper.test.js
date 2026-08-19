/**
 * permissionMapper — Copilot permission requests ⇄ ACP `session/request_permission`
 * (IN-3 scope item 4).
 *
 * Pure functions, so every one of the ten Copilot variants is testable without a
 * protocol, a CLI or a manager. The agent wires them; this file proves the shapes.
 *
 * **What the title says.** ACP renders `title` as the headline of a security prompt.
 * It therefore states the action being AUTHORISED — the command, the file, the URL —
 * rather than the model's `intention`, which is model-authored prose explaining
 * itself and the least trustworthy field in the request. `intention` still reaches
 * the host verbatim inside `rawInput`; it just does not occupy the position of
 * authority.
 *
 * **What is not offered.** `reject_always` is absent from every option set: the
 * Copilot `PermissionDecision` union has no session-scoped reject, so offering one
 * would be a button the host renders and we cannot honour.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const M = require(path.join(__dirname, '../../..', 'out', 'acp', 'permissionMapper.js'));

const SID = 'sess-1';
const FALLBACK = 'permission-7';

/** Option kinds offered, in order — the shape assertions below read off this. */
const kinds = req => M.toAcpPermissionRequest(SID, req, FALLBACK).options.map(o => o.kind);
const optionFor = (req, kind) =>
    M.toAcpPermissionRequest(SID, req, FALLBACK).options.find(o => o.kind === kind);

const shell = (over = {}) => ({
    kind: 'shell',
    toolCallId: 'tc-1',
    fullCommandText: 'rm -rf build',
    intention: 'Clean the build directory',
    commands: [{ identifier: 'rm', readOnly: false }],
    possiblePaths: [],
    possibleUrls: [],
    hasWriteFileRedirection: false,
    canOfferSessionApproval: true,
    ...over
});

describe('permissionMapper — envelope (IN-3)', () => {
    it('carries the session id the request belongs to', () => {
        expect(M.toAcpPermissionRequest(SID, shell(), FALLBACK).sessionId).to.equal(SID);
    });

    it('uses the request toolCallId when the CLI supplied one', () => {
        expect(M.toAcpPermissionRequest(SID, shell(), FALLBACK).toolCall.toolCallId).to.equal('tc-1');
    });

    /**
     * `toolCallId` is optional on every Copilot variant but REQUIRED by ACP. Without
     * a fallback we would emit a malformed request, and a strict client is entitled
     * to reject it — turning a missing id into a denied permission.
     */
    it('falls back to the supplied id when the CLI omitted toolCallId', () => {
        const req = shell();
        delete req.toolCallId;
        expect(M.toAcpPermissionRequest(SID, req, FALLBACK).toolCall.toolCallId).to.equal(FALLBACK);
    });

    it('passes the whole request through as rawInput, losing no variant field', () => {
        const req = shell();
        expect(M.toAcpPermissionRequest(SID, req, FALLBACK).toolCall.rawInput).to.deep.equal(req);
    });

    it('never offers reject_always, which Copilot cannot honour', () => {
        const everyVariant = [
            shell(),
            { kind: 'write', fileName: '/a.ts', diff: '-x\n+y', intention: 'i', canOfferSessionApproval: true },
            { kind: 'read', path: '/a.ts', intention: 'i' },
            { kind: 'url', url: 'https://example.com/x', intention: 'i' },
            { kind: 'mcp', serverName: 'srv', toolName: 't', toolTitle: 'T', readOnly: false },
            { kind: 'memory', fact: 'f' },
            { kind: 'custom-tool', toolName: 't', toolDescription: 'd' },
            { kind: 'hook', toolName: 'bash' },
            { kind: 'extension-management', operation: 'install', extensionName: 'e' },
            { kind: 'extension-permission-access', extensionName: 'e', capabilities: ['fs'] }
        ];
        for (const req of everyVariant) {
            expect(kinds(req), `variant ${req.kind}`).to.not.include('reject_always');
            expect(kinds(req), `variant ${req.kind}`).to.include('allow_once');
            expect(kinds(req), `variant ${req.kind}`).to.include('reject_once');
        }
    });
});

describe('permissionMapper — tool kind and title per variant (IN-3)', () => {
    const cases = [
        ['shell', shell(), 'execute', 'rm -rf build'],
        ['write', { kind: 'write', fileName: '/src/a.ts', diff: '', intention: 'i', canOfferSessionApproval: true }, 'edit', '/src/a.ts'],
        ['read', { kind: 'read', path: '/src/a.ts', intention: 'i' }, 'read', '/src/a.ts'],
        ['url', { kind: 'url', url: 'https://example.com/x', intention: 'i' }, 'fetch', 'https://example.com/x'],
        ['mcp', { kind: 'mcp', serverName: 'srv', toolName: 'query', toolTitle: 'Query', readOnly: true }, 'other', 'srv'],
        ['memory', { kind: 'memory', fact: 'the user prefers tabs' }, 'other', 'the user prefers tabs'],
        ['custom-tool', { kind: 'custom-tool', toolName: 'update_work_plan', toolDescription: 'd' }, 'other', 'update_work_plan'],
        ['hook', { kind: 'hook', toolName: 'bash' }, 'other', 'bash'],
        ['extension-management', { kind: 'extension-management', operation: 'install', extensionName: 'acme' }, 'other', 'acme'],
        ['extension-permission-access', { kind: 'extension-permission-access', extensionName: 'acme', capabilities: ['fs'] }, 'other', 'acme']
    ];

    for (const [name, req, expectedKind, titleMustMention] of cases) {
        it(`${name} → ACP kind '${expectedKind}', titled with what is being authorised`, () => {
            const acp = M.toAcpPermissionRequest(SID, req, FALLBACK);
            expect(acp.toolCall.kind).to.equal(expectedKind);
            expect(acp.toolCall.title).to.be.a('string').and.to.include(titleMustMention);
        });
    }

    /**
     * The model's stated reason is the least trustworthy field in the request, so it
     * must not be what a user reads when deciding. The command is.
     */
    it('does not let the model-authored intention displace the command in the title', () => {
        const acp = M.toAcpPermissionRequest(SID, shell({ intention: 'Tidy up harmlessly' }), FALLBACK);
        expect(acp.toolCall.title).to.include('rm -rf build');
    });

    it('still forwards intention verbatim, in rawInput', () => {
        const acp = M.toAcpPermissionRequest(SID, shell({ intention: 'Tidy up harmlessly' }), FALLBACK);
        expect(acp.toolCall.rawInput.intention).to.equal('Tidy up harmlessly');
    });
});

describe('permissionMapper — locations (IN-3)', () => {
    it('marks the file a write touches, so a host can reveal it', () => {
        const acp = M.toAcpPermissionRequest(
            SID, { kind: 'write', fileName: '/src/a.ts', diff: '', intention: 'i', canOfferSessionApproval: true }, FALLBACK);
        expect(acp.toolCall.locations).to.deep.equal([{ path: '/src/a.ts' }]);
    });

    it('marks the file a read touches', () => {
        const acp = M.toAcpPermissionRequest(SID, { kind: 'read', path: '/src/a.ts', intention: 'i' }, FALLBACK);
        expect(acp.toolCall.locations).to.deep.equal([{ path: '/src/a.ts' }]);
    });

    /** A variant with no path must not carry an empty array a host would render as "0 files". */
    it('omits locations entirely where no path exists', () => {
        expect(M.toAcpPermissionRequest(SID, { kind: 'memory', fact: 'f' }, FALLBACK).toolCall)
            .to.not.have.property('locations');
    });
});

describe('permissionMapper — which variants may be approved for the session (IN-3)', () => {
    /**
     * Copilot has no session-scoped approval shape for `hook`. Offering one would
     * produce a decision we could not express, so the option is withheld.
     */
    it('withholds allow_always for hook, which has no session-scoped shape', () => {
        expect(kinds({ kind: 'hook', toolName: 'bash' })).to.not.include('allow_always');
    });

    it('honours canOfferSessionApproval:false on shell', () => {
        expect(kinds(shell({ canOfferSessionApproval: false }))).to.not.include('allow_always');
        expect(kinds(shell({ canOfferSessionApproval: true }))).to.include('allow_always');
    });

    it('honours canOfferSessionApproval:false on write', () => {
        const write = over => ({ kind: 'write', fileName: '/a.ts', diff: '', intention: 'i', ...over });
        expect(kinds(write({ canOfferSessionApproval: false }))).to.not.include('allow_always');
        expect(kinds(write({ canOfferSessionApproval: true }))).to.include('allow_always');
    });

    /**
     * A URL's session approval is scoped to a `domain`, which we derive from the URL.
     * If it will not parse there is no domain to scope to, so the option is withheld
     * rather than sent with a domain we invented.
     */
    it('withholds allow_always for a URL we cannot derive a domain from', () => {
        expect(kinds({ kind: 'url', url: 'https://example.com/x', intention: 'i' })).to.include('allow_always');
        expect(kinds({ kind: 'url', url: 'not a url', intention: 'i' })).to.not.include('allow_always');
    });

    it('offers allow_always for the variants that do have a session shape', () => {
        const withSessionShape = [
            { kind: 'read', path: '/a.ts', intention: 'i' },
            { kind: 'mcp', serverName: 'srv', toolName: 't', toolTitle: 'T', readOnly: false },
            { kind: 'memory', fact: 'f' },
            { kind: 'custom-tool', toolName: 't', toolDescription: 'd' },
            { kind: 'extension-management', operation: 'install' },
            { kind: 'extension-permission-access', extensionName: 'e', capabilities: [] }
        ];
        for (const req of withSessionShape) {
            expect(kinds(req), `variant ${req.kind}`).to.include('allow_always');
        }
    });

    it('gives every option a distinct id and a name a human can read', () => {
        const { options } = M.toAcpPermissionRequest(SID, shell(), FALLBACK);
        const ids = options.map(o => o.optionId);
        expect(new Set(ids).size).to.equal(ids.length);
        for (const o of options) {
            expect(o.optionId, 'optionId').to.be.a('string').and.to.have.length.greaterThan(0);
            expect(o.name, 'name').to.be.a('string').and.to.have.length.greaterThan(0);
        }
    });

    /** The allow_always label must say the scope, or a user cannot tell the two allows apart. */
    it('labels allow_always as session-scoped, distinctly from allow_once', () => {
        const once = optionFor(shell(), 'allow_once');
        const always = optionFor(shell(), 'allow_always');
        expect(always.name).to.not.equal(once.name);
        expect(always.name.toLowerCase()).to.include('session');
    });
});

/**
 * The outcome direction. Option ids are taken from the mapper's own constants, never
 * from string literals — a rename that broke the round trip has to break a test, and
 * literals here would agree with a stale spelling forever.
 */
describe('permissionMapper — the host\'s answer becomes a Copilot decision (IN-3)', () => {
    const IDS = M.PERMISSION_OPTION_IDS;
    const selected = optionId => ({ outcome: 'selected', optionId });

    it('allow once approves this call only', () => {
        expect(M.fromAcpOutcome(shell(), selected(IDS.allowOnce))).to.deep.equal({ kind: 'approve-once' });
    });

    it('reject once rejects', () => {
        expect(M.fromAcpOutcome(shell(), selected(IDS.rejectOnce))).to.deep.equal({ kind: 'reject' });
    });

    /**
     * ACP delivers a dismissed prompt as `cancelled`, which is distinct from a
     * rejection: the user declined to answer rather than answering "no". Copilot has
     * a matching kind, so the distinction survives.
     */
    it('a cancelled prompt is cancelled, not rejected', () => {
        expect(M.fromAcpOutcome(shell(), { outcome: 'cancelled' })).to.deep.equal({ kind: 'cancelled' });
    });

    describe('allow always carries the session-scoped payload for its variant', () => {
        const sessionCases = [
            ['shell', shell(), { kind: 'commands', commandIdentifiers: ['rm'] }],
            ['write', { kind: 'write', fileName: '/a.ts', diff: '', intention: 'i', canOfferSessionApproval: true }, { kind: 'write' }],
            ['read', { kind: 'read', path: '/a.ts', intention: 'i' }, { kind: 'read' }],
            ['memory', { kind: 'memory', fact: 'f' }, { kind: 'memory' }],
            ['mcp', { kind: 'mcp', serverName: 'srv', toolName: 'query', toolTitle: 'Q', readOnly: false }, { kind: 'mcp', serverName: 'srv', toolName: 'query' }],
            ['custom-tool', { kind: 'custom-tool', toolName: 'update_work_plan', toolDescription: 'd' }, { kind: 'custom-tool', toolName: 'update_work_plan' }],
            ['extension-management', { kind: 'extension-management', operation: 'install' }, { kind: 'extension-management', operation: 'install' }],
            ['extension-permission-access', { kind: 'extension-permission-access', extensionName: 'acme', capabilities: [] }, { kind: 'extension-permission-access', extensionName: 'acme' }]
        ];

        for (const [name, req, approval] of sessionCases) {
            it(`${name} → approve-for-session with a ${approval.kind} approval`, () => {
                expect(M.fromAcpOutcome(req, selected(IDS.allowAlways)))
                    .to.deep.equal({ kind: 'approve-for-session', approval });
            });
        }

        /** A URL grant is scoped by `domain`, and the SDK documents `approval` as absent there. */
        it('url → approve-for-session scoped by domain, with no approval payload', () => {
            const d = M.fromAcpOutcome({ kind: 'url', url: 'https://example.com/a/b', intention: 'i' }, selected(IDS.allowAlways));
            expect(d).to.deep.equal({ kind: 'approve-for-session', domain: 'example.com' });
        });

        it('scopes a shell grant to every command identifier the request named', () => {
            const req = shell({ commands: [{ identifier: 'rm', readOnly: false }, { identifier: 'find', readOnly: true }] });
            expect(M.fromAcpOutcome(req, selected(IDS.allowAlways)).approval.commandIdentifiers)
                .to.deep.equal(['rm', 'find']);
        });
    });

    /**
     * These are the cases that decide whether the seam is safe. Anything we cannot
     * interpret must not become consent — an approval we did not receive is worse
     * than a denial we did not intend.
     */
    describe('never approves on an answer it cannot interpret', () => {
        const mustNotApprove = decision => {
            expect(decision.kind, JSON.stringify(decision)).to.not.match(/^approve/);
        };

        it('an optionId we never offered', () => {
            mustNotApprove(M.fromAcpOutcome(shell(), selected('some-option-the-host-invented')));
        });

        it('allow always on a variant that was never offered it (hook)', () => {
            mustNotApprove(M.fromAcpOutcome({ kind: 'hook', toolName: 'bash' }, selected(IDS.allowAlways)));
        });

        it('allow always on a shell the CLI said could not be session-approved', () => {
            mustNotApprove(M.fromAcpOutcome(shell({ canOfferSessionApproval: false }), selected(IDS.allowAlways)));
        });

        it('a selected outcome with no optionId at all', () => {
            mustNotApprove(M.fromAcpOutcome(shell(), { outcome: 'selected' }));
        });

        it('an outcome object of a shape ACP does not define', () => {
            mustNotApprove(M.fromAcpOutcome(shell(), { outcome: 'something-else' }));
            mustNotApprove(M.fromAcpOutcome(shell(), undefined));
        });
    });
});
