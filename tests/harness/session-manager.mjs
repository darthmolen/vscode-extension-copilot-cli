/**
 * Session Manager
 *
 * Handles SDK client and session lifecycle for the spike tool.
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let CopilotClient;

async function loadSDK() {
    if (!CopilotClient) {
        const sdk = await import('@github/copilot-sdk');
        CopilotClient = sdk.CopilotClient;
    }
}

/**
 * Create and manage a Copilot SDK session.
 * @param {{ model?: string, hooks?: object, verbose?: boolean }} options
 */
export async function createSessionManager(options = {}) {
    await loadSDK();

    const client = new CopilotClient({
        cwd: process.cwd(),
        autoStart: true,
    });

    const sessionConfig = {
        model: options.model || 'gpt-5',
        streaming: true,
    };

    if (options.hooks) {
        sessionConfig.hooks = options.hooks;
    }

    const session = await client.createSession(sessionConfig);

    return {
        client,
        session,
        sessionId: session.sessionId,

        async sendAndWait(prompt, timeout = 120000) {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
            );

            const sendPromise = session.sendAndWait({ prompt });
            return Promise.race([sendPromise, timeoutPromise]);
        },

        async destroy() {
            try {
                if (session) await session.destroy();
            } catch (_) { /* ignore */ }
            try {
                if (client) await client.stop();
            } catch (_) { /* ignore */ }
        },
    };
}

/**
 * Get the installed SDK version.
 */
export function getSDKVersion() {
    try {
        const pkgPath = path.resolve(__dirname, '../../node_modules/@github/copilot-sdk/package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.version;
    } catch {
        return 'unknown';
    }
}
