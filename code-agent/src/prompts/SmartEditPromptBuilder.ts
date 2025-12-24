import { z } from 'zod';
import { IPromptBuilder, ReasoningEffort } from './prompt.interface';

export const SmartEditSchema = z.object({
    found: z.boolean().describe('Whether the code block was found in the file'),
    actualString: z.string().describe('The EXACT string from the file that matches the intent. Must include exact whitespace.'),
    confidence: z.enum(['high', 'medium', 'low']).describe('Confidence in the match')
});

export type SmartEditOutput = z.infer<typeof SmartEditSchema>;

export interface SmartEditVariables {
    fileContent: string;
    failedFindString: string;
}

/**
 * Prompt builder for smart edit recovery.
 * Used when exact string replacement fails to locate the intended code block.
 */
export class SmartEditPromptBuilder implements IPromptBuilder<SmartEditVariables, SmartEditOutput> {
    getReasoningEffort(): ReasoningEffort {
        return 'medium';
    }

    getZodSchema(): z.ZodType<SmartEditOutput> {
        return SmartEditSchema;
    }

    buildSystemPrompt(): string {
        return `You are a code matching expert. Your job is to locate a code block in a file that was intended to be replaced, but failed exact string matching.

The user will provide:
1. The full file content
2. The "search string" that failed to match

Your task:
1. Find the code block in the file that corresponds to the "search string".
2. Ignore minor whitespace differences, indentation changes, or partially correct content.
3. If the user provided a regex or a rough description, find the actual code it refers to.
4. Return the EXACT substring from the file (including all newlines and indentation) so that a string replacement will succeed.`;
    }

    buildUserPrompt(variables: SmartEditVariables): string {
        // Truncate file content if too huge? hopefully context window handles it.
        // limit context output to avoid massive logs if possible, but we need full file for matching.

        return `## FILE CONTENT:
${variables.fileContent}

## FAILED SEARCH STRING:
${variables.failedFindString}

## INSTRUCTIONS:
Locate the block in the file that matches the "FAILED SEARCH STRING".
Return the EXACT substring from the "FILE CONTENT" that matches.
If you cannot find a confident match, set found=false.`;
    }
}
