import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { CustomAgentDefinition } from '../../shared/models';
import { Logger } from '../../logger';

export type ParseResult =
    | { kind: 'success'; agent: CustomAgentDefinition }
    | { kind: 'error'; message: string };

/** Options injected for testing (override homeDir). */
export interface AgentFileServiceOptions {
    homeDir?: string;
}

/**
 * File-based storage for custom agents.
 *
 * Agents are stored as `.md` files with YAML frontmatter:
 *
 *   ~/.copilot/agents/          — global (all workspaces)
 *   <workspace>/.copilot/agents/ — project scope (per-repo)
 *
 * Project-scoped agents win on name collision.
 */
export class AgentFileService {
    private readonly logger = Logger.getInstance();
    private readonly homeDir: string;

    constructor(options?: AgentFileServiceOptions) {
        this.homeDir = options?.homeDir ?? os.homedir();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Parsing
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Parse a single agent `.md` file into a `CustomAgentDefinition`.
     *
     * Format:
     *   ---
     *   name: my-agent   (required)
     *   displayName: My Agent
     *   description: What it does
     *   model: haiku
     *   tools: view, grep   (comma-sep string OR YAML array)
     *   ---
     *
     *   System prompt body (markdown)
     *
     * Using anchored regex to correctly handle `---` horizontal rules in body.
     */
    parseAgentFile(filePath: string): ParseResult {
        let raw: string;
        try {
            raw = fs.readFileSync(filePath, 'utf-8');
        } catch (e) {
            return { kind: 'error', message: `Cannot read file ${filePath}: ${e instanceof Error ? e.message : String(e)}` };
        }

        // Anchored at file start — matches opening `---`, captures frontmatter YAML, then body.
        // Handles CRLF (\r\n) and `---` horizontal rules inside the body.
        const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
        if (!match) {
            return { kind: 'error', message: `No valid frontmatter in ${filePath}` };
        }

        const [, frontmatterYaml, rawBody] = match;
        let fm: Record<string, unknown>;
        try {
            fm = (yaml.load(frontmatterYaml) as Record<string, unknown>) ?? {};
        } catch (e) {
            return { kind: 'error', message: `YAML parse error in ${filePath}: ${e instanceof Error ? e.message : String(e)}` };
        }

        const name = typeof fm['name'] === 'string' ? fm['name'].trim() : '';
        if (!name) {
            return { kind: 'error', message: `Frontmatter 'name' is required in ${filePath}` };
        }

        const prompt = rawBody.trim();

        const agent: CustomAgentDefinition = {
            name,
            prompt,
        };

        if (typeof fm['displayName'] === 'string') { agent.displayName = fm['displayName']; }
        if (typeof fm['description'] === 'string') { agent.description = fm['description']; }
        if (typeof fm['model'] === 'string') { agent.model = fm['model']; }

        // Normalize tools: string (comma-sep) or YAML array
        if (fm['tools'] !== undefined && fm['tools'] !== null) {
            if (typeof fm['tools'] === 'string') {
                agent.tools = fm['tools'].split(',').map((t: string) => t.trim()).filter(Boolean);
            } else if (Array.isArray(fm['tools'])) {
                agent.tools = (fm['tools'] as unknown[]).map(String);
            }
        }

        return { kind: 'success', agent };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Directory resolution
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Return the list of agent directories to search, in priority order:
     * [global, project].
     */
    getAgentDirs(workspaceRoot?: string): string[] {
        const dirs: string[] = [path.join(this.homeDir, '.copilot', 'agents')];
        if (workspaceRoot) {
            dirs.push(path.join(workspaceRoot, '.copilot', 'agents'));
        }
        return dirs;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scanning
    // ──────────────────────────────────────────────────────────────────────────

    /** Read all `.md` files from `dir`, skip non-existent dirs and parse errors. */
    scanDirectory(dir: string, scope?: 'global' | 'project'): CustomAgentDefinition[] {
        if (!fs.existsSync(dir)) { return []; }
        const agents: CustomAgentDefinition[] = [];
        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch (e) {
            this.logger.warn(`[AgentFileService] Cannot read directory ${dir}: ${e instanceof Error ? e.message : String(e)}`);
            return [];
        }

        for (const entry of entries) {
            if (!entry.endsWith('.md')) { continue; }
            const filePath = path.join(dir, entry);
            const result = this.parseAgentFile(filePath);
            if (result.kind === 'error') {
                this.logger.warn(`[AgentFileService] Skipping ${filePath}: ${result.message}`);
                continue;
            }
            if (scope) { result.agent.scope = scope; }
            agents.push(result.agent);
        }
        return agents;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Public API
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Return all agents from global + project dirs.
     * Project agents win on name collision.
     */
    getAll(workspaceRoot?: string): CustomAgentDefinition[] {
        const [globalDir, projectDir] = this.getAgentDirs(workspaceRoot);
        const globalAgents = this.scanDirectory(globalDir, 'global');
        const projectAgents = projectDir ? this.scanDirectory(projectDir, 'project') : [];

        // Merge: start with global, project overrides on name collision
        const byName = new Map<string, CustomAgentDefinition>();
        for (const a of globalAgents) { byName.set(a.name, a); }
        for (const a of projectAgents) { byName.set(a.name, a); }
        return Array.from(byName.values());
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Serialization
    // ──────────────────────────────────────────────────────────────────────────

    /** Serialize a `CustomAgentDefinition` to frontmatter + body markdown. */
    serializeAgent(agent: CustomAgentDefinition): string {
        const fm: Record<string, unknown> = { name: agent.name };
        if (agent.displayName !== undefined) { fm['displayName'] = agent.displayName; }
        if (agent.description !== undefined) { fm['description'] = agent.description; }
        if (agent.model !== undefined) { fm['model'] = agent.model; }
        if (agent.tools !== undefined && agent.tools !== null) {
            fm['tools'] = agent.tools.join(', ');
        }
        // Never serialize builtIn or scope — those are runtime-only

        const frontmatter = yaml.dump(fm, { lineWidth: -1 });
        return `---\n${frontmatter}---\n\n${agent.prompt}`;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Write / Delete
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Write an agent definition to disk.
     *
     * @param agent       The agent to save
     * @param scope       'global' (default) or 'project'
     * @param workspaceRoot  Required when scope is 'project'
     */
    save(agent: CustomAgentDefinition, scope: 'global' | 'project' = 'global', workspaceRoot?: string): void {
        let dir: string;
        if (scope === 'project') {
            if (!workspaceRoot) {
                throw new Error("workspaceRoot is required when scope is 'project'");
            }
            dir = path.join(workspaceRoot, '.copilot', 'agents');
        } else {
            dir = path.join(this.homeDir, '.copilot', 'agents');
        }
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `${agent.name}.md`);
        fs.writeFileSync(filePath, this.serializeAgent(agent), 'utf-8');
        this.logger.info(`[AgentFileService] Saved agent "${agent.name}" to ${filePath}`);
    }

    /**
     * Delete an agent by name — removes from both global and project dirs (idempotent).
     */
    delete(name: string, workspaceRoot?: string): void {
        const [globalDir, projectDir] = this.getAgentDirs(workspaceRoot);
        for (const dir of [globalDir, projectDir].filter(Boolean)) {
            const filePath = path.join(dir!, `${name}.md`);
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                    this.logger.info(`[AgentFileService] Deleted agent "${name}" from ${filePath}`);
                } catch (e) {
                    this.logger.warn(`[AgentFileService] Could not delete ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }
    }
}
