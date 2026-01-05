import { EventEmitter } from 'events';
import * as path from 'path';

// Import from the existing code-agent package
// Note: These paths assume code-agent is a sibling directory
const codeAgentPath = path.resolve(__dirname, '../../../code-agent/dist');

// We'll dynamically require the compiled code-agent modules
// This requires code-agent to be built first (tsc)

export interface AgentConfig {
    repoRoot: string;
    userTask: string;
    model: string;
    baseUrl: string;
    allowedCommands?: string[];
    verbose?: boolean;
    // Tuning parameters
    maxContextHistory?: number;
    summarizationThreshold?: number;
    supervisorInterval?: number;
    // Multi-agent mode
    useMultiAgent?: boolean;
}

export class AgentRunner extends EventEmitter {
    private isRunning = false;
    private isCancelled = false;
    private isPaused = false;
    private pendingUserInput: ((value: string) => void) | null = null;
    private executePlanNode: any = null; // Reference to ExecutePlanNode for pause/resume
    private currentPlan: any = null; // Store extracted plan

    // Session-based command permissions
    private allowedCommandTypes: Set<string> = new Set();
    private allowedExactCommands: Set<string> = new Set();

    // Cached pipeline structure - will be populated when pipeline is created
    private pipelineNodes: string[] = [
        'ScanWorkspace',
        'SelectFiles',
        'AttachFiles',
        'ExtractPlan',
        'ExecutePlan'
    ];

    constructor() {
        super();
    }

    /**
     * List available models from LM Studio
     */
    async listModels(baseUrl: string = 'http://localhost:1234/v1'): Promise<any[]> {
        try {
            const { LMStudioClient } = require(path.join(codeAgentPath, 'llm/LMStudioClient'));
            return await LMStudioClient.listModels(baseUrl);
        } catch (error: any) {
            this.emit('error', { message: `Failed to list models: ${error.message}` });
            return [];
        }
    }

    /**
     * Get info about a specific model (including context length)
     */
    async getModelInfo(baseUrl: string = 'http://localhost:1234/v1', modelId?: string): Promise<any> {
        try {
            const { LMStudioClient } = require(path.join(codeAgentPath, 'llm/LMStudioClient'));
            return await LMStudioClient.getModelInfo(baseUrl, modelId);
        } catch (error: any) {
            this.emit('error', { message: `Failed to get model info: ${error.message}` });
            return null;
        }
    }

    /**
     * Get the currently loaded model from LM Studio
     */
    async getLoadedModel(baseUrl: string = 'http://localhost:1234/v1'): Promise<any> {
        try {
            const { LMStudioClient } = require(path.join(codeAgentPath, 'llm/LMStudioClient'));
            return await LMStudioClient.getLoadedModel(baseUrl);
        } catch (error: any) {
            this.emit('error', { message: `Failed to get loaded model: ${error.message}` });
            return null;
        }
    }

    /**
     * Returns the pipeline structure for dynamic graph rendering.
     * This introspects the actual pipeline nodes.
     */
    getPipelineStructure(): { nodes: string[] } {
        return { nodes: this.pipelineNodes };
    }

    /**
     * Get the current plan if available
     */
    getCurrentPlan(): any {
        return this.currentPlan;
    }

    /**
     * Allow a command type (e.g., "python", "npm") for this session
     */
    allowCommandType(type: string): void {
        this.allowedCommandTypes.add(type);
        this.emit('permission:type_added', { type });
    }

    /**
     * Allow an exact command for this session
     */
    allowExactCommand(command: string): void {
        this.allowedExactCommands.add(command);
        this.emit('permission:exact_added', { command });
    }

    /**
     * Check if a command is allowed (either by type or exact match)
     */
    isCommandAllowed(command: string): boolean {
        const cmdType = command.split(' ')[0];
        return this.allowedCommandTypes.has(cmdType) ||
            this.allowedExactCommands.has(command);
    }

    /**
     * Pause the agent execution
     */
    pause(): void {
        this.isPaused = true;
        if (this.executePlanNode && typeof this.executePlanNode.pause === 'function') {
            this.executePlanNode.pause();
        }
        this.emit('agent:paused', {});
    }

    /**
     * Resume agent execution with optional guidance
     */
    resume(guidance?: string): void {
        this.isPaused = false;
        if (this.executePlanNode && typeof this.executePlanNode.resume === 'function') {
            this.executePlanNode.resume(guidance);
        }
        this.emit('agent:resumed', { guidance });
    }

    /**
     * Run the agent with the given configuration.
     */
    async run(config: AgentConfig): Promise<void> {
        if (this.isRunning) {
            throw new Error('Agent is already running');
        }

        this.isRunning = true;
        this.isCancelled = false;
        this.isPaused = false;
        this.currentPlan = null;

        try {
            // Get model info for context limit
            let contextLimit = 32768; // Default
            try {
                const { LMStudioClient } = require(path.join(codeAgentPath, 'llm/LMStudioClient'));
                const modelInfo = await LMStudioClient.getModelInfo(config.baseUrl, config.model);
                if (modelInfo?.maxContextLength) {
                    contextLimit = modelInfo.maxContextLength;
                    this.emit('model:info', { model: config.model, contextLimit });
                }
            } catch (e: any) {
                // Continue with default context limit
            }

            // =====================
            // MULTI-AGENT MODE
            // =====================
            if (config.useMultiAgent) {
                this.emit('pipeline:start', { name: 'MultiAgent', multiAgent: true, nodes: ['ScanWorkspace', 'SelectFiles', 'AttachFiles', 'ExtractPlan', 'MultiAgent'] });

                // Run planning nodes first (same as single-agent mode)
                const { Pipeline } = require(path.join(codeAgentPath, 'pipeline/Pipeline'));
                const { ScanWorkspaceNode } = require(path.join(codeAgentPath, 'nodes/ScanWorkspaceNode'));
                const { SelectFilesNode } = require(path.join(codeAgentPath, 'nodes/SelectFilesNode'));
                const { AttachFilesNode } = require(path.join(codeAgentPath, 'nodes/AttachFilesNode'));
                const { ExtractPlanNode } = require(path.join(codeAgentPath, 'nodes/ExtractPlanNode'));
                const { LMStudioClient } = require(path.join(codeAgentPath, 'llm/LMStudioClient'));
                const { MultiAgentOrchestrator } = require(path.join(codeAgentPath, 'orchestrator/MultiAgentOrchestrator'));

                // Build planning pipeline
                const planPipeline = Pipeline.create('MultiAgentPlanning')
                    .pipe(new ScanWorkspaceNode())
                    .pipe(new SelectFilesNode())
                    .pipe(new AttachFilesNode())
                    .pipe(new ExtractPlanNode());

                // Forward pipeline events
                if (typeof planPipeline.on === 'function') {
                    planPipeline.on('node:enter', (data: any) => this.emit('node:enter', data));
                    planPipeline.on('node:exit', (data: any) => {
                        if (data.nodeName === 'ExtractPlan' && data.state?.plan) {
                            this.currentPlan = data.state.plan;
                            this.emit('plan:extracted', { plan: this.currentPlan });
                        }
                        this.emit('node:exit', data);
                    });
                }

                // Create pipeline context
                const planContext = {
                    logger: (msg: string) => {
                        this.emit('log', { message: msg, timestamp: Date.now() });
                    },
                    askUser: async (query: string, options?: any): Promise<string> => {
                        if (this.isCancelled) throw new Error('Agent cancelled');
                        this.emit('ask_user', { query, options });
                        return new Promise((resolve, reject) => {
                            this.pendingUserInput = (input: string) => {
                                if (this.isCancelled) reject(new Error('Agent cancelled'));
                                else resolve(input);
                            };
                        });
                    }
                };

                // Initial state for planning
                const planState = {
                    repoRoot: config.repoRoot,
                    userTask: config.userTask,
                    allFiles: [],
                    selectedFiles: [],
                    fileContents: new Map(),
                    history: [],
                    results: null,
                    contextLimit,
                    clientConfig: {
                        baseUrl: config.baseUrl,
                        model: config.model,
                        verbose: config.verbose || false
                    }
                };

                // Run planning pipeline
                const planResult = await planPipeline.run(planState, planContext);

                // Now run orchestrator with planned state
                const client = new LMStudioClient({
                    baseUrl: config.baseUrl,
                    model: config.model,
                    verbose: config.verbose || false
                });

                const orchestrator = new MultiAgentOrchestrator({
                    client,
                    repoRoot: config.repoRoot,
                    emitter: this,
                    logger: (msg: string) => {
                        this.emit('log', { message: msg, timestamp: Date.now() });
                    },
                    askUser: planContext.askUser,
                    maxStepsPerAgent: 400
                });

                // Build todo list from plan
                const todoList = planResult.plan?.todos
                    ?.map((t: any, i: number) => `${i + 1}. ${t.title}: ${t.details}`)
                    .join('\n') || '';

                // Get goal from plan restatement
                const goal = planResult.plan?.restatement || config.userTask;

                this.emit('node:enter', { nodeName: 'MultiAgent' });

                const result = await orchestrator.run(
                    config.userTask,
                    goal,
                    todoList,
                    planResult.selectedFiles || []
                );

                this.emit('node:exit', { nodeName: 'MultiAgent' });

                this.emit('pipeline:end', {
                    name: 'MultiAgent',
                    success: result.success,
                    message: result.message
                });

                return;
            }

            // =====================
            // SINGLE-AGENT MODE (existing)
            // =====================
            // Dynamically import the code-agent modules
            const { Pipeline } = require(path.join(codeAgentPath, 'pipeline/Pipeline'));
            const { ScanWorkspaceNode } = require(path.join(codeAgentPath, 'nodes/ScanWorkspaceNode'));
            const { SelectFilesNode } = require(path.join(codeAgentPath, 'nodes/SelectFilesNode'));
            const { AttachFilesNode } = require(path.join(codeAgentPath, 'nodes/AttachFilesNode'));
            const { ExtractPlanNode } = require(path.join(codeAgentPath, 'nodes/ExtractPlanNode'));
            const { ExecutePlanNode } = require(path.join(codeAgentPath, 'nodes/ExecutePlanNode'));

            // Create ExecutePlanNode and store reference for pause/resume
            this.executePlanNode = new ExecutePlanNode(this);

            // Build the pipeline
            const pipeline = Pipeline.create('CodeAgent')
                .pipe(new ScanWorkspaceNode())
                .pipe(new SelectFilesNode())
                .pipe(new AttachFilesNode())
                .pipe(new ExtractPlanNode())
                .pipe(this.executePlanNode);

            // Update pipeline nodes from actual structure
            if (typeof pipeline.getNodeNames === 'function') {
                this.pipelineNodes = pipeline.getNodeNames();
            }

            // Forward pipeline events
            if (typeof pipeline.on === 'function') {
                pipeline.on('pipeline:start', (data: any) => this.emit('pipeline:start', data));
                pipeline.on('pipeline:end', (data: any) => this.emit('pipeline:end', data));
                pipeline.on('pipeline:error', (data: any) => this.emit('pipeline:error', data));
                pipeline.on('node:enter', (data: any) => this.emit('node:enter', data));
                pipeline.on('node:exit', (data: any) => {
                    // Capture plan when ExtractPlan node exits
                    if (data.nodeName === 'ExtractPlan' && data.state?.plan) {
                        this.currentPlan = data.state.plan;
                        this.emit('plan:extracted', { plan: this.currentPlan });
                    }
                    this.emit('node:exit', data);
                });
            }

            // Combine session permissions with config permissions
            const allAllowedCommands = [
                ...(config.allowedCommands || []),
                ...Array.from(this.allowedCommandTypes),
                ...Array.from(this.allowedExactCommands)
            ];

            // Create pipeline context with GUI integration
            const context = {
                logger: (msg: string) => {
                    this.emit('log', { message: msg, timestamp: Date.now() });
                },
                askUser: async (query: string, options?: any): Promise<string> => {
                    if (this.isCancelled) {
                        throw new Error('Agent cancelled');
                    }

                    // Check if this is a command approval with our permissions
                    if (options?.command && this.isCommandAllowed(options.command)) {
                        return 'allow_once'; // Auto-approve
                    }

                    this.emit('ask_user', { query, options });

                    return new Promise((resolve, reject) => {
                        this.pendingUserInput = (input: string) => {
                            if (this.isCancelled) {
                                reject(new Error('Agent cancelled'));
                            } else {
                                resolve(input);
                            }
                        };
                    });
                }
            };

            // Create initial state
            const initialState = {
                repoRoot: config.repoRoot,
                userTask: config.userTask,
                allFiles: [],
                selectedFiles: [],
                fileContents: new Map(),
                history: [],
                results: null,
                contextLimit, // Pass context limit for token tracking
                clientConfig: {
                    baseUrl: config.baseUrl,
                    model: config.model,
                    verbose: config.verbose || false,
                    allowedCommands: allAllowedCommands
                },
                config: {
                    maxContextHistory: config.maxContextHistory,
                    summarizationThreshold: config.summarizationThreshold,
                    supervisorInterval: config.supervisorInterval
                }
            };

            // Run the pipeline
            const result = await pipeline.run(initialState, context);

            this.emit('pipeline:end', {
                name: 'CodeAgent',
                finalState: result,
                success: true
            });

        } catch (error: any) {
            if (!this.isCancelled) {
                this.emit('pipeline:error', {
                    error: error.message,
                    stack: error.stack
                });
            }
            throw error;
        } finally {
            this.isRunning = false;
            this.pendingUserInput = null;
            this.executePlanNode = null;
        }
    }

    /**
     * Provide user input to a pending prompt.
     */
    provideUserInput(input: string): void {
        if (this.pendingUserInput) {
            const callback = this.pendingUserInput;
            this.pendingUserInput = null;
            callback(input);
        }
    }

    /**
     * Cancel the running agent.
     */
    cancel(): void {
        this.isCancelled = true;
        if (this.pendingUserInput) {
            this.pendingUserInput('');
        }
        this.emit('cancelled', {});
    }

    /**
     * Check if agent is currently running.
     */
    getIsRunning(): boolean {
        return this.isRunning;
    }

    /**
     * Check if agent is paused.
     */
    getIsPaused(): boolean {
        return this.isPaused;
    }
}
