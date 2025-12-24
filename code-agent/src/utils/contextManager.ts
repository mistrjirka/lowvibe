import { LMStudioClient } from '../llm/LMStudioClient';
import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Configuration for context management
 */
export interface ContextManagerConfig {
    /** Maximum number of recent tool calls to keep in full detail */
    maxToolCalls: number;
    /** Context usage percentage threshold to trigger summarization (0-1) */
    summarizationThreshold: number;
    /** Number of recent messages to keep when summarizing */
    recentMessagesToKeep: number;
    /** LLM client for summarization */
    client?: LMStudioClient;
}

const DEFAULT_CONFIG: ContextManagerConfig = {
    maxToolCalls: 5,
    summarizationThreshold: 0.85,
    recentMessagesToKeep: 10
};

/**
 * Manages conversation context to prevent token overflow
 */
export class ContextManager {
    private config: ContextManagerConfig;

    constructor(config: Partial<ContextManagerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if a message contains a tool call or result
     */
    private isToolMessage(message: any): boolean {
        if (message.role !== 'assistant') return false;
        try {
            const content = typeof message.content === 'string'
                ? JSON.parse(message.content)
                : message.content;
            return content?.type === 'tool_call';
        } catch {
            return false;
        }
    }

    /**
     * Check if a message is a tool result (system message following tool call)
     */
    private isToolResult(message: any): boolean {
        if (message.role !== 'system' && message.role !== 'user') return false;
        const content = message.content || '';
        return content.includes('Tool Result:') ||
            content.includes('Tool Output:') || // Matches ExecutePlanNode format
            content.includes('Command output:') ||
            content.includes('File written:') ||
            content.includes('File modified:') ||
            content.includes('Error:');
    }

    /**
     * Create a stripped version of a tool call message (keep essential info only)
     */
    private stripToolCall(message: any): any {
        try {
            const content = typeof message.content === 'string'
                ? JSON.parse(message.content)
                : message.content;

            if (content?.type === 'tool_call') {
                // Keep only tool name and a brief summary
                const strippedContent = {
                    type: 'tool_call',
                    tool: content.tool,
                    summary: `[Archived] Called ${content.tool}`
                };
                return {
                    role: message.role,
                    content: JSON.stringify(strippedContent)
                };
            }
        } catch {
            // Return as-is if parsing fails
        }
        return message;
    }

    /**
     * Strip old tool calls, keeping only the last N in full detail
     */
    pruneToolCalls(messages: any[]): any[] {
        // Find indices of all tool call messages
        const toolCallIndices: number[] = [];
        messages.forEach((msg, idx) => {
            if (this.isToolMessage(msg)) {
                toolCallIndices.push(idx);
            }
        });

        // If within limit, no pruning needed
        if (toolCallIndices.length <= this.config.maxToolCalls) {
            return messages;
        }

        // Determine which tool calls to strip (all except last N)
        const toStrip = new Set(toolCallIndices.slice(0, -this.config.maxToolCalls));
        const resultIndicesToStrip = new Set<number>();

        // Also find tool results that follow stripped tool calls
        toStrip.forEach(idx => {
            // Check next message for tool result
            if (idx + 1 < messages.length && this.isToolResult(messages[idx + 1])) {
                resultIndicesToStrip.add(idx + 1);
            }
        });

        // Build pruned message list
        return messages.map((msg, idx) => {
            if (toStrip.has(idx)) {
                return this.stripToolCall(msg);
            }
            if (resultIndicesToStrip.has(idx)) {
                // Keep a minimal version of tool result
                return {
                    role: msg.role,
                    content: `[Archived tool result]`
                };
            }
            return msg;
        });
    }

    /**
     * Generate a summary of old messages using the LLM
     */
    async summarizeMessages(messages: any[], client: LMStudioClient): Promise<string> {
        // Build a condensed representation for summarization
        const oldMessagesText = messages.map((msg, idx) => {
            const role = msg.role.toUpperCase();
            let content = msg.content;

            // Try to extract key info from JSON content
            try {
                const parsed = JSON.parse(content);
                if (parsed.type === 'tool_call') {
                    content = `Called tool: ${parsed.tool}`;
                } else if (parsed.type === 'message') {
                    content = parsed.text?.substring(0, 200) || content;
                }
            } catch {
                // Keep as is
            }

            // Truncate long content, BUT protect previous summaries
            const isSummary = content.includes('[INTERMEDIATE STEPS SUMMARIZED]');
            const truncationLimit = isSummary ? 5000 : 500; // Allow much larger limit for existing summary breakdown

            if (content.length > truncationLimit) {
                content = content.substring(0, truncationLimit) + '...';
            }

            return `[${role}] ${content}`;
        }).join('\n');

        // Use simple summarization prompt
        const summaryPrompt = [
            {
                role: 'system', content: `You are a summarization assistant. Summarize the following conversation history into a concise summary.
The history may start with a "[INTERMEDIATE STEPS SUMMARIZED]" block - this is the summary of the past. You MUST integrate this past context with the new recent messages into a single updated narrative.

Focus on:
1. What approaches were tried and failed
2. What approaches worked
3. Key insights or learnings
4. Current state of the task

Keep it brief but informative (max 500 words).` },
            { role: 'user', content: oldMessagesText }
        ];

        try {
            const summarySchema = {
                type: 'object',
                properties: {
                    summary: { type: 'string' }
                },
                required: ['summary'],
                additionalProperties: false
            };

            const result = await client.completion(summaryPrompt, summarySchema, 'SummaryOutput');
            return result.summary || 'Unable to summarize previous context.';
        } catch (error) {
            logger.error(`[ContextManager] Summarization failed: ${error}`);
            // Fallback: create a simple mechanical summary
            return this.createFallbackSummary(messages);
        }
    }

    /**
     * Create a simple fallback summary without LLM
     */
    private createFallbackSummary(messages: any[]): string {
        const toolsCalled: string[] = [];
        const errors: string[] = [];

        messages.forEach(msg => {
            try {
                const content = typeof msg.content === 'string'
                    ? JSON.parse(msg.content)
                    : msg.content;

                if (content?.type === 'tool_call') {
                    toolsCalled.push(content.tool);
                }
            } catch {
                // Check for errors in plain text
                if (msg.content?.includes('Error:') || msg.content?.includes('failed')) {
                    const errorMatch = msg.content.match(/Error:([^\n]+)/);
                    if (errorMatch) {
                        errors.push(errorMatch[1].trim().substring(0, 100));
                    }
                }
            }
        });

        const toolSummary = toolsCalled.length > 0
            ? `Tools used: ${[...new Set(toolsCalled)].join(', ')}`
            : '';
        const errorSummary = errors.length > 0
            ? `Errors encountered: ${errors.slice(0, 3).join('; ')}`
            : '';

        return `[Previous context summarized - ${messages.length} messages]\n${toolSummary}\n${errorSummary}`.trim();
    }

    /**
     * Apply context management to messages based on current token usage
     */
    async manageContext(
        messages: any[],
        currentTokens: number,
        contextLimit: number,
        client?: LMStudioClient
    ): Promise<{ messages: any[]; wasSummarized: boolean }> {
        let result = [...messages];
        let wasSummarized = false;

        // First, always prune old tool calls
        result = this.pruneToolCalls(result);

        // Logging for debug
        try {
            const logsDir = path.resolve(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
            fs.writeFileSync(
                path.join(logsDir, `summary_check_${Date.now()}.json`),
                JSON.stringify({
                    currentTokens,
                    contextLimit,
                    ratio: currentTokens / contextLimit,
                    messageCount: result.length,
                    messagesPreview: result.map(m => ({ role: m.role, length: m.content?.length }))
                }, null, 2)
            );
        } catch (err) { /* ignore log error */ }

        // Check if we need to summarize
        const usageRatio = currentTokens / contextLimit;

        if (usageRatio >= this.config.summarizationThreshold && client) {
            logger.info(`[ContextManager] Token usage at ${(usageRatio * 100).toFixed(1)}%, triggering summarization`);

            // Keep system message (first) AND original user task (second)
            // This ensures the agent never loses the original prompt
            const systemMessage = result[0];
            const originalTaskMessage = result.length > 1 ? result[1] : null;

            // We need at least 2 preserved messages + 2 old messages + recent to make sense
            const startIndex = 2;

            const recentMessages = result.slice(-this.config.recentMessagesToKeep);
            const oldMessages = result.slice(startIndex, -this.config.recentMessagesToKeep);

            if (oldMessages.length > 2 && originalTaskMessage) {  // Only summarize if we have enough old messages
                // Use AI-powered summarization for insightful summaries
                const summary = await this.summarizeMessages(oldMessages, client);

                // LOG THE SUMMARY OPERATION
                try {
                    const logPath = path.resolve(process.cwd(), 'logs', `summarization_${Date.now()}.json`);
                    fs.writeFileSync(logPath, JSON.stringify({
                        inputMessages: oldMessages,
                        generatedSummary: summary
                    }, null, 2));
                } catch (e) { /* ignore */ }

                // Find where the recent messages start - we need to maintain alternation
                // The pattern should be: system, user(task), assistant, user, assistant, ...

                // We will structure it as:
                // [System]
                // [User - Original Task]
                // [System - Summary of intermediate steps]
                // [Recent Messages...]

                const summaryMessage = {
                    role: 'system',
                    content: `[INTERMEDIATE STEPS SUMMARIZED]\n${summary}\n\nThe above is a summary of actions taken after the original task. Continuing with recent context below.`
                };

                result = [
                    systemMessage,
                    originalTaskMessage,
                    summaryMessage,
                    ...recentMessages
                ];

                wasSummarized = true;
                logger.info(`[ContextManager] Summarized ${oldMessages.length} messages, preserved Original Task + ${recentMessages.length} recent`);
            } else if (oldMessages.length > 2 && !originalTaskMessage) {
                // This should never happen - throw error instead of silent fallback
                throw new Error('[ContextManager] Unexpected state: oldMessages exist but no originalTaskMessage. Cannot summarize.');
            }

        }

        return { messages: result, wasSummarized };
    }
}

