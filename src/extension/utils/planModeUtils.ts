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

/**
 * Extracts the first top-level heading from plan.md content.
 * Only matches single `#` headings (not `##` or deeper).
 * @returns The heading text or null if none found.
 */
export function extractPlanHeading(planContent: string): string | null {
    for (const line of planContent.split('\n')) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
            const heading = trimmed.substring(2).trim();
            return heading || null;
        }
    }
    return null;
}

/**
 * Builds the kickoff message sent to the work session after plan acceptance.
 * Line 1 is the plan heading (for session label), followed by the plan path and instructions.
 */
export function buildKickoffMessage(heading: string | null, planPath: string): string {
    const title = heading || 'Plan Implementation';
    return `${title}\n\nplan file: ${planPath}\nReview each task and execute them in order. Start with the first incomplete task.`;
}
