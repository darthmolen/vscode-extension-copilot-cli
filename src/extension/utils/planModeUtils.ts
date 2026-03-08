/**
 * Pure utility functions for plan mode logic.
 * Kept separate from extension.ts so they can be unit tested without vscode.
 */

/**
 * Returns true if a new session should automatically start in planning mode.
 * @param configValue The value of copilotCLI.startNewSessionInPlanning config
 */
export function shouldAutoEnablePlanMode(configValue: boolean | null | undefined): boolean {
    return configValue === true;
}
