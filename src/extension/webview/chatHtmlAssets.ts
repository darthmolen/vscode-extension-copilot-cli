/**
 * Resolves the chat document's assets against a webview.
 *
 * Split from `chatHtml.ts` for one concrete reason: this module needs `vscode`
 * at runtime (`Uri.joinPath`), and importing `vscode` into the document builder
 * would make it unrequirable from a plain mocha process — so the CSP and nonce
 * could only be tested by patching `Module.prototype.require`, which is a
 * documented cause of this suite's cross-file flake.
 *
 * Every chat surface — the sidebar view and the editor panel — resolves assets
 * through here, so `localResourceRoots` mistakes surface in one place rather
 * than per surface.
 */

import * as vscode from 'vscode';
import { ChatHtmlAssets, createNonce } from './chatHtml';

/**
 * Resolve the stylesheet and module entry point for `webview`, with a fresh
 * nonce.
 *
 * Only `main.js` is resolved: every other webview file arrives through its ES
 * module imports, resolved by the browser relative to it.
 */
export function resolveChatHtmlAssets(
    webview: vscode.Webview,
    extensionUri: vscode.Uri
): ChatHtmlAssets {
    return {
        styleUri: webview
            .asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'styles.css'))
            .toString(),
        scriptUri: webview
            .asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.js'))
            .toString(),
        cspSource: webview.cspSource,
        nonce: createNonce()
    };
}
