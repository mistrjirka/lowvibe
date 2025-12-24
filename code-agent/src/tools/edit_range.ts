import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

export const EditRangeSchema = z.object({
    path: z.string().describe('Path to the file (relative to repo root)'),
    startLine: z.number().describe('Start line number (1-indexed, inclusive)'),
    endLine: z.number().describe('End line number (1-indexed, inclusive)'),
    newContent: z.string().describe('Content to replace the lines with')
});

export type EditRangeArgs = z.infer<typeof EditRangeSchema>;

/**
 * Replace a range of lines in a file with new content
 */
export function editRange(repoRoot: string, args: EditRangeArgs): { success: boolean; message: string; linesRemoved: number; linesAdded: number } | { error: string } {
    const absolutePath = path.resolve(repoRoot, args.path);

    if (!absolutePath.startsWith(path.resolve(repoRoot))) {
        return { error: "Access denied: Path is outside repository root" };
    }

    if (!fs.existsSync(absolutePath)) {
        return { error: `File not found: ${args.path}` };
    }

    if (args.startLine < 1 || args.endLine < args.startLine) {
        return { error: `Invalid line range: ${args.startLine}-${args.endLine}` };
    }

    try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const lines = content.split('\n');

        if (args.endLine > lines.length) {
            return { error: `End line ${args.endLine} exceeds file length (${lines.length} lines)` };
        }

        const before = lines.slice(0, args.startLine - 1);
        const after = lines.slice(args.endLine);
        const newContentLines = args.newContent.split('\n');

        const newContent = [...before, ...newContentLines, ...after].join('\n');
        fs.writeFileSync(absolutePath, newContent, 'utf-8');

        const linesRemoved = args.endLine - args.startLine + 1;
        const linesAdded = newContentLines.length;

        return {
            success: true,
            message: `Replaced lines ${args.startLine}-${args.endLine} (${linesRemoved} lines) with ${linesAdded} new lines`,
            linesRemoved,
            linesAdded
        };
    } catch (err: any) {
        return { error: `Failed to edit range: ${err.message}` };
    }
}
