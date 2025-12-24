import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

export const ReadFileSchema = z.object({
    path: z.string()
});

export type ReadFileArgs = z.infer<typeof ReadFileSchema>;

export function readFile(repoRoot: string, args: ReadFileArgs): { content?: string; error?: string } {
    const absolutePath = path.resolve(repoRoot, args.path);
    if (!absolutePath.startsWith(path.resolve(repoRoot))) {
        return { error: "Access denied: Path is outside repository root" };
    }

    if (!fs.existsSync(absolutePath)) {
        return { error: "File not found" };
    }

    try {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        return { content };
    } catch (err: any) {
        return { error: err.message };
    }
}
