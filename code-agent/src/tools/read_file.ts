import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { detectLanguage, getOutline, OutlineItem } from './ast_parser';
import { findCallersForFile, CallerInfo } from '../utils/callerTracker';

export const ReadFileSchema = z.object({
    path: z.string(),
    includeCallers: z.boolean().optional().describe('If true, scan repo for functions that call functions in this file')
});

export type ReadFileArgs = z.infer<typeof ReadFileSchema>;

const FILE_TRUNCATE_THRESHOLD = 5000; // chars
const FILE_SHOW_HALF = 2000; // show first and last this many chars

export interface ReadFileResult {
    content?: string;
    truncated?: boolean;
    totalChars?: number;
    outline?: OutlineItem[];
    callers?: Record<string, CallerInfo[]>;
    error?: string;
}

export function readFile(repoRoot: string, args: ReadFileArgs): ReadFileResult {
    // Normalize path to prevent absolute path traversal
    const relativePath = args.path.replace(/^[/\\]+/, '');
    const absolutePath = path.resolve(repoRoot, relativePath);
    if (!absolutePath.startsWith(path.resolve(repoRoot))) {
        return { error: "Access denied: Path is outside repository root" };
    }

    if (!fs.existsSync(absolutePath)) {
        return { error: "File not found" };
    }

    try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const result: ReadFileResult = {};

        // Handle content truncation
        if (content.length <= FILE_TRUNCATE_THRESHOLD) {
            result.content = content;
        } else {
            const firstPart = content.slice(0, FILE_SHOW_HALF);
            const lastPart = content.slice(-FILE_SHOW_HALF);
            result.content = firstPart +
                `\n\n... MIDDLE TRUNCATED (${content.length} chars total, showing first and last ${FILE_SHOW_HALF}) ...\n\n` +
                lastPart +
                `\n\nTIP: For Python/C++ files, use get_file_outline("${args.path}") to see structure, then read_function to read specific functions.\n` +
                `Or use run_cmd with "head -n 100 ${args.path}" or "tail -n 100 ${args.path}" to view specific portions.`;
            result.truncated = true;
            result.totalChars = content.length;
        }

        // Add outline and callers if requested
        if (args.includeCallers) {
            const lang = detectLanguage(args.path);
            if (lang !== 'unknown') {
                try {
                    result.outline = getOutline(content, lang);
                    const callersMap = findCallersForFile(repoRoot, absolutePath);
                    result.callers = Object.fromEntries(callersMap);
                } catch (err) {
                    // If AST parsing fails, just skip callers
                }
            }
        }

        return result;
    } catch (err: any) {
        return { error: err.message };
    }
}

