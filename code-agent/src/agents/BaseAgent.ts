import { LMStudioClient } from '../llm/LMStudioClient';
import { ContextManager } from '../utils/contextManager';
import { zodSchemaToJsonSchema } from '../prompts/prompt.interface';
import { z } from 'zod';
import { EventEmitter } from 'events';

/**
 * Configuration for an agent
 */
export interface AgentConfig {
    /** LLM client for making completions */
    client: LMStudioClient;
    /** Repository root for file operations */
    repoRoot: string;
    /** Maximum steps before forced termination */
    maxSteps: number;
    /** Event emitter for GUI updates */
    emitter?: EventEmitter;
    /** Logger function */
    logger: (msg: string) => void;
}

/**
 * Message in conversation history
 */
export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Result of running an agent
 */
export interface AgentResult<T> {
    success: boolean;
    output?: T;
    error?: string;
    steps: number;
}

/**
 * Abstract base class for all agents in the multi-agent architecture.
 * Provides shared functionality: conversation history, context management,
 * tool dispatch, and the main agent loop.
 */
export abstract class BaseAgent<TOutput> {
    protected config: AgentConfig;
    protected messages: Message[] = [];
    protected contextManager: ContextManager;
    protected stepCount = 0;

    /** Name of this agent (for logging) */
    abstract readonly name: string;

    /** System prompt for this agent */
    abstract buildSystemPrompt(): string;

    /** Zod schema for validating agent output */
    abstract getOutputSchema(): z.ZodType<any>;

    /** Handle a single step's output, return true if agent should stop */
    abstract handleOutput(output: any): Promise<{ done: boolean; result?: TOutput; error?: string }>;

    /** Get available tools for this agent */
    abstract getAvailableTools(): Map<string, (args: any) => Promise<any>>;

    constructor(config: AgentConfig) {
        this.config = config;
        this.contextManager = new ContextManager({
            maxToolCalls: 5,
            summarizationThreshold: 0.65,
            recentMessagesToKeep: 10
        });
    }

    /**
     * Initialize conversation with system prompt and initial user message
     */
    protected initializeConversation(userMessage: string): void {
        this.messages = [
            { role: 'system', content: this.buildSystemPrompt() },
            { role: 'user', content: userMessage }
        ];
        this.stepCount = 0;
    }

    /**
     * Add a message to conversation history
     */
    protected addMessage(role: 'user' | 'assistant' | 'system', content: string): void {
        this.messages.push({ role, content });
    }

    /**
     * Emit an event if emitter is available (for GUI updates)
     */
    protected emit(event: string, data: any): void {
        if (this.config.emitter) {
            this.config.emitter.emit(event, data);
        }
    }

    /**
     * Log a message
     */
    protected log(msg: string): void {
        this.config.logger(`[${this.name}] ${msg}`);
    }

    /**
     * Execute a tool call and return the result
     */
    protected async executeTool(toolName: string, args: any): Promise<string> {
        const tools = this.getAvailableTools();
        const tool = tools.get(toolName);

        if (!tool) {
            return JSON.stringify({ success: false, error: `Unknown tool: ${toolName}` });
        }

        try {
            const result = await tool(args);
            return JSON.stringify(result);
        } catch (error) {
            return JSON.stringify({ success: false, error: String(error) });
        }
    }

    /**
     * Run the agent loop until completion or max steps
     */
    async run(userMessage: string): Promise<AgentResult<TOutput>> {
        this.initializeConversation(userMessage);
        const schema = this.getOutputSchema();
        const jsonSchema = zodSchemaToJsonSchema(schema);

        while (this.stepCount < this.config.maxSteps) {
            this.stepCount++;
            this.log(`Step ${this.stepCount}`);

            // Manage context if needed
            const contextResult = await this.contextManager.manageContext(
                this.messages,
                this.estimateTokens(),
                32000, // Default context limit
                this.config.client
            );
            this.messages = contextResult.messages;

            // Get LLM response
            let response;
            try {
                const rawResponse = await this.config.client.completion(
                    this.messages,
                    jsonSchema,
                    `${this.name}Output`
                );
                response = schema.parse(rawResponse);
            } catch (error) {
                this.log(`Validation error: ${error}`);
                this.addMessage('system', `Your last response was invalid: ${error}. Please try again.`);
                continue;
            }

            // Log the response
            this.addMessage('assistant', JSON.stringify(response));
            this.emit('agent:step', { agent: this.name, step: this.stepCount, response });

            // Handle the response type
            if (response.type === 'message') {
                this.log(`Message: ${response.text}`);
                this.emit('agent:message', { agent: this.name, text: response.text });
                continue;
            }

            if (response.type === 'tool_call') {
                this.log(`Tool call: ${response.tool}`);
                const toolResult = await this.executeTool(response.tool, response.args);
                this.addMessage('user', `Tool Output: ${toolResult}`);
                this.emit('agent:tool', { agent: this.name, tool: response.tool, result: toolResult });
                continue;
            }

            // Let subclass handle specific output types (done, error, result, implement, etc.)
            const handleResult = await this.handleOutput(response);
            if (handleResult.done) {
                return {
                    success: !handleResult.error,
                    output: handleResult.result,
                    error: handleResult.error,
                    steps: this.stepCount
                };
            }
        }

        // Max steps reached
        return {
            success: false,
            error: `Agent ${this.name} reached max steps (${this.config.maxSteps})`,
            steps: this.stepCount
        };
    }

    /**
     * Rough token estimation for context management
     */
    private estimateTokens(): number {
        return this.messages.reduce((acc, msg) => acc + Math.ceil(msg.content.length / 4), 0);
    }
}
