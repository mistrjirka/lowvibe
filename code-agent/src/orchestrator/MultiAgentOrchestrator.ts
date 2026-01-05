import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
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
    ThinkerOutput,
    ImplementerOutputSchema,
    TesterOutputSchema,
    FinisherFeedbackSchema,
    ImplementTask,
    TestResult,
    TaskResultEntry,
    CommandCorrectionSchema,
    CommandCorrection
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
    goal: string;  // Restated goal from planning
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
            goal: '',
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
     * Normalize tool args - LLM sometimes returns nested structures
     * e.g., {file_path: {path: ...}} instead of {path: ...}
     */
    private normalizeArgs(tool: string, args: Record<string, any>): Record<string, any> {
        // If args has 'path' at top level, it's already normalized
        if (args.path) return args;

        // Check for nested structures like file_path.path
        if (args.file_path?.path) {
            return { path: args.file_path.path, includeCallers: args.caller_info?.include || false };
        }

        // Check for cmd in various forms
        if (args.command) {
            return { cmd: args.command, cwd: args.cwd || args.directory || '.' };
        }

        return args;
    }

    /**
     * Run the full multi-agent pipeline
     */
    async run(task: string, goal: string, todoList: string, files: string[]): Promise<{ success: boolean; message: string }> {
        this.state.task = task;
        this.state.goal = goal;
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
                    goal: this.state.goal,
                    todoList: this.state.todoList,
                    currentFiles: this.state.allFiles
                })
            }
        ];

        let stepCount = 0;
        let lastWasImplement = false;

        while (stepCount < this.config.maxStepsPerAgent) {
            stepCount++;
            this.log(`[Thinker] Step ${stepCount}/${this.config.maxStepsPerAgent}`);

            let response: ThinkerOutput;
            try {
                // Manage Context
                messages = this.manageContext(messages);

                this.log(`[DEBUG] Calling LLM completion for Thinker Step ${stepCount}...`);
                const rawResponse = await this.config.client.completion(messages, schema, 'ThinkerOutput');
                this.log(`[DEBUG] Received LLM response for Thinker Step ${stepCount}`);

                try {
                    response = ThinkerOutputSchema.parse(rawResponse);
                } catch (parseError: any) {
                    this.log(`[DEBUG] Thinker JSON Parse Error: ${parseError.message}`);
                    throw parseError; // Rethrow to outer catch
                }

                messages.push({ role: 'assistant', content: JSON.stringify(response) });

                // Emit raw step event with correct structure for UI
                if (response.type === 'message') {
                    this.emit('thinker:step', { step: stepCount, message: { role: 'assistant', content: response.text } });
                } else if (response.type === 'tool_call') {
                    this.emit('thinker:step', {
                        step: stepCount,
                        message: {
                            role: 'assistant',
                            content: `Tool Call: ${response.tool}`,
                            tool_calls: [{ id: `call_${Date.now()}`, type: 'function', function: { name: response.tool, arguments: JSON.stringify(response.args) } }]
                        }
                    });
                } else {
                    // For implement/final, still emit something so UI updates
                    this.emit('thinker:step', { step: stepCount, response });
                }

            } catch (error) {
                this.log(`[Thinker] Error in Step ${stepCount}: ${error}`);
                messages.push({
                    role: 'user',
                    content: `Error parsing your response. Please ensure your JSON matches the schema.\nError details: ${error instanceof Error ? error.message : String(error)}`
                });
                // Emit error to UI so user sees it
                this.emit('thinker:step', { step: stepCount, message: { role: 'system', content: `System Error: ${error instanceof Error ? error.message : String(error)}` } });
                continue;
            }

            if (response.type === 'message') {
                this.log(`[Thinker] Message: ${response.text.slice(0, 100)}...`);
                lastWasImplement = false;
                continue;
            }

            if (response.type === 'tool_call') {
                this.log(`[DEBUG] Executing tool: ${response.tool}`);
                const result = await this.executeThinkerTool(response.tool, response.args);
                this.log(`[DEBUG] Tool execution finished. Result size: ${JSON.stringify(result).length} chars`);

                this.emit('thinker:tool_result', { step: stepCount, tool: response.tool, result });
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
                    const testFiles = payload.test_files;

                    // Run Implementer
                    this.log(`[DEBUG] Starting Implementer for task ${i + 1}/${payload.tasks.length}`);
                    const implResult = await this.runImplementer(payload.description, task, i + 1, payload.tasks.length, testFiles);

                    if (implResult.error) {
                        // Implementer failed - return to Thinker
                        messages.push({
                            role: 'user',
                            content: `Implementer Error on task ${i + 1}: ${implResult.error}\n\nPlease adjust your approach.`
                        });
                        break;
                    }

                    // Run Tester
                    this.log(`[DEBUG] Starting Tester for task ${i + 1}`);
                    const testResult = await this.runTester(payload.description, task, implResult.summary || '', testFiles);

                    this.state.taskResults.push({
                        task,
                        test_result: testResult
                    });
                }

                // If we completed all tasks, run Finisher
                if (this.state.taskResults.length === payload.tasks.length) {
                    this.log(`[DEBUG] All tasks completed. Running Finisher...`);
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
                this.log(`[Thinker] Final: ${response.criteriaStatus}`);
                this.emit('thinker:final', response);
                return { success: response.criteriaStatus === 'success', message: response.text };
            }
        }

        return { success: false, message: 'Thinker reached max steps' };
    }

    /**
     * Execute a Thinker tool
     */
    private async executeThinkerTool(tool: string, rawArgs: Record<string, any>): Promise<any> {
        // Normalize args to handle LLM hallucinations like {file_path: {path: ...}}
        const args = this.normalizeArgs(tool, rawArgs);
        this.log(`[Thinker] Executing tool: ${tool} with args: ${JSON.stringify(args)}`);

        if (!this.config.repoRoot) {
            return { error: 'repoRoot is not set' };
        }

        try {
            switch (tool) {
                case 'read_file':
                    if (!args?.path) {
                        return { error: `read_file requires a "path" argument, got: ${JSON.stringify(rawArgs)}` };
                    }
                    return readFile(this.config.repoRoot, args as any);
                case 'run_cmd':
                    if (!args?.cmd) {
                        return { error: `run_cmd requires a "cmd" argument, got: ${JSON.stringify(rawArgs)}` };
                    }
                    return await runCmd(this.config.repoRoot, args as any);
                case 'manage_todos':
                    // TODO: Implement todo management
                    return { success: true, message: 'Todo updated' };
                default:
                    return { error: `Unknown tool: ${tool}` };
            }
        } catch (error) {
            this.log(`[Thinker] Tool error: ${error}`);
            return { error: String(error) };
        }
    }

    /**
     * Run the Implementer agent for a single task
     */
    private async runImplementer(
        description: string,
        task: ImplementTask,
        index: number,
        total: number,
        testFiles?: string[]
    ): Promise<{ summary?: string; error?: string }> {
        const promptBuilder = new ImplementerPromptBuilder();
        const schema = zodSchemaToJsonSchema(ImplementerOutputSchema);

        let messages: any[] = [
            { role: 'system', content: promptBuilder.buildSystemPrompt() },
            {
                role: 'user',
                content: promptBuilder.buildUserPrompt({
                    goal: this.state.goal,
                    overallDescription: description,
                    currentTask: task,
                    taskIndex: index,
                    totalTasks: total,
                    todoList: this.state.todoList,
                    testFiles: testFiles
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
                this.emit('implementer:tool_result', { step: stepCount, tool: response.tool, result });
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
        this.log(`[Implementer] Executing tool: ${tool} with args: ${JSON.stringify(args)}`);

        try {
            switch (tool) {
                case 'add_function':
                    if (!args.path || !args.function_code) {
                        return { error: `add_function requires 'path' and 'function_code', got: ${JSON.stringify(args)}` };
                    }
                    return addFunction(this.config.repoRoot, args as any);
                case 'edit_function':
                    if (!args.path || !args.function_name || !args.new_code) {
                        return { error: `edit_function requires 'path', 'function_name', and 'new_code', got: ${JSON.stringify(args)}` };
                    }
                    return editFunction(this.config.repoRoot, args as any);
                case 'remove_function':
                    if (!args.path || !args.function_name) {
                        return { error: `remove_function requires 'path' and 'function_name', got: ${JSON.stringify(args)}` };
                    }
                    return removeFunction(this.config.repoRoot, args as any);
                case 'read_file':
                    if (!args.path) {
                        return { error: `read_file requires 'path', got: ${JSON.stringify(args)}` };
                    }
                    return readFile(this.config.repoRoot, args as any);
                case 'read_function':
                    if (!args.path || !args.function_name) {
                        return { error: `read_function requires 'path' and 'function_name', got: ${JSON.stringify(args)}` };
                    }
                    return readFunction(this.config.repoRoot, args as any);
                case 'write_file':
                    if (!args.path || args.content === undefined) {
                        return { error: `write_file requires 'path' and 'content', got: ${JSON.stringify(args)}` };
                    }
                    return writeFile(this.config.repoRoot, args as any);
                case 'get_file_outline':
                    if (!args.path) {
                        return { error: `get_file_outline requires 'path', got: ${JSON.stringify(args)}` };
                    }
                    return getFileOutline(this.config.repoRoot, args as any);
                default:
                    return { error: `Unknown tool: ${tool}` };
            }
        } catch (error) {
            this.log(`[Implementer] Tool error: ${error}`);
            return { error: String(error) };
        }
    }

    /**
     * Run the Tester agent
     */
    private async runTester(description: string, task: ImplementTask, implSummary: string, testFiles?: string[]): Promise<TestResult> {
        const promptBuilder = new TesterPromptBuilder();
        const schema = zodSchemaToJsonSchema(TesterOutputSchema);

        // Use explicitly provided test files if available, otherwise fallback to heuristics
        const relevantTestFiles = testFiles && testFiles.length > 0
            ? testFiles
            : this.state.allFiles.filter(f => f.endsWith('.in') || f.endsWith('.txt') || f.endsWith('.json'));

        let messages: any[] = [
            { role: 'system', content: promptBuilder.buildSystemPrompt() },
            {
                role: 'user',
                content: promptBuilder.buildUserPrompt({
                    goal: this.state.goal,
                    overallDescription: description,
                    completedTask: task,
                    implementerSummary: implSummary,
                    todoList: this.state.todoList,
                    filesCreatedByTester: this.state.testerCreatedFiles,
                    testInputFiles: relevantTestFiles
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
                this.emit('tester:tool_result', { step: stepCount, tool: response.tool, result });
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
        this.log(`[Tester] Executing tool: ${tool} with args: ${JSON.stringify(args)}`);

        try {
            switch (tool) {
                case 'run_cmd':
                    // Supervisor check for command/cwd correctness
                    this.log(`[Tester] Verifying command: ${args.cmd} in ${args.cwd}`);
                    const correction = await this.correctCommand(args.cmd, args.cwd);

                    if (correction.corrected_cmd !== args.cmd || correction.corrected_cwd !== args.cwd) {
                        this.log(`[Tester] Auto-corrected: "${args.cmd}" @ "${args.cwd}" -> "${correction.corrected_cmd}" @ "${correction.corrected_cwd}" (${correction.reason})`);
                    }

                    return await runCmd(this.config.repoRoot, {
                        cmd: correction.corrected_cmd,
                        cwd: correction.corrected_cwd
                    });
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
        } catch (error) {
            this.log(`[Tester] Tool error: ${error}`);
            return { error: String(error) };
        }
    }

    /**
     * Supervisor Agent to correct commands and CWD
     */
    private async correctCommand(cmd: string, cwd: string = '.'): Promise<CommandCorrection> {
        // 1. Get file tree context
        let fileTree = '';
        try {
            // Get concise file tree (max depth 3, exclude node_modules/git)
            const { stdout } = await execAsync(`find . -maxdepth 3 -not -path '*/.*' -not -path './node_modules*' -not -path './dist*'`, { cwd: this.config.repoRoot });
            fileTree = stdout;
        } catch (e) {
            fileTree = 'Error listing files: ' + e;
        }

        // 2. Build prompt
        const prompt = `You are a Command Supervisor.
The user agent wants to run a command, but often makes mistakes with CWD (using absolute paths or wrong directories).

Requested Command: \`${cmd}\`
Requested CWD: \`${cwd || '.'}\`

Project File Structure (relative to repo root):
${fileTree.split('\n').slice(0, 100).join('\n')}${fileTree.split('\n').length > 100 ? '\n...(truncated)' : ''}

## Your Task
1. Verify if the CWD exists in the project structure.
2. Check if the command makes sense in that CWD (e.g. is package.json present for npm install?).
3. **CRITICAL**: Convert any ABSOLUTE paths in CWD to RELATIVE paths from repo root.
4. If CWD is likely wrong (e.g. running 'npm test' in root when package.json is in 'server'), fix it.

Return the corrected command and CWD. If strictly correct, return as is.`;

        // 3. Call LLM
        const schema = zodSchemaToJsonSchema(CommandCorrectionSchema);
        // Use a temp client message sequence
        const messages = [{ role: 'user', content: prompt }];

        try {
            const rawResponse = await this.config.client.completion(messages, schema, 'CommandCorrection');
            return CommandCorrectionSchema.parse(rawResponse);
        } catch (e) {
            this.log(`[Tester] Corrector failed, using original: ${e}`);
            return { corrected_cmd: cmd, corrected_cwd: cwd, reason: 'Corrector failed' };
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


    /**
     * Manage context window size
     */
    private manageContext(messages: any[]): any[] {
        // Estimate token count (char count / 4)
        const totalChars = JSON.stringify(messages).length;
        const estTokens = Math.round(totalChars / 4);

        this.log(`[DEBUG] Context Status: ~${estTokens} tokens, ${messages.length} messages`);

        // Pruning threshold: 30k tokens (approx 120k chars)
        const CHAR_LIMIT = 120000;

        if (totalChars > CHAR_LIMIT) {
            this.log(`[DEBUG] Context limit exceeded (${totalChars} chars). Pruning history...`);

            // Algorithm: Keep System Prompt (0) + User Task (1) + Last N messages
            // We assume index 0 is system, index 1 is initial user prompt.
            if (messages.length > 10) {
                const system = messages[0];
                const task = messages[1];
                const recent = messages.slice(-10); // Keep last 10 turns

                this.log(`[DEBUG] Pruned to: System + Task + Last ${recent.length} messages`);
                return [system, task, ...recent];
            }
        }

        return messages;
    }
}
