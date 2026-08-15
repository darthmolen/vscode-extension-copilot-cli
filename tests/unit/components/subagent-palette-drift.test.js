/**
 * Sub-agent palette — the webview copy must not drift from the source of truth
 *
 * S2. The same ten hex values lived in three places: `extension.ts` (which
 * actually assigns, per agentId, and rides the color on the event payload),
 * `SubagentPanelService.ts`, and `SubagentDock.js`. The extension-side pair can
 * share a TypeScript module; the webview cannot import from `src/` because
 * esbuild COPIES webview files rather than bundling them.
 *
 * So the webview keeps its own literal and this guard keeps it honest.
 *
 * Note it imports both palettes as VALUES and compares arrays. It deliberately
 * does not scan source text — CLAUDE.md bans that, and the failure mode is
 * documented: a test once passed because the string it searched for sat inside
 * a `//` comment.
 */

import { describe, it } from 'mocha';
import { expect } from 'chai';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { PALETTE as WEBVIEW_PALETTE } from '../../../src/webview/app/components/SubagentDock/SubagentDock.js';

const require = createRequire(import.meta.url);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('sub-agent palette — single source of truth (S2)', () => {
    it('the webview palette matches the shared extension-side palette exactly', () => {
        const { SUBAGENT_PALETTE } = require(join(REPO_ROOT, 'out', 'shared', 'subagentPalette.js'));

        expect(WEBVIEW_PALETTE).to.deep.equal(SUBAGENT_PALETTE);
    });

    it('the shared palette is non-empty and all entries are hex colors', () => {
        const { SUBAGENT_PALETTE } = require(join(REPO_ROOT, 'out', 'shared', 'subagentPalette.js'));

        expect(SUBAGENT_PALETTE).to.be.an('array').with.length.greaterThan(0);
        for (const color of SUBAGENT_PALETTE) {
            expect(color, `"${color}" is not a #RRGGBB hex color`).to.match(/^#[0-9A-Fa-f]{6}$/);
        }
    });

    it('has no duplicate colors, so consecutive agents are visually distinct', () => {
        const { SUBAGENT_PALETTE } = require(join(REPO_ROOT, 'out', 'shared', 'subagentPalette.js'));

        expect(new Set(SUBAGENT_PALETTE).size).to.equal(SUBAGENT_PALETTE.length);
    });
});
