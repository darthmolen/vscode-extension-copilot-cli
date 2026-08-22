/**
 * Which chat a palette command acts on (v3.13.0 P3 §4.2)
 *
 * Every other route into a session carries its surface: the RPC channel *is* the
 * identity. The command palette is the one origin with none, and the rule the plan
 * settled on is "never pick a surface the user did not indicate".
 *
 * So: the focused chat if there is one; the sidebar if it is the *only* chat in the
 * window — not as a fallback but as the sole candidate; otherwise nothing, and the
 * command says so. Guessing between two open chats is exactly the defect this whole
 * task exists to remove.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { resolveCommandSurface } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'webview', 'commandSurface.js')
);

const sidebar = { name: 'sidebar' };
const tabOne = { name: 'tab-1' };
const tabTwo = { name: 'tab-2' };

describe('resolveCommandSurface', () => {
    it('takes the focused chat', () => {
        const chosen = resolveCommandSurface([
            { surface: sidebar, isActive: false },
            { surface: tabOne, isActive: true }
        ]);
        expect(chosen).to.equal(tabOne);
    });

    it('takes the only chat there is, when nothing is focused', () => {
        // Not a fallback — with one candidate there is nothing to guess between.
        const chosen = resolveCommandSurface([{ surface: sidebar, isActive: false }]);
        expect(chosen).to.equal(sidebar);
    });

    it('refuses to guess between two unfocused chats', () => {
        const chosen = resolveCommandSurface([
            { surface: sidebar, isActive: false },
            { surface: tabOne, isActive: false }
        ]);
        expect(chosen).to.equal(undefined);
    });

    it('refuses when two chats both claim focus', () => {
        // VS Code should not report this; if it does, guessing is still wrong.
        const chosen = resolveCommandSurface([
            { surface: tabOne, isActive: true },
            { surface: tabTwo, isActive: true }
        ]);
        expect(chosen).to.equal(undefined);
    });

    it('has no answer when there are no chats at all', () => {
        expect(resolveCommandSurface([])).to.equal(undefined);
    });

    it('prefers the focused chat over the sole-candidate rule', () => {
        const chosen = resolveCommandSurface([
            { surface: sidebar, isActive: true },
            { surface: tabOne, isActive: false },
            { surface: tabTwo, isActive: false }
        ]);
        expect(chosen).to.equal(sidebar);
    });
});
