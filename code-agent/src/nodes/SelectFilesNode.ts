import { Node, PipelineContext } from '../pipeline/Pipeline';
import { AgentState } from '../pipeline/AgentState';
import { LMStudioClient } from '../llm/LMStudioClient';
import { SelectFilesPromptBuilder, zodSchemaToJsonSchema } from '../prompts';

export class SelectFilesNode implements Node<AgentState> {
    name = "SelectFiles";

    async execute(state: AgentState, context: PipelineContext): Promise<AgentState> {
        context.logger("[SelectFiles] Selecting relevant files...");

        const client = new LMStudioClient(state.clientConfig);
        const promptBuilder = new SelectFilesPromptBuilder();

        const messages = [
            { role: "system", content: promptBuilder.buildSystemPrompt() },
            {
                role: "user", content: promptBuilder.buildUserPrompt({
                    userTask: state.userTask,
                    fileList: state.allFiles
                })
            }
        ];

        const jsonSchema = zodSchemaToJsonSchema(promptBuilder.getZodSchema());
        const rawResult = await client.completion(messages, jsonSchema, "SelectFilesOutput");

        // Strict runtime validation
        const result = promptBuilder.getZodSchema().parse(rawResult);

        // Logic validation - only keep files that exist in our list
        const validFiles = result.files.filter((f) => state.allFiles.includes(f));

        context.logger(`[SelectFiles] Selected: ${validFiles.join(', ') || '(none)'}`);

        return { ...state, selectedFiles: validFiles };
    }
}
