/**
 * What this surface must remember about itself across a window reload.
 *
 * VS Code restores a webview panel by handing back whatever the *webview* saved
 * with `setState`. The extension cannot write that channel, so the session id —
 * which the extension already sends on init — is recorded here on the way past.
 * `registerWebviewPanelSerializer` reads it back and reopens the right session.
 *
 * The channel is shared: the sub-agent dock's minimized flag lives in it too.
 * Every write merges, because replacing it would quietly reset an unrelated
 * preference each time a session started.
 */

/**
 * Record the session this surface is showing.
 *
 * @param {{getState?: () => any, setState?: (state: any) => void} | undefined} vscodeApi
 *        The object `acquireVsCodeApi()` returns. Absent in some harnesses.
 * @param {string | null | undefined} sessionId
 *        The surface's session, or null while it has none yet.
 */
export function rememberSessionId(vscodeApi, sessionId) {
	if (!vscodeApi || typeof vscodeApi.setState !== 'function') {
		return;
	}
	const current = (typeof vscodeApi.getState === 'function' && vscodeApi.getState()) || {};
	// Written even when null: a fresh tab that inherited a stale id would restore
	// the previous conversation into itself.
	vscodeApi.setState({ ...current, sessionId: sessionId ?? null });
}
