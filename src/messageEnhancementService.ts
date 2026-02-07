import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from './logger';

/**
 * Service for enhancing user messages with contextual information.
 * 
 * Responsibilities:
 * - Inject active file context into messages
 * - Include selected text when applicable
 * - Resolve @file references to actual file paths
 * - Track the last active text editor (for webview focus issue)
 */
export class MessageEnhancementService {
    private logger: Logger;
    private lastActiveTextEditor: vscode.TextEditor | undefined = undefined;
    private activeEditorDisposable: vscode.Disposable | undefined = undefined;
    
    constructor() {
        this.logger = Logger.getInstance();
        
        // Track active text editor (needed when webview has focus)
        // Filter initial value by scheme to avoid output channels
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && (activeEditor.document.uri.scheme === 'file' || activeEditor.document.uri.scheme === 'untitled')) {
            this.lastActiveTextEditor = activeEditor;
        }
        this.activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && (editor.document.uri.scheme === 'file' || editor.document.uri.scheme === 'untitled')) {
                this.lastActiveTextEditor = editor;
            }
        });
    }
    
    /**
     * Enhance a user message with contextual information.
     * 
     * @param message The original user message
     * @returns Enhanced message with context prepended
     */
    public async enhanceMessageWithContext(message: string): Promise<string> {
        this.logger.debug('[Enhance] Starting message enhancement...');
        
        const config = vscode.workspace.getConfiguration('copilotCLI');
        const includeActiveFile = config.get<boolean>('includeActiveFile', true);
        const resolveFileReferences = config.get<boolean>('resolveFileReferences', true);
        
        this.logger.debug(`[Enhance] includeActiveFile config: ${includeActiveFile}`);
        this.logger.debug(`[Enhance] resolveFileReferences config: ${resolveFileReferences}`);
        
        const parts: string[] = [];
        
        // Add active file context if enabled and there's an active editor
        if (includeActiveFile) {
            // Use lastActiveTextEditor instead of vscode.window.activeTextEditor
            // because activeTextEditor is null when webview has focus
            const activeEditor = this.lastActiveTextEditor;
            this.logger.debug(`[Enhance] activeEditor (lastActive): ${activeEditor ? activeEditor.document.uri.fsPath : 'null'}`);
            
            if (activeEditor) {
                const document = activeEditor.document;
                const relativePath = vscode.workspace.asRelativePath(document.uri);
                const selection = activeEditor.selection;
                
                parts.push(`[Active File: ${relativePath}]`);
                this.logger.debug(`[Enhance] Added active file context: ${relativePath}`);
                
                // If there's a selection, include it
                if (!selection.isEmpty) {
                    const selectedText = document.getText(selection);
                    const startLine = selection.start.line + 1;
                    const endLine = selection.end.line + 1;
                    parts.push(`[Selected lines ${startLine}-${endLine}]:\n\`\`\`\n${selectedText}\n\`\`\``);
                    this.logger.debug(`[Enhance] Added selection context: lines ${startLine}-${endLine}`);
                }
            }
        }
        
        // Process @file_name references if enabled
        const processedMessage = resolveFileReferences 
            ? await this.processFileReferences(message)
            : message;
        
        this.logger.debug(`[Enhance] parts array length: ${parts.length}`);
        
        // Combine context with the message
        if (parts.length > 0) {
            const enhanced = `${parts.join('\n')}\n\n${processedMessage}`;
            this.logger.debug(`[Enhance] Final enhanced message (first 200 chars): ${enhanced.substring(0, 200)}`);
            return enhanced;
        }
        
        this.logger.debug(`[Enhance] No enhancement applied, returning original message`);
        return processedMessage;
    }
    
    /**
     * Processes @file_name references in the message.
     * Resolves them to relative paths from workspace root.
     * 
     * @param message Message potentially containing @file references
     * @returns Message with @file references resolved to paths
     */
    private async processFileReferences(message: string): Promise<string> {
        // Match @filename patterns (handles paths with /,\,., -, _)
        const fileRefPattern = /@([\w\-._/\\]+\.\w+)/g;
        let processedMessage = message;
        const matches = Array.from(message.matchAll(fileRefPattern));
        
        for (const match of matches) {
            const fileName = match[1];
            const fullMatch = match[0];
            
            try {
                // Try to find the file in the workspace
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    continue;
                }
                
                // Check if it's already a valid path
                let fileUri: vscode.Uri | null = null;
                
                // Try as relative path from workspace root
                const rootPath = workspaceFolders[0].uri.fsPath;
                const absolutePath = path.isAbsolute(fileName) 
                    ? fileName 
                    : path.join(rootPath, fileName);
                
                if (fs.existsSync(absolutePath)) {
                    fileUri = vscode.Uri.file(absolutePath);
                } else {
                    // Try to find the file using workspace findFiles
                    const pattern = `**/${fileName}`;
                    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 1);
                    if (files.length > 0) {
                        fileUri = files[0];
                    }
                }
                
                if (fileUri) {
                    const relativePath = vscode.workspace.asRelativePath(fileUri);
                    // Replace @file with the relative path
                    processedMessage = processedMessage.replace(fullMatch, relativePath);
                    this.logger.info(`Resolved ${fullMatch} to ${relativePath}`);
                }
            } catch (error) {
                this.logger.warn(`Failed to resolve file reference ${fullMatch}: ${error}`);
            }
        }
        
        return processedMessage;
    }
    
    /**
     * Get the last active text editor (for external inspection/testing)
     */
    public getLastActiveTextEditor(): vscode.TextEditor | undefined {
        return this.lastActiveTextEditor;
    }
    
    /**
     * Clean up resources
     */
    public dispose(): void {
        this.activeEditorDisposable?.dispose();
    }
}
