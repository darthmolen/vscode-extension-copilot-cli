/**
 * Tool-argument preview — the webview copy must not drift from the source of truth
 *
 * The same "what did this tool do" line is produced in two places: the extension's
 * `shared/toolArgPreview.ts` (used by the pop-out panel) and `SubagentDock.js`
 * (used by the dock). The webview cannot import from `src/` — esbuild COPIES
 * webview files rather than bundling them — so it keeps its own copy, and this
 * guard keeps the two honest. Same arrangement, and same reason, as
 * `subagent-palette-drift.test.js`.
 *
 * They drifted invisibly once already: both handled only `pattern`, `path` and
 * `command`, so `skill`, `sql` and `task` rows rendered as a bare tool name in
 * BOTH surfaces — and `sql` and `task` were carrying a human-written description
 * the whole time.
 *
 * It compares BEHAVIOUR, calling both implementations, rather than scanning source
 * text — CLAUDE.md bans that, and a test here once passed against a `//` comment.
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { SubagentDock } from '../../../src/webview/app/components/SubagentDock/SubagentDock.js';
import { EventBus } from '../../../src/webview/app/state/EventBus.js';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const { previewToolArguments } = require(join(root, 'out', 'shared', 'toolArgPreview.js'));

/** Real argument shapes, taken from measured session logs. */
const CASES = [
    ['bash',          { command: 'ls -la', description: 'List files' }],
    ['rg',            { pattern: 'foo|bar', paths: ['/repo'], output_mode: 'content' }],
    ['view',          { path: '/repo/src/extension.ts' }],
    ['sql',           { description: 'Load plan tasks into todos', query: 'INSERT INTO todos …' }],
    ['task',          { name: 'plan-reviewer', agent_type: 'rubber-duck', description: 'Review plan', prompt: 'You are…' }],
    ['skill',         { skill: 'plan-intake-review' }],
    ['web_fetch',     { url: 'https://example.com' }],
    ['mystery_tool',  { target: 'the-thing' }],
    ['reload_agents', {}],
    ['no_args',       undefined]
];

describe('Sub-agent tool-argument preview — webview must match the shared module', () => {
    let dom, dock;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><div id="container"></div>');
        global.document = dom.window.document;
        global.window = dom.window;
        dock = new SubagentDock(document.getElementById('container'), new EventBus());
    });
    afterEach(() => { delete global.document; delete global.window; });

    for (const [toolName, args] of CASES) {
        it(`agrees on ${toolName}`, () => {
            expect(dock._argPreview({ toolName, arguments: args })).to.equal(previewToolArguments(args));
        });
    }

    it('says something for every tool that carries a usable argument', () => {
        const silent = CASES
            .filter(([, args]) => args && Object.keys(args).length > 0)
            .filter(([, args]) => previewToolArguments(args) === '');

        expect(silent, 'tools rendering as a bare name').to.deep.equal([]);
    });
});
