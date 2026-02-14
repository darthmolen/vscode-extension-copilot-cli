import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

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
 * - Session history loading (loadSessionHistory)
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
     */
    getMostRecentSession(sessionStateDir: string, workspaceFolder: string, filterByFolder: boolean): string | null {
        const allSessions = SessionService.getAllSessions(sessionStateDir);
        if (allSessions.length === 0) {
            return null;
        }

        const sorted = allSessions.sort((a, b) => b.mtime - a.mtime);

        if (!filterByFolder) {
            return sorted[0].id;
        }

        const folderSessions = SessionService.filterSessionsByFolder(sorted, workspaceFolder);
        if (folderSessions.length > 0) {
            return folderSessions[0].id;
        }

        // Fallback to global most recent
        return sorted[0].id;
    },

    /**
     * Formats a session label from plan.md heading, falling back to 8-char session ID.
     */
    formatSessionLabel(sessionId: string, sessionPath: string): string {
        try {
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
        } catch {
            // Ignore errors reading plan
        }

        return sessionId.substring(0, 8);
    },

    /**
     * Loads user and assistant messages from an events.jsonl file.
     * Returns a fresh array each call (no accumulation).
     */
    loadSessionHistory(eventsPath: string): Promise<SessionMessage[]> {
        return new Promise((resolve) => {
            if (!fs.existsSync(eventsPath)) {
                resolve([]);
                return;
            }

            const messages: SessionMessage[] = [];
            const fileStream = fs.createReadStream(eventsPath);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity
            });

            rl.on('line', (line: string) => {
                try {
                    const event = JSON.parse(line);
                    if (event.type === 'user.message' && event.data?.content) {
                        messages.push({
                            role: 'user',
                            content: event.data.content,
                            timestamp: event.timestamp
                        });
                    } else if (event.type === 'assistant.message' && event.data?.content) {
                        const content = event.data.content;
                        if (content && typeof content === 'string') {
                            messages.push({
                                role: 'assistant',
                                content,
                                timestamp: event.timestamp
                            });
                        }
                    }
                } catch {
                    // Skip malformed lines
                }
            });

            rl.on('close', () => {
                resolve(messages);
            });

            rl.on('error', () => {
                resolve(messages);
            });
        });
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
