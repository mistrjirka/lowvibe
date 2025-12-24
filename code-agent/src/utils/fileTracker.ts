import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const BACKUP_DIR = '.code-agent-backups';

export interface FileBackup {
    originalPath: string;
    backupPath: string;
    timestamp: number;
    hash: string;
}

/**
 * Create a backup of a file before modification.
 * Backups are stored in a .code-agent-backups directory alongside the file.
 */
export function createFileBackup(filePath: string, content: string): string {
    const dir = path.dirname(filePath);
    const backupDir = path.join(dir, BACKUP_DIR);

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = Date.now();
    const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
    const baseName = path.basename(filePath);
    const backupName = `${baseName}.${timestamp}.${hash}.bak`;
    const backupPath = path.join(backupDir, backupName);

    fs.writeFileSync(backupPath, content, 'utf-8');
    return backupPath;
}

/**
 * Generate a simple line-by-line diff between two strings.
 * Returns a unified diff-like format.
 */
export function getFileDiff(before: string, after: string): string {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const diff: string[] = [];

    // Simple LCS-based diff
    const maxLen = Math.max(beforeLines.length, afterLines.length);
    let bi = 0, ai = 0;

    while (bi < beforeLines.length || ai < afterLines.length) {
        if (bi >= beforeLines.length) {
            // Only additions left
            diff.push(`+${afterLines[ai]}`);
            ai++;
        } else if (ai >= afterLines.length) {
            // Only deletions left
            diff.push(`-${beforeLines[bi]}`);
            bi++;
        } else if (beforeLines[bi] === afterLines[ai]) {
            // Lines match - context
            diff.push(` ${beforeLines[bi]}`);
            bi++;
            ai++;
        } else {
            // Look ahead to see if this is an insertion or deletion
            const nextBeforeMatch = afterLines.indexOf(beforeLines[bi], ai);
            const nextAfterMatch = beforeLines.indexOf(afterLines[ai], bi);

            if (nextBeforeMatch !== -1 && (nextAfterMatch === -1 || nextBeforeMatch - ai <= nextAfterMatch - bi)) {
                // Insertion in after
                while (ai < nextBeforeMatch) {
                    diff.push(`+${afterLines[ai]}`);
                    ai++;
                }
            } else if (nextAfterMatch !== -1) {
                // Deletion from before
                while (bi < nextAfterMatch) {
                    diff.push(`-${beforeLines[bi]}`);
                    bi++;
                }
            } else {
                // No match found - treat as replacement
                diff.push(`-${beforeLines[bi]}`);
                diff.push(`+${afterLines[ai]}`);
                bi++;
                ai++;
            }
        }
    }

    return diff.join('\n');
}

/**
 * List all backups for a specific file.
 */
export function getBackups(filePath: string): FileBackup[] {
    const dir = path.dirname(filePath);
    const backupDir = path.join(dir, BACKUP_DIR);
    const baseName = path.basename(filePath);

    if (!fs.existsSync(backupDir)) {
        return [];
    }

    const files = fs.readdirSync(backupDir);
    const backups: FileBackup[] = [];

    for (const file of files) {
        if (file.startsWith(baseName + '.') && file.endsWith('.bak')) {
            const parts = file.split('.');
            if (parts.length >= 4) {
                const timestamp = parseInt(parts[parts.length - 3], 10);
                const hash = parts[parts.length - 2];

                backups.push({
                    originalPath: filePath,
                    backupPath: path.join(backupDir, file),
                    timestamp,
                    hash
                });
            }
        }
    }

    // Sort by timestamp, newest first
    return backups.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Restore a file from a backup.
 */
export function restoreFromBackup(backupPath: string, targetPath: string): boolean {
    try {
        const content = fs.readFileSync(backupPath, 'utf-8');
        fs.writeFileSync(targetPath, content, 'utf-8');
        return true;
    } catch {
        return false;
    }
}

/**
 * Clean up old backups, keeping only the most recent N backups per file.
 */
export function cleanupBackups(filePath: string, keepCount: number = 10): number {
    const backups = getBackups(filePath);
    let deleted = 0;

    if (backups.length > keepCount) {
        const toDelete = backups.slice(keepCount);
        for (const backup of toDelete) {
            try {
                fs.unlinkSync(backup.backupPath);
                deleted++;
            } catch {
                // Ignore deletion errors
            }
        }
    }

    return deleted;
}
