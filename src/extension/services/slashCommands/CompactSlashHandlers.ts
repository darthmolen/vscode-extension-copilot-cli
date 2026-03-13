/**
 * Handles the /compact slash command.
 *
 * Calls session.rpc.compaction.compact() via SDKSessionManager to free
 * context window space on demand.
 */
export class CompactSlashHandlers {
    constructor(private sessionManager: any) {}

    async handleCompact(): Promise<{ success: boolean; content?: string; error?: string }> {
        try {
            const result = await this.sessionManager.compactSession();

            if (!result) {
                return {
                    success: true,
                    content: '✓ Compaction complete.'
                };
            }

            const { tokensRemoved, messagesRemoved } = result;
            const parts: string[] = [];
            if (typeof tokensRemoved === 'number') {
                parts.push(`freed ${tokensRemoved.toLocaleString()} tokens`);
            }
            if (typeof messagesRemoved === 'number') {
                parts.push(`removed ${messagesRemoved} messages`);
            }

            const summary = parts.length > 0 ? parts.join(', ') : 'context compacted';
            return {
                success: true,
                content: `✓ Compaction complete — ${summary}.`
            };
        } catch (error: any) {
            return {
                success: false,
                error: `Compaction failed: ${error?.message ?? error}`
            };
        }
    }
}
