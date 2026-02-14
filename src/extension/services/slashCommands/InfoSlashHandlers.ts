/**
 * Handles info slash commands: /mcp, /usage, /help
 * 
 * MINIMAL IMPLEMENTATION - just enough to pass tests
 */
export class InfoSlashHandlers {
    constructor(private mcpConfig: any, private backendState: any) {}

    async handleMcp(): Promise<{ success: boolean; content?: string; error?: string }> {
        try {
            const config = this.mcpConfig.getConfig();
            
            if (!config || Object.keys(config).length === 0) {
                return {
                    success: true,
                    content: 'No MCP servers configured.\n\nMCP (Model Context Protocol) allows you to connect external tools and data sources.\n\nConfigure servers in your Copilot settings.'
                };
            }

            const formattedConfig = JSON.stringify(config, null, 2);
            const serverCount = Object.keys(config).length;

            const content = `# MCP Server Configuration\n\n${serverCount} server(s) configured:\n\n\`\`\`json\n${formattedConfig}\n\`\`\``;

            return {
                success: true,
                content
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Failed to load MCP configuration: ${error.message}`
            };
        }
    }

    async handleUsage(): Promise<{ success: boolean; content?: string; error?: string }> {
        try {
            const sessionStartTime = this.backendState.getSessionStartTime();

            if (!sessionStartTime) {
                return {
                    success: true,
                    content: 'No active session.\n\nStart a conversation to track usage metrics.'
                };
            }

            const now = Date.now();
            // sessionStartTime is a number (timestamp), not a Date object
            const durationMs = now - sessionStartTime;
            const durationMinutes = Math.floor(durationMs / 1000 / 60);
            const durationSeconds = Math.floor((durationMs / 1000) % 60);

            const messageCount = this.backendState.getMessageCount();
            const toolCallCount = this.backendState.getToolCallCount();

            // Convert timestamp to Date for formatting
            const startDate = new Date(sessionStartTime);
            const content = `# Session Usage\n\n` +
                `**Started**: ${startDate.toLocaleString()}\n` +
                `**Duration**: ${durationMinutes}m ${durationSeconds}s\n` +
                `**Messages sent**: ${messageCount}\n` +
                `**Tool calls**: ${toolCallCount}\n`;

            return {
                success: true,
                content
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Failed to load usage metrics: ${error.message}`
            };
        }
    }

    async handleHelp(commandName?: string): Promise<{ success: boolean; content?: string; error?: string }> {
        try {
            if (commandName) {
                // Show help for specific command
                const helpText = this.getCommandHelp(commandName);
                if (!helpText) {
                    return {
                        success: false,
                        error: `Unknown command: /${commandName}\n\nType /help to see all available commands.`
                    };
                }
                return {
                    success: true,
                    content: helpText
                };
            }

            // Show all commands
            const content = `# Available Commands\n\n` +
                `## Plan Mode\n` +
                `- \`/plan\` - Enter plan mode\n` +
                `- \`/exit\` - Exit plan mode\n` +
                `- \`/accept\` - Accept plan\n` +
                `- \`/reject\` - Reject plan\n\n` +
                `## Code & Review\n` +
                `- \`/review\` - Show plan.md content\n` +
                `- \`/diff <file1> <file2>\` - Open diff viewer\n\n` +
                `## Configuration\n` +
                `- \`/mcp\` - Show MCP server config\n` +
                `- \`/usage\` - Show session metrics\n` +
                `- \`/help [command]\` - Show this help\n\n` +
                `## CLI Passthrough\n` +
                `- \`/delegate [task]\` - Push to GitHub coding agent\n` +
                `- \`/agent\` - Select custom agents\n` +
                `- \`/skills\` - Manage skills\n` +
                `- \`/plugin\` - Manage plugins\n` +
                `- \`/login\` - Authenticate with GitHub\n` +
                `- \`/logout\` - Log out\n\n` +
                `Type /help <command> for details on a specific command.`;

            return {
                success: true,
                content
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Failed to load help: ${error.message}`
            };
        }
    }

    private getCommandHelp(commandName: string): string | null {
        const helpTexts: Record<string, string> = {
            plan: `# /plan - Enter Plan Mode\n\nUsage: \`/plan\`\n\nEnters planning mode where you can design and document your implementation approach before writing code.\n\nExample: \`/plan\``,
            exit: `# /exit - Exit Plan Mode\n\nUsage: \`/exit\`\n\nExits plan mode and returns to work mode.\n\nExample: \`/exit\``,
            accept: `# /accept - Accept Plan\n\nUsage: \`/accept\`\n\nAccepts the current plan and switches to work mode for implementation.\n\nExample: \`/accept\``,
            reject: `# /reject - Reject Plan\n\nUsage: \`/reject\`\n\nRejects the current plan and stays in plan mode to revise.\n\nExample: \`/reject\``,
            review: `# /review - Show Plan Content\n\nUsage: \`/review\`\n\nDisplays the current plan.md file content from your session. If no plan exists, shows a friendly message.\n\nExample: \`/review\``,
            diff: `# /diff - Open Diff Viewer\n\nUsage: \`/diff <file1> <file2>\`\n\nOpens VS Code's diff viewer to compare two files side-by-side.\n\nExample: \`/diff src/old.ts src/new.ts\``,
            mcp: `# /mcp - Show MCP Configuration\n\nUsage: \`/mcp\`\n\nDisplays the Model Context Protocol (MCP) server configuration, showing active servers and their tools.\n\nExample: \`/mcp\``,
            usage: `# /usage - Show Session Metrics\n\nUsage: \`/usage\`\n\nDisplays session statistics including start time, duration, message count, and tool calls.\n\nExample: \`/usage\``,
            help: `# /help - Command Help\n\nUsage: \`/help [command]\`\n\nShows this help message. Optionally specify a command name for detailed help.\n\nExamples:\n- \`/help\` - Show all commands\n- \`/help review\` - Show help for /review`,
            delegate: `# /delegate - GitHub Coding Agent\n\nUsage: \`/delegate [task]\`\n\nOpens GitHub Copilot coding agent in a terminal to create a PR on GitHub.\n\nExample: \`/delegate fix the authentication bug\``,
            agent: `# /agent - Custom Agents\n\nUsage: \`/agent\`\n\nOpens a terminal to browse and select specialized agents (refactoring, code-review, etc.).\n\nExample: \`/agent\``,
            skills: `# /skills - Manage Skills\n\nUsage: \`/skills [list|info|add|remove|reload]\`\n\nOpens a terminal to manage custom scripts and resources.\n\nExample: \`/skills list\``,
            plugin: `# /plugin - Manage Plugins\n\nUsage: \`/plugin [marketplace|install|uninstall|update|list]\`\n\nOpens a terminal to install extensions from the marketplace.\n\nExample: \`/plugin list\``,
            login: `# /login - Authenticate\n\nUsage: \`/login\`\n\nOpens a terminal to authenticate with GitHub Copilot (supports enterprise SSO).\n\nExample: \`/login\``,
            logout: `# /logout - Log Out\n\nUsage: \`/logout\`\n\nOpens a terminal to log out of GitHub Copilot.\n\nExample: \`/logout\``
        };

        return helpTexts[commandName] || null;
    }
}
