import { z } from 'zod';
import { IPromptBuilder, ReasoningEffort } from './prompt.interface';

/**
 * Schema for supervisor output - the "debugging duck"
 */
export const SupervisorSchema = z.object({
    loopDetected: z.boolean().describe('Whether a loop or stuck pattern was detected'),
    progressMade: z.boolean().describe('Whether meaningful progress was made in last 5 steps'),
    codingAdvice: z.string().describe('Helpful coding advice based on what the agent is working on'),
    debuggingTips: z.string().describe('Specific debugging suggestions if there are errors'),
    nextStepSuggestion: z.string().describe('What the agent should focus on next'),
    todosToComplete: z.array(z.number()).describe('1-based indices of todos that appear to be done and should be marked complete'),
    confidence: z.string().describe('How confident the agent seems: low, medium, or high')
});

export type SupervisorOutput = z.infer<typeof SupervisorSchema>;

export interface SupervisorVariables {
    recentMessages: Array<{ role: string; content: string }>;
    todoStatus: Array<{ title: string; status?: string }>;
    recentToolOutputs: string[];
    recentErrors: string[];
    recentFiles: string[];
    userTask: string;        // Original user request
    planRestatement?: string; // High-level goal summary
}

/**
 * Prompt builder for the "debugging duck" supervisor
 */
export class SupervisorPromptBuilder implements IPromptBuilder<SupervisorVariables, SupervisorOutput> {
    getReasoningEffort(): ReasoningEffort {
        return 'medium';
    }

    getZodSchema(): z.ZodType<SupervisorOutput> {
        return SupervisorSchema;
    }

    buildSystemPrompt(): string {
        return `You are a "debugging duck" (Senior Dev/Supervisor) for an AI agent.
Your goal: Help the agent succeed by analyzing the CURRENT STATE and MOST RECENT OUTPUTS.

## Tone
Collaborative, Direct, Actionable. NO passive observation ("You are editing...").

## Critical Checks (Loop/Failure Detection)
Set loopDetected=true if:
- Same error repeated 2+ times
- Same tool call repeated identically
- "String to replace not found" error (Advice: "Use get_file_outline to see functions, then use edit_function instead of replace_in_file.")
- **Syntax error persisting after 2+ fix attempts** (Advice: "STOP editing. Use remove_function then add_function with correct code, OR create a NEW file from scratch.")
- **replace_in_file failures** (Advice: "STOP using replace_in_file. Use get_file_outline to see structure, then read_function + edit_function for reliable edits.")

## AST Tools (RECOMMEND THESE)
When the agent struggles with file edits, recommend:
- get_file_outline: See functions/classes/variables with line numbers
- read_function: Read specific function by name
- edit_function: Replace entire function (safer than find/replace)
- add_function: Insert code at specific line
- remove_function: Delete function by name
These are MORE RELIABLE than replace_in_file.

## Your Output
1. codingAdvice: Specific technical advice for the code.
2. debuggingTips: Fixes for errors.
3. nextStepSuggestion: Directive for immediate next action.
4. todosToComplete: Indices of DONE tasks.

## Focus
- Focus heavily on the MOST RECENT tool output (usually the last run_cmd).
- Ensure the agent isn't hallucinating success.
- **C/C++ CHECK**: If working on C/C++, verify the agent compiled (clang++/clang) before running. If not, advise: "Compile first with clang++ -o program program.cpp before running."
- If syntax errors persist, ALWAYS suggest using AST tools or creating a fresh file.`;
    }

    buildUserPrompt(variables: SupervisorVariables): string {
        // Search for last 2 run_cmds to define context window
        let contextStartIndex = 0;
        let runCmdCount = 0;

        // Iterate backwards through the 50 messages provided
        for (let i = variables.recentMessages.length - 1; i >= 0; i--) {
            const msg = variables.recentMessages[i];
            // Check for run_cmd tool call in assistant message
            if (msg.role === 'assistant' && msg.content.includes('"tool":"run_cmd"')) {
                runCmdCount++;
                if (runCmdCount === 2) {
                    // Found the 2nd to last run_cmd. Start from the message BEFORE it.
                    contextStartIndex = Math.max(0, i - 1);
                    break;
                }
            }
        }

        // Fallback: If less than 2 run_cmds found, use last 15 messages
        if (runCmdCount < 2) {
            contextStartIndex = Math.max(0, variables.recentMessages.length - 15);
        }

        const relevantMessages = variables.recentMessages.slice(contextStartIndex);

        const messagesPreview = relevantMessages
            .map((m) => {
                // No truncation - duck needs full file contents to debug effectively
                return `[${m.role}] ${m.content}`;
            })
            .join('\n\n');

        const todoList = variables.todoStatus
            .map((t, i) => `${i + 1}. [${t.status || 'pending'}] ${t.title}`)
            .join('\n');

        const toolOutputs = variables.recentToolOutputs.length > 0
            ? variables.recentToolOutputs.slice(-5).join('\n---\n')
            : '(no recent tool outputs)';

        const errors = variables.recentErrors.length > 0
            ? variables.recentErrors.join('\n')
            : '(none)';

        const files = variables.recentFiles.length > 0
            ? variables.recentFiles.join(', ')
            : '(none)';

        return `## 🎯 ORIGINAL USER GOAL:
"${variables.userTask}"

## 📝 PLAN OVERVIEW:
${variables.planRestatement || '(no plan summary)'}

## Agent's Recent Work (last 10 messages):
${messagesPreview}

## Todo Status:
${todoList}

## Recent Tool Outputs:
${toolOutputs}

## Errors Encountered:
${errors}

## Files Being Worked On:
${files}

Please analyze the progress towards the ORIGINAL GOAL and provide your debugging duck advice. If any todos appear complete, list their indices.`;
    }
}
