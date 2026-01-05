import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { detectLanguage, getOutline, findByName } from './ast_parser';
import { getFileDiff } from '../utils/fileTracker';

export const EditFunctionSchema = z.object({
    path: z.string().describe('Path to the file (relative to repo root)'),
    name: z.string().describe('Name of the function/class/method to edit'),
    newContent: z.string().describe('Complete new content for the function (including signature)')
});

export type EditFunctionArgs = z.infer<typeof EditFunctionSchema>;

/**
 * Edit a specific function/class by name
 */
export function editFunction(repoRoot: string, args: EditFunctionArgs): { success: boolean; message: string; diff?: string } | { error: string } {
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

        // Preserve indentation from original
        const originalFirst = lines[item.line - 1];
        const indent = originalFirst.match(/^(\s*)/)?.[1] || '';

        // Apply indentation to new content if it doesn't have it
        let newContentLines = args.newContent.split('\n');
        if (!newContentLines[0].startsWith(indent)) {
            newContentLines = newContentLines.map((line, i) =>
                i === 0 ? indent + line.trimStart() : line
            );
        }

        const newFileContent = [...before, ...newContentLines, ...after].join('\n');

        fs.writeFileSync(absolutePath, newFileContent, 'utf-8');

        // Generate real diff
        const diff = getFileDiff(content, newFileContent);

        return {
            success: true,
            message: `Successfully edited ${item.type} "${args.name}"`,
            diff
        };
    } catch (err: any) {
        return { error: `Failed to edit function: ${err.message}` };
    }
}
