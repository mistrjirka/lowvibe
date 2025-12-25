import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { detectLanguage, getOutline, findByName } from './ast_parser';
import { getFileDiff } from '../utils/fileTracker';

export const ReplaceCodeblockSchema = z.object({
    path: z.string().describe('Path to the file (relative to repo root)'),
    name: z.string().describe('Name of the function/class/logic block to replace'),
    newContent: z.string().describe('Complete new content for the code block (including signature)')
});

export type ReplaceCodeblockArgs = z.infer<typeof ReplaceCodeblockSchema>;

/**
 * Strip comments and empty lines to compare logic only
 */
function stripCommentsAndWhitespace(code: string, language: 'python' | 'cpp'): string {
    return code
        .split('\n')
        .filter(line => {
            const trimmed = line.trim();
            if (!trimmed) return false;  // Empty line
            if (language === 'python' && trimmed.startsWith('#')) return false;  // Python comment
            if (language === 'cpp' && (trimmed.startsWith('//') || trimmed.startsWith('/*'))) return false;  // C++ comment
            return true;
        })
        .map(line => line.trim())
        .join('\n');
}

/**
 * Replace a specific function/class/logic block by name
 */
export function replaceCodeblock(repoRoot: string, args: ReplaceCodeblockArgs): { success: boolean; message: string; diff?: string; warning?: string } | { error: string } {
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
            return { error: `Code block "${args.name}" not found in ${args.path}. Use get_file_outline to see available blocks.` };
        }

        const lines = content.split('\n');
        const before = lines.slice(0, item.line - 1);
        const after = lines.slice(item.endLine);
        const originalCode = lines.slice(item.line - 1, item.endLine).join('\n');

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

        // Check if logic is unchanged (after stripping comments/whitespace)
        const oldStripped = stripCommentsAndWhitespace(originalCode, language);
        const newStripped = stripCommentsAndWhitespace(args.newContent, language);

        if (oldStripped === newStripped) {
            return {
                success: true,
                message: `⚠️ WARNING: Code block "${args.name}" was replaced but LOGIC IS UNCHANGED (only comments/whitespace differ). Review if this is intentional.`,
                diff,
                warning: 'logic_unchanged'
            };
        }

        return {
            success: true,
            message: `Successfully replaced ${item.type} "${args.name}"`,
            diff
        };
    } catch (err: any) {
        return { error: `Failed to replace code block: ${err.message}` };
    }
}

// Legacy export for backward compatibility
export const EditFunctionSchema = ReplaceCodeblockSchema;
export type EditFunctionArgs = ReplaceCodeblockArgs;
export const editFunction = replaceCodeblock;
