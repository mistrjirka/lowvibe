import * as fs from 'fs';
import * as path from 'path';
import { Node, PipelineContext } from '../pipeline/Pipeline';
import { AgentState } from '../pipeline/AgentState';

export class ScanWorkspaceNode implements Node<AgentState> {
    name = "ScanWorkspace";

    async execute(state: AgentState, context: PipelineContext): Promise<AgentState> {
        context.logger("[ScanWorkspace] Scanning files...");
        const files = this.getFiles(state.repoRoot);
        context.logger(`[ScanWorkspace] Found ${files.length} files.`);
        return { ...state, allFiles: files };
    }

    private getFiles(dir: string, baseDir: string = dir): string[] {
        let results: string[] = [];
        const list = fs.readdirSync(dir);

        const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.venv', '__pycache__', 'coverage']);

        for (const file of list) {
            if (ignoreDirs.has(file)) continue;

            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);

            if (stat && stat.isDirectory()) {
                results = results.concat(this.getFiles(filePath, baseDir));
            } else {
                results.push(path.relative(baseDir, filePath));
            }
        }
        return results;
    }
}
