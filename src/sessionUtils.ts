import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './logger';

export interface SessionInfo {
    id: string;
    cwd?: string;
    mtime: number;
}

/**
 * Reads the working directory (cwd) from a session's events.jsonl file.
 * The first line of events.jsonl is always a session.start event containing context.cwd.
 * 
 * @param sessionId The session ID (directory name)
 * @returns The working directory path, or undefined if not found/readable
 */
export function getSessionCwd(sessionId: string): string | undefined {
    const logger = Logger.getInstance();
    
    try {
        const eventsPath = path.join(os.homedir(), '.copilot', 'session-state', sessionId, 'events.jsonl');
        
        if (!fs.existsSync(eventsPath)) {
            logger.debug(`No events.jsonl found for session ${sessionId}`);
            return undefined;
        }
        
        // Read only the first ~2KB (first line) for performance
        const fd = fs.openSync(eventsPath, 'r');
        const buffer = Buffer.alloc(2048);
        const bytesRead = fs.readSync(fd, buffer, 0, 2048, 0);
        fs.closeSync(fd);
        
        const firstLine = buffer.toString('utf8', 0, bytesRead).split('\n')[0];
        
        if (!firstLine) {
            logger.debug(`Empty events.jsonl for session ${sessionId}`);
            return undefined;
        }
        
        const event = JSON.parse(firstLine);
        
        if (event.type === 'session.start' && event.data?.context?.cwd) {
            return event.data.context.cwd;
        }
        
        logger.debug(`No cwd found in session.start event for ${sessionId}`);
        return undefined;
        
    } catch (error) {
        logger.debug(`Failed to read cwd from session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

/**
 * Gets all sessions with their metadata (id, cwd, mtime).
 * Only returns sessions that have a valid events.jsonl file.
 * 
 * @returns Array of session info objects
 */
export function getAllSessions(): SessionInfo[] {
    const logger = Logger.getInstance();
    
    try {
        const sessionDir = path.join(os.homedir(), '.copilot', 'session-state');
        
        if (!fs.existsSync(sessionDir)) {
            return [];
        }
        
        return fs.readdirSync(sessionDir)
            .filter(name => {
                const fullPath = path.join(sessionDir, name);
                if (!fs.statSync(fullPath).isDirectory()) {
                    return false;
                }
                
                // Validate that events.jsonl exists
                const eventsPath = path.join(fullPath, 'events.jsonl');
                if (!fs.existsSync(eventsPath)) {
                    logger.debug(`Skipping session ${name}: no events.jsonl found`);
                    return false;
                }
                
                return true;
            })
            .map(name => {
                const fullPath = path.join(sessionDir, name);
                return {
                    id: name,
                    cwd: getSessionCwd(name),
                    mtime: fs.statSync(fullPath).mtime.getTime()
                };
            });
            
    } catch (error) {
        logger.error('Failed to get sessions list', error instanceof Error ? error : undefined);
        return [];
    }
}

/**
 * Filters sessions by matching workspace folder.
 * 
 * @param sessions Array of session info objects
 * @param workspaceFolder The workspace folder path to match
 * @returns Filtered array of sessions matching the workspace folder
 */
export function filterSessionsByFolder(sessions: SessionInfo[], workspaceFolder: string): SessionInfo[] {
    const logger = Logger.getInstance();
    
    // Normalize the workspace folder path for comparison
    const normalizedWorkspace = path.normalize(workspaceFolder);
    
    const filtered = sessions.filter(session => {
        if (!session.cwd) {
            return false; // Skip sessions without cwd (treat as no match)
        }
        
        const normalizedCwd = path.normalize(session.cwd);
        return normalizedCwd === normalizedWorkspace;
    });
    
    logger.debug(`Filtered ${sessions.length} sessions to ${filtered.length} matching folder: ${workspaceFolder}`);
    
    return filtered;
}

/**
 * Gets the most recent session for a given workspace folder.
 * Falls back to most recent global session if no folder-specific sessions exist.
 * 
 * @param workspaceFolder The workspace folder path to match
 * @param filterByFolder Whether to filter by folder (from config)
 * @returns Session ID or null if no sessions exist
 */
export function getMostRecentSession(workspaceFolder: string, filterByFolder: boolean): string | null {
    const logger = Logger.getInstance();
    const allSessions = getAllSessions();
    
    if (allSessions.length === 0) {
        logger.info('No sessions found');
        return null;
    }
    
    // Sort by modification time (most recent first)
    const sortedSessions = allSessions.sort((a, b) => b.mtime - a.mtime);
    
    if (!filterByFolder) {
        logger.info(`Folder filtering disabled, using most recent session: ${sortedSessions[0].id}`);
        return sortedSessions[0].id;
    }
    
    // Try to find folder-specific session
    const folderSessions = filterSessionsByFolder(sortedSessions, workspaceFolder);
    
    if (folderSessions.length > 0) {
        logger.info(`Using most recent folder-specific session: ${folderSessions[0].id}`);
        return folderSessions[0].id;
    }
    
    // Fallback to most recent global session
    logger.info(`No folder-specific sessions found, using most recent global session: ${sortedSessions[0].id}`);
    return sortedSessions[0].id;
}
