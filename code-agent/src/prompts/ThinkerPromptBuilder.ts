import { z } from 'zod';
import { IPromptBuilder, ReasoningEffort } from './prompt.interface';
import { ThinkerOutputSchema, ImplementToolSchema } from '../schemas/AgentSchemas';

/**
 * Variables for the Thinker agent prompt
 */
export interface ThinkerVariables {
    task: string;
    todoList: string;
    currentFiles: string[];
    recentHistory?: string;
}

/**
 * Prompt builder for the Thinker agent.
 * The Thinker analyzes tasks, proposes solutions, and dispatches work to Implementer.
 */
export class ThinkerPromptBuilder implements IPromptBuilder<ThinkerVariables, z.infer<typeof ThinkerOutputSchema>> {
    getReasoningEffort(): ReasoningEffort {
        return 'high';
    }

    getZodSchema(): z.ZodType<z.infer<typeof ThinkerOutputSchema>> {
        return ThinkerOutputSchema;
    }

    buildSystemPrompt(): string {
        return `You are the THINKER agent in a multi-agent coding system.

## Your Role
You analyze tasks, plan solutions, and dispatch implementation work to the Implementer agent.

## Available Tools
- \`read_file\`: Read file content with optional caller information
- \`run_cmd\`: Execute shell commands
- \`manage_todos\`: Update the task checklist
- \`implement\`: Dispatch file operations to the Implementer agent

## Rules
1. Think step-by-step before acting
2. Read relevant files before proposing changes
3. Use \`implement\` to dispatch actual code changes
4. After each tool call, explain what you learned
5. You CANNOT call \`implement\` twice in a row - you must output a message or use another tool first

## Implement Tool Format
When calling implement, provide:
{
  "type": "implement",
  "payload": {
    "description": "Overall goal description",
    "tasks": [
      {
        "type": "create_file" | "edit_file" | "delete_file",
        "task_description": "Specific task details",
        "code": "Code to add/modify",
        "file": "path/to/file"
      }
    ]
  }
}

## Output Format
Always output one of:
- \`message\`: Explain your reasoning or findings
- \`tool_call\`: Use a tool (read_file, run_cmd, manage_todos)
- \`implement\`: Dispatch work to Implementer
- \`final\`: Mark task complete`;
    }

    buildUserPrompt(variables: ThinkerVariables): string {
        const filesSection = variables.currentFiles.length > 0
            ? `\n## Available Files\n${variables.currentFiles.join('\n')}`
            : '';

        const historySection = variables.recentHistory
            ? `\n## Recent Progress\n${variables.recentHistory}`
            : '';

        return `## Task
${variables.task}

## Current TODO List
${variables.todoList}
${filesSection}
${historySection}

Analyze the task and decide what to do next.`;
    }
}
