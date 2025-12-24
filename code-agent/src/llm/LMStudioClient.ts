import OpenAI from 'openai';
import { logger } from '../utils/logger';

export interface LMStudioClientConfig {
    baseUrl?: string;
    model: string;
    apiKey?: string;
    verbose?: boolean;
}

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface ModelInfo {
    id: string;
    type?: string;
    maxContextLength?: number;
    loaded?: boolean;
    architecture?: string;
    quantization?: string;
}

export class LMStudioClient {
    private client: OpenAI;
    private model: string;
    private verbose: boolean;
    private baseUrl: string;

    // Token usage tracking
    lastUsage: TokenUsage | null = null;

    constructor(config: LMStudioClientConfig) {
        this.baseUrl = config.baseUrl || 'http://localhost:1234/v1';
        this.client = new OpenAI({
            baseURL: this.baseUrl,
            apiKey: config.apiKey || 'lm-studio',
            dangerouslyAllowBrowser: true
        });
        this.model = config.model;
        this.verbose = config.verbose || false;
    }

    /**
     * List all available models from LM Studio
     */
    static async listModels(baseUrl: string = 'http://localhost:1234/v1'): Promise<ModelInfo[]> {
        try {
            const response = await fetch(`${baseUrl}/models`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();

            return (data.data || []).map((m: any) => ({
                id: m.id,
                type: m.type || 'llm',
                loaded: m.state === 'loaded' || m.loaded === true,
                architecture: m.architecture,
                quantization: m.quantization
            }));
        } catch (error) {
            logger.error(`[LMStudioClient] Failed to list models: ${error}`);
            return [];
        }
    }

    /**
     * Get detailed info about a specific model including context length
     * Uses LM Studio's REST API v0 endpoint
     */
    static async getModelInfo(baseUrl: string = 'http://localhost:1234/v1', modelId?: string): Promise<ModelInfo | null> {
        try {
            const restBaseUrl = baseUrl.replace('/v1', '');

            // Try REST API v0 /models endpoint
            const response = await fetch(`${restBaseUrl}/api/v0/models`);

            if (!response.ok) {
                logger.info(`[LMStudioClient] /api/v0/models returned ${response.status}, using fallback`);
                return LMStudioClient.getModelInfoFallback(baseUrl, modelId);
            }

            const rawData = await response.json();
            const data = Array.isArray(rawData) ? rawData : (rawData.data || []);

            if (!Array.isArray(data)) {
                logger.error(`[LMStudioClient] Unexpected response format from /api/v0/models`);
                return LMStudioClient.getModelInfoFallback(baseUrl, modelId);
            }

            // Log the raw response for debugging
            logger.info(`[LMStudioClient] Got ${data.length} models from /api/v0/models`);

            // Find loaded model
            const loaded = data.find((m: any) => m.state === 'loaded' || m.loaded);

            if (loaded) {
                // Log all context-related fields for debugging
                logger.info(`[LMStudioClient] Loaded model fields: ${Object.keys(loaded).join(', ')}`);
                logger.info(`[LMStudioClient] context_length=${loaded.context_length}, n_ctx=${loaded.n_ctx}, max_context_length=${loaded.max_context_length}`);

                // Check for loaded/configured context - different from max
                // LM Studio stores the configured context in different fields depending on version
                const contextLen = loaded.loaded_context_length ||  // Actual loaded size
                    loaded.current_context_length ||
                    loaded.n_ctx ||                   // llama.cpp style
                    loaded.context_length ||          // Configured value
                    loaded.max_context_length ||      // Model max (fallback)
                    32768;

                logger.info(`[LMStudioClient] Using context length: ${contextLen}`);

                if (!modelId || loaded.id === modelId || loaded.path?.includes(modelId)) {
                    return {
                        id: loaded.id || loaded.path,
                        type: loaded.type,
                        maxContextLength: contextLen,
                        loaded: true,
                        architecture: loaded.architecture,
                        quantization: loaded.quantization
                    };
                }
            }

            // Find specific model by ID
            if (modelId) {
                const model = data.find((m: any) =>
                    m.id === modelId || m.path === modelId || m.path?.includes(modelId)
                );

                if (model) {
                    const contextLen = model.loaded_context_length ||
                        model.current_context_length ||
                        model.n_ctx ||
                        model.context_length ||
                        model.max_context_length ||
                        32768;
                    return {
                        id: model.id || model.path,
                        type: model.type,
                        maxContextLength: contextLen,
                        loaded: model.state === 'loaded' || model.loaded === true,
                        architecture: model.architecture,
                        quantization: model.quantization
                    };
                }
            }

            return null;
        } catch (error) {
            logger.error(`[LMStudioClient] Failed to get model info: ${error}`);
            return LMStudioClient.getModelInfoFallback(baseUrl, modelId);
        }
    }

    /**
     * Fallback method using /v1/models endpoint
     */
    private static async getModelInfoFallback(baseUrl: string, modelId?: string): Promise<ModelInfo | null> {
        try {
            const models = await LMStudioClient.listModels(baseUrl);
            if (!modelId) {
                return models.find(m => m.loaded) || models[0] || null;
            }
            return models.find(m => m.id === modelId) || null;
        } catch {
            return null;
        }
    }

    /**
     * Get the currently loaded model
     */
    static async getLoadedModel(baseUrl: string = 'http://localhost:1234/v1'): Promise<ModelInfo | null> {
        const models = await LMStudioClient.listModels(baseUrl);
        return models.find(m => m.loaded) || null;
    }

    async completion(messages: any[], jsonSchema: any, schemaName: string): Promise<any> {
        try {
            if (this.verbose) {
                logger.info(`[LMStudioClient] Sending request with schema: ${schemaName}`);
                logger.info(`[LMStudioClient] Schema: ${JSON.stringify(jsonSchema, null, 2)}`);
                logger.info(`[LMStudioClient] Messages:`);
                for (const msg of messages) {
                    logger.info(`  [${msg.role}]: ${msg.content.substring(0, 500)}${msg.content.length > 500 ? '...' : ''}`);
                }
            }

            const completion = await this.client.chat.completions.create({
                model: this.model,
                messages: messages,
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: schemaName,
                        strict: true,
                        schema: jsonSchema
                    }
                }
            });

            // Extract token usage from response
            if (completion.usage) {
                this.lastUsage = {
                    promptTokens: completion.usage.prompt_tokens,
                    completionTokens: completion.usage.completion_tokens,
                    totalTokens: completion.usage.total_tokens
                };

                if (this.verbose) {
                    logger.info(`[LMStudioClient] Token usage - Prompt: ${this.lastUsage.promptTokens}, Completion: ${this.lastUsage.completionTokens}, Total: ${this.lastUsage.totalTokens}`);
                }
            }

            const content = completion.choices[0].message.content;
            if (!content) {
                throw new Error("Received empty content from LLM");
            }

            if (this.verbose) {
                logger.info(`[LMStudioClient] Raw response content: ${content}`);
            }

            // Handle case where content might already be parsed or is a string
            if (typeof content === 'object') {
                return content;
            }

            try {
                const parsed = JSON.parse(content);
                if (this.verbose) {
                    logger.info(`[LMStudioClient] Parsed response: ${JSON.stringify(parsed)}`);
                }
                return parsed;
            } catch (parseError) {
                logger.error(`[LMStudioClient] Failed to parse JSON response: ${content}`);
                logger.error(`[LMStudioClient] Parse error: ${parseError}`);
                throw new Error(`Failed to parse LLM output as JSON: ${content}`);
            }
        } catch (error) {
            logger.error(`[LMStudioClient] Call failed: ${error}`);
            throw error;
        }
    }

    /**
     * Get the last token usage
     */
    getLastUsage(): TokenUsage | null {
        return this.lastUsage;
    }
}
