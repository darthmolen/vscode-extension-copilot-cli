/**
 * Prompt Loader
 *
 * Parses markdown files with YAML frontmatter into structured prompt objects.
 * No external dependencies — uses regex-based frontmatter parsing.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Parse YAML frontmatter from a markdown string.
 * Handles simple YAML: strings, numbers, arrays (- item style).
 */
function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
        return { meta: {}, body: content.trim() };
    }

    const yamlStr = match[1];
    const body = match[2].trim();
    const meta = {};

    let currentKey = null;
    let currentArray = null;

    for (const line of yamlStr.split('\n')) {
        const trimmed = line.trimEnd();

        // Array item: "  - value"
        if (trimmed.match(/^\s+-\s+/) && currentKey) {
            const value = trimmed.replace(/^\s+-\s+/, '');
            if (!currentArray) {
                currentArray = [];
                meta[currentKey] = currentArray;
            }
            currentArray.push(value);
            continue;
        }

        // Key-value: "key: value"
        const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
        if (kvMatch) {
            currentKey = kvMatch[1];
            const rawValue = kvMatch[2].trim();
            currentArray = null;

            if (rawValue === '') {
                // Value will come as array items on following lines
                continue;
            }

            // Parse value types
            if (rawValue === 'true') meta[currentKey] = true;
            else if (rawValue === 'false') meta[currentKey] = false;
            else if (/^\d+$/.test(rawValue)) meta[currentKey] = parseInt(rawValue, 10);
            else meta[currentKey] = rawValue;
        }
    }

    return { meta, body };
}

/**
 * Load a single prompt file.
 * @param {string} filePath - Absolute path to .md file
 * @returns {{ id: string, category: string, prompt: string, timeout: number, [key: string]: any }}
 */
export function loadPrompt(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { meta, body } = parseFrontmatter(content);

    return {
        id: meta.id || path.basename(filePath, '.md'),
        category: meta.category || 'uncategorized',
        timeout: meta.timeout || 60000,
        prompt: body,
        ...meta,
        _source: filePath,
    };
}

/**
 * Load all prompt files from a directory.
 * @param {string} dirPath - Path to directory containing .md files
 * @param {{ category?: string, id?: string }} [filter] - Optional filters
 * @returns {Array} Array of prompt objects
 */
export function loadPrompts(dirPath, filter = {}) {
    const resolvedDir = path.resolve(dirPath);

    if (!fs.existsSync(resolvedDir)) {
        throw new Error(`Prompt directory not found: ${resolvedDir}`);
    }

    const stat = fs.statSync(resolvedDir);

    // Single file
    if (stat.isFile()) {
        const prompt = loadPrompt(resolvedDir);
        return applyFilter([prompt], filter);
    }

    // Directory
    const files = fs.readdirSync(resolvedDir)
        .filter(f => f.endsWith('.md') && f !== 'README.md')
        .sort();

    const prompts = files.map(f => loadPrompt(path.join(resolvedDir, f)));
    return applyFilter(prompts, filter);
}

function applyFilter(prompts, filter) {
    let result = prompts;

    if (filter.category) {
        result = result.filter(p => p.category === filter.category);
    }
    if (filter.id) {
        result = result.filter(p => p.id === filter.id);
    }

    return result;
}
