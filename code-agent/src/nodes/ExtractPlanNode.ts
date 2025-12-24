import { Node, PipelineContext } from '../pipeline/Pipeline';
import { AgentState } from '../pipeline/AgentState';
import { LMStudioClient } from '../llm/LMStudioClient';
import { ExtractPlanPromptBuilder, zodSchemaToJsonSchema } from '../prompts';

export class ExtractPlanNode implements Node<AgentState> {
    name = "ExtractPlan";

    async execute(state: AgentState, context: PipelineContext): Promise<AgentState> {
        context.logger("[ExtractPlan] Generating plan...");

        const client = new LMStudioClient(state.clientConfig);
        const promptBuilder = new ExtractPlanPromptBuilder();

        const messages = [
            { role: "system", content: promptBuilder.buildSystemPrompt() },
            {
                role: "user", content: promptBuilder.buildUserPrompt({
                    userTask: state.userTask,
                    fileContents: state.fileContents
                })
            }
        ];

        const jsonSchema = zodSchemaToJsonSchema(promptBuilder.getZodSchema());
        const rawResult = await client.completion(messages, jsonSchema, "ExtractPlanOutput");

        // Strict runtime validation
        const plan = promptBuilder.getZodSchema().parse(rawResult);

        context.logger(`[ExtractPlan] Plan generated: ${plan.restatement}`);
        plan.todos.forEach((todo, i) => {
            context.logger(`  ${i + 1}. ${todo.title}`);
        });

        return { ...state, plan };
    }
}
