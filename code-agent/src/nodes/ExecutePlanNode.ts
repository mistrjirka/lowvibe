import { Node, PipelineContext } from '../pipeline/Pipeline';
import { AgentState } from '../pipeline/AgentState';
import { LMStudioClient } from '../llm/LMStudioClient';
import { AgentStepPromptBuilder, AgentStepSchema, MessageOnlySchema, VerifyCommandPromptBuilder, VerifyCommandSchema, SupervisorPromptBuilder, SupervisorSchema, SmartEditPromptBuilder, SmartEditSchema, zodSchemaToJsonSchema } from '../prompts';
import { replaceInFile, ReplaceInFileSchema } from '../tools/replace_in_file';
import { writeFile, WriteFileSchema } from '../tools/write_file';
import { readFile, ReadFileSchema } from '../tools/read_file';
import { runCmd, RunCmdSchema } from '../tools/run_cmd';
import { markTodoDone, addTodo, updateTodo, MarkTodoDoneSchema, AddTodoSchema, UpdateTodoSchema } from '../tools/manage_todos';
import { ContextManager } from '../utils/contextManager';
import { callWithContextRetry } from '../utils/ContextViewBuilder';
import { getFileOutline, GetFileOutlineSchema } from '../tools/get_file_outline';
import { readFunction, ReadFunctionSchema } from '../tools/read_function';
import { editFunction, EditFunctionSchema } from '../tools/edit_function';
import { addFunction, AddFunctionSchema, removeFunction, RemoveFunctionSchema } from '../tools/add_remove_function';
import { editRange, EditRangeSchema } from '../tools/edit_range';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// Helper: Generate tree structure for orientation (1 level deep)
function scanCurrentFiles(dir: string): string {
    try {
        const items = fs.readdirSync(dir);
        const lines: string[] = [];
        for (const item of items.slice(0, 20)) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                lines.push(`[DIR] ${item}/`);
                try {
                    const subItems = fs.readdirSync(fullPath).slice(0, 5);
                    for (const sub of subItems) {
                        lines.push(`    ${sub}`);
                    }
                    if (fs.readdirSync(fullPath).length > 5) lines.push(`    ...`);
                } catch { /* ignore */ }
            } else {
                lines.push(`[FILE] ${item}`);
            }
        }
        if (items.length > 20) lines.push(`... (${items.length - 20} more)`);
        return lines.join('\n');
    } catch {
        return '(unable to read directory)';
    }
}

export class ExecutePlanNode implements Node<AgentState> {
    name = "ExecutePlan";
    private maxSteps = 150;
    private emitter?: EventEmitter;
    private isPaused = false;
    private pauseResolver: ((value: void) => void) | null = null;
    private pendingGuidance: string | null = null;

    /**
     * @param emitter Optional EventEmitter for GUI integration
     */
    constructor(emitter?: EventEmitter) {
        this.emitter = emitter;
    }

    /**
     * Pause the agent execution
     */
    pause(): void {
        this.isPaused = true;
        this.emit('agent:paused', {});
    }

    /**
     * Resume agent execution, optionally with guidance
     */
    resume(guidance?: string): void {
        if (guidance) {
            this.pendingGuidance = guidance;
        }
        this.isPaused = false;
        if (this.pauseResolver) {
            this.pauseResolver();
            this.pauseResolver = null;
        }
        this.emit('agent:resumed', { guidance });
    }

    /**
     * Wait if paused, resolve when resumed
     */
    private async waitIfPaused(): Promise<void> {
        if (!this.isPaused) return;

        return new Promise((resolve) => {
            this.pauseResolver = resolve;
        });
    }

    /**
     * Emit an event if emitter is available (for GUI updates)
     */
    private emit(event: string, data: any): void {
        if (this.emitter) {
            this.emitter.emit(event, data);
        }
    }

    async execute(state: AgentState, context: PipelineContext): Promise<AgentState> {
        context.logger("[ExecutePlan] Starting agent loop...");
        const client = new LMStudioClient(state.clientConfig);
        const promptBuilder = new AgentStepPromptBuilder();

        // Initial context
        let messages: any[] = [
            { role: "system", content: promptBuilder.buildSystemPrompt() },
            {
                role: "user", content: promptBuilder.buildUserPrompt({
                    plan: state.plan!,
                    fileContents: state.fileContents,
                    availableFiles: state.allFiles, // Pass full file list
                    userTask: state.userTask
                })
            }
        ];

        state.history = messages;
        const fullJsonSchema = zodSchemaToJsonSchema(AgentStepSchema);
        const messageOnlyJsonSchema = zodSchemaToJsonSchema(MessageOnlySchema);

        let stepCount = 0;

        let mustSendMessage = false; // Force message after tool call

        // Token usage tracking
        const cumulativeUsage = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0
        };
        let lastPromptTokens = 0; // Current message size in tokens
        const contextLimit = (state as any).contextLimit || 32768; // Default if not set

        // Context manager for pruning tool calls and summarization
        // Context manager for pruning tool calls and summarization
        const contextManager = new ContextManager({
            maxToolCalls: 5,           // Keep last 5 tool calls in full
            summarizationThreshold: state.config?.summarizationThreshold || 0.65,
            recentMessagesToKeep: state.config?.maxContextHistory || 10
        });
        while (stepCount < this.maxSteps) {
            stepCount++;
            context.logger(`\n[Agent Step ${stepCount}]`);

            // Check if paused and wait if so
            await this.waitIfPaused();

            // If there's pending guidance from a pause, inject it
            if (this.pendingGuidance) {
                messages.push({
                    role: "user",
                    content: `USER GUIDANCE: ${this.pendingGuidance}`
                });
                this.pendingGuidance = null;
            }

            // Supervisor check logic - "debugging duck"
            const supervisorInterval = state.config?.supervisorInterval || 5;
            if (stepCount > 0 && stepCount % supervisorInterval === 0) {
                context.logger(`[Supervisor] 🦆 Debugging duck analyzing step ${stepCount}...`);
                this.emit('agent:supervisor_check', { stepCount });

                try {
                    const supervisorPromptBuilder = new SupervisorPromptBuilder();
                    const supervisorJsonSchema = zodSchemaToJsonSchema(SupervisorSchema);

                    // Collect recent errors and tool outputs from messages
                    const recentErrors: string[] = [];
                    const recentFiles: string[] = [];
                    const recentToolOutputs: string[] = [];

                    for (const msg of messages.slice(-20)) {
                        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

                        // Track errors
                        if (content.includes('error') || content.includes('Error') || content.includes('failed')) {
                            // Capture more context for errors (up to 2000 chars for the specific error line/block)
                            const match = content.match(/error[:\s]+([^\n]{0,2000})/i);
                            if (match) recentErrors.push(match[1].trim());
                        }

                        // Track files
                        const pathMatch = content.match(/"path"\s*:\s*"([^"]+)"/);
                        if (pathMatch && !recentFiles.includes(pathMatch[1])) {
                            recentFiles.push(pathMatch[1]);
                        }

                        // Track tool outputs (user messages that start with "Tool Output:")
                        // Track tool outputs (user messages that start with "Tool Output:")
                        if (msg.role === 'user' && content.startsWith('Tool Output:')) {
                            // UNLIMITED output as requested by user
                            recentToolOutputs.push(content);
                        }
                    }

                    const supervisorMessages = [
                        { role: "system", content: supervisorPromptBuilder.buildSystemPrompt() },
                        {
                            role: "user",
                            content: supervisorPromptBuilder.buildUserPrompt({
                                recentMessages: messages.slice(-50)
                                    .map(m => ({
                                        role: m.role,
                                        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
                                    }))
                                    .filter(m => !m.content.includes(state.userTask)), // Deduplicate original task for supervisor
                                todoStatus: state.plan?.todos || [],
                                recentToolOutputs: recentToolOutputs.slice(-5),
                                recentErrors: recentErrors.slice(-5),
                                recentFiles: recentFiles.slice(-10),
                                userTask: state.userTask,
                                planRestatement: state.plan?.restatement
                            })
                        }
                    ];

                    // LOG SUPERVISOR PROMPT
                    try {
                        const logsDir = path.resolve(process.cwd(), 'logs');
                        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
                        fs.writeFileSync(
                            path.join(logsDir, `step_${stepCount}_supervisor_prompt.json`),
                            JSON.stringify(supervisorMessages, null, 2)
                        );
                    } catch (e) { /* ignore */ }

                    // Use adaptive retry in case context overflows
                    const rawSupervisor = await callWithContextRetry(
                        client,
                        supervisorMessages,
                        50, // Start with up to 50 messages for supervisor
                        supervisorJsonSchema,
                        "SupervisorOutput"
                    );
                    const supervisorResult = SupervisorSchema.parse(rawSupervisor);

                    context.logger(`[Supervisor] 🦆 Loop: ${supervisorResult.loopDetected}, Progress: ${supervisorResult.progressMade}, Confidence: ${supervisorResult.confidence}`);

                    // Emit for GUI - includes loop alert
                    this.emit('agent:supervisor_result', {
                        stepCount,
                        loopDetected: supervisorResult.loopDetected,
                        progressMade: supervisorResult.progressMade,
                        codingAdvice: supervisorResult.codingAdvice,
                        debuggingTips: supervisorResult.debuggingTips,
                        nextStepSuggestion: supervisorResult.nextStepSuggestion,
                        confidence: supervisorResult.confidence
                    });

                    // ALWAYS inject the debugging duck advice
                    context.logger(`[Supervisor] 🦆 Advice: ${supervisorResult.codingAdvice}`);

                    let guidance = `DEBUGGING DUCK (step ${stepCount}):\n`;
                    guidance += `💡 Coding Advice: ${supervisorResult.codingAdvice}\n`;
                    if (supervisorResult.debuggingTips && supervisorResult.debuggingTips !== '(none)') {
                        guidance += `🔧 Debugging Tips: ${supervisorResult.debuggingTips}\n`;
                    }
                    guidance += `➡️ Next Step: ${supervisorResult.nextStepSuggestion}`;

                    if (supervisorResult.loopDetected) {
                        guidance += `\n\n⚠️ WARNING: Loop pattern detected! Consider a different approach.`;
                    }

                    // Auto-complete todos suggested by supervisor
                    if (supervisorResult.todosToComplete && supervisorResult.todosToComplete.length > 0 && state.plan) {
                        for (const todoIndex of supervisorResult.todosToComplete) {
                            const idx = todoIndex - 1; // Convert to 0-based
                            if (idx >= 0 && idx < state.plan.todos.length && state.plan.todos[idx].status !== 'completed') {
                                state.plan.todos[idx].status = 'completed';
                                context.logger(`[Supervisor] 🦆 Auto-completed todo #${todoIndex}: ${state.plan.todos[idx].title}`);
                                guidance += `\n✅ Marked todo #${todoIndex} "${state.plan.todos[idx].title}" as done.`;
                            }
                        }

                        const completedCount = state.plan.todos.filter(t => t.status === 'completed').length;
                        const totalCount = state.plan.todos.length;
                        const percent = Math.round((completedCount / totalCount) * 100);
                        context.logger(`[Progress] Todos: ${completedCount}/${totalCount} done (${percent}%)`);

                        // Emit deep copy so React sees a new object reference
                        this.emit('plan:updated', { plan: JSON.parse(JSON.stringify(state.plan)) });
                    }

                    messages.push({
                        role: "user",
                        content: guidance
                    });

                } catch (supervisorError: any) {
                    // HARD FAILURE - Supervisor must work
                    context.logger(`[Supervisor] ❌ CRITICAL ERROR: ${supervisorError.message}`);
                    this.emit('agent:supervisor_error', {
                        stepCount,
                        error: supervisorError.message
                    });
                    throw new Error(`Supervisor failed at step ${stepCount}: ${supervisorError.message}`);
                }
            }



            // Dynamically choose schema based on state
            const currentSchema = mustSendMessage ? messageOnlyJsonSchema : fullJsonSchema;
            const currentZodSchema = mustSendMessage ? MessageOnlySchema : AgentStepSchema;
            if (mustSendMessage) {
                context.logger(`[Schema] Using message-only schema (must explain before tools)`);
            }

            // Apply context management before LLM call
            // Use lastPromptTokens (current message size) not cumulative total
            const contextResult = await contextManager.manageContext(
                messages,
                lastPromptTokens,
                contextLimit,
                client
            );
            messages = contextResult.messages;
            if (contextResult.wasSummarized) {
                context.logger(`[Context] Summarized old messages to save tokens`);
                this.emit('agent:context_summarized', {
                    messageCount: messages.length,
                    messages: messages.map(m => ({ role: m.role, contentPreview: m.content?.substring(0, 100) }))
                });
            }

            let rawResponse;
            let response;
            try {
                // LOG AGENT PROMPT
                try {
                    const logsDir = path.resolve(process.cwd(), 'logs');
                    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
                    fs.writeFileSync(
                        path.join(logsDir, `step_${stepCount}_agent_prompt.json`),
                        JSON.stringify(messages, null, 2)
                    );
                } catch (e) { /* ignore */ }

                rawResponse = await client.completion(messages, currentSchema, "AgentStepOutput");
                response = currentZodSchema.parse(rawResponse);

                // Track and emit token usage
                const stepUsage = client.getLastUsage();
                if (stepUsage) {
                    // Track current message size (prompt_tokens) for context management
                    lastPromptTokens = stepUsage.promptTokens;

                    cumulativeUsage.promptTokens += stepUsage.promptTokens;
                    cumulativeUsage.completionTokens += stepUsage.completionTokens;
                    cumulativeUsage.totalTokens += stepUsage.totalTokens;

                    this.emit('agent:token_usage', {
                        step: stepUsage,
                        cumulative: { ...cumulativeUsage },
                        currentPromptTokens: lastPromptTokens, // Current message size
                        contextLimit
                    });
                }
            } catch (e) {
                context.logger(`[ExecutePlan] Validation Error: ${e}. Retrying...`);
                messages.push({ role: "system", content: `Your last response was invalid: ${e}. Please try again.` });
                continue;
            }

            if (response.type === "message") {
                context.logger(`[Agent] ${response.text}`);
                this.emit('agent:message', { stepCount, text: response.text });
                messages.push({ role: "assistant", content: JSON.stringify(response) });
                mustSendMessage = false; // Message sent, can use tools again
            } else if (response.type === "final") {
                context.logger(`[Agent Final] ${response.criteriaStatus}: ${response.text}`);
                this.emit('agent:final', { stepCount, criteriaStatus: response.criteriaStatus, text: response.text });

                // Interactive Feedback Loop
                const feedback = await context.askUser(
                    `\nTask marked complete (${response.criteriaStatus}).\nPress ENTER to finish, or type feedback (multiline supported) to continue the agent loop: `,
                    { multiline: true }
                );

                if (!feedback.trim()) {
                    state.results = response;
                    break;
                }

                // User wants to continue
                context.logger(`[User Feedback] ${feedback}`);
                messages.push({ role: "assistant", content: JSON.stringify(response) });
                messages.push({
                    role: "user",
                    content: `User Feedback: ${feedback}\n\nSYSTEM INSTRUCTION: The user has rejected your completion. You must address their feedback before declaring "final" again.`
                });
                continue;
            } else if (response.type === "tool_call") {
                // Check if forced to send message first
                if (mustSendMessage) {
                    context.logger(`[Anti-Loop] Must send a message before using tools again.`);
                    messages.push({ role: "system", content: "You MUST output a 'message' type explaining your reasoning before making another tool call." });
                    continue;
                }

                // Check for duplicate run_cmd removed as per user request to avoid issues with flaky commands

                mustSendMessage = true; // After this tool, must send message

                context.logger(`[Agent Tool] ${response.tool}`);
                this.emit('agent:tool_call', { stepCount, tool: response.tool, args: response.args });
                messages.push({ role: "assistant", content: JSON.stringify(response) });

                let toolResult: any;

                try {
                    switch (response.tool) {
                        case "replace_in_file":
                            const replaceArgs = ReplaceInFileSchema.parse(response.args);
                            toolResult = replaceInFile(state.repoRoot, replaceArgs);

                            // SMART RECOVERY for "not found" errors
                            if (!toolResult.success && toolResult.fileContent &&
                                (toolResult.error?.includes('String to replace not found') || toolResult.error?.includes('found 0'))) {

                                context.logger(`[Smart Recovery] Exact match failed. Attempting fuzzy match...`);

                                try {
                                    const smartPromptBuilder = new SmartEditPromptBuilder();
                                    const smartMessages = [
                                        { role: "system", content: smartPromptBuilder.buildSystemPrompt() },
                                        {
                                            role: "user",
                                            content: smartPromptBuilder.buildUserPrompt({
                                                fileContent: toolResult.fileContent,
                                                failedFindString: replaceArgs.find
                                            })
                                        }
                                    ];
                                    const smartJsonSchema = zodSchemaToJsonSchema(SmartEditSchema);

                                    // Use a separate/fast call for this
                                    const rawSmart = await client.completion(smartMessages, smartJsonSchema, "SmartEditOutput");
                                    const smartResult = SmartEditSchema.parse(rawSmart);

                                    if (smartResult.found && smartResult.actualString) {
                                        context.logger(`[Smart Recovery] Found fuzzy match (Confidence: ${smartResult.confidence})`);
                                        context.logger(`[Smart Recovery] Retrying replacement with corrected string...`);

                                        // Update the args with the ACTUAL string found in the file
                                        replaceArgs.find = smartResult.actualString;

                                        // Retry the replacement
                                        const retryResult = replaceInFile(state.repoRoot, replaceArgs);

                                        if (retryResult.success) {
                                            toolResult = retryResult;
                                            toolResult.diff = `(Fussy Match Applied)\n` + (toolResult.diff || '');
                                            // Update the message history to show what we actually replaced
                                            messages[messages.length - 1] = {
                                                role: "assistant",
                                                content: JSON.stringify({ ...response, args: replaceArgs })
                                            };
                                        } else {
                                            context.logger(`[Smart Recovery] Retry failed: ${retryResult.error}`);
                                        }
                                    } else {
                                        context.logger(`[Smart Recovery] No matching block found.`);
                                    }
                                } catch (recErr: any) {
                                    // HARD FAILURE - SmartEdit must work if triggered
                                    context.logger(`[Smart Recovery] ❌ CRITICAL ERROR: ${recErr.message}`);
                                    throw new Error(`SmartEdit recovery failed: ${recErr.message}`);
                                }
                            }
                            break;
                        case "write_file":
                            toolResult = writeFile(state.repoRoot, WriteFileSchema.parse(response.args));
                            break;
                        case "read_file":
                            toolResult = readFile(state.repoRoot, ReadFileSchema.parse(response.args));
                            if (toolResult.error && toolResult.error.includes("File not found")) {
                                const tree = scanCurrentFiles(state.repoRoot);
                                toolResult.error += `\n\nPossible Reason: File does not exist at that path.\nHere is the current file tree for context:\n${tree}`;
                            }
                            break;
                        case "run_cmd":
                            let cmdArgs = RunCmdSchema.parse(response.args);
                            const cwd = cmdArgs.cwd ? path.resolve(state.repoRoot, cmdArgs.cwd) : state.repoRoot;

                            // LLM-based command verification
                            const verifyPromptBuilder = new VerifyCommandPromptBuilder();
                            const fileTree = scanCurrentFiles(state.repoRoot);
                            const verifyMessages = [
                                { role: "system", content: verifyPromptBuilder.buildSystemPrompt() },
                                {
                                    role: "user", content: verifyPromptBuilder.buildUserPrompt({
                                        cmd: cmdArgs.cmd,
                                        cwd,
                                        repoRoot: state.repoRoot,
                                        fileTree
                                    })
                                }
                            ];
                            const verifyJsonSchema = zodSchemaToJsonSchema(VerifyCommandSchema);

                            try {
                                const rawVerification = await client.completion(verifyMessages, verifyJsonSchema, "VerifyCommandOutput");
                                const verification = VerifyCommandSchema.parse(rawVerification);

                                if (!verification.valid) {
                                    if (verification.correctedCmd || verification.correctedCwd !== undefined) {
                                        // Auto-correct and continue
                                        context.logger(`[LLM Path Correction] ${verification.error}`);
                                        cmdArgs = {
                                            cmd: verification.correctedCmd || cmdArgs.cmd,
                                            cwd: verification.correctedCwd || undefined
                                        };
                                        // Update the message history to reflect the corrected command
                                        messages[messages.length - 1] = {
                                            role: "assistant",
                                            content: JSON.stringify({ ...response, args: cmdArgs })
                                        };
                                    } else {
                                        // Cannot auto-correct - return error
                                        context.logger(`[LLM Path Error] ${verification.error}`);
                                        toolResult = { error: verification.error, cwd, repoRoot: state.repoRoot };
                                        break;
                                    }
                                }
                            } catch (verifyErr: any) {
                                // HARD FAILURE - Command verification must work
                                context.logger(`[Verify] ❌ CRITICAL ERROR: ${verifyErr.message}`);
                                toolResult = { error: `Command verification failed: ${verifyErr.message}. Command blocked.` };
                                break;
                            }

                            // Check allowlist
                            const commandType = cmdArgs.cmd.split(' ')[0]; // e.g., "python", "npm", "ls"
                            const isAllowed = (state.clientConfig.allowedCommands || []).some(prefix => cmdArgs.cmd.startsWith(prefix));

                            let answer = 'y'; // Default to yes if allowed
                            if (!isAllowed) {
                                context.logger(`[Approval Required] Command: ${cmdArgs.cmd}`);

                                // Emit detailed command approval event for GUI
                                this.emit('agent:command_approval', {
                                    stepCount,
                                    command: cmdArgs.cmd,
                                    commandType,
                                    cwd
                                });

                                answer = await context.askUser(`Run this command? (y/n/c to cancel+guide): `, {
                                    command: cmdArgs.cmd,
                                    commandType,
                                    cwd
                                } as any);
                            } else {
                                context.logger(`[Auto-Approved] Command: ${cmdArgs.cmd}`);
                            }

                            if (answer.toLowerCase() === 'y' || answer === 'allow_once') {
                                toolResult = await runCmd(state.repoRoot, cmdArgs);
                            } else if (answer.toLowerCase() === 'c' || answer === 'reject') {
                                const guidance = await context.askUser("Enter guidance: ");
                                messages.push({ role: "user", content: `Command cancelled by user. Guidance: ${guidance}` });
                                continue;
                            } else if (answer === 'allow_type') {
                                // Add command type to allowed list for this session
                                if (!state.clientConfig.allowedCommands) {
                                    state.clientConfig.allowedCommands = [];
                                }
                                state.clientConfig.allowedCommands.push(commandType);
                                context.logger(`[Permission] Added "${commandType}" to allowed commands`);
                                toolResult = await runCmd(state.repoRoot, cmdArgs);
                            } else if (answer === 'allow_exact') {
                                // Add exact command to allowed list
                                if (!state.clientConfig.allowedCommands) {
                                    state.clientConfig.allowedCommands = [];
                                }
                                state.clientConfig.allowedCommands.push(cmdArgs.cmd);
                                context.logger(`[Permission] Added exact command to allowed list`);
                                toolResult = await runCmd(state.repoRoot, cmdArgs);
                            } else {
                                const reason = await context.askUser("Reason for rejection (optional): ");
                                toolResult = { error: `User rejected command. Reason: ${reason}` };
                            }
                            break;
                        case "mark_todo_done":
                            if (state.plan) {
                                toolResult = markTodoDone(state.plan, MarkTodoDoneSchema.parse(response.args));
                                // Emit deep copy so React sees a new object reference
                                this.emit('plan:updated', { plan: JSON.parse(JSON.stringify(state.plan)) });
                            } else {
                                toolResult = { error: 'No plan available to modify' };
                            }
                            break;
                        case "add_todo":
                            if (state.plan) {
                                toolResult = addTodo(state.plan, AddTodoSchema.parse(response.args));
                                this.emit('plan:updated', { plan: JSON.parse(JSON.stringify(state.plan)) });
                            } else {
                                toolResult = { error: 'No plan available to modify' };
                            }
                            break;
                        case "update_todo":
                            if (state.plan) {
                                toolResult = updateTodo(state.plan, UpdateTodoSchema.parse(response.args));
                                this.emit('plan:updated', { plan: JSON.parse(JSON.stringify(state.plan)) });
                            } else {
                                toolResult = { error: 'No plan available to modify' };
                            }
                            break;
                        case "get_file_outline":
                            toolResult = getFileOutline(state.repoRoot, GetFileOutlineSchema.parse(response.args));
                            break;
                        case "read_function":
                            toolResult = readFunction(state.repoRoot, ReadFunctionSchema.parse(response.args));
                            break;
                        case "edit_function":
                            toolResult = editFunction(state.repoRoot, EditFunctionSchema.parse(response.args));
                            break;
                        case "add_function":
                            toolResult = addFunction(state.repoRoot, AddFunctionSchema.parse(response.args));
                            break;
                        case "remove_function":
                            toolResult = removeFunction(state.repoRoot, RemoveFunctionSchema.parse(response.args));
                            break;
                        case "edit_range":
                            toolResult = editRange(state.repoRoot, EditRangeSchema.parse(response.args));
                            break;
                        default:
                            toolResult = { error: "Unknown tool" };
                    }
                } catch (err: any) {
                    toolResult = { error: `Tool execution error: ${err.message}` };
                }

                context.logger(`[Tool Result] ${JSON.stringify(toolResult)}`);
                this.emit('agent:tool_result', { stepCount, tool: response.tool, result: toolResult });
                messages.push({ role: "user", content: `Tool Output: ${JSON.stringify(toolResult)}` });
            }
        }

        return state;
    }
}
