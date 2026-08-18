/**
 * The four members by which a sidebar view and an editor panel differ.
 *
 * `ChatViewProvider` touches its VS Code object for exactly four things —
 * `postMessage`, `asWebviewUri`, setting `.html`, and an existence check — and
 * every one of them is on `.webview`, which is the *identical* `vscode.Webview`
 * type on `WebviewView` and `WebviewPanel`. What actually differs is how you show
 * it, how it announces visibility, and what its disposal means. Naming those here
 * is what lets one surface class serve both, instead of a second class that would
 * have to keep 15 methods in step with the first.
 *
 * All three types live in this file deliberately: a contract and its sealed
 * variant set. VS Code offers exactly two webview containers, so the set cannot
 * grow, and splitting them would put two ten-line adapters in two files whose
 * only meaning is "the other one of the pair".
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';

export interface ChatWebviewSlot {
    /** The webview itself — identical in type whichever container holds it. */
    readonly webview: vscode.Webview;
    readonly isVisible: boolean;
    /** Bring this slot to the front. `show()` on a view, `reveal()` on a panel. */
    reveal(preserveFocus?: boolean): void;
    readonly onDidChangeVisibility: vscode.Event<void>;
    readonly onDidDispose: vscode.Event<void>;
    /**
     * Whether disposal is the end of the surface.
     *
     * The sidebar carried the comment *"Don't dispose `_view` — VS Code owns the
     * sidebar view lifecycle"*: VS Code tears the view down when its container is
     * hidden and re-resolves it later into the same surface, same session. A panel
     * is the opposite — the user closes it and it is gone. Encoded as a flag so no
     * call site has to remember which one it is holding.
     */
    readonly closingEndsSurface: boolean;
}

/** A slot over the sidebar view VS Code hands to `resolveWebviewView`. */
export class SidebarSlot implements ChatWebviewSlot {
    constructor(
        private readonly view: vscode.WebviewView,
        private readonly viewType: string
    ) {}

    get webview(): vscode.Webview {
        return this.view.webview;
    }

    get isVisible(): boolean {
        return this.view.visible;
    }

    /** A view cannot reveal itself; focusing its id is how VS Code shows one. */
    reveal(preserveFocus?: boolean): void {
        vscode.commands.executeCommand(`${this.viewType}.focus`, { preserveFocus });
    }

    get onDidChangeVisibility(): vscode.Event<void> {
        return this.view.onDidChangeVisibility;
    }

    get onDidDispose(): vscode.Event<void> {
        return this.view.onDidDispose;
    }

    readonly closingEndsSurface = false;
}

/** A slot over an editor-tab panel. */
export class PanelSlot implements ChatWebviewSlot {
    constructor(private readonly panel: vscode.WebviewPanel) {}

    get webview(): vscode.Webview {
        return this.panel.webview;
    }

    get isVisible(): boolean {
        return this.panel.visible;
    }

    reveal(preserveFocus?: boolean): void {
        // Column left undefined: reveal where the panel already is rather than
        // dragging it to whichever group happens to be active.
        this.panel.reveal(undefined, preserveFocus);
    }

    /**
     * A panel has no `onDidChangeVisibility`. `onDidChangeViewState` covers the
     * same ground and more — it also fires when the panel changes column — which
     * is harmless here because every listener re-reads `isVisible` anyway.
     */
    get onDidChangeVisibility(): vscode.Event<void> {
        const viewState = this.panel.onDidChangeViewState;
        return (listener, thisArgs?, disposables?) =>
            viewState(() => listener.call(thisArgs), undefined, disposables);
    }

    get onDidDispose(): vscode.Event<void> {
        return this.panel.onDidDispose;
    }

    readonly closingEndsSurface = true;
}

/**
 * Where a chat webview is allowed to load files from.
 *
 * One list, used both when the sidebar view is resolved and when a panel is
 * created. `SubagentPanelService` is the cautionary tale: it passes
 * `{ enableScripts, retainContextWhenHidden }` and nothing else, which is exactly
 * why it cannot load `dist/webview` assets.
 *
 * `vscodeApi` is injectable only so this is testable without the extension host;
 * production always takes the default.
 */
export function chatWebviewResourceRoots(
    extensionUri: vscode.Uri,
    vscodeApi: typeof vscode = vscode
): vscode.Uri[] {
    return [
        extensionUri,
        vscodeApi.Uri.file(path.join(os.homedir(), '.copilot')),
        // Full tmpdir needed: pasted images go into random copilot-paste-<uuid> subdirs
        vscodeApi.Uri.file(os.tmpdir()),
        ...(vscodeApi.workspace.workspaceFolders ?? []).map(folder => folder.uri)
    ];
}
