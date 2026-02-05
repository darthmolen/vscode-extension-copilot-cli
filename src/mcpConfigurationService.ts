import { Logger } from './logger';

/**
 * Service for MCP (Model Context Protocol) server configuration.
 * 
 * Responsibilities:
 * - Read MCP server configuration from VS Code settings
 * - Filter enabled servers
 * - Expand ${workspaceFolder} variables in configuration
 * - Prepare configuration for SDK consumption
 */
export class MCPConfigurationService {
    private logger: Logger;
    private workingDirectory: string;
    
    constructor(workingDirectory: string) {
        this.logger = Logger.getInstance();
        this.workingDirectory = workingDirectory;
    }
    
    /**
     * Recursively expand ${workspaceFolder} variables in configuration.
     * 
     * @param obj Any value (string, object, array, primitive)
     * @returns Same structure with variables expanded
     */
    public expandVariables(obj: any): any {
        if (typeof obj === 'string') {
            const expanded = obj.replace(/\$\{workspaceFolder\}/g, this.workingDirectory);
            if (expanded !== obj) {
                this.logger.debug(`[MCP] Expanded: "${obj}" -> "${expanded}"`);
            }
            return expanded;
        } else if (Array.isArray(obj)) {
            return obj.map(item => this.expandVariables(item));
        } else if (obj && typeof obj === 'object') {
            const expanded: any = {};
            for (const [key, value] of Object.entries(obj)) {
                expanded[key] = this.expandVariables(value);
            }
            return expanded;
        }
        return obj;
    }
    
    /**
     * Get enabled MCP servers from configuration.
     * Filters out servers with enabled: false and expands variables.
     * 
     * @param mcpConfig Raw MCP configuration object
     * @returns Filtered and expanded server configurations
     */
    public getEnabledMCPServers(mcpConfig: Record<string, any>): Record<string, any> {
        const enabled: Record<string, any> = {};
        
        for (const [name, config] of Object.entries(mcpConfig)) {
            if (config && config.enabled !== false) {
                // Remove the 'enabled' field before passing to SDK
                const { enabled: _, ...serverConfig } = config;
                
                // Expand ${workspaceFolder} variables
                const expandedConfig = this.expandVariables(serverConfig);
                enabled[name] = expandedConfig;
            }
        }
        
        if (Object.keys(enabled).length > 0) {
            this.logger.info(`[MCP] Servers configured: ${Object.keys(enabled).join(', ')}`);
        }
        
        return enabled;
    }
}
