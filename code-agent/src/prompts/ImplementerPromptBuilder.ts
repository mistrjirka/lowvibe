import { z } from 'zod';
import { IPromptBuilder, ReasoningEffort } from './prompt.interface';
import { ImplementerOutputSchema, ImplementTask } from '../schemas/AgentSchemas';

/**
 * Variables for the Implementer agent prompt
 */
export interface ImplementerVariables {
    goal: string;  // The overall goal from planning
    overallDescription: string;
    currentTask: ImplementTask;
    taskIndex: number;
    totalTasks: number;
    fileOutline?: string;
    todoList: string;
    testFiles?: string[];
}

/**
 * Prompt builder for the Implementer agent.
 * The Implementer executes ONE file operation task at a time.
 */
export class ImplementerPromptBuilder implements IPromptBuilder<ImplementerVariables, z.infer<typeof ImplementerOutputSchema>> {
    getReasoningEffort(): ReasoningEffort {
        return 'medium';
    }

    getZodSchema(): z.ZodType<z.infer<typeof ImplementerOutputSchema>> {
        return ImplementerOutputSchema;
    }

    buildSystemPrompt(): string {
        return `You are the IMPLEMENTER agent in a multi-agent coding system.

## Your Role
You execute ONE file operation task given by the Thinker. Focus on precise, syntactic code manipulation.

## Available Tools

### add_function
Add a new function/class to a file.
Arguments:
- path (required): File path
- function_code (required): Complete function/class code to add
- insert_after (optional): Insert after this function name

### edit_function  
Edit an existing function/class by name.
Arguments:
- path (required): File path
- function_name (required): Name of function to edit
- new_code (required): New function code

### remove_function
Remove a function/class by name.
Arguments:
- path (required): File path
- function_name (required): Name of function to remove

### read_file
Read file content.
Arguments:
- path (required): File path

### read_function
Read a specific function's code.
Arguments:
- path (required): File path
- function_name (required): Name of function to read

### write_file
Write content to a file (creates or overwrites).
Arguments:
- path (required): File path
- content (required): Complete file content to write

### get_file_outline
Get syntactic structure of a file.
Arguments:
- path (required): File path

## Rules
1. Use AST-based tools (add_function, edit_function) over raw text manipulation
2. Do NOT add duplicate functions - if a function exists, use edit_function
3. Read the file/function first to understand context
4. When done, call the \`done\` output type
5. If the task is impossible, call the \`error\` output type

## Output Format
Always output one of:
- \`message\`: Explain your reasoning
- \`tool_call\`: { "type": "tool_call", "tool": "tool_name", "args": { ... } }
- \`done\`: { "type": "done", "summary": "what was implemented" }
- \`error\`: { "type": "error", "reason": "why task is impossible" }`;
    }

    buildUserPrompt(variables: ImplementerVariables): string {
        const outlineSection = variables.fileOutline
            ? `\n## Current File Outline\n\`\`\`\n${variables.fileOutline}\n\`\`\``
            : '';

        const testFilesSection = variables.testFiles && variables.testFiles.length > 0
            ? `\n## Relevant Test Files\n${variables.testFiles.join('\n')}`
            : '';

        return `## Goal
${variables.goal}

## Task Description
${variables.overallDescription}

## Your Task (${variables.taskIndex}/${variables.totalTasks})
- Type: ${variables.currentTask.type}
- File: ${variables.currentTask.file}
- Description: ${variables.currentTask.task_description}

### Code to Implement
\`\`\`
${variables.currentTask.code}
\`\`\`
${outlineSection}
${testFilesSection}

## Current TODO List
${variables.todoList}

Complete this specific task using the appropriate tools.`;
    }
}
