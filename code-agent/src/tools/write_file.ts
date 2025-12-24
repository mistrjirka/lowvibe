import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { createFileBackup, getFileDiff, cleanupBackups } from '../utils/fileTracker';

export const WriteFileSchema = z.object({
    path: z.string(),
    content: z.string()
});

export type WriteFileArgs = z.infer<typeof WriteFileSchema>;

export interface WriteFileResult {
    success: boolean;
    error?: string;
    isNew?: boolean;       // True if this was a new file
    diff?: string;         // Diff of changes (if file existed)
    backupPath?: string;   // Path to backup file (if file existed)
}

export function writeFile(repoRoot: string, args: WriteFileArgs): WriteFileResult {
    const absolutePath = path.resolve(repoRoot, args.path);
    if (!absolutePath.startsWith(path.resolve(repoRoot))) {
        return { success: false, error: "Access denied: Path is outside repository root" };
    }

    try {
        const dir = path.dirname(absolutePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        let previousContent: string | undefined;
        let backupPath: string | undefined;
        let diff: string | undefined;
        let isNew = true;

        // Check if file exists and backup if so
        if (fs.existsSync(absolutePath)) {
            isNew = false;
            previousContent = fs.readFileSync(absolutePath, 'utf-8');
            backupPath = createFileBackup(absolutePath, previousContent);

            // Clean up old backups
            cleanupBackups(absolutePath, 10);

            // Generate diff
            diff = getFileDiff(previousContent, args.content);
        }

        fs.writeFileSync(absolutePath, args.content, 'utf-8');

        return {
            success: true,
            isNew,
            diff,
            backupPath
        };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}
