import { z } from 'zod';
import { IPromptBuilder, ReasoningEffort } from './prompt.interface';

/**
 * Schema for command verification result.
 */
export const VerifyCommandSchema = z.object({
    valid: z.boolean().describe('Whether the command will work as-is'),
    correctedCmd: z.string().optional().describe('Corrected command if fixable'),
    correctedCwd: z.string().optional().describe('Corrected working directory if needed (relative to root or empty for root)'),
    error: z.string().optional().describe('Error message explaining what is wrong and how to fix it')
});

export type VerifyCommandOutput = z.infer<typeof VerifyCommandSchema>;

export interface VerifyCommandVariables {
    cmd: string;
    cwd: string;
    repoRoot: string;
    fileTree: string;
}

/**
 * Prompt builder for verifying commands before execution.
 */
export class VerifyCommandPromptBuilder implements IPromptBuilder<VerifyCommandVariables, VerifyCommandOutput> {
    getReasoningEffort(): ReasoningEffort {
        return 'low';
    }

    getZodSchema(): z.ZodType<VerifyCommandOutput> {
        return VerifyCommandSchema;
    }

    buildSystemPrompt(): string {
        return `You are a command verifier. Your job is to check if a shell command will work given the current directory and available files.

## Your Task:
1. Analyze the command and check if all referenced files exist in the file tree
2. If the command will work, return valid: true
3. If fixable (wrong path), return valid: false with correctedCmd and/or correctedCwd
4. If not fixable, return valid: false with a helpful error message

## Common Issues to Check:
- Python script not in the cwd but exists elsewhere in the tree
- Input file (< file.txt) path is wrong
- Using relative paths that don't match the file tree structure
- Using ".." to access files outside the repository root (STRICTLY FORBIDDEN)
- Changing directory (cd) to outside the repository root

## Output Format:
Return a JSON object with:
- valid: boolean - will the command work?
- correctedCmd: string (optional) - fixed command if path needed correction
- correctedCwd: string (optional) - correct cwd relative to root (empty string = root)
- error: string (optional) - explanation of what's wrong

## Example:
Command: "python script.py < data/input.txt"
CWD: "/project/subdir"
If script.py is in /project not /project/subdir, return:
{
  "valid": false,
  "correctedCwd": "",
  "error": "script.py is in root, not subdir"
}`;
    }

    buildUserPrompt(variables: VerifyCommandVariables): string {
        return `## Command to Verify:
${variables.cmd}

## Current Working Directory:
${variables.cwd}

## Repository Root:
${variables.repoRoot}

## File Tree:
${variables.fileTree}

Analyze if this command will work. If not, provide a correction or helpful error.`;
    }
}
