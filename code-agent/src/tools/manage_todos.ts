import { z } from 'zod';
import { Plan } from '../pipeline/AgentState';

// Schema for mark_todo_done args
export const MarkTodoDoneSchema = z.object({
    index: z.number().describe('1-based todo index')
});

// Schema for add_todo args
export const AddTodoSchema = z.object({
    position: z.number().describe('1-based position to insert at (0 = append to end)'),
    title: z.string(),
    details: z.string()
});

// Schema for update_todo args
export const UpdateTodoSchema = z.object({
    index: z.number().describe('1-based todo index'),
    title: z.string().optional(),
    details: z.string().optional(),
    status: z.enum(['pending', 'completed', 'failed']).optional()
});

export type MarkTodoDoneArgs = z.infer<typeof MarkTodoDoneSchema>;
export type AddTodoArgs = z.infer<typeof AddTodoSchema>;
export type UpdateTodoArgs = z.infer<typeof UpdateTodoSchema>;

/**
 * Mark a todo as done by index (1-based)
 */
export function markTodoDone(plan: Plan, args: MarkTodoDoneArgs): { success: boolean; message: string } {
    const idx = args.index - 1; // Convert to 0-based

    if (idx < 0 || idx >= plan.todos.length) {
        return {
            success: false,
            message: `Invalid todo index ${args.index}. Valid range: 1-${plan.todos.length}`
        };
    }

    const todo = plan.todos[idx];
    todo.status = 'completed';

    return {
        success: true,
        message: `Marked todo #${args.index} "${todo.title}" as done ✓`
    };
}

/**
 * Add a new todo at the specified position
 */
export function addTodo(plan: Plan, args: AddTodoArgs): { success: boolean; message: string } {
    const newTodo = {
        title: args.title,
        details: args.details,
        acceptanceCriteria: [],
        status: 'pending' as const
    };

    if (args.position <= 0 || args.position > plan.todos.length) {
        // Append to end
        plan.todos.push(newTodo);
        return {
            success: true,
            message: `Added new todo #${plan.todos.length}: "${args.title}"`
        };
    }

    // Insert at position (1-based)
    const insertIdx = args.position - 1;
    plan.todos.splice(insertIdx, 0, newTodo);

    return {
        success: true,
        message: `Inserted new todo #${args.position}: "${args.title}"`
    };
}

/**
 * Update an existing todo
 */
export function updateTodo(plan: Plan, args: UpdateTodoArgs): { success: boolean; message: string } {
    const idx = args.index - 1;

    if (idx < 0 || idx >= plan.todos.length) {
        return {
            success: false,
            message: `Invalid todo index ${args.index}. Valid range: 1-${plan.todos.length}`
        };
    }

    const todo = plan.todos[idx];
    const changes: string[] = [];

    if (args.title !== undefined) {
        todo.title = args.title;
        changes.push('title');
    }
    if (args.details !== undefined) {
        todo.details = args.details;
        changes.push('details');
    }
    if (args.status !== undefined) {
        todo.status = args.status;
        changes.push(`status→${args.status}`);
    }

    return {
        success: true,
        message: `Updated todo #${args.index}: ${changes.join(', ')}`
    };
}
