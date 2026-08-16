/**
 * buildChatHtml — the chat webview document, extracted (v3.13.0 Task 1)
 *
 * `_getHtmlForWebview` lived as a private method on `ChatViewProvider`, so the
 * only way to get a chat document was to own a sidebar view. `ChatPanelService`
 * needs the same document for an editor tab, and a second hand-rolled copy is
 * how `SubagentPanelService` ended up with no CSP and no nonce.
 *
 * The builder is deliberately **pure** — it takes resolved strings, not a
 * `vscode.Webview`. That keeps the security-critical part (CSP, nonce) testable
 * with no module mocking, which matters here: patching `Module.prototype.require`
 * is one of the documented causes of this suite's cross-file flake, and adding
 * another instance to test a string builder would be a poor trade.
 *
 * The vscode-specific URI resolution stays with the caller.
 */

const { describe, it } = require('mocha');
const { expect } = require('chai');
const path = require('path');

const { buildChatHtml, createNonce } = require(
    path.join(__dirname, '../../..', 'out', 'extension', 'webview', 'chatHtml.js')
);

const ASSETS = {
    styleUri: 'https://file+.vscode-resource/dist/webview/styles.css',
    scriptUri: 'https://file+.vscode-resource/dist/webview/main.js',
    cspSource: 'https://file+.vscode-resource',
    nonce: 'TESTNONCE0123456789abcdefghijkl'
};

describe('buildChatHtml', () => {
    describe('content security policy', () => {
        it('emits the exact CSP the sidebar shipped with', () => {
            const html = buildChatHtml(ASSETS);
            expect(html).to.include(
                `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
                `style-src ${ASSETS.cspSource} 'unsafe-inline'; ` +
                `script-src 'nonce-${ASSETS.nonce}' ${ASSETS.cspSource} https://cdn.jsdelivr.net; ` +
                `img-src ${ASSETS.cspSource} data:; ` +
                `font-src ${ASSETS.cspSource} data:;">`
            );
        });

        it('gates both script tags on the same nonce', () => {
            const html = buildChatHtml(ASSETS);
            // marked (CDN) and the module entry point
            expect(html).to.include(`<script nonce="${ASSETS.nonce}" src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js">`);
            expect(html).to.include(`<script type="module" nonce="${ASSETS.nonce}" src="${ASSETS.scriptUri}">`);
        });

        it('never emits a script tag without a nonce', () => {
            const html = buildChatHtml(ASSETS);
            const scriptTags = html.match(/<script[^>]*>/g) || [];
            expect(scriptTags).to.have.length.greaterThan(0);
            for (const tag of scriptTags) {
                expect(tag, `unguarded script tag: ${tag}`).to.include(`nonce="${ASSETS.nonce}"`);
            }
        });
    });

    describe('assets', () => {
        it('links the stylesheet it was given', () => {
            expect(buildChatHtml(ASSETS)).to.include(`<link rel="stylesheet" href="${ASSETS.styleUri}">`);
        });
    });

    describe('mount points', () => {
        // main.js resolves every component against these ids; a missing one is a
        // silently blank region, not an error.
        const MOUNTS = [
            'session-toolbar-mount',
            'custom-agents-mount',
            'subagent-dock-mount',
            'messages-mount',
            'acceptance-mount',
            'input-mount'
        ];

        for (const id of MOUNTS) {
            it(`renders #${id}`, () => {
                expect(buildChatHtml(ASSETS)).to.include(`<div id="${id}"></div>`);
            });
        }
    });

    describe('createNonce', () => {
        it('produces 32 alphanumeric characters', () => {
            const nonce = createNonce();
            expect(nonce).to.have.lengthOf(32);
            expect(nonce).to.match(/^[A-Za-z0-9]{32}$/);
        });

        it('does not repeat across calls', () => {
            const seen = new Set();
            for (let i = 0; i < 50; i++) {
                seen.add(createNonce());
            }
            expect(seen.size).to.equal(50);
        });
    });
});
