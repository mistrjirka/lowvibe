import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { detectLanguage, getOutline, findByName } from './ast_parser';
import { getFileDiff } from '../utils/fileTracker';

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
/**
 * Helper to find the deepest node containing the target line
 */
function findContainingNode(items: import('./ast_parser').OutlineItem[], line: number): import('./ast_parser').OutlineItem | null {
    for (const item of items) {
        if (line >= item.line && line <= item.endLine) {
            // Check children for a more specific match
            if (item.children) {
                const childMatch = findContainingNode(item.children, line);
                if (childMatch) return childMatch;
            }
            return item;
        }
    }
    return null;
}

/**
 * Extract the name of a function/class definition from code
 */
function extractDefinitionName(code: string, language: 'python' | 'cpp' | 'unknown'): string | null {
    const firstLine = code.trim().split('\n')[0];

    if (language === 'python') {
        // Match: def function_name(... or class ClassName... or async def func_name(...
        const match = firstLine.match(/^(?:async\s+)?(?:def|class)\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
        return match ? match[1] : null;
    } else if (language === 'cpp') {
        // Match: void function_name(... or class ClassName { or int main(...
        // Also handle: ReturnType ClassName::method_name(...
        const classMatch = firstLine.match(/^(?:class|struct)\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (classMatch) return classMatch[1];

        const funcMatch = firstLine.match(/(?:\w+\s+)+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
        return funcMatch ? funcMatch[1] : null;
    }

    return null;
}

/**
 * Add a new function/class at a specific line
 */
export function addFunction(repoRoot: string, args: AddFunctionArgs): { success: boolean; message: string; diff?: string } | { error: string } {
    const absolutePath = path.resolve(repoRoot, args.path.replace(/^[/\\]+/, ''));

    if (!absolutePath.startsWith(path.resolve(repoRoot))) {
        return { error: "Access denied: Path is outside repository root" };
    }

    if (!fs.existsSync(absolutePath)) {
        return { error: `File not found: ${args.path}` };
    }

    try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const lines = content.split('\n');
        let insertAtLine = args.insertAtLine;
        let warning = '';

        // Smart Insertion Logic: Check if we are inside another function
        const language = detectLanguage(args.path);
        if (language !== 'unknown') {
            try {
                const outline = getOutline(content, language);

                // DUPLICATE CHECK: Extract the name of the function/class being added
                const newItemName = extractDefinitionName(args.code, language);
                if (newItemName) {
                    const existingItem = findByName(outline, newItemName);
                    if (existingItem) {
                        return {
                            error: `Duplicate detected: A ${existingItem.type} named "${newItemName}" already exists at lines ${existingItem.line}-${existingItem.endLine}. Use edit_function to modify it instead.`
                        };
                    }
                }

                const containingNode = findContainingNode(outline, insertAtLine);

                // If we are strictly inside a function/class/method (not just at the start/end boundaries)
                // And the code being added looks like a function/class definition
                if (containingNode && ['function', 'method', 'class'].includes(containingNode.type)) {
                    const isDef = /^\s*(def|class|async def|void|int|bool|string|public|private|protected)\b/.test(args.code);

                    // If adding a definition inside another definition, probably a mistake.
                    // Exception: User might legitimately want inner functions, but usually not for global tasks.
                    // We assume if the user picked a line in the middle, they might have meant "after this function"
                    // checking if the line is NOT the last line (which might be the intended insertion point)
                    if (isDef && insertAtLine > containingNode.line && insertAtLine < containingNode.endLine) {
                        // Adjust to end of function
                        insertAtLine = containingNode.endLine + 1;
                        warning = ` (Adjusted insertion from line ${args.insertAtLine} to ${insertAtLine} to avoid breaking '${containingNode.name}')`;
                    }
                }
            } catch (astError) {
                // Ignore AST errors, fall back to raw line insertion
                console.warn('AST parsing failed during addFunction:', astError);
            }
        }

        const insertIndex = Math.max(0, Math.min(insertAtLine - 1, lines.length));
        const newCodeLines = args.code.split('\n');

        lines.splice(insertIndex, 0, ...newCodeLines);

        const newContent = lines.join('\n');
        fs.writeFileSync(absolutePath, newContent, 'utf-8');

        // Generate diff
        const diff = getFileDiff(content, newContent);

        return {
            success: true,
            message: `Inserted ${newCodeLines.length} lines at line ${insertAtLine}${warning}`,
            diff
        };
    } catch (err: any) {
        return { error: `Failed to add function: ${err.message}` };
    }
}

/**
 * Remove a function/class by name
 */
export function removeFunction(repoRoot: string, args: RemoveFunctionArgs): { success: boolean; message: string; linesRemoved: number; diff?: string } | { error: string } {
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
        const before = lines.slice(0, item.line - 1);
        const after = lines.slice(item.endLine);

        const newContent = [...before, ...after].join('\n');
        fs.writeFileSync(absolutePath, newContent, 'utf-8');

        const linesRemoved = item.endLine - item.line + 1;

        // Generate diff
        const diff = getFileDiff(content, newContent);

        return {
            success: true,
            message: `Removed "${args.name}" (lines ${item.line}-${item.endLine})`,
            linesRemoved,
            diff
        };
    } catch (err: any) {
        return { error: `Failed to remove function: ${err.message}` };
    }
}
