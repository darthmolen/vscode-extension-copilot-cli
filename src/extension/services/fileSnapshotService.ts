import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '../../logger';

/**
 * File snapshot for tracking pre-edit state
 */
export interface FileSnapshot {
    toolCallId: string;
    originalPath: string;
    tempFilePath: string;
    existedBefore: boolean;
}

/**
 * Service for capturing and managing file snapshots before modifications.
 * 
 * Responsibilities:
 * - Capture file state before edit/create operations
 * - Create temporary copies for diff comparison
 * - Cleanup temporary files
 * - Manage snapshot storage
 */
export class FileSnapshotService {
    private logger: Logger;
    private fileSnapshots: Map<string, FileSnapshot> = new Map();
    private pendingByPath: Map<string, Omit<FileSnapshot, 'toolCallId'>> = new Map();
    private nextId = 0;
    private tempDir: string;

    constructor() {
        this.logger = Logger.getInstance();
        this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-cli-snapshots-'));
        this.logger.debug(`[FileSnapshot] Temp directory created: ${this.tempDir}`);
    }
    
    /**
     * Capture a snapshot of a file before modification.
     * Only captures for 'edit' and 'create' tools.
     * 
     * @param toolCallId Unique identifier for this tool execution
     * @param toolName Name of the tool being executed
     * @param args Tool arguments (must contain 'path')
     * @returns Snapshot object if captured, null otherwise
     */
    public captureFileSnapshot(toolCallId: string, toolName: string, args: any): FileSnapshot | null {
        // Only capture for edit and create tools
        if (toolName !== 'edit' && toolName !== 'create') {
            return null;
        }
        
        try {
            // Extract file path from arguments
            const filePath = (args as any)?.path;
            if (!filePath) {
                this.logger.debug(`[FileSnapshot] No path in ${toolName} tool arguments`);
                return null;
            }
            
            // Check if file exists before operation
            const existedBefore = fs.existsSync(filePath);
            
            let tempFilePath = '';
            
            if (existedBefore) {
                // Create temp file with original content
                const fileName = path.basename(filePath);
                const timestamp = Date.now();
                tempFilePath = path.join(this.tempDir, `${toolCallId}-${timestamp}-${fileName}`);
                
                // Copy original file to temp location
                fs.copyFileSync(filePath, tempFilePath);
                
                this.logger.info(`[FileSnapshot] Captured snapshot: ${filePath} -> ${tempFilePath}`);
            } else {
                // File doesn't exist yet - create empty temp file to represent "before" state
                // This allows VS Code diff to show the file as "created" instead of failing
                const fileName = path.basename(filePath);
                const timestamp = Date.now();
                tempFilePath = path.join(this.tempDir, `${toolCallId}-${timestamp}-${fileName}-empty`);
                
                // Create empty file to represent "no content before"
                fs.writeFileSync(tempFilePath, '', 'utf8');
                
                this.logger.info(`[FileSnapshot] File will be created (didn't exist before): ${filePath}`);
                this.logger.info(`[FileSnapshot] Created empty temp file for diff: ${tempFilePath}`);
            }
            
            // Store snapshot info
            const snapshot: FileSnapshot = {
                toolCallId,
                originalPath: filePath,
                tempFilePath,
                existedBefore
            };
            
            this.fileSnapshots.set(toolCallId, snapshot);
            return snapshot;
            
        } catch (error) {
            this.logger.error(`[FileSnapshot] Failed to capture snapshot: ${error}`);
            return null;
        }
    }
    
    /**
     * Capture a file snapshot keyed by file path (Phase 1 of two-phase correlation).
     * Called from onPreToolUse hook, BEFORE the SDK modifies the file.
     *
     * @param toolName Name of the tool ('edit' or 'create')
     * @param filePath Absolute path to the target file
     */
    public captureByPath(toolName: string, filePath: string): void {
        if (toolName !== 'edit' && toolName !== 'create') {
            return;
        }

        try {
            // Clean up previous pending snapshot for this path
            const previous = this.pendingByPath.get(filePath);
            if (previous && previous.tempFilePath && fs.existsSync(previous.tempFilePath)) {
                fs.unlinkSync(previous.tempFilePath);
            }

            const existedBefore = fs.existsSync(filePath);
            const fileName = path.basename(filePath);
            const uniqueId = `${Date.now()}-${this.nextId++}`;
            let tempFilePath: string;

            if (existedBefore) {
                tempFilePath = path.join(this.tempDir, `pending-${uniqueId}-${fileName}`);
                fs.copyFileSync(filePath, tempFilePath);
                this.logger.info(`[FileSnapshot] Pre-hook snapshot: ${filePath} -> ${tempFilePath}`);
            } else {
                tempFilePath = path.join(this.tempDir, `pending-${uniqueId}-${fileName}-empty`);
                fs.writeFileSync(tempFilePath, '', 'utf8');
                this.logger.info(`[FileSnapshot] Pre-hook snapshot (new file): ${filePath}`);
            }

            this.pendingByPath.set(filePath, {
                originalPath: filePath,
                tempFilePath,
                existedBefore
            });
        } catch (error) {
            this.logger.error(`[FileSnapshot] Failed to capture pre-hook snapshot: ${error}`);
        }
    }

    /**
     * Get a pending snapshot by file path (for testing/inspection).
     */
    public getPendingByPath(filePath: string): Omit<FileSnapshot, 'toolCallId'> | null {
        return this.pendingByPath.get(filePath) || null;
    }

    /**
     * Re-key a pending snapshot from file path to toolCallId (Phase 2).
     * Called from handleToolStart when tool.execution_start fires with toolCallId.
     *
     * @param filePath File path used as key in Phase 1
     * @param toolCallId Tool call ID from execution_start event
     */
    public correlateToToolCallId(filePath: string, toolCallId: string): void {
        const pending = this.pendingByPath.get(filePath);
        if (pending) {
            this.fileSnapshots.set(toolCallId, {
                toolCallId,
                ...pending
            });
            this.pendingByPath.delete(filePath);
            this.logger.debug(`[FileSnapshot] Correlated ${filePath} -> ${toolCallId}`);
        }
    }

    /**
     * Get a snapshot by tool call ID.
     *
     * @param toolCallId Tool call identifier
     * @returns Snapshot if found, null otherwise
     */
    public getSnapshot(toolCallId: string): FileSnapshot | null {
        return this.fileSnapshots.get(toolCallId) || null;
    }
    
    /**
     * Cleanup a specific snapshot.
     * Deletes the temporary file and removes from tracking.
     * 
     * @param toolCallId Tool call identifier
     */
    public cleanupSnapshot(toolCallId: string): void {
        const snapshot = this.fileSnapshots.get(toolCallId);
        if (snapshot) {
            try {
                if (snapshot.tempFilePath && fs.existsSync(snapshot.tempFilePath)) {
                    fs.unlinkSync(snapshot.tempFilePath);
                    this.logger.debug(`[FileSnapshot] Deleted temp file: ${snapshot.tempFilePath}`);
                }
                this.fileSnapshots.delete(toolCallId);
                this.logger.debug(`[FileSnapshot] Cleaned up snapshot for ${toolCallId}`);
            } catch (error) {
                this.logger.error(`[FileSnapshot] Failed to cleanup snapshot: ${error}`);
            }
        }
    }
    
    /**
     * Cleanup all snapshots.
     * Deletes all temporary files and clears tracking.
     */
    public cleanupAllSnapshots(): void {
        for (const [toolCallId] of this.fileSnapshots) {
            this.cleanupSnapshot(toolCallId);
        }
        // Also clean up any uncorrelated pending snapshots
        for (const [filePath, pending] of this.pendingByPath) {
            try {
                if (pending.tempFilePath && fs.existsSync(pending.tempFilePath)) {
                    fs.unlinkSync(pending.tempFilePath);
                }
            } catch (error) {
                this.logger.error(`[FileSnapshot] Failed to cleanup pending snapshot for ${filePath}: ${error}`);
            }
        }
        this.pendingByPath.clear();
        this.logger.debug('[FileSnapshot] Cleaned up all snapshots');
    }
    
    /**
     * Create a temporary snapshot file with provided content.
     * Used for custom tools that need BEFORE state without a file path.
     */
    public createTempSnapshot(content: string, baseName: string): string {
        const uniqueName = `${this.nextId++}-${baseName}`;
        const tempPath = path.join(this.tempDir, uniqueName);
        fs.writeFileSync(tempPath, content, 'utf-8');
        this.logger.debug(`[FileSnapshot] Temp snapshot created: ${tempPath}`);
        return tempPath;
    }

    /**
     * Cleanup a temporary file path (best-effort).
     */
    public cleanupTempFile(tempPath: string): void {
        try {
            if (tempPath && fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
                this.logger.debug(`[FileSnapshot] Cleaned up: ${tempPath}`);
            }
        } catch (error) {
            this.logger.warn(`[FileSnapshot] Cleanup failed: ${tempPath}`, error instanceof Error ? error : undefined);
        }
    }

    /**
     * Get the temp directory used for snapshots.
     */
    public getTempDir(): string {
        return this.tempDir;
    }

    /**
     * Dispose of the service.
     * Cleanup all snapshots and remove temp directory.
     */
    public dispose(): void {
        this.cleanupAllSnapshots();
        
        // Remove temp directory
        try {
            if (fs.existsSync(this.tempDir)) {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
                this.logger.debug(`[FileSnapshot] Removed temp directory: ${this.tempDir}`);
            }
        } catch (error) {
            this.logger.warn(`[FileSnapshot] Failed to remove temp directory: ${error}`);
        }
    }
}
