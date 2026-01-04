import { z } from 'zod';
import { IPromptBuilder, ReasoningEffort } from './prompt.interface';
import { FinisherFeedbackSchema, TaskResultEntry } from '../schemas/AgentSchemas';

/**
 * Variables for the Finisher agent prompt
 */
export interface FinisherVariables {
    overallDescription: string;
    taskResults: TaskResultEntry[];
    todoList: string;
}

/**
 * Prompt builder for the Finisher agent.
 * The Finisher aggregates test results and provides feedback to the Thinker.
 */
export class FinisherPromptBuilder implements IPromptBuilder<FinisherVariables, z.infer<typeof FinisherFeedbackSchema>> {
    getReasoningEffort(): ReasoningEffort {
        return 'medium';
    }

    getZodSchema(): z.ZodType<z.infer<typeof FinisherFeedbackSchema>> {
        return FinisherFeedbackSchema;
    }

    buildSystemPrompt(): string {
        return `You are the FINISHER agent in a multi-agent coding system.

## Your Role
You aggregate all test results and provide constructive feedback to the Thinker agent.

## Your Output
Analyze all task results and produce a summary:
{
  "overall": "Common error patterns, what went wrong, what to focus on next",
  "task_results": [pre-filled with Tester outputs]
}

## Guidelines
1. Identify recurring error patterns
2. Note which approaches worked vs failed
3. Provide specific, actionable feedback
4. If all tasks succeeded, acknowledge completion`;
    }

    buildUserPrompt(variables: FinisherVariables): string {
        const resultsSection = variables.taskResults.map((tr, i) => {
            return `### Task ${i + 1}: ${tr.task.type} - ${tr.task.file}
- Description: ${tr.task.task_description}
- Success: ${tr.test_result.successfully_implemented}
- Successes: ${tr.test_result.successes || 'N/A'}
- Mistakes: ${tr.test_result.mistakes || 'N/A'}`;
        }).join('\n\n');

        return `## Overall Goal
${variables.overallDescription}

## Task Results
${resultsSection}

## Current TODO List
${variables.todoList}

Analyze all results and provide feedback for the Thinker.`;
    }
}
