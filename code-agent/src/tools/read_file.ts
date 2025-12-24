import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

export const ReadFileSchema = z.object({
    path: z.string()
});

export type ReadFileArgs = z.infer<typeof ReadFileSchema>;

const FILE_TRUNCATE_THRESHOLD = 5000; // chars
const FILE_SHOW_HALF = 2000; // show first and last this many chars

export function readFile(repoRoot: string, args: ReadFileArgs): { content?: string; truncated?: boolean; totalChars?: number; error?: string } {
    const absolutePath = path.resolve(repoRoot, args.path);
    if (!absolutePath.startsWith(path.resolve(repoRoot))) {
        return { error: "Access denied: Path is outside repository root" };
    }

    if (!fs.existsSync(absolutePath)) {
        return { error: "File not found" };
    }

    try {
        const content = fs.readFileSync(absolutePath, 'utf-8');

        if (content.length <= FILE_TRUNCATE_THRESHOLD) {
            return { content };
        }

        // Truncate large files - show first and last portions
        const firstPart = content.slice(0, FILE_SHOW_HALF);
        const lastPart = content.slice(-FILE_SHOW_HALF);
        const truncatedContent = firstPart +
            `\n\n... MIDDLE TRUNCATED (${content.length} chars total, showing first and last ${FILE_SHOW_HALF}) ...\n\n` +
            lastPart +
            `\n\nTIP: For Python/C++ files, use get_file_outline("${args.path}") to see structure, then read_function to read specific functions.\n` +
            `Or use run_cmd with "head -n 100 ${args.path}" or "tail -n 100 ${args.path}" to view specific portions.`;

        return { content: truncatedContent, truncated: true, totalChars: content.length };
    } catch (err: any) {
        return { error: err.message };
    }
}

