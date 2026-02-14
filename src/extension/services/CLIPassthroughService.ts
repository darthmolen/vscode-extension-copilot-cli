/**
 * CLI Passthrough Service
 * Opens VS Code integrated terminal with Copilot CLI for commands we don't handle
 */

export class CLIPassthroughService {
    private vscode: any;
    private currentTerminal: any = null;

    constructor(vscode?: any) {
        // Runtime check for VS Code availability (enables testing)
        if (typeof vscode !== 'undefined') {
            this.vscode = vscode;
        } else if (vscode) {
            this.vscode = vscode;
        }
    }

    /**
     * Get instruction message for a specific command
     */
    public getInstructionMessage(command: string): string {
        const instructions: Record<string, string> = {
            'delegate': 'The `/delegate` command opens GitHub Copilot coding agent in a new PR. Opening terminal...',
            'agent': 'The `/agent` command lets you select specialized agents (refactoring, code-review, etc.). Opening terminal...',
            'skills': 'The `/skills` command manages custom scripts and resources. Opening terminal...',
            'plugin': 'The `/plugin` command installs extensions from the marketplace. Opening terminal...',
            'login': 'Opening terminal to authenticate with GitHub Copilot...',
            'logout': 'Opening terminal to log out of GitHub Copilot...'
        };

        return instructions[command] || 'Opening Copilot CLI in terminal...';
    }

    /**
     * Open Copilot CLI in integrated terminal
     * @param fullCommand - Full slash command with arguments (e.g., "/delegate my task")
     * @param sessionId - Current SDK session ID
     * @param workspacePath - Current workspace path
     * @returns Result with success status and instruction message
     */
    public openCLI(
        fullCommand: string,
        sessionId: string | null,
        workspacePath: string | null
    ): { success: boolean; instruction?: string; error?: string } {
        try {
            // Validate inputs
            if (!sessionId) {
                return {
                    success: false,
                    error: 'sessionId is required'
                };
            }

            if (!workspacePath) {
                return {
                    success: false,
                    error: 'workspacePath is required'
                };
            }

            // Extract command name for instruction
            const commandName = fullCommand.replace(/^\//, '').split(' ')[0];
            const instruction = this.getInstructionMessage(commandName);

            // Reuse or create terminal
            if (!this.currentTerminal) {
                this.currentTerminal = this.vscode.window.createTerminal({
                    name: 'Copilot CLI',
                    cwd: workspacePath
                });
            }

            // Show terminal
            this.currentTerminal.show();

            // Send base command with --resume flag
            this.currentTerminal.sendText(`copilot --resume ${sessionId}`);

            // Send the slash command
            this.currentTerminal.sendText(fullCommand);

            return {
                success: true,
                instruction
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message || 'Failed to open CLI terminal'
            };
        }
    }
}
