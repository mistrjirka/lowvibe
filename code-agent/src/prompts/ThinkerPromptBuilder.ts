import { z } from 'zod';
import { IPromptBuilder, ReasoningEffort } from './prompt.interface';
import { ThinkerOutputSchema, ImplementToolSchema } from '../schemas/AgentSchemas';

/**
 * Variables for the Thinker agent prompt
 */
export interface ThinkerVariables {
  task: string;
  goal: string;  // The restated goal from planning
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

### read_file
Read file content.
Arguments:
- path (required): File path to read
- includeCallers (optional): If true, find functions that call functions in this file

### run_cmd
Execute shell commands.
Arguments:
- cmd (required): Shell command to execute
- cwd (optional): Working directory relative to repo root

### manage_todos
Update the task checklist.
Arguments:
- action (required): "add", "complete", or "update"
- todo (required): Todo item text

## Rules
1. Think step-by-step before acting
2. Read relevant files before proposing changes
3. Use \`implement\` to dispatch actual code changes
4. After each tool call, explain what you learned
5. You CANNOT call \`implement\` twice in a row - you must output a message or use another tool first
6. If you call \`implement\`, the \`tasks\` array MUST contain at least one task. If you have no implementation tasks, do not call \`implement\`.
7. **INTEGRATION**: You must explicitly plan to integrate sub-solutions. If you create separate files, ensure they are connected/imported in the final solution.

## Planning Strategy
1. Break down complex tasks.
2. Verify each step.
3. Ensure all components are wired together in the final solution.

## Implement Tool Format
When calling implement, provide:
{
  "type": "implement",
  "payload": {
    "description": "Overall goal description",
    "tasks": [ ... ],
    "test_files": ["path/to/test1.in", "path/to/test2.txt"] // Optional: relevant test inputs
  }
}

## Output Format
Always output one of:
- \`message\`: { "type": "message", "text": "your explanation" }
- \`tool_call\`: { "type": "tool_call", "tool": "tool_name", "args": { ... } }
- \`implement\`: Dispatch work to Implementer
- \`final\`: { "type": "final", "text": "summary", "criteriaStatus": "success"|"partial"|"blocked" }`;
  }

  buildUserPrompt(variables: ThinkerVariables): string {
    const filesSection = variables.currentFiles.length > 0
      ? `\n## Available Files\n${variables.currentFiles.join('\n')}`
      : '';

    const historySection = variables.recentHistory
      ? `\n## Recent Progress\n${variables.recentHistory}`
      : '';

    return `## Goal
${variables.goal}

## User Task
${variables.task}

## TODO List
${variables.todoList}
${filesSection}
${historySection}

Analyze the task and decide what to do next.`;
  }
}
