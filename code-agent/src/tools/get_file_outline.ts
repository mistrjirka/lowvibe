import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { detectLanguage, getOutline, collectAllNames, FileOutline } from './ast_parser';

export const GetFileOutlineSchema = z.object({
    path: z.string().describe('Path to the file (relative to repo root)')
});

export type GetFileOutlineArgs = z.infer<typeof GetFileOutlineSchema>;

/**
 * Get the structural outline of a file (functions, classes, variables)
 */
export function getFileOutline(repoRoot: string, args: GetFileOutlineArgs): FileOutline | { error: string } {
    const absolutePath = path.resolve(repoRoot, args.path);

    if (!absolutePath.startsWith(path.resolve(repoRoot))) {
        return { error: "Access denied: Path is outside repository root" };
    }

    if (!fs.existsSync(absolutePath)) {
        return { error: `File not found: ${args.path}` };
    }

    const language = detectLanguage(args.path);
    if (language === 'unknown') {
        return { error: `Unsupported language for file: ${args.path}. Supported: Python (.py), C++ (.cpp, .cc, .c, .h)` };
    }

    try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const outline = getOutline(content, language);
        const allNames = collectAllNames(outline);

        return {
            path: args.path,
            language,
            outline,
            allNames
        };
    } catch (err: any) {
        return { error: `Failed to parse file: ${err.message}` };
    }
}
