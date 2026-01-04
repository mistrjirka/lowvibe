import { z } from 'zod';
import { IPromptBuilder, ReasoningEffort } from './prompt.interface';
import { TesterOutputSchema, ImplementTask } from '../schemas/AgentSchemas';

/**
 * Variables for the Tester agent prompt
 */
export interface TesterVariables {
    overallDescription: string;
    completedTask: ImplementTask;
    implementerSummary: string;
    todoList: string;
    filesCreatedByTester: string[];
}

/**
 * Prompt builder for the Tester agent.
 * The Tester verifies implementation correctness after Implementer completes.
 */
export class TesterPromptBuilder implements IPromptBuilder<TesterVariables, z.infer<typeof TesterOutputSchema>> {
    getReasoningEffort(): ReasoningEffort {
        return 'medium';
    }

    getZodSchema(): z.ZodType<z.infer<typeof TesterOutputSchema>> {
        return TesterOutputSchema;
    }

    buildSystemPrompt(): string {
        return `You are the TESTER agent in a multi-agent coding system.

## Your Role
You verify that the Implementer's changes are correct. Test for syntax errors, logical errors, and correctness.

## Available Tools
- \`run_cmd\`: Execute commands (compile, run tests, syntax check)
- \`create_file\`: Create test files
- \`read_file\`: Read files to verify content

## Restrictions
- You can ONLY edit files you created in this session
- You CANNOT edit existing project files

## Testing Strategy
1. Check syntax: Run linter/compiler
2. Check logic: Run the code with test inputs
3. Verify output: Compare to expected results

## Output Format
Always output one of:
- \`message\`: Explain your testing approach or findings
- \`tool_call\`: Use a tool
- \`result\`: Final test results:
  {
    "type": "result",
    "payload": {
      "successfully_implemented": true/false,
      "successes": "what worked",
      "mistakes": "what failed (empty if success)",
      "tests_to_keep": ["files showing errors to preserve"]
    }
  }`;
    }

    buildUserPrompt(variables: TesterVariables): string {
        const testerFilesSection = variables.filesCreatedByTester.length > 0
            ? `\n## Files You Created (can edit)\n${variables.filesCreatedByTester.join('\n')}`
            : '';

        return `## Overall Goal
${variables.overallDescription}

## Completed Task
- Type: ${variables.completedTask.type}
- File: ${variables.completedTask.file}
- Description: ${variables.completedTask.task_description}

## Implementer's Summary
${variables.implementerSummary}

## Current TODO List
${variables.todoList}
${testerFilesSection}

Test the implementation and report results.`;
    }
}
