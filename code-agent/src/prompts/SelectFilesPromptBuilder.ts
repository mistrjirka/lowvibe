import { z } from 'zod';
import { IPromptBuilder, ReasoningEffort } from './prompt.interface';

/**
 * Schema for selecting files from a list.
 */
export const SelectFilesSchema = z.object({
    files: z.array(z.string()).describe('List of selected relative file paths relevant to the task')
});

export type SelectFilesOutput = z.infer<typeof SelectFilesSchema>;

export interface SelectFilesVariables {
    userTask: string;
    fileList: string[];
}

/**
 * Prompt builder for selecting relevant files from a repository.
 */
export class SelectFilesPromptBuilder implements IPromptBuilder<SelectFilesVariables, SelectFilesOutput> {
    getReasoningEffort(): ReasoningEffort {
        return 'low';
    }

    getZodSchema(): z.ZodType<SelectFilesOutput> {
        return SelectFilesSchema;
    }

    buildSystemPrompt(): string {
        return `You are a coding agent file selector. Your ONLY job is to select files from a provided list that are relevant to completing a user's coding task.

## Output Format:
Return a JSON object with a "files" array containing the selected file paths.

## Rules:
- ONLY select files from the provided list - do not invent file names
- Select files that need to be READ or MODIFIED to complete the task
- If the repository contains test files (e.g. *.in, tests/, data/), YOU MUST SELECT THEM to verify the solution
- Be selective - only include files that are truly necessary
- If the task mentions a specific file (like "main.py"), include it if it exists in the list

## Example:
If the user wants to "add type hints to main.py" and "main.py" is in the file list, you should return:
{"files": ["main.py"]}`;
    }

    buildUserPrompt(variables: SelectFilesVariables): string {
        const fileListFormatted = variables.fileList.length > 0
            ? variables.fileList.map(f => `- ${f}`).join('\n')
            : '(no files found)';

        return `## User Task:
${variables.userTask}

## Available Files in Repository:
${fileListFormatted}

Select the files from the list above that are relevant to completing the task. Return them in the "files" array.`;
    }
}
