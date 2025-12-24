import { z } from 'zod';
import { IPromptBuilder, ReasoningEffort } from './prompt.interface';
import { Plan } from '../pipeline/AgentState';

// ============================================
// STRICT TOOL CALL SCHEMAS
// Each tool has its own schema with exact args
// ============================================

const MessageStep = z.object({
    type: z.literal('message'),
    text: z.string()
});

const FinalStep = z.object({
    type: z.literal('final'),
    text: z.string(),
    criteriaStatus: z.enum(['met', 'partially_met', 'not_met'])
});

// read_file: { path: string }
const ReadFileToolCall = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('read_file'),
    args: z.object({
        path: z.string()
    })
});

// write_file: { path: string, content: string }
const WriteFileToolCall = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('write_file'),
    args: z.object({
        path: z.string(),
        content: z.string()
    })
});

// replace_in_file: { path: string, find: string, replace: string, expectedReplacements?: number }
const ReplaceInFileToolCall = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('replace_in_file'),
    args: z.object({
        path: z.string(),
        find: z.string(),
        replace: z.string(),
        expectedReplacements: z.number().optional()
    })
});

// run_cmd: { cmd: string, cwd?: string }
const RunCmdToolCall = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('run_cmd'),
    args: z.object({
        cmd: z.string(),
        cwd: z.string().optional()
    })
});

// mark_todo_done: Mark a todo as completed
const MarkTodoDoneToolCall = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('mark_todo_done'),
    args: z.object({
        index: z.number()
    })
});

// add_todo: Insert a new todo
const AddTodoToolCall = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('add_todo'),
    args: z.object({
        position: z.number(),
        title: z.string(),
        details: z.string()
    })
});

// update_todo: Update an existing todo
const UpdateTodoToolCall = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('update_todo'),
    args: z.object({
        index: z.number(),
        title: z.string().optional(),
        details: z.string().optional(),
        status: z.enum(['pending', 'completed', 'failed']).optional()
    })
});

/**
 * Strict AgentStepSchema - each tool has its own exact schema.
 * This prevents malformed args like {"path":{"$ref":"..."}}
 */
export const AgentStepSchema = z.union([
    MessageStep,
    FinalStep,
    ReadFileToolCall,
    WriteFileToolCall,
    ReplaceInFileToolCall,
    RunCmdToolCall,
    MarkTodoDoneToolCall,
    AddTodoToolCall,
    UpdateTodoToolCall
]);

/**
 * Message-only schema - used after a tool call to force the LLM to explain before using more tools.
 */
export const MessageOnlySchema = z.union([
    MessageStep,
    FinalStep
]);

export type AgentStepOutput = z.infer<typeof AgentStepSchema>;
export type MessageOnlyOutput = z.infer<typeof MessageOnlySchema>;

export interface AgentStepVariables {
    plan: Plan;
    fileContents: Map<string, string>;
    availableFiles?: string[]; // Optional: list of files in repo for reference
    userTask: string; // The original raw prompt from the user
}

/**
 * Prompt builder for agent execution steps.
 */
export class AgentStepPromptBuilder implements IPromptBuilder<AgentStepVariables, AgentStepOutput> {
    getReasoningEffort(): ReasoningEffort {
        return 'high';
    }

    getZodSchema(): z.ZodType<AgentStepOutput> {
        return AgentStepSchema;
    }

    buildSystemPrompt(): string {
        return `You are an autonomous coding agent. Execute the plan step by step.

## Available Tools:

### read_file
Read a file's contents.
Arguments: { "path": "<relative file path>" }
Example: {"type":"tool_call","tool":"read_file","args":{"path":"main.py"}}

### write_file
Write content to a file (creates or overwrites).
Arguments: { "path": "<relative file path>", "content": "<file content>" }
Example: {"type":"tool_call","tool":"write_file","args":{"path":"output.txt","content":"Hello World"}}

### replace_in_file
Find and replace text in a file.
Arguments: { "path": "<relative file path>", "find": "<text to find>", "replace": "<replacement text>", "expectedReplacements": <optional number> }
Example: {"type":"tool_call","tool":"replace_in_file","args":{"path":"main.py","find":"def add(a, b):","replace":"def add(a: int, b: int) -> int:"}}

### run_cmd
Execute a shell command (requires user approval).
Arguments: { "cmd": "<command>", "cwd": "<optional working directory>" }
Example: {"type":"tool_call","tool":"run_cmd","args":{"cmd":"python main.py"}}

### mark_todo_done
Mark a todo item as completed when you finish it.
Arguments: { "index": <1-based todo number> }
Example: {"type":"tool_call","tool":"mark_todo_done","args":{"index":1}}

### add_todo
Add a new todo item when you discover additional work needed.
Arguments: { "position": <1-based position, 0 = end>, "title": "<title>", "details": "<details>" }
Example: {"type":"tool_call","tool":"add_todo","args":{"position":0,"title":"Fix bug","details":"Handle edge case"}}

### update_todo
Update a todo's title, details, or status.
Arguments: { "index": <1-based todo number>, "title": "<new title>", "details": "<new details>", "status": "pending"|"completed"|"failed" }
Example: {"type":"tool_call","tool":"update_todo","args":{"index":2,"status":"failed"}}

## Response Types:
1. message: Progress update
   {"type":"message","text":"<your progress message>"}

2. tool_call: Use a tool (see examples above)

3. final: Mark task complete
   {"type":"final","text":"<summary>","criteriaStatus":"met"|"partially_met"|"not_met"}

## CRITICAL RULES:
- All tool arguments MUST be literal strings or numbers. Do NOT use JSON references ($ref), nested objects, or any complex types.
- The "path" argument must always be a simple string like "main.py" or "src/utils.py"
- Execute one step at a time
- Use replace_in_file for edits (find exact text, replace with new text)
- Verify your changes work before marking complete
- CRITICAL: If you used multiple temporary files, you MUST integrate them into the final requested file structure and verify the solution works before marking the task as complete.
- When finishing, you MUST output a brief explanation of how to use your solution and how it works.
- ANTI-LOOP: If you see in the conversation history that you have tried the SAME approach multiple times and it keeps failing, you MUST try a FUNDAMENTALLY DIFFERENT approach. Do NOT repeat the same fix. Step back and reconsider your logic.
- ANTI-LOOP: If the same error appears 2+ times, the problem is likely in your UNDERSTANDING of the problem, not just the code. Re-read the requirements.
- WORKFLOW: After EVERY tool call, you MUST output a "message" type explaining what happened and what you will do next. Only then can you make another tool call.

## TODO MANAGEMENT (IMPORTANT):
- When you COMPLETE a todo step, call mark_todo_done with its index
- If you discover ADDITIONAL work needed, use add_todo to add it to the plan
- If a todo needs modification, use update_todo
- Keep the todo list updated so progress is visible!

- Return "final" when all acceptance criteria are met`;
    }

    buildUserPrompt(variables: AgentStepVariables): string {
        const fileContext = Array.from(variables.fileContents.entries())
            .map(([k, v]) => `--- ${k} ---\n${v}`)
            .join('\n');

        const filesNote = variables.availableFiles && variables.availableFiles.length > 0
            ? `\nAvailable files in repo: ${variables.availableFiles.join(', ')}`
            : '';

        return `## 🎯 ORIGINAL USER TASK:
"${variables.userTask}"

## 📝 CURRENT PLAN:
${variables.plan.todos.map((t, i) => {
            const status = t.status === 'completed' ? '[x]' : (t.status === 'failed' ? '[-]' : '[ ]');
            return `${i + 1}. ${status} ${t.title}`;
        }).join('\n')}

Attached Files:
${fileContext || '(none)'}
${filesNote}

Begin execution.`;
    }
}
