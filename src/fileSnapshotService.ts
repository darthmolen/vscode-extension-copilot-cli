import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from './logger';

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
        this.logger.debug('[FileSnapshot] Cleaned up all snapshots');
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
