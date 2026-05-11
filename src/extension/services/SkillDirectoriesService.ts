import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PLUGIN_CACHE_MAX_DEPTH = 5;

function findSkillDirsIn(dir: string, currentDepth: number, maxDepth: number): string[] {
    if (currentDepth >= maxDepth) { return []; }
    if (!fs.existsSync(dir)) { return []; }

    const results: string[] = [];

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) { continue; }
        if (entry.name === 'skills') {
            results.push(path.join(dir, entry.name));
        } else {
            results.push(...findSkillDirsIn(path.join(dir, entry.name), currentDepth + 1, maxDepth));
        }
    }

    return results;
}

/**
 * Resolves all skill directories that should be passed to the Copilot SDK.
 *
 * Searches three default locations:
 *   1. ~/.claude/skills     — Claude Code user skills
 *   2. ~/.agents/skills     — Copilot CLI's canonical personal skill directory
 *   3. ~/.claude/plugins/cache/**\/skills — Installed Claude Code plugin skills
 *
 * Plus any user-configured additional directories.
 *
 * Only directories that actually exist on disk are returned.
 * Duplicates are removed.
 *
 * @param additionalDirs User-configured extra directories (from copilotCLI.additionalSkillDirectories)
 * @param homeDir Home directory (injectable for testing; defaults to os.homedir())
 */
export function resolveSkillDirectories(
    additionalDirs: string[],
    homeDir: string = os.homedir()
): string[] {
    const candidates: string[] = [
        path.join(homeDir, '.claude', 'skills'),
        path.join(homeDir, '.agents', 'skills'),
    ];

    // Discover all skills/ dirs inside the Claude Code plugin cache
    const pluginCacheDir = path.join(homeDir, '.claude', 'plugins', 'cache');
    candidates.push(...findSkillDirsIn(pluginCacheDir, 0, PLUGIN_CACHE_MAX_DEPTH));

    // Append user-configured directories last
    candidates.push(...additionalDirs);

    // Filter to existing directories and deduplicate, preserving order
    const seen = new Set<string>();
    const result: string[] = [];
    for (const dir of candidates) {
        if (!seen.has(dir) && fs.existsSync(dir)) {
            seen.add(dir);
            result.push(dir);
        }
    }

    return result;
}
