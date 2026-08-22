import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { randomUUID } from 'crypto';

/** Normalize a path and strip trailing separators for reliable comparison. */
function normalizePath(p: string): string {
    let n = path.normalize(p);
    while (n.length > 1 && n.endsWith(path.sep)) {
        n = n.slice(0, -1);
    }
    return n;
}

export interface SessionInfo {
    id: string;
    cwd?: string;
    mtime: number;
}

export interface SessionMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: number;
}

/**
 * Gets the working directory from a session's events.jsonl.
 * Reads only the first ~2KB for performance.
 */
function getSessionCwd(sessionDir: string, sessionId: string): string | undefined {
    try {
        const eventsPath = path.join(sessionDir, sessionId, 'events.jsonl');
        if (!fs.existsSync(eventsPath)) {
            return undefined;
        }

        const fd = fs.openSync(eventsPath, 'r');
        const buffer = Buffer.alloc(2048);
        const bytesRead = fs.readSync(fd, buffer, 0, 2048, 0);
        fs.closeSync(fd);

        const firstLine = buffer.toString('utf8', 0, bytesRead).split('\n')[0];
        if (!firstLine) {
            return undefined;
        }

        const event = JSON.parse(firstLine);
        if (event.type === 'session.start' && event.data?.context?.cwd) {
            return event.data.context.cwd;
        }

        return undefined;
    } catch {
        return undefined;
    }
}

/**
 * SessionService consolidates all session lifecycle logic:
 * - Session discovery (getAllSessions, filterSessionsByFolder, getMostRecentSession)
 * - Session labeling (formatSessionLabel)
 * - Session resume determination (determineSessionToResume)
 *
 * All methods accept explicit paths/config — no global state dependency.
 */
export const SessionService = {
    /**
     * Returns all valid sessions (those with events.jsonl) from the given directory.
     */
    getAllSessions(sessionStateDir: string): SessionInfo[] {
        try {
            if (!fs.existsSync(sessionStateDir)) {
                return [];
            }

            return fs.readdirSync(sessionStateDir)
                .filter(name => {
                    const fullPath = path.join(sessionStateDir, name);
                    if (!fs.statSync(fullPath).isDirectory()) {
                        return false;
                    }
                    return fs.existsSync(path.join(fullPath, 'events.jsonl'));
                })
                .map(name => ({
                    id: name,
                    cwd: getSessionCwd(sessionStateDir, name),
                    mtime: fs.statSync(path.join(sessionStateDir, name)).mtime.getTime()
                }));
        } catch {
            return [];
        }
    },

    /**
     * Filters sessions to those matching a workspace folder path.
     * Sessions without cwd are excluded.
     */
    filterSessionsByFolder(sessions: SessionInfo[], workspaceFolder: string): SessionInfo[] {
        const normalizedWorkspace = normalizePath(workspaceFolder);
        return sessions.filter(session => {
            if (!session.cwd) {
                return false;
            }
            return normalizePath(session.cwd) === normalizedWorkspace;
        });
    },

    /**
     * Returns the most recent session ID, optionally filtered by workspace folder.
     * Falls back to global most recent if no folder-specific sessions exist.
     *
     * `alreadyOpen` is the set of sessions this window already has a surface for.
     * They are not candidates: they are already resumed. Without this, restoring a
     * chat tab on window reload and then asking for "the last session" returns the
     * tab's own session — it was, after all, the last one written to — and two
     * hosts claim it on an ordinary reload.
     *
     * The global fallback still means *"this folder has no sessions"*. It is not
     * reached when the folder's sessions merely happen to be open, because
     * borrowing another workspace's conversation is worse than starting a new one.
     */
    getMostRecentSession(
        sessionStateDir: string,
        workspaceFolder: string,
        filterByFolder: boolean,
        alreadyOpen: string[] = []
    ): string | null {
        const allSessions = SessionService.getAllSessions(sessionStateDir);
        if (allSessions.length === 0) {
            return null;
        }

        const open = new Set(alreadyOpen);
        const sorted = allSessions.sort((a, b) => b.mtime - a.mtime);
        const mostRecentAvailable = (sessions: SessionInfo[]): string | null =>
            sessions.find(session => !open.has(session.id))?.id ?? null;

        if (!filterByFolder) {
            return mostRecentAvailable(sorted);
        }

        const folderSessions = SessionService.filterSessionsByFolder(sorted, workspaceFolder);
        if (folderSessions.length > 0) {
            return mostRecentAvailable(folderSessions);
        }

        // Fallback to global most recent
        return mostRecentAvailable(sorted);
    },

    /**
     * Writes a custom session name to session-name.txt.
     * This is the highest-priority label source. Use as a fallback when the CLI
     * cannot rename the session (e.g. "Workspace not found" on resumed sessions).
     */
    writeSessionName(sessionPath: string, name: string): void {
        const namePath = path.join(sessionPath, 'session-name.txt');
        fs.writeFileSync(namePath, name, 'utf-8');
    },

    /**
     * Records the model this session is on, in `session-model.txt`.
     *
     * Beside `session-name.txt` and shaped like it: plain text, one value, single
     * purpose, no read-modify-write to race. Never throws — the model switch has
     * already succeeded by the time this runs, and failing to write the note down
     * must not be reported to the user as a failed switch.
     *
     * Deliberately not merged into P4's `session-pairing.json`: that is written
     * once at plan-session creation and never edited, this is rewritten on every
     * switch, and coupling two lifetimes into one file buys only a lost-update
     * window.
     */
    writeSessionModel(sessionPath: string, model: string): void {
        try {
            fs.writeFileSync(path.join(sessionPath, 'session-model.txt'), model, 'utf-8');
        } catch { /* never throw */ }
    },

    /** The model this session last recorded, or `null` if it never did. */
    readSessionModel(sessionPath: string): string | null {
        try {
            const modelPath = path.join(sessionPath, 'session-model.txt');
            if (!fs.existsSync(modelPath)) {
                return null;
            }
            const model = fs.readFileSync(modelPath, 'utf-8').trim();
            return model.length > 0 ? model : null;
        } catch {
            return null;
        }
    },

    /**
     * Writes a readable default name to session-name.txt only if one does not already exist.
     * Uses workspace.yaml created_at if available, otherwise current date.
     * Never throws — safe to call in any lifecycle context.
     */
    ensureSessionName(sessionPath: string): void {
        try {
            const namePath = path.join(sessionPath, 'session-name.txt');
            if (fs.existsSync(namePath)) {
                return; // no-clobber
            }

            let date = new Date();
            const yamlPath = path.join(sessionPath, 'workspace.yaml');
            if (fs.existsSync(yamlPath)) {
                try {
                    const yamlContent = fs.readFileSync(yamlPath, 'utf-8');
                    const match = yamlContent.match(/^created_at:\s*(.+)$/m);
                    if (match) {
                        const parsed = new Date(match[1].trim());
                        if (!isNaN(parsed.getTime())) {
                            date = parsed;
                        }
                    }
                } catch { /* use current date */ }
            }

            const formatted = date.toLocaleString('en-US', {
                month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', hour12: true
            });
            fs.writeFileSync(namePath, `Session \u2013 ${formatted}`, 'utf-8');
        } catch { /* never throw */ }
    },

    /**
     * Formats a session label from session-name.txt, plan.md heading,
     * workspace.yaml summary, or falls back to 8-char session ID.
     * Priority: session-name.txt > plan.md heading > workspace.yaml summary > UUID prefix
     */
    formatSessionLabel(sessionId: string, sessionPath: string): string {
        try {
            // Highest priority: session-name.txt (written by /rename command)
            const namePath = path.join(sessionPath, 'session-name.txt');
            if (fs.existsSync(namePath)) {
                const name = fs.readFileSync(namePath, 'utf-8').trim();
                if (name) {
                    return name.substring(0, 40);
                }
            }

            // Second priority: plan.md heading
            const planPath = path.join(sessionPath, 'plan.md');
            if (fs.existsSync(planPath)) {
                const planContent = fs.readFileSync(planPath, 'utf-8');
                const lines = planContent.split('\n');
                for (const line of lines) {
                    if (line.startsWith('# ')) {
                        return line.substring(2).trim().substring(0, 40);
                    }
                }
            }

            // Third priority: workspace.yaml summary field
            const yamlPath = path.join(sessionPath, 'workspace.yaml');
            if (fs.existsSync(yamlPath)) {
                const content = fs.readFileSync(yamlPath, 'utf-8');
                const lines = content.split('\n');
                
                // Find summary: line (may be multiline with |- syntax)
                const summaryLineIdx = lines.findIndex((l: string) => l.startsWith('summary: '));
                if (summaryLineIdx !== -1) {
                    let summary = lines[summaryLineIdx].substring('summary: '.length).trim();
                    
                    // Handle multiline YAML (summary: |- or summary: |)
                    if (summary === '|-' || summary === '|') {
                        // Collect all indented lines that follow
                        const summaryLines: string[] = [];
                        for (let i = summaryLineIdx + 1; i < lines.length; i++) {
                            const line = lines[i];
                            // Stop if we hit a non-indented line (next YAML key)
                            if (line && !line.startsWith(' ') && !line.startsWith('\t')) {
                                break;
                            }
                            // Add indented lines (trim leading spaces)
                            if (line.trim()) {
                                summaryLines.push(line.trim());
                            }
                        }
                        summary = summaryLines.join(' ');
                    }
                    
                    // Strip [Active File: ...] prefix if present (added by messageEnhancementService)
                    summary = summary.replace(/^\[Active File:.*?\]\s*/s, '').trim();
                    
                    if (summary) {
                        return summary.substring(0, 40);
                    }
                }
            }
        } catch {
            // Ignore errors reading files
        }

        return sessionId.substring(0, 8);
    },

    /**
     * Forks a session by copying its directory to a new UUID.
     *
     * Copies all files from the source session directory to a new directory named
     * after a freshly-generated UUID. Patches the `session.start` event in the
     * new `events.jsonl` to reference the new session ID so the CLI accepts it.
     *
     * @param sourceSessionId - The session ID to fork from.
     * @param sessionStateDir - Path to the session-state directory (e.g. ~/.copilot/session-state).
     * @returns The new session ID.
     */
    forkSession(sourceSessionId: string, sessionStateDir: string): string {
        const sourceDir = path.join(sessionStateDir, sourceSessionId);
        const newId = randomUUID();
        const destDir = path.join(sessionStateDir, newId);

        fs.cpSync(sourceDir, destDir, { recursive: true });

        const eventsPath = path.join(destDir, 'events.jsonl');
        if (fs.existsSync(eventsPath)) {
            const content = fs.readFileSync(eventsPath, 'utf-8');
            const lines = content.split('\n');
            if (lines.length > 0 && lines[0].trim() !== '') {
                try {
                    const firstEvent = JSON.parse(lines[0]);
                    if (firstEvent.type === 'session.start' && firstEvent.data?.sessionId) {
                        firstEvent.data.sessionId = newId;
                        lines[0] = JSON.stringify(firstEvent);
                        fs.writeFileSync(eventsPath, lines.join('\n'), 'utf-8');
                    }
                } catch { /* malformed first line — leave as-is */ }
            }
        }

        SessionService.ensureSessionName(destDir);

        return newId;
    },

    /**
     * Determines which session to resume based on workspace and config.
     */
    determineSessionToResume(
        sessionStateDir: string,
        workspaceFolder: string,
        config: { filterSessionsByFolder: boolean }
    ): string | null {
        return SessionService.getMostRecentSession(
            sessionStateDir,
            workspaceFolder,
            config.filterSessionsByFolder
        );
    }
};
