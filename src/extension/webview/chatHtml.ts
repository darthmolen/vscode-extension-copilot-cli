/**
 * The chat webview document, shared by every surface that renders a chat.
 *
 * This began as `ChatViewProvider._getHtmlForWebview`, which meant the only way
 * to obtain a chat document was to own the sidebar view. `ChatPanelService`
 * needs the same document for an editor tab, and the cost of *not* sharing is
 * already visible in `SubagentPanelService`: it hand-rolls its own HTML and
 * ships with neither a CSP nor a nonce.
 *
 * Deliberately free of `vscode`: it takes resolved strings rather than a
 * `vscode.Webview`, so the security-critical parts (CSP, nonce) are testable
 * without patching `Module.prototype.require` — a documented cause of this
 * suite's cross-file flake. Callers do the URI resolution, which is the part
 * that genuinely differs between a view and a panel.
 */

/** Everything the document needs that a caller must resolve against its webview. */
import { randomBytes } from 'crypto';

export interface ChatHtmlAssets {
    /** `asWebviewUri` result for `dist/webview/styles.css`. */
    styleUri: string;
    /** `asWebviewUri` result for `dist/webview/main.js` — the ES module entry point. */
    scriptUri: string;
    /** The webview's `cspSource`. */
    cspSource: string;
    /** Per-document nonce; see {@link createNonce}. Both script tags are gated on it. */
    nonce: string;
}

/**
 * A fresh 32-character nonce.
 *
 * One per document render. Reusing a nonce across renders would defeat the
 * point of having one.
 *
 * From a CSPRNG, not `Math.random()`. The nonce is the credential that authorises every inline and
 * module script in this document, and `Math.random()` is seeded state an attacker who can observe
 * one output can continue — which makes a guessable nonce a way past the CSP rather than a formality.
 */
export function createNonce(): string {
    // Hex, not base64url: `-` and `_` sit outside the CSP grammar's base64-value, and the nonce
    // has to survive being pasted into a `script-src 'nonce-…'` directive unambiguously. 16 bytes
    // is 128 bits of entropy in 32 alphanumeric characters.
    return randomBytes(16).toString('hex');
}

/**
 * Build the chat document.
 *
 * The body is mount points only — `main.js` constructs every component and
 * resolves it against these ids, so a missing mount is a silently blank region
 * rather than an error. Only `main.js` needs a resolved URI; the rest of the
 * webview arrives through its ES module imports.
 */
export function buildChatHtml(assets: ChatHtmlAssets): string {
    const { styleUri, scriptUri, cspSource, nonce } = assets;

    return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource} https://cdn.jsdelivr.net; img-src ${cspSource} data:; font-src ${cspSource} data:;">
	<title>Copilot CLI Chat</title>
	<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
	<link rel="stylesheet" href="${styleUri}">
</head>
<body>
	<!-- Component Mount Points - Components render themselves here -->
	<div id="session-toolbar-mount"></div>
	<div id="custom-agents-mount"></div>

	<main role="main">
		<div id="subagent-dock-mount"></div>
		<div id="messages-mount"></div>
		<div id="acceptance-mount"></div>
		<div id="input-mount"></div>
	</main>

	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
