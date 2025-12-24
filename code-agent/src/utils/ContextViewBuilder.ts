import { LMStudioClient } from '../llm/LMStudioClient';
import { logger } from './logger';

export interface Message {
    role: string;
    content: string;
}

export interface ContextView {
    messages: Message[];
    summarizedCount: number;
}

/**
 * Creates model-specific views from canonical messages.
 * Uses MESSAGE COUNTS (not tokens) since token counts are unpredictable.
 * Progressive summarization shrinks context by summarizing oldest messages.
 */
export class ContextViewBuilder {
    private client: LMStudioClient;

    constructor(client: LMStudioClient) {
        this.client = client;
    }

    /**
     * Build a view with at most `maxMessages` messages.
     * Preserves: first N messages (system + task), last M messages (recent context).
     * Summarizes middle messages progressively.
     * 
     * @param canonical - Full message history (single source of truth)
     * @param maxMessages - Maximum number of messages in the view
     * @param preserveFirst - Number of messages to preserve at start (default: 2 for system + task)
     * @param preserveLast - Number of recent messages to preserve (default: 10)
     */
    async buildView(
        canonical: Message[],
        maxMessages: number,
        preserveFirst: number = 2,
        preserveLast: number = 10
    ): Promise<ContextView> {
        // If already fits, return as-is
        if (canonical.length <= maxMessages) {
            return { messages: [...canonical], summarizedCount: 0 };
        }

        // Split into preserved sections
        const first = canonical.slice(0, preserveFirst);
        const last = canonical.slice(-preserveLast);
        let middle = canonical.slice(preserveFirst, -preserveLast);

        // Edge case: not enough middle to summarize
        if (middle.length === 0) {
            const truncated = [...first, ...last.slice(-(maxMessages - preserveFirst))];
            return {
                messages: truncated,
                summarizedCount: canonical.length - truncated.length
            };
        }

        let summarizedCount = 0;
        let summaryMessage: Message | null = null;

        // Progressively summarize oldest messages until we fit
        while ((first.length + (summaryMessage ? 1 : 0) + middle.length + last.length) > maxMessages && middle.length > 0) {
            // Take oldest 2 messages from middle
            const toSummarize = middle.splice(0, 2);
            summarizedCount += toSummarize.length;

            const summaryText = await this.summarizeMessages(toSummarize);

            if (summaryMessage) {
                // Append to existing summary
                summaryMessage.content += '\n' + summaryText;
            } else {
                // Create new summary message
                summaryMessage = {
                    role: 'system',
                    content: `[SUMMARIZED CONTEXT]\n${summaryText}`
                };
            }
        }

        // Build final view
        const result: Message[] = [...first];
        if (summaryMessage) {
            result.push(summaryMessage);
        }
        result.push(...middle, ...last);

        return { messages: result, summarizedCount };
    }

    /**
     * Summarize a batch of messages using LLM.
     */
    private async summarizeMessages(messages: Message[]): Promise<string> {
        const content = messages.map(m => `[${m.role}] ${m.content.slice(0, 300)}`).join('\n');

        try {
            const result = await this.client.completion([
                {
                    role: 'system',
                    content: 'Summarize these messages in 1-2 sentences. Focus on: what was tried, what worked/failed, current state.'
                },
                { role: 'user', content }
            ], {
                type: 'object',
                properties: { summary: { type: 'string' } },
                required: ['summary'],
                additionalProperties: false
            }, 'SummaryOutput');

            return result.summary || 'Previous context condensed.';
        } catch (err) {
            logger.error(`[ContextViewBuilder] Summarization failed: ${err}`);
            return `[${messages.length} messages summarized]`;
        }
    }
}

/**
 * Retry an LLM call, progressively reducing context on overflow.
 * 
 * @param client - LLM client
 * @param canonical - Full message history
 * @param initialMaxMessages - Starting message limit
 * @param schema - Zod/JSON schema for output
 * @param schemaName - Name for schema
 * @param maxRetries - Max retry attempts
 */
export async function callWithContextRetry<T>(
    client: LMStudioClient,
    canonical: Message[],
    initialMaxMessages: number,
    schema: any,
    schemaName: string,
    maxRetries: number = 5
): Promise<T> {
    const viewBuilder = new ContextViewBuilder(client);
    let currentMax = initialMaxMessages;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const view = await viewBuilder.buildView(canonical, currentMax);
            logger.info(`[ContextRetry] Attempt ${attempt + 1}: ${view.messages.length} messages, ${view.summarizedCount} summarized`);

            return await client.completion(view.messages, schema, schemaName);
        } catch (err: any) {
            lastError = err;
            const msg = err.message || '';

            // Check if it's a context overflow error
            if (msg.includes('context') || msg.includes('token') || msg.includes('length')) {
                logger.info(`[ContextRetry] Context overflow, reducing by 2 messages`);
                currentMax = Math.max(5, currentMax - 2);
            } else {
                // Not a context error, don't retry
                throw err;
            }
        }
    }

    throw lastError || new Error('Max retries exceeded');
}
