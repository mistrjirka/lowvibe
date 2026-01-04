import * as fs from 'fs';
import * as path from 'path';
import { detectLanguage, findFunctionCalls, FunctionCallInfo, getOutline, OutlineItem } from '../tools/ast_parser';

/**
 * Information about a caller of a function
 */
export interface CallerInfo {
    file: string;
    functionName: string;
    line: number;
}

/**
 * Scans the repository to find all callers of functions defined in a target file.
 * @param repoRoot Root directory of the repository
 * @param targetFile Path to the file whose functions we want to find callers for
 * @returns Map of function name -> list of callers
 */
export function findCallersForFile(repoRoot: string, targetFile: string): Map<string, CallerInfo[]> {
    const callers = new Map<string, CallerInfo[]>();

    // First, get the outline of the target file to know what functions exist
    const targetContent = fs.readFileSync(targetFile, 'utf-8');
    const targetLang = detectLanguage(targetFile);
    if (targetLang === 'unknown') {
        return callers;
    }

    const outline = getOutline(targetContent, targetLang);
    const targetFunctions = collectFunctionNames(outline);

    // Scan all supported files in the repo
    const filesToScan = collectSupportedFiles(repoRoot);

    for (const file of filesToScan) {
        try {
            const content = fs.readFileSync(file, 'utf-8');
            const lang = detectLanguage(file);
            if (lang === 'unknown') continue;

            const calls = findFunctionCalls(content, lang);
            const relativePath = path.relative(repoRoot, file);

            for (const call of calls) {
                // Match by function name (we're matching unqualified names)
                // We check if the called function exists in target file
                for (const [qualifiedName, simpleName] of targetFunctions) {
                    if (call.calledFunction === simpleName) {
                        if (!callers.has(qualifiedName)) {
                            callers.set(qualifiedName, []);
                        }
                        callers.get(qualifiedName)!.push({
                            file: relativePath,
                            functionName: call.callerContext,
                            line: call.line
                        });
                    }
                }
            }
        } catch (err) {
            // Skip files that can't be read
            continue;
        }
    }

    return callers;
}

/**
 * Collect all function names from outline with both qualified and simple names
 * Returns array of [qualifiedName, simpleName]
 */
function collectFunctionNames(outline: OutlineItem[], prefix = ''): [string, string][] {
    const names: [string, string][] = [];

    for (const item of outline) {
        const qualifiedName = prefix ? `${prefix}.${item.name}` : item.name;

        if (item.type === 'function' || item.type === 'method') {
            names.push([qualifiedName, item.name]);
        }

        if (item.children) {
            const childPrefix = item.type === 'class' ? item.name : qualifiedName;
            names.push(...collectFunctionNames(item.children, childPrefix));
        }
    }

    return names;
}

/**
 * Collect all Python and C++ files in the repository
 */
function collectSupportedFiles(dir: string, maxDepth = 5): string[] {
    const files: string[] = [];

    function walk(currentDir: string, depth: number): void {
        if (depth > maxDepth) return;

        try {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                // Skip common non-code directories
                if (entry.isDirectory()) {
                    if (['node_modules', '.git', '__pycache__', 'venv', '.venv', 'dist', 'build'].includes(entry.name)) {
                        continue;
                    }
                    walk(fullPath, depth + 1);
                } else if (entry.isFile()) {
                    const lang = detectLanguage(fullPath);
                    if (lang !== 'unknown') {
                        files.push(fullPath);
                    }
                }
            }
        } catch {
            // Skip directories we can't read
        }
    }

    walk(dir, 0);
    return files;
}
