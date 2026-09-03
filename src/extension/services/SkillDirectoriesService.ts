import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PLUGIN_CACHE_MAX_DEPTH = 5;
const MANIFEST_SCHEMA_VERSION = 2;

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

interface InstalledPluginEntry {
    installPath?: string;
}

interface InstalledPluginsManifest {
    version?: number;
    plugins?: Record<string, InstalledPluginEntry[] | undefined>;
}

/**
 * Skill directories for the plugins Claude Code actually has installed, read
 * from ~/.claude/plugins/installed_plugins.json.
 *
 * Returns null when the manifest is absent, unreadable, or a schema this code
 * does not recognise — the caller then falls back to walking the cache, so a
 * future schema bump degrades instead of silently yielding no skills.
 */
function findSkillDirsFromManifest(homeDir: string): string[] | null {
    try {
        const manifestPath = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
        if (!fs.existsSync(manifestPath)) { return null; }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as InstalledPluginsManifest;
        if (manifest?.version !== MANIFEST_SCHEMA_VERSION || !manifest.plugins) { return null; }

        const results: string[] = [];
        for (const entries of Object.values(manifest.plugins)) {
            for (const entry of entries ?? []) {
                if (!entry?.installPath) { continue; }
                results.push(path.join(entry.installPath, 'skills'));
            }
        }
        return results;
    } catch {
        return null;
    }
}

/**
 * Resolves all skill directories that should be passed to the Copilot SDK.
 *
 * Searches three default locations:
 *   1. ~/.claude/skills     — Claude Code user skills
 *   2. ~/.agents/skills     — Copilot CLI's canonical personal skill directory
 *   3. Installed Claude Code plugin skills, per
 *      ~/.claude/plugins/installed_plugins.json
 *
 * Plus any user-configured additional directories.
 *
 * The manifest is preferred over walking ~/.claude/plugins/cache/** because the
 * cache retains every version ever fetched and every uninstalled leftover. A
 * blind walk therefore passes stale versions alongside installed ones, so two
 * directories claim the same skill names. The manifest names exactly one
 * installPath per installed plugin, and follows Claude Code if it ever moves
 * plugins out of cache/. The walk remains as a fallback for installs with no
 * manifest.
 *
 * ~/.claude/plugins/marketplaces is deliberately never scanned: it holds cloned
 * marketplace sources, listing plugins the user has not installed.
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

    // Installed plugin skills. Prefer the manifest; fall back to walking the
    // cache when it is missing or unrecognised.
    const fromManifest = findSkillDirsFromManifest(homeDir);
    if (fromManifest) {
        candidates.push(...fromManifest);
    } else {
        const pluginCacheDir = path.join(homeDir, '.claude', 'plugins', 'cache');
        candidates.push(...findSkillDirsIn(pluginCacheDir, 0, PLUGIN_CACHE_MAX_DEPTH));
    }

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
