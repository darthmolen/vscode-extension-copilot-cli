/**
 * Handles not-supported slash commands
 * 
 * These are CLI-specific commands that don't apply to the extension context.
 * 
 * MINIMAL IMPLEMENTATION - just enough to pass tests
 */
export class NotSupportedSlashHandlers {
    async handleNotSupported(commandName: string): Promise<{ success: boolean; content?: string; error?: string }> {
        try {
            const command = commandName ? `/${commandName}` : 'This command';
            
            const content = `# Command Not Supported\n\n` +
                `The ${command} command is not available in this extension.\n\n` +
                `This is a CLI-specific command that doesn't apply to the VS Code extension context.\n\n` +
                `**Supported commands**: Type /help to see available commands.`;

            return {
                success: true,
                content
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Failed to generate not-supported message: ${error.message}`
            };
        }
    }
}
