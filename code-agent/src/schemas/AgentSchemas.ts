import { z } from 'zod';

// ============================================================================
// TOOL ARGUMENT SCHEMAS - each tool has explicit schema
// ============================================================================

// Thinker tools
export const ThinkerReadFileSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('read_file'),
    args: z.object({
        path: z.string().describe('Path to the file to read'),
        includeCallers: z.boolean().optional().describe('If true, find functions that call functions in this file')
    })
});

export const ThinkerRunCmdSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('run_cmd'),
    args: z.object({
        cmd: z.string().describe('Shell command to execute'),
        cwd: z.string().optional().describe('Working directory (relative to repo root)')
    })
});

export const ThinkerManageTodosSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('manage_todos'),
    args: z.object({
        action: z.enum(['add', 'complete', 'update']),
        todo: z.string()
    })
});

// Implementer tools
export const ImplAddFunctionSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('add_function'),
    args: z.object({
        path: z.string().describe('File path'),
        function_code: z.string().describe('Complete function code'),
        insert_after: z.string().optional().describe('Insert after this function name')
    })
});

export const ImplEditFunctionSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('edit_function'),
    args: z.object({
        path: z.string().describe('File path'),
        function_name: z.string().describe('Name of function to edit'),
        new_code: z.string().describe('New function code')
    })
});

export const ImplRemoveFunctionSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('remove_function'),
    args: z.object({
        path: z.string().describe('File path'),
        function_name: z.string().describe('Name of function to remove')
    })
});

export const ImplReadFileSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('read_file'),
    args: z.object({
        path: z.string().describe('File path')
    })
});

export const ImplReadFunctionSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('read_function'),
    args: z.object({
        path: z.string().describe('File path'),
        function_name: z.string().describe('Name of function to read')
    })
});

export const ImplWriteFileSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('write_file'),
    args: z.object({
        path: z.string().describe('File path'),
        content: z.string().describe('Complete file content to write')
    })
});

export const ImplGetFileOutlineSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('get_file_outline'),
    args: z.object({
        path: z.string().describe('File path')
    })
});

// Tester tools
export const TesterRunCmdSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('run_cmd'),
    args: z.object({
        cmd: z.string().describe('Shell command to execute'),
        cwd: z.string().optional().describe('Working directory')
    })
});

export const TesterCreateFileSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('create_file'),
    args: z.object({
        path: z.string().describe('File path'),
        content: z.string().describe('File content')
    })
});

export const TesterReadFileSchema = z.object({
    type: z.literal('tool_call'),
    tool: z.literal('read_file'),
    args: z.object({
        path: z.string().describe('File path')
    })
});

// ============================================================================
// THINKER AGENT SCHEMAS
// ============================================================================

export const ImplementTaskSchema = z.object({
    type: z.enum(['create_file', 'edit_file', 'delete_file']),
    task_description: z.string().describe('Goal of this task: what to implement, where to insert, which function to edit'),
    code: z.string().describe('Code to create, insert, or replace with'),
    file: z.string().describe('File path - new name for create_file, existing path for edit/delete')
});

export type ImplementTask = z.infer<typeof ImplementTaskSchema>;

export const ImplementToolSchema = z.object({
    description: z.string().describe('What we are trying to achieve overall'),
    tasks: z.array(ImplementTaskSchema).min(1).describe('List of file operations to perform'),
    test_files: z.array(z.string()).optional().describe('List of test files that should be used for validation (e.g. .in files, .txt inputs)')
});

export type ImplementToolCall = z.infer<typeof ImplementToolSchema>;

// Use z.union instead of discriminatedUnion to allow multiple tool_call options
export const ThinkerOutputSchema = z.union([
    z.object({
        type: z.literal('message'),
        text: z.string()
    }),
    ThinkerReadFileSchema,
    ThinkerRunCmdSchema,
    ThinkerManageTodosSchema,
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

export const ImplementerDoneSchema = z.object({
    type: z.literal('done'),
    summary: z.string().describe('Brief summary of what was implemented')
});

export type ImplementerDone = z.infer<typeof ImplementerDoneSchema>;

export const ImplementerErrorSchema = z.object({
    type: z.literal('error'),
    reason: z.string().describe('Why the task is impossible: function not found, unclear instructions, etc.')
});

export type ImplementerError = z.infer<typeof ImplementerErrorSchema>;

export const ImplementerOutputSchema = z.union([
    z.object({
        type: z.literal('message'),
        text: z.string()
    }),
    ImplAddFunctionSchema,
    ImplEditFunctionSchema,
    ImplRemoveFunctionSchema,
    ImplReadFileSchema,
    ImplReadFunctionSchema,
    ImplWriteFileSchema,
    ImplGetFileOutlineSchema,
    ImplementerDoneSchema,
    ImplementerErrorSchema
]);

export type ImplementerOutput = z.infer<typeof ImplementerOutputSchema>;

// ============================================================================
// TESTER AGENT SCHEMAS
// ============================================================================

export const TestResultSchema = z.object({
    successfully_implemented: z.boolean(),
    successes: z.string().describe('What worked and which parts to keep - empty if failed'),
    mistakes: z.string().describe('What went wrong, specific errors - empty if success'),
    tests_to_keep: z.array(z.string()).describe('Test file paths that should not be deleted (show mistakes)')
});

export type TestResult = z.infer<typeof TestResultSchema>;

export const TesterOutputSchema = z.union([
    z.object({
        type: z.literal('message'),
        text: z.string()
    }),
    TesterRunCmdSchema,
    TesterCreateFileSchema,
    TesterReadFileSchema,
    z.object({
        type: z.literal('result'),
        payload: TestResultSchema
    })
]);

export type TesterOutput = z.infer<typeof TesterOutputSchema>;

// ============================================================================
// FINISHER AGENT SCHEMAS  
// ============================================================================

export const TaskResultEntrySchema = z.object({
    task: ImplementTaskSchema,
    test_result: TestResultSchema
});

export type TaskResultEntry = z.infer<typeof TaskResultEntrySchema>;

export const FinisherFeedbackSchema = z.object({
    overall: z.string().describe('Summary of all task results and overall assessment'),
    task_results: z.array(TaskResultEntrySchema)
});

export type FinisherFeedback = z.infer<typeof FinisherFeedbackSchema>;

// ============================================================================
// COMMAND CORRECTOR SCHEMAS
// ============================================================================

export const CommandCorrectionSchema = z.object({
    corrected_cmd: z.string().describe('The corrected command string'),
    corrected_cwd: z.string().optional().describe('The corrected relative working directory. If root, omit or use "."'),
    reason: z.string().describe('Explanation of why correction was needed (e.g. "path fixed", "typo fixed", "verified correct")')
});

export type CommandCorrection = z.infer<typeof CommandCorrectionSchema>;
