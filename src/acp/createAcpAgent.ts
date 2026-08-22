/**
 * Composition root for the ACP agent process (IN-3).
 *
 * The only place that knows what a session *is*: a new `SDKSessionManager`, started
 * against the **shared** `CopilotClientProvider`, wrapped in an `SdkSessionBackend`.
 * Every other file in `src/acp/` takes its collaborators as parameters, which is
 * what keeps them free of `vscode` and of the CLI.
 *
 * Split in two on purpose. `createSessionStarter` is the wiring — one provider, N
 * managers — and is worth testing on its own. `createAcpAgent` is the trivial
 * assembly on top. The alternative was hanging `startSession` off the agent so a
 * test could reach it, which would have put a peephole in production for the
 * convenience of the test.
 */

import type { LoggerLike } from '../logger';
import { CopilotAcpAgent, AcpSessionBackend } from './CopilotAcpAgent';
import { SdkSessionBackend, AcpManagerSlice, PermissionPolicy, HistoryReader, FileTextReader } from './SdkSessionBackend';
import { SessionService } from '../extension/services/SessionService';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * What the entry point must supply. `createManager` is injected rather than calling
 * `new SDKSessionManager(...)` here so this module — and its tests — need neither
 * the CLI nor `vscode`.
 */
export interface AcpAgentCompositionDeps {
    logger: LoggerLike;
    /** Directory the agent may use for persistent files. */
    globalStorageDir: string;
    /** Fallback workspace when a client opens a session without a cwd. */
    workspaceFolder?: string;
    /**
     * The single shared client provider. **One instance for the whole process** —
     * see {@link createSessionStarter}.
     */
    clientProvider: unknown;
    /** Builds a manager bound to the given workspace and provider. */
    createManager(args: {
        workspaceFolder: string;
        clientProvider: unknown;
        settings: Record<string, unknown>;
        /** When present, the manager attaches to this existing session instead of minting one. */
        resumeSessionId?: string;
    }): AcpManagerSlice;
    /** Snapshot of `copilotCLI.*` settings taken at launch. */
    settings?: Readonly<Record<string, unknown>>;
    /** Where session transcripts live. Defaults to the CLI's own store. */
    sessionStateDir?: string;
    agentName?: string;
    agentVersion?: string;
}

/**
 * Where a session's stored conversation lives, and how to turn it into turns.
 *
 * Reuses `SessionService.loadSessionHistory` rather than parsing `events.jsonl` here.
 * A second parser would be a second opinion about which events count as "what was
 * said", and the two would diverge the first time the CLI added an event type — with
 * the ACP transcript and the sidebar transcript disagreeing about the same session.
 * `SessionService` imports only `fs`, `path`, `readline` and `crypto`, so it is safe
 * in a process with no `vscode`.
 *
 * `sessionStateDir` is a parameter rather than a constant so this is testable against
 * a real file without writing into the user's `~/.copilot`.
 */
export function createHistoryReader(sessionStateDir: string): HistoryReader {
    return async sessionId => {
        const eventsPath = path.join(sessionStateDir, sessionId, 'events.jsonl');
        const messages = await SessionService.loadSessionHistory(eventsPath);
        return messages.map(m => ({ role: m.role, content: m.content }));
    };
}

/**
 * A file's text, or `null` when there is no readable file there.
 *
 * The `null` matters as much as the text. A diff distinguishes three states that a
 * throw would flatten into one: a file with content, an EMPTY file — a real state a
 * host has to render — and no file at all, which for the "before" side is how ACP
 * spells a newly created file.
 */
export const readFileTextOrNull: FileTextReader = absolutePath => {
    try {
        return fs.readFileSync(absolutePath, 'utf-8');
    } catch {
        // Missing, a directory, unreadable: from a diff's point of view these are the
        // same answer — there is no previous text to show.
        return null;
    }
};

/**
 * The stored sessions, newest first, optionally narrowed to one directory.
 *
 * Newest first because a host renders this as a picker and the session someone wants
 * is almost always the one they were last in. `SessionService.getAllSessions` reports
 * mtime; ACP wants an ISO timestamp, so the ordering is done here where the number
 * still exists rather than pushed onto a client that only gets the string.
 */
export function createSessionLister(sessionStateDir: string) {
    return async (params: { cwd?: string }) => {
        // PROVISIONAL — replace with `sessionPairing.roleOf()` when Lane B's P4 lands.
        // Written up on the `cross-talk` branch, which is checked out at
        // ../vscode-copilot-cli-extension-cross-talk:
        //     planning/cross-talk/A-to-B-01-p4-work-plan-pairing.md
        // Named rather than linked: that file is not on this branch, and a relative
        // path resolving in one checkout and 404ing in another is worse than a path
        // you can paste.
        //
        // Plan mode is a TWO-session design: entering it creates a second SDK session
        // at `<id>-plan`. That session is an internal half rather than a conversation
        // anyone started, and listing it invites a user to open something that only
        // makes sense attached to its work session. In a real store this was 197
        // entries of 909 — the fixtures had none, so only a live run showed it.
        //
        // This is a string match on a naming convention, which is debt, and it is the
        // SECOND place to know that convention: `sdkSessionManager.ts` is the other.
        // P4 replaces both with one resolver and keeps the suffix as its documented
        // fallback, so deleting this is a one-line change to a `roleOf` call.
        const all = SessionService.getAllSessions(sessionStateDir)
            .filter(session => !session.id.endsWith('-plan'));
        const scoped = params.cwd
            ? SessionService.filterSessionsByFolder(all, params.cwd)
            : all;

        return scoped
            .slice()
            .sort((a, b) => b.mtime - a.mtime)
            .map(session => ({
                sessionId: session.id,
                // `cwd` is required by ACP and our store may not know it — a session
                // whose events.jsonl lacks a start event. The session still exists and
                // is still loadable, so it is reported with an empty cwd rather than
                // hidden, which would make it undeletable through the protocol too.
                cwd: session.cwd ?? '',
                title: SessionService.formatSessionLabel(session.id, path.join(sessionStateDir, session.id)),
                updatedAt: new Date(session.mtime).toISOString()
            }));
    };
}

/**
 * Remove a session from the store. Destructive and not undoable.
 *
 * The id arrives over a wire from a host we do not control, so it is untrusted input
 * and `path.join(dir, id)` is not a containment check — `..` segments resolve happily
 * outside the store. The resolved path is therefore verified to be a direct child of
 * the store before anything is removed. Without that, one malformed id is an `rm -rf`
 * on something that was never ours.
 */
export function createSessionDeleter(sessionStateDir: string) {
    const root = path.resolve(sessionStateDir);

    return async (sessionId: string) => {
        const target = path.resolve(root, sessionId);

        if (!sessionId || path.dirname(target) !== root || path.basename(target) !== sessionId) {
            throw new Error(`refusing to delete "${sessionId}": not a session in this store`);
        }
        if (!fs.existsSync(target)) {
            // Already gone is the state the caller asked for. Erroring would make a
            // repeated delete — or a race with another surface — look like a fault.
            return;
        }
        fs.rmSync(target, { recursive: true, force: true });
    };
}

/** The CLI's own session store. */
export const DEFAULT_SESSION_STATE_DIR = path.join(os.homedir(), '.copilot', 'session-state');

/**
 * How the agent answers a permission request it cannot put to its host.
 *
 * `yolo` is the only setting that changes this, and it changes only this: a host
 * that IS reachable is still asked, and its answer still stands, including when it
 * says no. The setting exists for the unattended case — an agent driven by a script
 * has nobody to ask, and denying every request would make it useless.
 *
 * Read from the launch snapshot rather than from live configuration because an agent
 * process has no VS Code to read from, and because a permission policy that could
 * change mid-session would mean two identical requests getting different answers for
 * reasons invisible in the transcript.
 */
function permissionPolicy(deps: AcpAgentCompositionDeps): PermissionPolicy {
    return { fallback: deps.settings?.yolo === true ? 'approve-once' : 'deny' };
}

/**
 * Build the function that turns a `session/new` into a running backend.
 *
 * **Every manager receives the same provider instance.** That is the whole payoff
 * of spine S4: a manager *given* a provider is a consumer and will not stop it, so
 * N sessions share one CLI process. If each built its own, N sessions would spawn N
 * CLIs and the first session to close would stop a client the others were still
 * using.
 */
export function createSessionStarter(
    deps: AcpAgentCompositionDeps
): (params: { cwd: string }) => Promise<AcpSessionBackend> {
    return async ({ cwd }) => {
        const manager = deps.createManager({
            // The client's cwd wins: an ACP client opens a session *for* a
            // directory, and that is more specific than whatever the process was
            // launched in.
            workspaceFolder: cwd || deps.workspaceFolder || process.cwd(),
            clientProvider: deps.clientProvider,
            settings: { ...(deps.settings ?? {}) }
        });

        return SdkSessionBackend.start(
            manager,
            deps.logger,
            permissionPolicy(deps),
            createHistoryReader(deps.sessionStateDir ?? DEFAULT_SESSION_STATE_DIR),
            readFileTextOrNull
        );
    };
}

/**
 * Build the function that resumes an existing session for `session/load`.
 *
 * Deliberately the same construction path as {@link createSessionStarter}, differing
 * only by `resumeSessionId`. A separate path would drift — the shared provider, the
 * per-session bridge and the cwd rule all have to stay identical, and the only thing
 * a resume changes is which session the manager attaches to.
 */
export function createSessionLoader(
    deps: AcpAgentCompositionDeps
): (params: { sessionId: string; cwd: string }) => Promise<AcpSessionBackend> {
    return async ({ sessionId, cwd }) => {
        const manager = deps.createManager({
            workspaceFolder: cwd || deps.workspaceFolder || process.cwd(),
            clientProvider: deps.clientProvider,
            settings: { ...(deps.settings ?? {}) },
            resumeSessionId: sessionId
        });

        return SdkSessionBackend.start(
            manager,
            deps.logger,
            permissionPolicy(deps),
            createHistoryReader(deps.sessionStateDir ?? DEFAULT_SESSION_STATE_DIR),
            readFileTextOrNull
        );
    };
}

/**
 * Copy a session and start a backend on the copy.
 *
 * Two steps that must stay in this order: `SessionService.forkSession` duplicates the
 * directory and rewrites the `session.start` event so the CLI accepts the new id, and
 * only then can a manager resume it. Starting first would attach to the source and
 * every subsequent turn would be written into the session being forked from.
 */
export function createSessionForker(deps: AcpAgentCompositionDeps, sessionStateDir: string) {
    return async ({ sessionId, cwd }: { sessionId: string; cwd: string }) => {
        const forkedId = SessionService.forkSession(sessionId, sessionStateDir);
        deps.logger.info(`[ACP] forked ${sessionId} → ${forkedId}`);
        return createSessionLoader(deps)({ sessionId: forkedId, cwd });
    };
}

/** Assemble the agent. See {@link createSessionStarter} for the part that matters. */
export function createAcpAgent(deps: AcpAgentCompositionDeps): CopilotAcpAgent {
    const sessionStateDir = deps.sessionStateDir ?? DEFAULT_SESSION_STATE_DIR;

    return new CopilotAcpAgent({
        logger: deps.logger,
        agentName: deps.agentName,
        agentVersion: deps.agentVersion,
        startSession: createSessionStarter(deps),
        loadSession: createSessionLoader(deps),
        listSessions: createSessionLister(sessionStateDir),
        forkSession: createSessionForker(deps, sessionStateDir),
        deleteSession: createSessionDeleter(sessionStateDir)
    });
}
