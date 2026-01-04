import { z } from 'zod';

// ============================================================================
// THINKER AGENT SCHEMAS
// ============================================================================

/**
 * Single implementation task within an implement call
 */
export const ImplementTaskSchema = z.object({
    type: z.enum(['create_file', 'edit_file', 'delete_file']),
    task_description: z.string().describe('Goal of this task: what to implement, where to insert, which function to edit'),
    code: z.string().describe('Code to create, insert, or replace with'),
    file: z.string().describe('File path - new name for create_file, existing path for edit/delete')
});

export type ImplementTask = z.infer<typeof ImplementTaskSchema>;

/**
 * Implement tool call - Thinker uses this to dispatch work to Implementer
 */
export const ImplementToolSchema = z.object({
    description: z.string().describe('What we are trying to achieve overall'),
    tasks: z.array(ImplementTaskSchema).min(1).describe('List of file operations to perform')
});

export type ImplementToolCall = z.infer<typeof ImplementToolSchema>;

/**
 * Thinker can output: message, tool_call, or implement
 */
export const ThinkerOutputSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('message'),
        text: z.string()
    }),
    z.object({
        type: z.literal('tool_call'),
        tool: z.enum(['read_file', 'run_cmd', 'manage_todos']),
        args: z.record(z.string(), z.any())
    }),
    z.object({
        type: z.literal('implement'),
        payload: ImplementToolSchema
    }),
    z.object({
        type: z.literal('final'),
        text: z.string(),
        criteriaStatus: z.enum(['success', 'partial', 'blocked'])
    })
]);

export type ThinkerOutput = z.infer<typeof ThinkerOutputSchema>;

// ============================================================================
// IMPLEMENTER AGENT SCHEMAS
// ============================================================================

/**
 * Implementer done signal - task completed successfully
 */
export const ImplementerDoneSchema = z.object({
    type: z.literal('done'),
    summary: z.string().describe('Brief summary of what was implemented')
});

export type ImplementerDone = z.infer<typeof ImplementerDoneSchema>;

/**
 * Implementer error signal - task cannot be completed
 */
export const ImplementerErrorSchema = z.object({
    type: z.literal('error'),
    reason: z.string().describe('Why the task is impossible: function not found, unclear instructions, etc.')
});

export type ImplementerError = z.infer<typeof ImplementerErrorSchema>;

/**
 * Implementer can output: message, tool_call, done, or error
 */
export const ImplementerOutputSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('message'),
        text: z.string()
    }),
    z.object({
        type: z.literal('tool_call'),
        tool: z.enum(['add_function', 'edit_function', 'remove_function', 'read_file', 'read_function', 'write_file', 'get_file_outline']),
        args: z.record(z.string(), z.any())
    }),
    ImplementerDoneSchema,
    ImplementerErrorSchema
]);

export type ImplementerOutput = z.infer<typeof ImplementerOutputSchema>;

// ============================================================================
// TESTER AGENT SCHEMAS
// ============================================================================

/**
 * Test result from Tester agent
 */
export const TestResultSchema = z.object({
    successfully_implemented: z.boolean(),
    successes: z.string().describe('What worked and which parts to keep - empty if failed'),
    mistakes: z.string().describe('What went wrong, specific errors - empty if success'),
    tests_to_keep: z.array(z.string()).describe('Test file paths that should not be deleted (show mistakes)')
});

export type TestResult = z.infer<typeof TestResultSchema>;

/**
 * Tester can output: message, tool_call, or result
 */
export const TesterOutputSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('message'),
        text: z.string()
    }),
    z.object({
        type: z.literal('tool_call'),
        tool: z.enum(['run_cmd', 'create_file', 'read_file']),
        args: z.record(z.string(), z.any())
    }),
    z.object({
        type: z.literal('result'),
        payload: TestResultSchema
    })
]);

export type TesterOutput = z.infer<typeof TesterOutputSchema>;

// ============================================================================
// FINISHER AGENT SCHEMAS
// ============================================================================

/**
 * Task result with test outcome - used in Finisher feedback
 */
export const TaskResultSchema = z.object({
    task: ImplementTaskSchema,
    test_result: TestResultSchema
});

export type TaskResultEntry = z.infer<typeof TaskResultSchema>;

/**
 * Finisher feedback - sent back to Thinker
 */
export const FinisherFeedbackSchema = z.object({
    overall: z.string().describe('Common error patterns, what is being done wrong, what to focus on'),
    task_results: z.array(TaskResultSchema).describe('Pre-filled from Tester outputs')
});

export type FinisherFeedback = z.infer<typeof FinisherFeedbackSchema>;

// ============================================================================
// CALLER INFO (for enhanced read_file)
// ============================================================================

/**
 * Information about a function caller
 */
export const CallerInfoSchema = z.object({
    file: z.string().describe('Path to the file containing the caller'),
    functionName: z.string().describe('Qualified name: ClassName.method or standalone function'),
    line: z.number().describe('Line number of the call')
});

export type CallerInfo = z.infer<typeof CallerInfoSchema>;

/**
 * Enhanced read_file result with caller information
 */
export const EnhancedReadFileResultSchema = z.object({
    content: z.string(),
    outline: z.array(z.object({
        name: z.string(),
        type: z.enum(['function', 'class', 'method']),
        startLine: z.number(),
        endLine: z.number()
    })),
    callers: z.record(z.string(), z.array(CallerInfoSchema)).describe('Map of function name to list of callers')
});

export type EnhancedReadFileResult = z.infer<typeof EnhancedReadFileResultSchema>;
