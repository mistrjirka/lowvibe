import { z } from 'zod';
import { IPromptBuilder, ReasoningEffort } from './prompt.interface';
import { TesterOutputSchema, ImplementTask } from '../schemas/AgentSchemas';

/**
 * Variables for the Tester agent prompt
 */
export interface TesterVariables {
    goal: string;  // The overall goal from planning
    overallDescription: string;
    completedTask: ImplementTask;
    implementerSummary: string;
    todoList: string;
    filesCreatedByTester: string[];
    testInputFiles: string[];  // Test input files available in the project
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
**CRITICAL**: You are NOT an implementer. You DO NOT implement the next steps of the goal. You ONLY verify the *Completed Task* listed below. The "Goal" provided is context only.

## Available Tools

### run_cmd
Execute commands (compile, run tests, syntax check).
Arguments:
- cmd (required): Shell command to execute
- cwd (optional): Working directory RELATIVE to project root (e.g., "src", "backend"). DO NOT use absolute paths.

### create_file
Create a test file.
Arguments:
- path (required): File path to create
- content (required): File content

### read_file
Read files to verify content.
Arguments:
- path (required): File path to read

## Restrictions
- You can ONLY edit files you created in this session
- You CANNOT edit existing project files
- You CANNOT implement new features. Your job is PURELY verification of the *current task*.

## Testing Strategy
1. Check syntax: Run linter/compiler
2. Check logic: Run the code with test inputs
3. Verify output: Compare to expected results

## Critical Rules for Test Files
1. **ALWAYS** use existing test input files if they are available (listed in prompt).
2. **DO NOT** create a new test file unless NO existing file covers the test case.
3. If using an existing file, use its relative path exactly as shown.
4. Only create new files if you absolutely must.

## Output Format
Always output one of:
- \`message\`: { "type": "message", "text": "your explanation" }
- \`tool_call\`: { "type": "tool_call", "tool": "tool_name", "args": { ... } }
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

        const testInputsSection = variables.testInputFiles.length > 0
            ? `\n## Test Input Files Available\n${variables.testInputFiles.join('\n')}\n\nUse these existing test inputs instead of creating new ones.`
            : '';

        return `## Goal
${variables.goal}

## Task Description  
${variables.overallDescription}

## Completed Task
- Type: ${variables.completedTask.type}
- File: ${variables.completedTask.file}
- Description: ${variables.completedTask.task_description}

## Implementer's Summary
${variables.implementerSummary}

## Current TODO List
${variables.todoList}
${testInputsSection}
${testerFilesSection}

Test the implementation of the *Completed Task* above. Do not proceed to verify or implement tasks that have not been done yet. Report results immediately after verification.`;
    }
}
