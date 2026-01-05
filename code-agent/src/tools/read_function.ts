import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { detectLanguage, parseFile, findByName, getOutline } from './ast_parser';

export const ReadFunctionSchema = z.object({
    path: z.string().describe('Path to the file (relative to repo root)'),
    name: z.string().describe('Name of the function/class/method to read')
});

export type ReadFunctionArgs = z.infer<typeof ReadFunctionSchema>;

/**
 * Read a specific function/class by name
 */
export function readFunction(repoRoot: string, args: ReadFunctionArgs): { content: string; line: number; endLine: number } | { error: string } {
    const absolutePath = path.resolve(repoRoot, args.path.replace(/^[/\\]+/, ''));

    if (!absolutePath.startsWith(path.resolve(repoRoot))) {
        return { error: "Access denied: Path is outside repository root" };
    }

    if (!fs.existsSync(absolutePath)) {
        return { error: `File not found: ${args.path}` };
    }

    const language = detectLanguage(args.path);
    if (language === 'unknown') {
        return { error: `Unsupported language for file: ${args.path}` };
    }

    try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const outline = getOutline(content, language);
        const item = findByName(outline, args.name);

        if (!item) {
            return { error: `Function/class "${args.name}" not found in ${args.path}` };
        }

        const lines = content.split('\n');
        const functionContent = lines.slice(item.line - 1, item.endLine).join('\n');

        return {
            content: functionContent,
            line: item.line,
            endLine: item.endLine
        };
    } catch (err: any) {
        return { error: `Failed to read function: ${err.message}` };
    }
}
