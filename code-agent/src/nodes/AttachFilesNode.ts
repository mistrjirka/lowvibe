import * as fs from 'fs';
import * as path from 'path';
import { Node, PipelineContext } from '../pipeline/Pipeline';
import { AgentState } from '../pipeline/AgentState';

const FILE_CONTENT_THRESHOLD = 500; // chars

/**
 * Map file extensions to human-readable types
 */
function getFileType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const types: Record<string, string> = {
        '.py': 'Python script',
        '.ts': 'TypeScript file',
        '.tsx': 'TypeScript React component',
        '.js': 'JavaScript file',
        '.jsx': 'JavaScript React component',
        '.cpp': 'C++ source file',
        '.c': 'C source file',
        '.h': 'C/C++ header file',
        '.json': 'JSON data file',
        '.md': 'Markdown document',
        '.txt': 'Text file',
        '.css': 'CSS stylesheet',
        '.html': 'HTML document',
        '.sh': 'Shell script',
        '.yml': 'YAML config',
        '.yaml': 'YAML config',
    };
    return types[ext] || 'File';
}

/**
 * Generate a summary for large files instead of including full content
 */
function generateFileSummary(filePath: string, content: string): string {
    const lines = content.split('\n').length;
    const type = getFileType(filePath);

    // Try to extract a brief description from first few lines
    const firstLines = content.split('\n').slice(0, 5).join('\n').trim();
    const preview = firstLines.length > 100 ? firstLines.slice(0, 100) + '...' : firstLines;

    return `[FILE: ${filePath}]
Type: ${type}
Lines: ${lines}
Preview:
${preview}

Note: File content is large (${content.length} chars). Use read_file("${filePath}") to view full contents.`;
}

export class AttachFilesNode implements Node<AgentState> {
    name = "AttachFiles";

    async execute(state: AgentState, context: PipelineContext): Promise<AgentState> {
        context.logger("[AttachFiles] Reading file contents...");
        const fileContents = new Map<string, string>();

        for (const file of state.selectedFiles) {
            try {
                const content = fs.readFileSync(path.join(state.repoRoot, file), 'utf-8');

                if (content.length <= FILE_CONTENT_THRESHOLD) {
                    // Small file - include full content
                    fileContents.set(file, content);
                    context.logger(`[AttachFiles] Attached ${file} (${content.length} chars)`);
                } else {
                    // Large file - include summary only
                    const summary = generateFileSummary(file, content);
                    fileContents.set(file, summary);
                    context.logger(`[AttachFiles] Summarized ${file} (${content.length} chars -> summary)`);
                }
            } catch (err) {
                context.logger(`[AttachFiles] Warning: Could not read ${file}`);
            }
        }

        return { ...state, fileContents };
    }
}

