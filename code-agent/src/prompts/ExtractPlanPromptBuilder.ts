import { z } from 'zod';
import { IPromptBuilder, ReasoningEffort } from './prompt.interface';

/**
 * Schema for the implementation plan.
 */
export const ExtractPlanSchema = z.object({
    restatement: z.string().describe('Restatement of the user task and what will be done'),
    todos: z.array(z.object({
        title: z.string(),
        details: z.string(),
        acceptanceCriteria: z.array(z.string())
    }))
});

export type ExtractPlanOutput = z.infer<typeof ExtractPlanSchema>;

export interface ExtractPlanVariables {
    userTask: string;
    fileContents: Map<string, string>;
}

/**
 * Prompt builder for generating an implementation plan.
 */
export class ExtractPlanPromptBuilder implements IPromptBuilder<ExtractPlanVariables, ExtractPlanOutput> {
    getReasoningEffort(): ReasoningEffort {
        return 'high';
    }

    getZodSchema(): z.ZodType<ExtractPlanOutput> {
        return ExtractPlanSchema;
    }

    buildSystemPrompt(): string {
        return `You are a senior software engineer creating a minimal implementation plan.

## CRITICAL: Keep plans SMALL
- Target 3-5 tasks maximum for most problems
- Each task should be a CONCRETE coding action, not research or analysis
- Combine related steps (don't separate "design" from "implement")
- Avoid generic steps like "analyze", "optimize", "handle edge cases" as separate tasks

## Plan Structure:
- restatement: One sentence summary of what will be done
- todos: 3-5 actionable coding tasks, each with:
  - title: Brief action (e.g., "Implement DP solution", not "Design DP State Representation")
  - details: WHAT to code, not theory
  - acceptanceCriteria: How to verify (focus on test outputs)

## Anti-patterns to AVOID:
- Separate "analysis" and "implementation" steps for the same thing
- Generic optimization/edge-case steps (handle inline)
- Academic-style breakdowns (state representation, recurrence relation, etc.)
- More than 2 sentences in details

## Good plan example:
1. "Implement DP solution" - Write dp.py with state dp[i] = min cost to produce T[0:i]
2. "Verify" - Run against test cases

## Rules:
- The LAST step MUST be "Verification": Run against ALL test files (*.in)
- If refactoring existing code, you may skip Integration step
- Order tasks logically (dependencies first)`;
    }

    buildUserPrompt(variables: ExtractPlanVariables): string {
        let fileContext = "";
        variables.fileContents.forEach((content, file) => {
            fileContext += `\n--- File: ${file} ---\n${content}\n`;
        });

        return `User Task: ${variables.userTask}

Attached Files:
${fileContext}

Analyze the task and files. Create a step-by-step implementation plan.`;
    }
}
