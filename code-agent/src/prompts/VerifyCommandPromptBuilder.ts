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
        return `You are a command path verifier. Check if referenced files/directories exist in the file tree.

## CRITICAL RULES:
1. If a file/directory EXISTS in the file tree, the command is VALID. Return valid: true.
2. ONLY return valid: false if a file is CLEARLY missing from the tree.
3. Do NOT invent errors. If unsure, assume the command is valid.
4. Executables without extensions (like "dp_implementation") are VALID on Linux.
5. "cd <subdir>" is VALID if that subdir exists in the file tree.

## When to return valid: false (with correctedCmd or error):
- Input file referenced via "<" doesn't exist at the expected path
- Script file doesn't exist at the expected path (but might exist elsewhere in tree - provide correction)

## When to return valid: true:
- Executable exists in tree
- Directory exists for cd command
- All referenced input files exist
- You are unsure (default to valid)

## Output:
{
  "valid": true/false,
  "correctedCmd": "...", // only if you can fix a path
  "correctedCwd": "...", // only if cwd needs to change
  "error": "..." // only if valid is false and unfixable
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
