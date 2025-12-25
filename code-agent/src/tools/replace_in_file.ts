import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { createFileBackup, getFileDiff, cleanupBackups } from '../utils/fileTracker';

export const ReplaceInFileSchema = z.object({
    path: z.string(),
    find: z.string(),
    replace: z.string(),
    expectedReplacements: z.number().optional()
});

export type ReplaceInFileArgs = z.infer<typeof ReplaceInFileSchema>;

export interface ReplaceInFileResult {
    success: boolean;
    replacementsMade: number;
    error?: string;
    fileContent?: string;  // Full file content on error for recovery
    diff?: string;         // Diff of changes on success
    backupPath?: string;   // Path to backup file
}

export function replaceInFile(repoRoot: string, args: ReplaceInFileArgs): ReplaceInFileResult {
    const absolutePath = path.resolve(repoRoot, args.path);

    // Security check: ensure we are within repoRoot
    if (!absolutePath.startsWith(path.resolve(repoRoot))) {
        return { success: false, replacementsMade: 0, error: "Access denied: Path is outside repository root" };
    }

    if (!fs.existsSync(absolutePath)) {
        return { success: false, replacementsMade: 0, error: "File not found" };
    }

    try {
        const content = fs.readFileSync(absolutePath, 'utf-8');

        // We need to count occurrences first if expectedReplacements is set
        // Create a global regex from the 'find' string. Escape special chars.
        const escapedFind = args.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedFind, 'g');

        const matches = content.match(regex);
        const count = matches ? matches.length : 0;

        if (count === 0) {
            // FALLBACK: Try relaxed matching for line endings (CRLF vs LF)
            // 1. Escape special regex characters in the search string
            // 2. Replace logical newlines with flexible regex pattern \r?\n
            const relaxedRegexStr = args.find
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex chars
                .replace(/(\r\n|\r|\n)/g, '\\r?\\n');   // Allow \r, \n, or \r\n to match \r?\n in file

            const relaxedRegex = new RegExp(relaxedRegexStr, 'g');
            const relaxedMatches = content.match(relaxedRegex);
            const relaxedCount = relaxedMatches ? relaxedMatches.length : 0;

            if (relaxedCount > 0 && (args.expectedReplacements === undefined || relaxedCount === args.expectedReplacements)) {
                // Relaxed match found! Proceed with replacement using regex.
                // NOTE: split/join uses literal replacement. String.replace(regex, str) parses '$' in str.
                // We must escape '$' in replacement string to '$$' to treat it literally.
                const safeReplacement = args.replace.replace(/\$/g, '$$$$');

                // Create backup before modification
                const backupPath = createFileBackup(absolutePath, content);
                cleanupBackups(absolutePath, 10);

                const newContent = content.replace(relaxedRegex, safeReplacement);

                // Diff and write
                const diff = getFileDiff(content, newContent);
                fs.writeFileSync(absolutePath, newContent, 'utf-8');

                return {
                    success: true,
                    replacementsMade: relaxedCount,
                    diff,
                    backupPath,
                    // Note for the agent/user that we used relaxed matching
                    error: undefined
                };
            }

            // Include full file content so agent can see what's actually in the file
            return {
                success: false,
                replacementsMade: 0,
                error: "String to replace not found (tried strict and relaxed line-ending match). Here is the current file content for reference:",
                fileContent: content
            };
        }

        if (args.expectedReplacements !== undefined && count !== args.expectedReplacements) {
            return {
                success: false,
                replacementsMade: 0,
                error: `Expected ${args.expectedReplacements} replacements, but found ${count}. Here is the current file content:`,
                fileContent: content
            };
        }

        // Create backup before modification
        const backupPath = createFileBackup(absolutePath, content);

        // Clean up old backups (keep last 10)
        cleanupBackups(absolutePath, 10);

        const newContent = content.split(args.find).join(args.replace);

        // Generate diff
        const diff = getFileDiff(content, newContent);

        // Write back
        fs.writeFileSync(absolutePath, newContent, 'utf-8');

        return {
            success: true,
            replacementsMade: count,
            diff,
            backupPath
        };

    } catch (err: any) {
        // Try to include file content even on error
        let fileContent: string | undefined;
        try {
            fileContent = fs.readFileSync(absolutePath, 'utf-8');
        } catch {
            // Ignore if we can't read the file
        }

        return {
            success: false,
            replacementsMade: 0,
            error: err.message,
            fileContent
        };
    }
}
