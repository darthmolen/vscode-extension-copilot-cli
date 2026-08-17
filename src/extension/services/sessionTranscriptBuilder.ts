/**
 * Projects a session's event log into the transcript a surface displays.
 *
 * `events.jsonl` is an append-only log written by the CLI. This folds it into a
 * read model: `tool.execution_start` joined to `tool.execution_complete` on
 * `toolCallId`, status derived from `success`. It is a projection, not a reader —
 * what comes out does not exist in the file.
 *
 * It replaces `SessionService.loadSessionHistory`, which parsed only `user.message`
 * and `assistant.message` and dropped every tool call. That, plus an in-memory
 * summary written separately by `chatViewProvider`, gave one session two different
 * histories depending on how you arrived at it. One projection, one history.
 *
 * A free function with no policy in it, deliberately: ACP's `session/load` is a
 * third caller in another process, and deciding *whether* to resume or attach
 * belongs to `ChatSessionHost.ensureStarted()`, not here.
 *
 * Free of `vscode` imports, so it is exercisable from the unit suite.
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { Message, ToolState } from '../../shared/models';

/**
 * Tool output is unbounded — a `bash` that printed a build log, a `view` of a large
 * file — and a session can hold dozens. Capped by default so a caller cannot forget
 * to. Fetching full output on demand is designed and deferred:
 * `planning/backlog/lazy-tool-results-on-rehydration.md`.
 */
const DEFAULT_MAX_RESULT_CHARS = 2000;

export interface BuildTranscriptOptions {
    /** Characters of tool output carried per tool. Default 2000. */
    maxResultChars?: number;
}

/** Only what this projection reads. The log carries much more. */
interface LoggedEvent {
    type?: string;
    data?: any;
    /** Sits on the event, not under `data` — verified against real sessions. */
    agentId?: string;
    timestamp?: string;
}

export async function buildSessionTranscript(
    eventsPath: string,
    options: BuildTranscriptOptions = {}
): Promise<Message[]> {
    if (!fs.existsSync(eventsPath)) {
        return [];
    }

    const maxResultChars = options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
    const messages: Message[] = [];
    /** Where each tool's message sits, so its completion can finish it in place. */
    const toolMessages = new Map<string, Message>();

    for await (const line of readLines(eventsPath)) {
        const event = parseLine(line);
        if (!event) {
            continue;
        }

        switch (event.type) {
            case 'user.message':
            case 'assistant.message': {
                const content = event.data?.content;
                if (typeof content === 'string' && content) {
                    messages.push({
                        kind: event.type === 'user.message' ? 'user' : 'assistant',
                        content,
                        timestamp: toMillis(event.timestamp)
                    });
                }
                break;
            }

            case 'tool.execution_start': {
                const { toolCallId, toolName, arguments: args } = event.data ?? {};
                if (!toolCallId) {
                    break;
                }
                // Starts as `running`. A start with no matching complete stays that
                // way, which is truthful — it was interrupted.
                const message: Message = {
                    kind: 'tool',
                    content: toolName ?? 'tool',
                    timestamp: toMillis(event.timestamp),
                    tool: {
                        toolCallId,
                        toolName,
                        arguments: args,
                        status: 'running',
                        startTime: toMillis(event.timestamp)
                    } as ToolState
                };
                if (event.agentId) {
                    message.agentId = event.agentId;
                }
                messages.push(message);
                toolMessages.set(toolCallId, message);
                break;
            }

            case 'tool.execution_complete': {
                const data = event.data ?? {};
                const message = toolMessages.get(data.toolCallId);
                if (!message?.tool) {
                    // A complete with no start — nothing to finish, and inventing a
                    // message for it would show a tool that never appeared to run.
                    break;
                }
                message.tool.status = data.success ? 'complete' : 'failed';
                message.tool.endTime = toMillis(event.timestamp);
                if (data.error) {
                    message.tool.error = data.error;
                }
                applyResult(message.tool, data.result, maxResultChars);
                break;
            }

            default:
                // Hooks, permissions, session lifecycle: not transcript content.
                break;
        }
    }

    return messages;
}

/** Tool output, capped. `result` arrives as `{ content }` or occasionally a string. */
function applyResult(tool: ToolState, result: any, maxResultChars: number): void {
    const content = typeof result === 'string' ? result : result?.content;
    if (typeof content !== 'string' || !content) {
        return;
    }
    if (content.length > maxResultChars) {
        tool.result = content.slice(0, maxResultChars);
        tool.resultTruncated = true;
    } else {
        tool.result = content;
    }
}

function toMillis(timestamp?: string): number {
    const parsed = timestamp ? Date.parse(timestamp) : NaN;
    return Number.isNaN(parsed) ? 0 : parsed;
}

function parseLine(line: string): LoggedEvent | null {
    if (!line.trim()) {
        return null;
    }
    try {
        return JSON.parse(line) as LoggedEvent;
    } catch {
        // One corrupt line must not cost the whole transcript.
        return null;
    }
}

function readLines(eventsPath: string): readline.Interface {
    return readline.createInterface({
        input: fs.createReadStream(eventsPath),
        crlfDelay: Infinity
    });
}
