/**
 * One line saying what a tool call actually did.
 *
 * Used for sub-agent rows, where a tool gets a single line and no room for its
 * whole argument object. Shipped in v3.10.0 reading only `pattern`, `path` and
 * `command`, which covered `rg`, `view` and `bash` — and left `skill`, `sql` and
 * `task` rendering as a bare tool name, even though `sql` and `task` carry a
 * human-written `description` right there in their arguments.
 *
 * Ordered most-specific first: a shell `command` or a search `pattern` answers
 * "what did it do" better than the paraphrase beside it, so those keep priority
 * over `description`.
 *
 * Free of `vscode` imports so the panel service and the unit suite can both use
 * it. The webview keeps its own copy — esbuild copies webview files rather than
 * bundling them, so it cannot import from `src/` — and
 * `tests/unit/components/subagent-arg-preview-drift.test.js` keeps the two honest,
 * exactly as the palette does.
 */
export function previewToolArguments(args: unknown): string {
    const a = args as Record<string, unknown> | undefined;
    if (!a || typeof a !== 'object') { return ''; }

    if (typeof a.pattern === 'string') { return `"${a.pattern}"`; }
    if (typeof a.path === 'string') { return a.path; }
    if (typeof a.command === 'string') { return a.command; }
    if (typeof a.description === 'string') { return a.description; }
    if (typeof a.skill === 'string') { return a.skill; }
    if (typeof a.url === 'string') { return a.url; }

    // Unknown tool: show its one argument rather than nothing at all.
    const printable = Object.values(a).filter(
        (v) => typeof v === 'string' || typeof v === 'number'
    );
    return printable.length === 1 ? String(printable[0]) : '';
}
