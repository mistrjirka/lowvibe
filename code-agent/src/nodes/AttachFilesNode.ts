import * as fs from 'fs';
import * as path from 'path';
import { Node, PipelineContext } from '../pipeline/Pipeline';
import { AgentState } from '../pipeline/AgentState';

export class AttachFilesNode implements Node<AgentState> {
    name = "AttachFiles";

    async execute(state: AgentState, context: PipelineContext): Promise<AgentState> {
        context.logger("[AttachFiles] Reading file contents...");
        const fileContents = new Map<string, string>();

        for (const file of state.selectedFiles) {
            try {
                const content = fs.readFileSync(path.join(state.repoRoot, file), 'utf-8');
                fileContents.set(file, content);
            } catch (err) {
                context.logger(`[AttachFiles] Warning: Could not read ${file}`);
            }
        }

        return { ...state, fileContents };
    }
}
