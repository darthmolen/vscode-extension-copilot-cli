import * as vscode from 'vscode';

const CHROMIUM_NOTICE_KEY = 'copilotCLI.notifiedChromiumDownload';

/**
 * Show a one-time toast informing the user that the agent's built-in browser
 * (via @playwright/mcp) will download Chromium on first use. Dismissible —
 * we never show it again once acknowledged.
 */
export async function maybeShowChromiumNotice(context: vscode.ExtensionContext): Promise<void> {
    if (context.globalState.get<boolean>(CHROMIUM_NOTICE_KEY)) {
        return;
    }

    const enabled = vscode.workspace.getConfiguration('copilotCLI')
        .get<boolean>('enablePlaywrightMcp', true);
    if (!enabled) {
        return;
    }

    const GOT_IT = 'Got it';
    const DISABLE = 'Disable';

    const choice = await vscode.window.showInformationMessage(
        'Copilot CLI: the agent now has a built-in browser via @playwright/mcp. The first time the agent uses it, Chromium will download (~150 MB). You can disable this in settings.',
        GOT_IT,
        DISABLE
    );

    if (choice === DISABLE) {
        await vscode.workspace.getConfiguration('copilotCLI')
            .update('enablePlaywrightMcp', false, vscode.ConfigurationTarget.Global);
    }

    // Mark as shown either way (Got it, Disable, or dismissed)
    await context.globalState.update(CHROMIUM_NOTICE_KEY, true);
}
