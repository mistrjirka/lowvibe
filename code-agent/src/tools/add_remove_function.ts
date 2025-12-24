import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { detectLanguage, getOutline, findByName } from './ast_parser';

// Add function schema
export const AddFunctionSchema = z.object({
    path: z.string().describe('Path to the file (relative to repo root)'),
    code: z.string().describe('Complete code for the new function/class'),
    insertAtLine: z.number().describe('Line number where to insert (1-indexed)')
});

export type AddFunctionArgs = z.infer<typeof AddFunctionSchema>;

// Remove function schema
export const RemoveFunctionSchema = z.object({
    path: z.string().describe('Path to the file (relative to repo root)'),
    name: z.string().describe('Name of the function/class/method to remove')
});

export type RemoveFunctionArgs = z.infer<typeof RemoveFunctionSchema>;

/**
 * Add a new function/class at a specific line
 */
export function addFunction(repoRoot: string, args: AddFunctionArgs): { success: boolean; message: string } | { error: string } {
    const absolutePath = path.resolve(repoRoot, args.path);

    if (!absolutePath.startsWith(path.resolve(repoRoot))) {
        return { error: "Access denied: Path is outside repository root" };
    }

    if (!fs.existsSync(absolutePath)) {
        return { error: `File not found: ${args.path}` };
    }

    try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const lines = content.split('\n');

        const insertIndex = Math.max(0, Math.min(args.insertAtLine - 1, lines.length));
        const newCodeLines = args.code.split('\n');

        lines.splice(insertIndex, 0, ...newCodeLines);

        fs.writeFileSync(absolutePath, lines.join('\n'), 'utf-8');

        return {
            success: true,
            message: `Inserted ${newCodeLines.length} lines at line ${args.insertAtLine}`
        };
    } catch (err: any) {
        return { error: `Failed to add function: ${err.message}` };
    }
}

/**
 * Remove a function/class by name
 */
export function removeFunction(repoRoot: string, args: RemoveFunctionArgs): { success: boolean; message: string; linesRemoved: number } | { error: string } {
    const absolutePath = path.resolve(repoRoot, args.path);

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
        const before = lines.slice(0, item.line - 1);
        const after = lines.slice(item.endLine);

        const newContent = [...before, ...after].join('\n');
        fs.writeFileSync(absolutePath, newContent, 'utf-8');

        const linesRemoved = item.endLine - item.line + 1;
        return {
            success: true,
            message: `Removed "${args.name}" (lines ${item.line}-${item.endLine})`,
            linesRemoved
        };
    } catch (err: any) {
        return { error: `Failed to remove function: ${err.message}` };
    }
}
