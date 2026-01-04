import { EventEmitter } from 'events';
import { LMStudioClient } from '../llm/LMStudioClient';
import { ContextManager } from '../utils/contextManager';
import { zodSchemaToJsonSchema } from '../prompts/prompt.interface';
import {
    ThinkerPromptBuilder,
    ImplementerPromptBuilder,
    TesterPromptBuilder,
    FinisherPromptBuilder
} from '../prompts';
import {
    ThinkerOutputSchema,
    ImplementerOutputSchema,
    TesterOutputSchema,
    FinisherFeedbackSchema,
    ImplementTask,
    TestResult,
    TaskResultEntry
} from '../schemas/AgentSchemas';

// Import tools
import { readFile } from '../tools/read_file';
import { runCmd } from '../tools/run_cmd';
import { addFunction, removeFunction } from '../tools/add_remove_function';
import { editFunction } from '../tools/edit_function';
import { readFunction } from '../tools/read_function';
import { writeFile } from '../tools/write_file';
import { getFileOutline } from '../tools/get_file_outline';

/**
 * Configuration for the multi-agent orchestrator
 */
export interface OrchestratorConfig {
    client: LMStudioClient;
    repoRoot: string;
    emitter?: EventEmitter;
    logger: (msg: string) => void;
    askUser: (query: string, options?: { multiline?: boolean }) => Promise<string>;
    maxStepsPerAgent: number;
}

/**
 * State maintained across the agent pipeline
 */
interface OrchestratorState {
    task: string;
    todoList: string;
    allFiles: string[];
    testerCreatedFiles: string[];
    taskResults: TaskResultEntry[];
    lastImplementPayload?: { description: string; tasks: ImplementTask[] };
}

/**
 * Multi-Agent Orchestrator
 * Manages the Thinker → Implementer → Tester → Finisher pipeline
 */
export class MultiAgentOrchestrator {
    private config: OrchestratorConfig;
    private contextManager: ContextManager;
    private state: OrchestratorState;

    constructor(config: OrchestratorConfig) {
        this.config = config;
        this.contextManager = new ContextManager({
            maxToolCalls: 5,
            summarizationThreshold: 0.65,
            recentMessagesToKeep: 10
        });
        this.state = {
            task: '',
            todoList: '',
            allFiles: [],
            testerCreatedFiles: [],
            taskResults: []
        };
    }

    private log(msg: string): void {
        this.config.logger(msg);
    }

    private emit(event: string, data: any): void {
        this.config.emitter?.emit(event, data);
    }

    /**
     * Run the full multi-agent pipeline
     */
    async run(task: string, todoList: string, files: string[]): Promise<{ success: boolean; message: string }> {
        this.state.task = task;
        this.state.todoList = todoList;
        this.state.allFiles = files;

        this.log('[Orchestrator] Starting multi-agent pipeline');
        this.emit('orchestrator:start', { task });

        try {
            // Main loop: Thinker processes until final
            const result = await this.runThinkerLoop();
            return result;
        } catch (error) {
            this.log(`[Orchestrator] Error: ${error}`);
            return { success: false, message: String(error) };
        }
    }

    /**
     * Run the Thinker agent loop
     */
    private async runThinkerLoop(): Promise<{ success: boolean; message: string }> {
        const promptBuilder = new ThinkerPromptBuilder();
        const schema = zodSchemaToJsonSchema(ThinkerOutputSchema);

        let messages: any[] = [
            { role: 'system', content: promptBuilder.buildSystemPrompt() },
            {
                role: 'user',
                content: promptBuilder.buildUserPrompt({
                    task: this.state.task,
                    todoList: this.state.todoList,
                    currentFiles: this.state.allFiles
                })
            }
        ];

        let stepCount = 0;
        let lastWasImplement = false;

        while (stepCount < this.config.maxStepsPerAgent) {
            stepCount++;
            this.log(`[Thinker] Step ${stepCount}`);

            const rawResponse = await this.config.client.completion(messages, schema, 'ThinkerOutput');
            const response = ThinkerOutputSchema.parse(rawResponse);

            messages.push({ role: 'assistant', content: JSON.stringify(response) });
            this.emit('thinker:step', { step: stepCount, response });

            if (response.type === 'message') {
                this.log(`[Thinker] ${response.text}`);
                lastWasImplement = false;
                continue;
            }

            if (response.type === 'tool_call') {
                const result = await this.executeThinkerTool(response.tool, response.args);
                messages.push({ role: 'user', content: `Tool Output: ${JSON.stringify(result)}` });
                lastWasImplement = false;
                continue;
            }

            if (response.type === 'implement') {
                if (lastWasImplement) {
                    messages.push({
                        role: 'system',
                        content: 'You must output a message or use another tool before calling implement again.'
                    });
                    continue;
                }

                const payload = response.payload;
                this.state.lastImplementPayload = payload;
                this.log(`[Thinker] Dispatching ${payload.tasks.length} tasks to Implementer`);

                // Process each task through Implementer → Tester
                for (let i = 0; i < payload.tasks.length; i++) {
                    const task = payload.tasks[i];

                    // Run Implementer
                    const implResult = await this.runImplementer(payload.description, task, i + 1, payload.tasks.length);

                    if (implResult.error) {
                        // Implementer failed - return to Thinker
                        messages.push({
                            role: 'user',
                            content: `Implementer Error on task ${i + 1}: ${implResult.error}\n\nPlease adjust your approach.`
                        });
                        break;
                    }

                    // Run Tester
                    const testResult = await this.runTester(payload.description, task, implResult.summary || '');

                    this.state.taskResults.push({
                        task,
                        test_result: testResult
                    });
                }

                // If we completed all tasks, run Finisher
                if (this.state.taskResults.length === payload.tasks.length) {
                    const feedback = await this.runFinisher(payload.description);
                    messages.push({
                        role: 'user',
                        content: `Finisher Feedback:\n${feedback.overall}\n\nTask Results: ${this.state.taskResults.length} tasks processed.`
                    });
                    this.state.taskResults = []; // Reset for next iteration
                }

                lastWasImplement = true;
                continue;
            }

            if (response.type === 'final') {
                this.log(`[Thinker] Final: ${response.criteriaStatus} - ${response.text}`);
                this.emit('thinker:final', response);
                return { success: response.criteriaStatus === 'success', message: response.text };
            }
        }

        return { success: false, message: 'Thinker reached max steps' };
    }

    /**
     * Execute a Thinker tool
     */
    private async executeThinkerTool(tool: string, args: Record<string, any>): Promise<any> {
        switch (tool) {
            case 'read_file':
                return readFile(this.config.repoRoot, args as any);
            case 'run_cmd':
                return await runCmd(this.config.repoRoot, args as any);
            case 'manage_todos':
                // TODO: Implement todo management
                return { success: true, message: 'Todo updated' };
            default:
                return { error: `Unknown tool: ${tool}` };
        }
    }

    /**
     * Run the Implementer agent for a single task
     */
    private async runImplementer(
        description: string,
        task: ImplementTask,
        index: number,
        total: number
    ): Promise<{ summary?: string; error?: string }> {
        const promptBuilder = new ImplementerPromptBuilder();
        const schema = zodSchemaToJsonSchema(ImplementerOutputSchema);

        let messages: any[] = [
            { role: 'system', content: promptBuilder.buildSystemPrompt() },
            {
                role: 'user',
                content: promptBuilder.buildUserPrompt({
                    overallDescription: description,
                    currentTask: task,
                    taskIndex: index,
                    totalTasks: total,
                    todoList: this.state.todoList
                })
            }
        ];

        let stepCount = 0;

        while (stepCount < this.config.maxStepsPerAgent) {
            stepCount++;
            this.log(`[Implementer] Step ${stepCount}`);

            const rawResponse = await this.config.client.completion(messages, schema, 'ImplementerOutput');
            const response = ImplementerOutputSchema.parse(rawResponse);

            messages.push({ role: 'assistant', content: JSON.stringify(response) });
            this.emit('implementer:step', { step: stepCount, response });

            if (response.type === 'message') {
                this.log(`[Implementer] ${response.text}`);
                continue;
            }

            if (response.type === 'tool_call') {
                const result = await this.executeImplementerTool(response.tool, response.args);
                messages.push({ role: 'user', content: `Tool Output: ${JSON.stringify(result)}` });
                continue;
            }

            if (response.type === 'done') {
                this.log(`[Implementer] Done: ${response.summary}`);
                return { summary: response.summary };
            }

            if (response.type === 'error') {
                this.log(`[Implementer] Error: ${response.reason}`);
                return { error: response.reason };
            }
        }

        return { error: 'Implementer reached max steps' };
    }

    /**
     * Execute an Implementer tool
     */
    private async executeImplementerTool(tool: string, args: Record<string, any>): Promise<any> {
        switch (tool) {
            case 'add_function':
                return addFunction(this.config.repoRoot, args as any);
            case 'edit_function':
                return editFunction(this.config.repoRoot, args as any);
            case 'remove_function':
                return removeFunction(this.config.repoRoot, args as any);
            case 'read_file':
                return readFile(this.config.repoRoot, args as any);
            case 'read_function':
                return readFunction(this.config.repoRoot, args as any);
            case 'write_file':
                return writeFile(this.config.repoRoot, args as any);
            case 'get_file_outline':
                return getFileOutline(this.config.repoRoot, args as any);
            default:
                return { error: `Unknown tool: ${tool}` };
        }
    }

    /**
     * Run the Tester agent
     */
    private async runTester(description: string, task: ImplementTask, implSummary: string): Promise<TestResult> {
        const promptBuilder = new TesterPromptBuilder();
        const schema = zodSchemaToJsonSchema(TesterOutputSchema);

        let messages: any[] = [
            { role: 'system', content: promptBuilder.buildSystemPrompt() },
            {
                role: 'user',
                content: promptBuilder.buildUserPrompt({
                    overallDescription: description,
                    completedTask: task,
                    implementerSummary: implSummary,
                    todoList: this.state.todoList,
                    filesCreatedByTester: this.state.testerCreatedFiles
                })
            }
        ];

        let stepCount = 0;

        while (stepCount < this.config.maxStepsPerAgent) {
            stepCount++;
            this.log(`[Tester] Step ${stepCount}`);

            const rawResponse = await this.config.client.completion(messages, schema, 'TesterOutput');
            const response = TesterOutputSchema.parse(rawResponse);

            messages.push({ role: 'assistant', content: JSON.stringify(response) });
            this.emit('tester:step', { step: stepCount, response });

            if (response.type === 'message') {
                this.log(`[Tester] ${response.text}`);
                continue;
            }

            if (response.type === 'tool_call') {
                const result = await this.executeTesterTool(response.tool, response.args);
                messages.push({ role: 'user', content: `Tool Output: ${JSON.stringify(result)}` });
                continue;
            }

            if (response.type === 'result') {
                this.log(`[Tester] Result: ${response.payload.successfully_implemented ? 'SUCCESS' : 'FAILED'}`);
                return response.payload;
            }
        }

        return {
            successfully_implemented: false,
            successes: '',
            mistakes: 'Tester reached max steps without producing result',
            tests_to_keep: []
        };
    }

    /**
     * Execute a Tester tool
     */
    private async executeTesterTool(tool: string, args: Record<string, any>): Promise<any> {
        switch (tool) {
            case 'run_cmd':
                return await runCmd(this.config.repoRoot, args as any);
            case 'create_file':
                const result = writeFile(this.config.repoRoot, args as any);
                if ('success' in result && result.success) {
                    this.state.testerCreatedFiles.push((args as any).path);
                }
                return result;
            case 'read_file':
                return readFile(this.config.repoRoot, args as any);
            default:
                return { error: `Unknown tool: ${tool}` };
        }
    }

    /**
     * Run the Finisher agent
     */
    private async runFinisher(description: string): Promise<{ overall: string; task_results: TaskResultEntry[] }> {
        const promptBuilder = new FinisherPromptBuilder();
        const schema = zodSchemaToJsonSchema(FinisherFeedbackSchema);

        const messages: any[] = [
            { role: 'system', content: promptBuilder.buildSystemPrompt() },
            {
                role: 'user',
                content: promptBuilder.buildUserPrompt({
                    overallDescription: description,
                    taskResults: this.state.taskResults,
                    todoList: this.state.todoList
                })
            }
        ];

        const rawResponse = await this.config.client.completion(messages, schema, 'FinisherFeedback');
        const response = FinisherFeedbackSchema.parse(rawResponse);

        this.log(`[Finisher] Overall: ${response.overall}`);
        this.emit('finisher:feedback', response);

        return {
            overall: response.overall,
            task_results: this.state.taskResults
        };
    }
}
