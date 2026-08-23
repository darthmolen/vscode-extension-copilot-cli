import * as vscode from 'vscode';
import { WebviewChatSurface } from './extension/webview/webviewChatSurface';
import { SidebarSlot } from './extension/webview/chatWebviewSlot';

/**
 * The sidebar's registration with VS Code, and nothing else.
 *
 * This class used to be the whole chat UI as well. `resolveWebviewView` is
 * genuinely sidebar-specific — it is *how* VS Code hands us a sidebar, and a panel
 * has no equivalent — but everything it went on to do applies to any container.
 * So the registration stayed here and the chat moved to `WebviewChatSurface`,
 * which this hands a `SidebarSlot`.
 *
 * The surface is injected rather than built here because the composition root
 * needs to talk to it directly: it is the sidebar's `ChatSurface`, the thing a
 * `ChatSessionHost` writes to. A provider that owned it privately would have to
 * re-export all fifteen of its methods.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'copilot-cli.chatView';

	constructor(private readonly surface: WebviewChatSurface) {}

	/**
	 * Called by VS Code when the sidebar view needs to be rendered.
	 *
	 * Can fire more than once: VS Code disposes the view when its container is
	 * hidden and resolves a fresh one on the way back. The surface is the same one
	 * either way, which is why the session survives a sidebar hide/show.
	 */
	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this.surface.attach(new SidebarSlot(webviewView, ChatViewProvider.viewType));
	}
}
